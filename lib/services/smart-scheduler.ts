import prisma from '@/lib/prisma'
import { wallClockIn } from '@/lib/appointment-time'
import { communicationPreferences, mayContact } from '@/lib/communication-preferences'

/**
 * Smart Scheduler Service
 * When an appointment is cancelled, this service finds waitlisted patients
 * who match the freed slot and offers it to them by text.
 */

interface CancelledSlot {
  hospitalId: string
  doctorId: string
  startsAt: Date
  duration: number
  /** The clinic's zone: which weekday a slot falls on depends on it. */
  timezone: string
}

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/**
 * The weekday a slot falls on, in the clinic's zone rather than the server's —
 * a Monday 09:00 appointment in Karachi is still Sunday in UTC, and the
 * waitlist matches on the patient's preferred *days*.
 */
function getDayOfWeek(slot: CancelledSlot): string {
  const { scheduledDate } = wallClockIn(slot.startsAt, slot.timezone)
  return DAY_NAMES[new Date(`${scheduledDate}T00:00:00Z`).getUTCDay()]
}

function getTimeOfDay(time: string): string {
  const hour = parseInt(time.split(':')[0])
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
  return 'EVENING'
}

/**
 * Find waitlisted patients that match a cancelled appointment slot
 */
export async function findMatchingWaitlistPatients(slot: CancelledSlot): Promise<
  Array<{
    id: string
    patientId: string
    patientName: string
    patientPhone: string
  }>
> {
  const dayOfWeek = getDayOfWeek(slot)
  const timeOfDay = getTimeOfDay(wallClockIn(slot.startsAt, slot.timezone).scheduledTime)

  // Find active waitlist entries for this hospital
  const waitlistEntries = await prisma.waitlist.findMany({
    where: {
      hospitalId: slot.hospitalId,
      status: 'ACTIVE',
      OR: [
        { doctorId: slot.doctorId },
        { doctorId: null }, // No doctor preference
      ],
    },
    orderBy: { createdAt: 'asc' }, // First come, first served
  })

  // Filter by preferred days and time
  const matching = waitlistEntries.filter((entry) => {
    // Check preferred days
    if (entry.preferredDays) {
      const days = entry.preferredDays as string[]
      if (days.length > 0 && !days.includes(dayOfWeek)) {
        return false
      }
    }

    // Check preferred time
    if (entry.preferredTime && entry.preferredTime !== timeOfDay) {
      return false
    }

    return true
  })

  if (matching.length === 0) return []

  // Fetch patient details for matching entries
  const patientIds = matching.map((e) => e.patientId)
  const patients = await prisma.patient.findMany({
    where: {
      id: { in: patientIds },
      hospitalId: slot.hospitalId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  })

  const patientMap = new Map(patients.map((p) => [p.id, p]))

  return matching
    .map((entry) => {
      const patient = patientMap.get(entry.patientId)
      if (!patient) return null
      return {
        id: entry.id,
        patientId: patient.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
        patientPhone: patient.phone,
      }
    })
    .filter(Boolean) as Array<{
    id: string
    patientId: string
    patientName: string
    patientPhone: string
  }>
}

/** One waitlisted patient offered a freed slot, and whether a text went to them. */
export interface WaitlistOffer {
  waitlistId: string
  patientId: string
  name: string
  phone: string
  /** A text offering the slot was queued. When false, `reason` says why and the desk should call. */
  messaged: boolean
  reason?: string
}

/**
 * Process a cancelled appointment: offer the freed slot to the first matching
 * patients on the waitlist.
 *
 * Each is sent a text, queued like every other message the clinic sends, so it
 * goes out with the clinic's own gateway, respects the patient's consent for
 * appointment messages and appears in their message history. This used to mark
 * the entries NOTIFIED and send nothing, while the waitlist page told the desk
 * patients were "automatically notified" (bug report 16 Oct, finding 5).
 *
 * A patient who cannot be texted is still offered the slot and marked NOTIFIED;
 * the cancellation's response names them so the desk can phone instead.
 */
export async function handleCancellationWaitlist(slot: CancelledSlot): Promise<{
  offers: WaitlistOffer[]
  slotDetails: {
    date: string
    time: string
    doctorName: string
  }
}> {
  const matches = await findMatchingWaitlistPatients(slot)

  const [doctor, hospital] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: slot.doctorId },
      select: { firstName: true, lastName: true },
    }),
    prisma.hospital.findUnique({
      where: { id: slot.hospitalId },
      select: { name: true, phone: true },
    }),
  ])

  const doctorName = doctor ? `Dr. ${doctor.firstName} ${doctor.lastName}` : 'your doctor'
  const dateStr = new Intl.DateTimeFormat('en-PK', {
    timeZone: slot.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(slot.startsAt)
  const time = wallClockIn(slot.startsAt, slot.timezone).scheduledTime
  const slotDetails = { date: dateStr, time, doctorName }

  // The first three in the queue, so one slot is not offered to the whole list.
  const toOffer = matches.slice(0, 3)
  if (toOffer.length === 0) return { offers: [], slotDetails }

  const patients = await prisma.patient.findMany({
    where: { id: { in: toOffer.map((m) => m.patientId) }, hospitalId: slot.hospitalId },
    select: { id: true, communicationPrefs: true },
  })
  const prefsOf = new Map(patients.map((p) => [p.id, p.communicationPrefs]))

  const body =
    `${hospital?.name ?? 'Your clinic'}: an appointment with ${doctorName} has come free on ` +
    `${dateStr} at ${time}.` +
    (hospital?.phone ? ` Call ${hospital.phone} to book it.` : ' Call the clinic to book it.')

  const now = new Date()
  const offers: WaitlistOffer[] = []

  for (const match of toOffer) {
    const decision = mayContact(
      communicationPreferences(prefsOf.get(match.patientId)),
      'SMS',
      'appointmentReminders'
    )
    const offer: WaitlistOffer = {
      waitlistId: match.id,
      patientId: match.patientId,
      name: match.patientName,
      phone: match.patientPhone,
      messaged: false,
    }

    if (!match.patientPhone) {
      offer.reason = 'No mobile number'
    } else if (!decision.allowed) {
      offer.reason = decision.reason
    } else {
      await prisma.messageLog.create({
        data: {
          hospitalId: slot.hospitalId,
          channel: 'SMS',
          patientId: match.patientId,
          recipient: match.patientPhone,
          body,
          relatedType: 'Waitlist',
          relatedId: match.id,
          scheduledFor: now,
          status: 'PENDING',
          // Read by the dispatcher, which re-checks consent at the moment of
          // sending.
          metadata: { kind: 'appointmentReminders' },
        },
      })
      offer.messaged = true
    }

    offers.push(offer)
  }

  await prisma.waitlist.updateMany({
    where: { id: { in: toOffer.map((m) => m.id) }, hospitalId: slot.hospitalId },
    data: { status: 'NOTIFIED', notifiedAt: now },
  })

  return { offers, slotDetails }
}

/** The waitlist states a patient is still waiting in. */
export const OPEN_WAITLIST_STATUSES = ['ACTIVE', 'NOTIFIED'] as const

/**
 * Close a waitlist entry because its patient has been booked.
 *
 * Called by the booking route when New Appointment was opened from the
 * waitlist's Book action. Scoped to the clinic and the patient, so an entry id
 * from elsewhere, or for somebody else, closes nothing. Returns whether it did.
 */
export async function bookFromWaitlist(
  db: Pick<typeof prisma, 'waitlist'>,
  entry: { waitlistId: string; hospitalId: string; patientId: string }
): Promise<boolean> {
  const { count } = await db.waitlist.updateMany({
    where: {
      id: entry.waitlistId,
      hospitalId: entry.hospitalId,
      patientId: entry.patientId,
      status: { in: [...OPEN_WAITLIST_STATUSES] },
    },
    data: { status: 'BOOKED', bookedAt: new Date() },
  })
  return count > 0
}

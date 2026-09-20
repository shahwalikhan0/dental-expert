import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cronAuthorised, cronUnauthorised } from '@/lib/cron-auth'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * GET /api/cron/reminders — meant to run hourly.
 *
 * Queues the day-before reminder for every upcoming appointment, and a second
 * one a few hours before for patients with a history of not turning up.
 * Dispatch is somebody else's job: these rows sit at PENDING with a
 * `scheduledFor`, and `/api/cron/dispatch` sends them when they fall due.
 *
 * This is the only thing that queues an appointment reminder. The
 * communication-triggers job used to send its own, immediately, in parallel —
 * two systems reminding the same patient about the same appointment, neither
 * aware of the other.
 *
 * Reminders are `MessageLog` rows tagged `relatedType: 'Appointment'`. They
 * used to be their own table, which recorded that a reminder had been scheduled
 * and nothing about what it said or whether it arrived — so a patient insisting
 * they were never reminded could be shown a row saying SENT and no more.
 *
 * The one route in the application that deliberately reads across clinics: it
 * authenticates on CRON_SECRET, and no clinic can call it.
 *
 * Scheduled hourly. `npm run scheduler` runs it on a plain host; `vercel.json`
 * carries the same schedule for a Vercel deployment. Both are generated from
 * lib/jobs.ts, and whatever calls it must send
 * `Authorization: Bearer $CRON_SECRET`. See docs/SCHEDULING.md.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return cronUnauthorised()

  const now = new Date()

  // Everything starting in the next two days. Two rather than one because an
  // appointment early the day after tomorrow needs its day-before reminder
  // queued tonight.
  //
  // This used to filter a `@db.Date` column with `scheduledDate >= now`, which
  // against a column holding midnight means every appointment later today was
  // skipped: a 4pm appointment was never found by a cron running at 9am. The
  // column is an instant now, so the window says what it means.
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
      startsAt: { gte: now, lte: new Date(now.getTime() + 2 * DAY) },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  })

  // Which reminders already exist, keyed by appointment *and* send time.
  //
  // This used to be keyed by appointment alone, which made any existing
  // reminder suppress every other one: the 24-hour reminder sent by the
  // communication triggers left a SENT row, so the hour-before reminder queued
  // here was skipped for every appointment that had had one. The two are
  // different messages at different times and both are wanted.
  const existingReminders = new Set(
    (
      await prisma.messageLog.findMany({
        where: {
          relatedType: 'Appointment',
          relatedId: { in: appointments.map((a) => a.id) },
          status: { in: ['PENDING', 'QUEUED', 'SENT', 'DELIVERED'] },
        },
        select: { relatedId: true, scheduledFor: true },
      })
    ).map((m) => `${m.relatedId}@${m.scheduledFor?.toISOString() ?? 'immediate'}`)
  )

  const alreadyQueued = (appointmentId: string, at: Date) =>
    existingReminders.has(`${appointmentId}@${at.toISOString()}`)

  // Gather no-show history for risk assessment.
  //
  // Walk-ins are excluded rather than given a risk of zero: a visitor has no
  // history to have a rate over, and reminding somebody who left a name at the
  // desk about a booking they did not make is how a clinic gets a reputation
  // for texting strangers.
  const patientIds = appointments.map((a) => a.patientId).filter((id): id is string => id !== null)
  const uniquePatientIds = [...new Set(patientIds)]
  const noShowCounts = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: {
      patientId: { in: uniquePatientIds },
      status: 'NO_SHOW',
    },
    _count: true,
  })
  const totalCounts = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: {
      patientId: { in: uniquePatientIds },
      startsAt: { lt: now },
    },
    _count: true,
  })
  const noShowMap: Record<string, number> = {}
  const totalMap: Record<string, number> = {}
  for (const ns of noShowCounts) if (ns.patientId) noShowMap[ns.patientId] = ns._count
  for (const t of totalCounts) if (t.patientId) totalMap[t.patientId] = t._count

  let created = 0
  let extraReminders = 0
  for (const appt of appointments) {
    // No patient record, no reminder. See the note on `patientIds` above.
    const patientId = appt.patientId
    const patient = appt.patient
    if (!patientId || !patient) continue

    const startsAt = appt.startsAt

    // Assess no-show risk: high if >30% no-show rate with at least 2 past appointments
    const total = totalMap[patientId] ?? 0
    const noShows = noShowMap[patientId] ?? 0
    const isHighRisk = total >= 2 && noShows / total > 0.3

    // Everybody gets the day-before reminder; patients with a history of not
    // turning up get a second nudge a few hours before.
    //
    // The day-before one is what the communication triggers had been sending
    // directly, and it is kept because it is what clinics have been getting.
    // The queue used to schedule its main reminder an hour before instead,
    // which would have replaced a day's notice with sixty minutes' — for a
    // patient who has to arrange time off, that is not a reminder.
    //
    // A reminder whose moment has already gone is not queued. The dispatcher
    // would send it the instant it ran, which for an appointment starting in
    // twenty minutes is a message arriving after the patient has left home.
    const at = [
      { when: new Date(startsAt.getTime() - 24 * HOUR), extra: false },
      ...(isHighRisk ? [{ when: new Date(startsAt.getTime() - 3 * HOUR), extra: true }] : []),
    ]

    for (const reminder of at) {
      if (reminder.when <= now) continue
      if (alreadyQueued(appt.id, reminder.when)) continue

      await queueReminder(
        { id: appt.id, hospitalId: appt.hospitalId, patientId, patient },
        reminder.when
      )
      if (reminder.extra) extraReminders++
      else created++
    }
  }

  return NextResponse.json({
    checked: appointments.length,
    created,
    extraReminders,
    processedAt: now.toISOString(),
  })
}

/**
 * A queued reminder, with no body yet.
 *
 * The wording comes from the clinic's own appointment template at send time,
 * not now — a template edited this afternoon should change the reminder that
 * goes out this evening, and freezing the text here would mean it did not.
 */
async function queueReminder(
  appointment: { id: string; hospitalId: string; patientId: string; patient: { phone: string } },
  scheduledFor: Date
) {
  await prisma.messageLog.create({
    data: {
      hospitalId: appointment.hospitalId,
      channel: 'SMS',
      patientId: appointment.patientId,
      recipient: appointment.patient.phone,
      body: '',
      relatedType: 'Appointment',
      relatedId: appointment.id,
      scheduledFor,
      status: 'PENDING',
      // What the message is for, so the dispatcher can re-check consent for
      // this kind alone rather than for the channel as a whole.
      metadata: { kind: 'appointmentReminders' },
    },
  })
}

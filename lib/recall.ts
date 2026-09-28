import { prisma } from '@/lib/prisma'
import { templateService } from '@/lib/services/template.service'
import { communicationPreferences, mayContact } from '@/lib/communication-preferences'
import { formatDate } from '@/lib/i18n/format'
import { RECALL_COOLDOWN_DAYS } from '@/lib/recare'
import type { CommunicationChannel } from '@prisma/client'

// The cooling-off period lives in lib/recare.ts, which the recall list
// screen can import without dragging a Prisma client into the browser.
export { RECALL_COOLDOWN_DAYS }

/**
 * Telling the people on the recall list that they are on it.
 *
 * `lib/recare.ts` finds who should be in the chair and is not booked. That was
 * the hard half and it was the only half: the due list was a screen somebody
 * looked at, and nothing recorded whether a single person on it had ever been
 * contacted. Two consequences, and the second is the expensive one:
 *
 *  - the desk working the list on Tuesday and again on Friday sent the same
 *    patient the same message twice, because neither pass could see the other;
 *  - no report could say what proportion of the overdue list had been
 *    contacted, or how many of those contacted came back — which is the only
 *    number that says whether recall is working at all.
 *
 * Messages go through `MessageLog` like every other message this application
 * sends, tagged `relatedType: 'Recare'`, so they appear in the communications
 * log, obey the clinic's send window, and are dispatched by the same cron.
 * Nothing here talks to Twilio.
 *
 * The wording is rendered **now** rather than at send time, which is the
 * opposite of what appointment reminders do. Two reasons: the dispatcher only
 * knows how to render an appointment, and a recall send is started by a person
 * working a list who should be able to see what is about to go out in their
 * name.
 */

/** Wording used when the clinic has no follow-up template of its own. */
const FALLBACK_BODY: Record<string, string> = {
  SMS: 'Dear {{patientName}}, you are due for your {{recareType}} at {{clinicName}}. Please call {{clinicPhone}} to book a time.',
  WHATSAPP:
    'Dear {{patientName}}, you are due for your {{recareType}} at {{clinicName}}. Please call {{clinicPhone}} to book a time.',
  EMAIL:
    '<p>Dear {{patientName}},</p><p>You are due for your <strong>{{recareType}}</strong> at {{clinicName}}{{lastVisitClause}}.</p><p>Please call us on {{clinicPhone}} and we will find you a time.</p><p>{{clinicName}}</p>',
}

const FALLBACK_SUBJECT = 'Time for your {{recareType}}'

export type RecallSkipReason =
  'NO_CONTACT_DETAILS' | 'CONSENT' | 'RECENTLY_CONTACTED' | 'NOT_ACTIVE' | 'GONE'

export interface RecallOutcome {
  recareId: string
  patientName: string
  queued: boolean
  reason?: RecallSkipReason
  /** Something a person can read, for the toast and the audit trail. */
  detail?: string
}

export interface RecallRun {
  queued: number
  skipped: number
  outcomes: RecallOutcome[]
}

/** The variables a recall template may use. */
export function recallVariables(recare: {
  dueDate: Date
  lastDoneAt: Date | null
  patient: { firstName: string; lastName: string }
  recareType: { name: string }
  hospital: { name: string; phone: string | null; locale: string }
}): Record<string, string> {
  const locale = recare.hospital.locale

  return {
    patientName: `${recare.patient.firstName} ${recare.patient.lastName}`,
    firstName: recare.patient.firstName,
    recareType: recare.recareType.name.toLowerCase(),
    clinicName: recare.hospital.name,
    clinicPhone: recare.hospital.phone ?? '',
    dueDate: formatDate(recare.dueDate, { locale }),
    lastVisit: recare.lastDoneAt ? formatDate(recare.lastDoneAt, { locale }) : '',
    // A clause rather than a bare date, so a template can carry it without
    // producing "…at the clinic, last seen ." for somebody who has never had
    // this kind of visit recorded.
    lastVisitClause: recare.lastDoneAt
      ? `, where we last saw you on ${formatDate(recare.lastDoneAt, { locale })}`
      : '',
  }
}

/**
 * Queue a recall message for each of these recares.
 *
 * Every refusal is reported rather than swallowed. A desk that selects forty
 * patients and is told "38 queued" needs to know that one had no mobile number
 * and one had asked not to be contacted — those are two different pieces of
 * follow-up work, and a silent drop is how a patient stops hearing from a
 * practice without anybody deciding that they should.
 */
export async function queueRecallMessages(
  hospitalId: string,
  recareIds: string[],
  options: { channel?: CommunicationChannel; force?: boolean; now?: Date } = {}
): Promise<RecallRun> {
  const channel = options.channel ?? 'SMS'
  const now = options.now ?? new Date()
  const cooldownFrom = new Date(now.getTime() - RECALL_COOLDOWN_DAYS * 86400000)

  const recares = await prisma.recare.findMany({
    where: { hospitalId, id: { in: recareIds } },
    select: {
      id: true,
      dueDate: true,
      lastDoneAt: true,
      status: true,
      lastContactedAt: true,
      patient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          isActive: true,
          communicationPrefs: true,
        },
      },
      recareType: { select: { name: true } },
      hospital: { select: { name: true, phone: true, locale: true } },
    },
  })

  const template = await templateService.getDefaultTemplate(hospitalId, 'FOLLOW_UP', channel)

  const outcomes: RecallOutcome[] = []

  for (const recare of recares) {
    const name = `${recare.patient.firstName} ${recare.patient.lastName}`
    const skip = (reason: RecallSkipReason, detail: string) =>
      outcomes.push({ recareId: recare.id, patientName: name, queued: false, reason, detail })

    // OPTED_OUT and INACTIVE are answers the patient or the practice already
    // gave. Chasing them would be the software overruling a decision.
    if (recare.status !== 'ACTIVE' || !recare.patient.isActive) {
      skip('NOT_ACTIVE', 'Not on the active recall list')
      continue
    }

    if (!options.force && recare.lastContactedAt && recare.lastContactedAt > cooldownFrom) {
      skip(
        'RECENTLY_CONTACTED',
        `Already contacted on ${formatDate(recare.lastContactedAt, { locale: recare.hospital.locale })}`
      )
      continue
    }

    const decision = mayContact(
      communicationPreferences(recare.patient.communicationPrefs),
      channel,
      'recallReminders'
    )
    if (!decision.allowed) {
      skip('CONSENT', decision.reason)
      continue
    }

    const recipient = channel === 'EMAIL' ? recare.patient.email : recare.patient.phone
    if (!recipient) {
      skip('NO_CONTACT_DETAILS', channel === 'EMAIL' ? 'No email address' : 'No mobile number')
      continue
    }

    const variables = recallVariables(recare)
    const body = templateService.replaceVariables(
      template?.content ?? FALLBACK_BODY[channel] ?? FALLBACK_BODY.SMS,
      variables
    )
    const subject =
      channel === 'EMAIL'
        ? templateService.replaceVariables(template?.subject ?? FALLBACK_SUBJECT, variables)
        : undefined

    // The message and the contact record are one write. A queued message the
    // recare does not know about is how the list gets worked twice.
    await prisma.$transaction([
      prisma.messageLog.create({
        data: {
          hospitalId,
          channel,
          patientId: recare.patient.id,
          recipient,
          subject,
          body,
          templateId: template?.id,
          relatedType: 'Recare',
          relatedId: recare.id,
          scheduledFor: now,
          status: 'PENDING',
          // Read by the dispatcher, which re-checks consent for this kind
          // alone at the moment of sending.
          metadata: { kind: 'recallReminders' },
        },
      }),
      prisma.recare.update({
        where: { id: recare.id },
        data: { lastContactedAt: now, contactAttempts: { increment: 1 } },
      }),
    ])

    outcomes.push({ recareId: recare.id, patientName: name, queued: true })
  }

  // An id that matched nothing belongs to another clinic or has been deleted.
  // Reported rather than dropped, so a stale selection does not look like a
  // successful send.
  for (const id of recareIds) {
    if (!recares.some((recare) => recare.id === id)) {
      outcomes.push({
        recareId: id,
        patientName: 'Unknown',
        queued: false,
        reason: 'GONE',
        detail: 'That recall is no longer on the list',
      })
    }
  }

  return {
    queued: outcomes.filter((outcome) => outcome.queued).length,
    skipped: outcomes.filter((outcome) => !outcome.queued).length,
    outcomes,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Did it work?
// ────────────────────────────────────────────────────────────────────────────

export interface RecallPerformance {
  /** Recares whose due date fell inside the window. */
  due: number
  /** Of those, how many the clinic contacted. */
  contacted: number
  /** Of those contacted, how many then booked. */
  booked: number
  /** Of those contacted, how many have since been seen. */
  attended: number
  /** booked ÷ contacted, as a percentage. The number that answers "is this working". */
  bookingRate: number
  /** contacted ÷ due. The number that answers "are we actually working the list". */
  coverage: number
  messagesSent: number
}

/**
 * How the recall list performed over a window.
 *
 * "Booked" means an appointment created *after* the patient was contacted, not
 * an appointment that happens to exist — somebody who was already booked for
 * next month and then got a reminder they did not need is not evidence that
 * recall works.
 *
 * Attribution is deliberately generous about the appointment's type and
 * strict about its timing. A patient rung about a scale and polish who books a
 * filling is still a patient the recall brought back; a patient who booked
 * before the call is not.
 */
export async function recallPerformance(
  hospitalId: string,
  window: { gte: Date; lte: Date }
): Promise<RecallPerformance> {
  const [due, contactedRecares, messagesSent] = await Promise.all([
    prisma.recare.count({
      where: { hospitalId, status: 'ACTIVE', dueDate: window },
    }),
    prisma.recare.findMany({
      where: { hospitalId, lastContactedAt: window },
      select: { id: true, patientId: true, lastContactedAt: true },
    }),
    prisma.messageLog.count({
      where: {
        hospitalId,
        relatedType: 'Recare',
        createdAt: window,
        status: { in: ['SENT', 'DELIVERED'] },
      },
    }),
  ])

  if (contactedRecares.length === 0) {
    return {
      due,
      contacted: 0,
      booked: 0,
      attended: 0,
      bookingRate: 0,
      coverage: 0,
      messagesSent,
    }
  }

  const patientIds = [...new Set(contactedRecares.map((recare) => recare.patientId))]

  // One query for every appointment those patients have made since the
  // earliest contact in the window, matched up in memory. The alternative is a
  // query per recare, and a recall campaign is hundreds of rows.
  const earliest = contactedRecares.reduce<Date>(
    (min, recare) =>
      recare.lastContactedAt && recare.lastContactedAt < min ? recare.lastContactedAt : min,
    window.lte
  )

  const appointments = await prisma.appointment.findMany({
    where: { hospitalId, patientId: { in: patientIds }, createdAt: { gte: earliest } },
    select: { patientId: true, createdAt: true, status: true },
  })

  const byPatient = new Map<string, { createdAt: Date; status: string }[]>()
  for (const appointment of appointments) {
    if (!appointment.patientId) continue
    const list = byPatient.get(appointment.patientId) ?? []
    list.push(appointment)
    byPatient.set(appointment.patientId, list)
  }

  let booked = 0
  let attended = 0

  for (const recare of contactedRecares) {
    const since = recare.lastContactedAt
    if (!since) continue

    const after = (byPatient.get(recare.patientId) ?? []).filter(
      (appointment) => appointment.createdAt >= since
    )
    if (after.length === 0) continue

    booked += 1
    if (after.some((appointment) => appointment.status === 'COMPLETED')) attended += 1
  }

  const contacted = contactedRecares.length

  return {
    due,
    contacted,
    booked,
    attended,
    messagesSent,
    bookingRate: contacted > 0 ? Math.round((booked / contacted) * 1000) / 10 : 0,
    coverage: due > 0 ? Math.round((contacted / due) * 1000) / 10 : 0,
  }
}

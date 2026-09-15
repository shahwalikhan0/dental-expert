/**
 * Sending the messages the clinic has queued.
 *
 * `/api/cron/reminders` writes a `MessageLog` row at PENDING with a
 * `scheduledFor`, and its own comment said "the sender picks them up". There
 * was no sender. Every reminder the hourly cron had ever queued was still
 * sitting at PENDING — the letter of FR-019 ("send **or** queue") met, and no
 * patient reminded.
 *
 * This is that sender. It is also where the send window finally means
 * something: `sendSMS` deliberately skips the window check for a scheduled
 * message, on the grounds that the question only matters at the moment of
 * sending, and the moment of sending never came.
 *
 * Three rules shape it:
 *
 *  1. **A clinic outside its send window is skipped, not failed.** Its messages
 *     stay PENDING and go out on the next run that falls inside the window.
 *     Failing them would mean an evening's reminders were lost because the cron
 *     ran at 21:05.
 *  2. **The wording is rendered now, not at queueing time.** A template edited
 *     this afternoon changes the reminder that goes out this evening, which is
 *     what the clinic expects of a template.
 *  3. **Consent is re-checked at send time.** A patient who opted out after the
 *     reminder was queued has opted out of it.
 */
import prisma from '@/lib/prisma'
import type { CommunicationChannel, MessageStatus, Prisma } from '@prisma/client'
import { smsService, type SMSConfig } from './sms.service'
import { emailService, type EmailConfig } from './email.service'
import { templateService } from './template.service'
import { isWithinSendWindow } from '@/lib/send-window'
import {
  communicationPreferences,
  mayContact,
  type MessageKind,
} from '@/lib/communication-preferences'
import type { Transporter } from 'nodemailer'
import { formatCalendarDay } from '@/lib/appointment-time'

/** How many messages one run will attempt, so a backlog cannot run forever. */
export const DISPATCH_BATCH_SIZE = 200

export interface DispatchResult {
  due: number
  sent: number
  /** Left PENDING for a later run — outside the clinic's send window. */
  deferred: number
  /** Not sent and never will be: the appointment moved, consent withdrawn. */
  cancelled: number
  failed: number
}

/**
 * What a queued message is about, for the consent check.
 *
 * Written into `metadata.kind` by whatever queues the message. The fallback on
 * `relatedType` covers rows queued before that was recorded, and is a map of
 * two entries rather than a guess: a message about an appointment is an
 * appointment reminder, and one about an invoice is a payment reminder.
 */
function kindOf(message: {
  metadata: Prisma.JsonValue | null
  relatedType: string | null
}): MessageKind | undefined {
  const stored =
    message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>).kind
      : undefined

  if (typeof stored === 'string') return stored as MessageKind

  if (message.relatedType === 'Appointment') return 'appointmentReminders'
  if (message.relatedType === 'Invoice') return 'paymentReminders'
  return undefined
}

/** The variables an appointment reminder template can use. */
export function appointmentVariables(appointment: {
  appointmentNo: string
  scheduledDate: Date
  scheduledTime: string
  patient: { firstName: string; lastName: string }
  doctor: { firstName: string; lastName: string } | null
  chair: { name: string } | null
  hospital: { name: string; phone: string | null }
}): Record<string, string> {
  return {
    patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
    firstName: appointment.patient.firstName,
    appointmentDate: formatCalendarDay(appointment.scheduledDate),
    appointmentTime: appointment.scheduledTime,
    appointmentNo: appointment.appointmentNo,
    doctorName: appointment.doctor
      ? `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`
      : 'your dentist',
    chair: appointment.chair?.name || 'TBA',
    // Kept as an alias so templates written against the old variable name keep
    // rendering; only `chair` is offered in the variable picker.
    chairNumber: appointment.chair?.name || 'TBA',
    clinicName: appointment.hospital.name,
    clinicPhone: appointment.hospital.phone || '',
  }
}

/** Appointments that no longer want reminding about. */
const DEAD_APPOINTMENT_STATUSES = ['CANCELLED', 'COMPLETED', 'NO_SHOW']

type QueuedMessage = Awaited<ReturnType<typeof dueMessages>>[number]

function dueMessages(now: Date) {
  return prisma.messageLog.findMany({
    where: { status: 'PENDING', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: DISPATCH_BATCH_SIZE,
    select: {
      id: true,
      hospitalId: true,
      channel: true,
      patientId: true,
      recipient: true,
      subject: true,
      body: true,
      relatedType: true,
      relatedId: true,
      metadata: true,
      templateId: true,
    },
  })
}

async function close(id: string, status: MessageStatus, reason?: string) {
  await prisma.messageLog.update({
    where: { id },
    data: {
      status,
      ...(status === 'SENT' ? { sentAt: new Date() } : {}),
      ...(status === 'FAILED' ? { failedAt: new Date() } : {}),
      ...(reason ? { errorMessage: reason } : {}),
    },
  })
}

/**
 * Send everything that has fallen due.
 *
 * Reads across clinics — it is a cron job, not a request — and is therefore
 * only ever reachable behind `CRON_SECRET`. Each clinic's messages are sent
 * with that clinic's own credentials, loaded once per run.
 */
export async function dispatchDueMessages(now = new Date()): Promise<DispatchResult> {
  const messages = await dueMessages(now)
  const result: DispatchResult = {
    due: messages.length,
    sent: 0,
    deferred: 0,
    cancelled: 0,
    failed: 0,
  }

  if (messages.length === 0) return result

  const byClinic = new Map<string, QueuedMessage[]>()
  for (const message of messages) {
    const existing = byClinic.get(message.hospitalId)
    if (existing) existing.push(message)
    else byClinic.set(message.hospitalId, [message])
  }

  for (const [hospitalId, queued] of byClinic) {
    // Rule 1: outside the window, the whole clinic waits.
    const window = await smsService.sendWindow(hospitalId)
    if (!isWithinSendWindow(window.timezone, window, now)) {
      result.deferred += queued.length
      continue
    }

    // Credentials are loaded once per clinic per run, and only for the channels
    // this clinic actually has messages on. A clinic with no SMS gateway
    // configured should not have its emails held up by that.
    let sms: SMSConfig | null = null
    let smsError: string | null = null
    let email: { config: EmailConfig; transporter: Transporter } | null = null
    let emailError: string | null = null

    for (const message of queued) {
      try {
        const rendered = await renderMessage(message, hospitalId)

        if (rendered.outcome === 'cancel') {
          await close(message.id, 'CANCELLED', rendered.reason)
          result.cancelled++
          continue
        }

        if (message.channel === 'SMS') {
          if (!sms && !smsError) {
            try {
              sms = await smsService.initialize(hospitalId)
            } catch (err) {
              smsError = err instanceof Error ? err.message : 'SMS gateway not configured'
            }
          }
          if (!sms) throw new Error(smsError ?? 'SMS gateway not configured')

          const sent = await smsService.deliver(message.recipient, rendered.body, sms)

          await prisma.messageLog.update({
            where: { id: message.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              body: rendered.body,
              provider: sms.gateway,
              providerRef: sent.messageId,
              cost: sent.cost,
            },
          })
        } else {
          if (!email && !emailError) {
            try {
              email = await emailService.initialize(hospitalId)
            } catch (err) {
              emailError = err instanceof Error ? err.message : 'Email not configured'
            }
          }
          if (!email) throw new Error(emailError ?? 'Email not configured')

          const subject = rendered.subject ?? message.subject ?? 'A message from your clinic'

          const sent = await emailService.deliver(message.recipient, subject, rendered.body, email)

          await prisma.messageLog.update({
            where: { id: message.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              // The subject as well as the body: the log records what was
              // actually sent, not what was queued.
              subject,
              body: rendered.body,
              provider: email.config.host,
              providerRef: sent.messageId,
            },
          })
        }

        result.sent++
      } catch (err) {
        await close(message.id, 'FAILED', err instanceof Error ? err.message : 'Send failed')
        result.failed++
      }
    }
  }

  return result
}

type Rendered =
  { outcome: 'send'; body: string; subject?: string } | { outcome: 'cancel'; reason: string }

/**
 * The message as it should go out now: consent re-checked, wording rendered.
 *
 * A reminder is queued with an empty body on purpose — the wording comes from
 * the clinic's own template at send time, so a template edited this afternoon
 * changes the reminder that goes out this evening. Freezing the text at
 * queueing time would mean it did not.
 */
async function renderMessage(message: QueuedMessage, hospitalId: string): Promise<Rendered> {
  // Rule 3: the patient may have opted out since this was queued.
  if (message.patientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: message.patientId, hospitalId },
      select: { communicationPrefs: true },
    })

    if (!patient) return { outcome: 'cancel', reason: 'The patient record has gone' }

    const decision = mayContact(
      communicationPreferences(patient.communicationPrefs),
      message.channel,
      kindOf(message)
    )
    if (!decision.allowed) return { outcome: 'cancel', reason: decision.reason }
  }

  if (message.relatedType !== 'Appointment' || !message.relatedId) {
    if (!message.body) return { outcome: 'cancel', reason: 'Nothing to send' }
    return { outcome: 'send', body: message.body }
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id: message.relatedId, hospitalId },
    select: {
      appointmentNo: true,
      scheduledDate: true,
      scheduledTime: true,
      status: true,
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
      chair: { select: { name: true } },
      hospital: { select: { name: true, phone: true } },
    },
  })

  if (!appointment) {
    return { outcome: 'cancel', reason: 'The appointment has gone' }
  }

  // Reminding somebody about an appointment they cancelled is worse than not
  // reminding them at all.
  if (DEAD_APPOINTMENT_STATUSES.includes(appointment.status)) {
    return {
      outcome: 'cancel',
      reason: `The appointment is ${appointment.status.toLowerCase().replace('_', ' ')}`,
    }
  }

  // A body already written wins: a one-off message somebody typed is not a
  // template and must go out as written.
  if (message.body) return { outcome: 'send', body: message.body }

  const template = await templateService.getDefaultTemplate(
    hospitalId,
    'APPOINTMENT',
    message.channel as CommunicationChannel
  )

  if (!template) {
    return {
      outcome: 'cancel',
      reason: `No default ${message.channel} template for appointments`,
    }
  }

  const variables = appointmentVariables(appointment)

  return {
    outcome: 'send',
    body: templateService.replaceVariables(template.content, variables),
    subject: template.subject
      ? templateService.replaceVariables(template.subject, variables)
      : undefined,
  }
}

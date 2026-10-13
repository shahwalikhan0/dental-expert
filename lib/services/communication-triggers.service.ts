// Automated Communication Triggers Service
// Handles automatic sending of appointment reminders, birthday wishes, payment reminders, etc.

import prisma from '@/lib/prisma'
import { smsService } from './sms.service'
import { emailService } from './email.service'
import { templateService } from './template.service'
import { addDays, startOfDay, endOfDay, subDays } from 'date-fns'
import { DEFAULT_TIMEZONE, clinicTimezone, localDay } from '@/lib/appointment-time'
import {
  calendarDayOf,
  dueAnchor,
  isInvoiceOverdue,
  owedInvoiceWhere,
  type DatedInvoice,
} from '@/lib/invoice-figures'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `16-Sep-2026`: the day an invoice fell due, as the clinic's calendar reads it. */
function dueAnchorLabel(invoice: DatedInvoice, timezone: string): string {
  const anchor = dueAnchor(invoice)
  if (!anchor) return 'ASAP'
  const day = calendarDayOf(anchor, timezone)
  return `${day.slice(8, 10)}-${MONTHS[Number(day.slice(5, 7)) - 1]}-${day.slice(0, 4)}`
}

/** What a birthday message is recorded as being about. */
const BIRTHDAY_RELATED_TYPE = 'PatientBirthday'

/**
 * How often the same overdue invoice may be chased.
 *
 * Every one of these triggers used to resend on every run, which did not
 * matter while nothing ran them. Put on an hourly schedule, an overdue invoice
 * would have produced twenty-four text messages a day until it was paid, and
 * the patient would have blocked the clinic's number long before that.
 */
const PAYMENT_REMINDER_INTERVAL_DAYS = 7

/**
 * Which of these records have already been messaged about since `since`.
 *
 * Read from the message log rather than from a flag on the record, because the
 * log is the record of what was actually sent — and because the alternative
 * was tried here and did not work: the lab-ready trigger appended a line to
 * the lab case's clinical notes "to prevent duplicate notifications", and
 * nothing ever read it back. It scribbled in a clinical record once per run
 * and prevented nothing.
 */
async function alreadyMessagedAbout(
  relatedType: string,
  relatedIds: string[],
  since?: Date
): Promise<Set<string | null>> {
  if (relatedIds.length === 0) return new Set()

  const rows = await prisma.messageLog.findMany({
    where: {
      relatedType,
      relatedId: { in: relatedIds },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { relatedId: true },
  })

  return new Set(rows.map((row) => row.relatedId))
}

class CommunicationTriggersService {
  // Appointment reminders are not here any more.
  //
  // They were sent from this job, immediately, while `/api/cron/reminders` was
  // separately queueing reminders for the same appointments that nothing ever
  // sent. Two systems reminding the same patient about the same appointment,
  // neither aware of the other, and only one of them working. The queue owns
  // them now: `/api/cron/reminders` decides when, `/api/cron/dispatch` sends.
  //
  // What is left here is the three triggers that have no queue and no schedule
  // to respect — they fire on the day they are true.

  // Send birthday wishes
  async sendBirthdayWishes() {
    const today = new Date()
    const todayMonth = today.getMonth() + 1
    const todayDate = today.getDate()

    // Get all patients with birthday today
    const patients = await prisma.patient.findMany({
      where: {
        isActive: true,
        dateOfBirth: {
          not: null,
        },
      },
    })

    // Filter patients with birthday today
    const birthdayPatients = patients.filter((patient) => {
      if (!patient.dateOfBirth) return false
      const dob = new Date(patient.dateOfBirth)
      return dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDate
    })

    console.log(`Found ${birthdayPatients.length} patients with birthday today`)

    /**
     * Who has already been wished today.
     *
     * Without this the job is not safe to run twice, and a job that is not safe
     * to run twice cannot be put on a simple schedule — a restart, a retry, or
     * two schedulers overlapping would send the same person two birthday
     * messages. Keyed off the message log rather than off a flag somewhere,
     * because the log is the record of what was actually sent.
     */
    const alreadyWished = await alreadyMessagedAbout(
      BIRTHDAY_RELATED_TYPE,
      birthdayPatients.map((patient) => patient.id),
      startOfDay(today)
    )

    for (const patient of birthdayPatients) {
      if (alreadyWished.has(patient.id)) continue

      try {
        const clinicInfo = await prisma.hospital.findUnique({
          where: { id: patient.hospitalId },
          select: { name: true, phone: true },
        })

        const variables = {
          patientName: `${patient.firstName} ${patient.lastName}`,
          firstName: patient.firstName,
          clinicName: clinicInfo?.name || 'Your Dental Clinic',
          // The starter birthday template signs off with it, and it was the
          // one trigger that did not fill it in.
          clinicPhone: clinicInfo?.phone || '',
        }

        // Send SMS. Whether this patient wants birthday messages is decided by
        // sendSMS, from `kind`.
        if (patient.phone) {
          const smsTemplate = await templateService.getDefaultTemplate(
            patient.hospitalId,
            'BIRTHDAY',
            'SMS'
          )

          if (smsTemplate) {
            const message = templateService.replaceVariables(smsTemplate.content, variables)

            await smsService.sendSMS({
              hospitalId: patient.hospitalId,
              phone: patient.phone,
              message,
              patientId: patient.id,
              templateId: smsTemplate.id,
              kind: 'birthdayWishes',
              // What the message was about, which is also what makes the job
              // safe to run twice — see `alreadyWished` above.
              relatedType: BIRTHDAY_RELATED_TYPE,
              relatedId: patient.id,
            })
          }
        }
      } catch (error) {
        console.error(`Error sending birthday wish to patient ${patient.id}:`, error)
      }
    }
  }

  /**
   * Send payment reminders for overdue invoices.
   *
   * Overdue by the rule every screen uses (lib/invoice-figures.ts): owed, and
   * due before today on the clinic's own calendar. This read `dueDate <= now`
   * on the server's clock — a bill due today was chased this morning — and
   * skipped every invoice with no due date, which was most of them. Since
   * 14 Oct every issued invoice has one ("due on receipt" is its issue day),
   * so those are reminded about now too.
   */
  async sendPaymentReminders() {
    const today = new Date()

    // Owed invoices whose due date (or, failing that, issue or creation date)
    // has passed by the server's clock: a superset, narrowed below by each
    // clinic's calendar.
    const candidates = await prisma.invoice.findMany({
      where: {
        ...owedInvoiceWhere(),
        OR: [
          { dueDate: { lt: today } },
          { dueDate: null, issuedAt: { lt: today } },
          { dueDate: null, issuedAt: null, createdAt: { lt: today } },
        ],
      },
      include: {
        patient: true,
      },
    })

    // Each clinic's own day. Read once per clinic per run, not cached across
    // runs — see `clinicTimezone`.
    const zones = new Map<string, string>()
    for (const hospitalId of new Set(candidates.map((invoice) => invoice.hospitalId))) {
      zones.set(hospitalId, await clinicTimezone(prisma, hospitalId))
    }
    const overdueInvoices = candidates.filter((invoice) => {
      const timezone = zones.get(invoice.hospitalId) ?? DEFAULT_TIMEZONE
      return isInvoiceOverdue(invoice, localDay(today, timezone), timezone)
    })

    console.log(`Found ${overdueInvoices.length} overdue invoices`)

    // Chased at most once a week. An invoice stays overdue until it is paid,
    // so without this the reminder repeats on every run for as long as the
    // debt exists.
    const chasedRecently = await alreadyMessagedAbout(
      'Invoice',
      overdueInvoices.map((invoice) => invoice.id),
      subDays(today, PAYMENT_REMINDER_INTERVAL_DAYS)
    )

    for (const invoice of overdueInvoices) {
      if (chasedRecently.has(invoice.id)) continue

      try {
        const clinicInfo = await prisma.hospital.findUnique({
          where: { id: invoice.hospitalId },
          select: { name: true, phone: true },
        })

        const variables = {
          patientName: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
          firstName: invoice.patient.firstName,
          invoiceNo: invoice.invoiceNo,
          invoiceAmount: `Rs ${invoice.totalAmount.toFixed(2)}`,
          balanceAmount: `Rs ${invoice.balanceAmount.toFixed(2)}`,
          // What the starter payment reminder says; the same figure.
          amount: `Rs ${invoice.balanceAmount.toFixed(2)}`,
          // The day it fell due on the clinic's calendar, as the invoice shows it.
          dueDate: dueAnchorLabel(invoice, zones.get(invoice.hospitalId) ?? DEFAULT_TIMEZONE),
          clinicName: clinicInfo?.name || 'Your Dental Clinic',
          clinicPhone: clinicInfo?.phone || '',
        }

        // Send SMS. Whether this patient wants payment reminders is decided by
        // sendSMS, from `kind`.
        if (invoice.patient.phone) {
          const smsTemplate = await templateService.getDefaultTemplate(
            invoice.hospitalId,
            'PAYMENT',
            'SMS'
          )

          if (smsTemplate) {
            const message = templateService.replaceVariables(smsTemplate.content, variables)

            await smsService.sendSMS({
              hospitalId: invoice.hospitalId,
              phone: invoice.patient.phone,
              message,
              patientId: invoice.patientId,
              templateId: smsTemplate.id,
              kind: 'paymentReminders',
              relatedType: 'Invoice',
              relatedId: invoice.id,
            })
          }
        }
      } catch (error) {
        console.error(`Error sending payment reminder for invoice ${invoice.invoiceNo}:`, error)
      }
    }
  }

  // Send lab work ready notifications
  async sendLabWorkReadyNotifications() {
    const labOrders = await prisma.labOrder.findMany({
      where: {
        status: 'READY',
        deliveredDate: null, // Not yet delivered to patient
      },
      include: {
        patient: true,
      },
    })

    console.log(`Found ${labOrders.length} ready lab orders`)

    // Told once. A case stays READY until somebody marks it delivered, which
    // may be days, and "your crown is ready" is not news twice.
    const alreadyTold = await alreadyMessagedAbout(
      'LabOrder',
      labOrders.map((order) => order.id)
    )

    for (const order of labOrders) {
      if (alreadyTold.has(order.id)) continue

      try {
        const clinicInfo = await prisma.hospital.findUnique({
          where: { id: order.hospitalId },
          select: { name: true, phone: true },
        })

        const variables = {
          patientName: `${order.patient.firstName} ${order.patient.lastName}`,
          firstName: order.patient.firstName,
          labOrderNo: order.orderNumber,
          labWorkType: order.workType,
          clinicName: clinicInfo?.name || 'Your Dental Clinic',
          clinicPhone: clinicInfo?.phone || '',
        }

        // Send SMS
        if (order.patient.phone) {
          const smsTemplate = await templateService.getDefaultTemplate(
            order.hospitalId,
            'LAB_WORK',
            'SMS'
          )

          if (smsTemplate) {
            const message = templateService.replaceVariables(smsTemplate.content, variables)

            await smsService.sendSMS({
              // Absent until now, which meant this one wrote a log row with an
              // empty hospitalId and failed on the foreign key: the lab-ready
              // notification was the one trigger that could never send.
              hospitalId: order.hospitalId,
              phone: order.patient.phone,
              message,
              patientId: order.patientId,
              templateId: smsTemplate.id,
              relatedType: 'LabOrder',
              relatedId: order.id,
            })
          }
        }

        // The line this used to append to the case's notes is gone. It was
        // there "to prevent duplicate notifications" and nothing read it, so
        // it prevented none — it only added a timestamp to a clinical record
        // on every run. `alreadyTold` above is the thing that actually does it.
      } catch (error) {
        console.error(`Error sending lab work notification for order ${order.orderNumber}:`, error)
      }
    }
  }

  // Send Google Review request SMS after appointment completion
  // Only sends to patients who rated satisfaction >= 4/5 ("review gating")
  async runAllTriggers() {
    console.log('Starting communication triggers...')

    try {
      await this.sendBirthdayWishes()
      await this.sendPaymentReminders()
      await this.sendLabWorkReadyNotifications()

      console.log('Communication triggers completed successfully')
    } catch (error) {
      console.error('Error running communication triggers:', error)
    }
  }
}

export const communicationTriggersService = new CommunicationTriggersService()

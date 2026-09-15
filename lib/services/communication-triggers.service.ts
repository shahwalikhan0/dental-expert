// Automated Communication Triggers Service
// Handles automatic sending of appointment reminders, birthday wishes, payment reminders, etc.

import prisma from '@/lib/prisma'
import { smsService } from './sms.service'
import { emailService } from './email.service'
import { templateService } from './template.service'
import { addDays, startOfDay, endOfDay, format, subDays } from 'date-fns'

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

    for (const patient of birthdayPatients) {
      try {
        const clinicInfo = await prisma.hospital.findUnique({
          where: { id: patient.hospitalId },
          select: { name: true, phone: true },
        })

        const variables = {
          patientName: `${patient.firstName} ${patient.lastName}`,
          firstName: patient.firstName,
          clinicName: clinicInfo?.name || 'Your Dental Clinic',
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
            })
          }
        }
      } catch (error) {
        console.error(`Error sending birthday wish to patient ${patient.id}:`, error)
      }
    }
  }

  // Send payment reminders for overdue invoices
  async sendPaymentReminders() {
    const today = new Date()

    // Get invoices that are overdue or due soon
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: {
          in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'],
        },
        balanceAmount: {
          gt: 0,
        },
        dueDate: {
          lte: today,
        },
      },
      include: {
        patient: true,
      },
    })

    console.log(`Found ${overdueInvoices.length} overdue invoices`)

    for (const invoice of overdueInvoices) {
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
          dueDate: invoice.dueDate ? format(invoice.dueDate, 'dd-MMM-yyyy') : 'ASAP',
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

    for (const order of labOrders) {
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

        // Update status to prevent duplicate notifications
        await prisma.labOrder.update({
          where: { id: order.id },
          data: {
            notes:
              (order.notes || '') +
              '\nReady notification sent on ' +
              format(new Date(), 'dd-MMM-yyyy HH:mm'),
          },
        })
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

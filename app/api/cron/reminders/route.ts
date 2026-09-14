import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/cron/reminders — scheduled hourly.
 *
 * Queues a reminder for every appointment in the next 24 hours that has not
 * already got one, and a second, earlier one for patients with a history of not
 * turning up. Dispatch is somebody else's job: these rows sit at PENDING with a
 * `scheduledFor`, and the sender picks them up.
 *
 * Reminders are `MessageLog` rows tagged `relatedType: 'Appointment'`. They
 * used to be their own table, which recorded that a reminder had been scheduled
 * and nothing about what it said or whether it arrived — so a patient insisting
 * they were never reminded could be shown a row saying SENT and no more.
 *
 * The one route in the application that deliberately reads across clinics: it
 * authenticates on CRON_SECRET, and no clinic can call it.
 */
export async function GET(req: Request) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Find appointments in next 24 hours across all active hospitals
  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
      scheduledDate: { gte: now, lte: in24Hours },
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  })

  // Which of them already have a reminder queued or sent.
  const alreadyReminded = new Set(
    (
      await prisma.messageLog.findMany({
        where: {
          relatedType: 'Appointment',
          relatedId: { in: appointments.map((a) => a.id) },
          status: { in: ['PENDING', 'QUEUED', 'SENT', 'DELIVERED'] },
        },
        select: { relatedId: true },
      })
    ).map((m) => m.relatedId!)
  )

  // Gather no-show history for risk assessment
  const patientIds = [...new Set(appointments.map((a) => a.patientId))]
  const noShowCounts = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: {
      patientId: { in: patientIds },
      status: 'NO_SHOW',
    },
    _count: true,
  })
  const totalCounts = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: {
      patientId: { in: patientIds },
      scheduledDate: { lt: now },
    },
    _count: true,
  })
  const noShowMap: Record<string, number> = {}
  const totalMap: Record<string, number> = {}
  for (const ns of noShowCounts) noShowMap[ns.patientId] = ns._count
  for (const t of totalCounts) totalMap[t.patientId] = t._count

  let created = 0
  let extraReminders = 0
  for (const appt of appointments) {
    if (alreadyReminded.has(appt.id)) continue

    // Assess no-show risk: high if >30% no-show rate with at least 2 past appointments
    const total = totalMap[appt.patientId] || 0
    const noShows = noShowMap[appt.patientId] || 0
    const isHighRisk = total >= 2 && noShows / total > 0.3

    await queueReminder(appt, new Date(appt.scheduledDate.getTime() - 60 * 60 * 1000))
    created++

    // High-risk patients get an extra early reminder (3 hours before)
    if (isHighRisk) {
      await queueReminder(appt, new Date(appt.scheduledDate.getTime() - 3 * 60 * 60 * 1000))
      extraReminders++
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
    },
  })
}

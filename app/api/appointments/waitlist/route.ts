import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { OPEN_WAITLIST_STATUSES } from '@/lib/services/smart-scheduler'

// GET /api/appointments/waitlist — List waitlist entries
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const doctorId = searchParams.get('doctorId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    // A name, a patient number or a phone. Optional: without it the list is
    // exactly what it was. The entry holds the patient's id, not a relation,
    // so the register is searched first and the entries narrowed to those.
    const search = (searchParams.get('search') || '').trim()

    const where: any = { hospitalId }
    // OPEN is everyone still waiting: on the list, or offered a slot and not
    // yet booked. The page opens on it, so an offered entry stays in sight
    // until it is booked or removed.
    if (status === 'OPEN') where.status = { in: [...OPEN_WAITLIST_STATUSES] }
    else if (status) where.status = status
    if (doctorId) where.doctorId = doctorId
    if (search) {
      const words = search.split(/\s+/).filter(Boolean)
      const matching = await prisma.patient.findMany({
        where: {
          hospitalId,
          AND: words.map((word) => ({
            OR: [
              { firstName: { contains: word, mode: 'insensitive' as const } },
              { lastName: { contains: word, mode: 'insensitive' as const } },
              { patientId: { contains: word, mode: 'insensitive' as const } },
              { phone: { contains: word } },
            ],
          })),
        },
        select: { id: true },
        take: 500,
      })
      where.patientId = { in: matching.map((p) => p.id) }
    }

    const [entries, total] = await Promise.all([
      prisma.waitlist.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.waitlist.count({ where }),
    ])

    // Enrich with patient and doctor names
    const patientIds = entries.map((e) => e.patientId)
    const doctorIds = entries.filter((e) => e.doctorId).map((e) => e.doctorId as string)

    const [patients, doctors] = await Promise.all([
      prisma.patient.findMany({
        where: { id: { in: patientIds }, hospitalId },
        select: { id: true, firstName: true, lastName: true, phone: true, patientId: true },
      }),
      doctorIds.length > 0
        ? prisma.staff.findMany({
            where: { id: { in: doctorIds }, hospitalId },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
    ])

    const patientMap = new Map(patients.map((p) => [p.id, p]))
    const doctorMap = new Map(doctors.map((d) => [d.id, d]))

    const enriched = entries.map((entry) => {
      const patient = patientMap.get(entry.patientId)
      const doctor = entry.doctorId ? doctorMap.get(entry.doctorId) : null
      return {
        ...entry,
        patient: patient
          ? {
              id: patient.id,
              patientId: patient.patientId,
              name: `${patient.firstName} ${patient.lastName}`,
              phone: patient.phone,
            }
          : null,
        doctor: doctor
          ? { id: doctor.id, name: `Dr. ${doctor.firstName} ${doctor.lastName}` }
          : null,
      }
    })

    // Summary counts
    const [activeCount, notifiedCount, bookedCount] = await Promise.all([
      prisma.waitlist.count({ where: { hospitalId, status: 'ACTIVE' } }),
      prisma.waitlist.count({ where: { hospitalId, status: 'NOTIFIED' } }),
      prisma.waitlist.count({ where: { hospitalId, status: 'BOOKED' } }),
    ])

    return NextResponse.json({
      entries: enriched,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      summary: { active: activeCount, notified: notifiedCount, booked: bookedCount },
    })
  } catch (err) {
    console.error('Error fetching waitlist:', err)
    return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 })
  }
}

// POST /api/appointments/waitlist — Add patient to waitlist
export async function POST(req: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('appointments:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { patientId, doctorId, preferredDays, preferredTime, procedureId, notes } = body

    if (!patientId) {
      return NextResponse.json({ error: 'Patient is required' }, { status: 400 })
    }

    // Verify patient exists
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Check if patient already has active waitlist entry
    const existing = await prisma.waitlist.findFirst({
      where: {
        hospitalId,
        patientId,
        status: { in: [...OPEN_WAITLIST_STATUSES] },
      },
    })
    if (existing) {
      return NextResponse.json({ error: 'Patient is already on the waitlist' }, { status: 409 })
    }

    const entry = await prisma.waitlist.create({
      data: {
        hospitalId,
        patientId,
        doctorId: doctorId || null,
        preferredDays: preferredDays || null,
        preferredTime: preferredTime || null,
        procedureId: procedureId || null,
        notes: notes || null,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    console.error('Error adding to waitlist:', err)
    return NextResponse.json({ error: 'Failed to add to waitlist' }, { status: 500 })
  }
}

// DELETE /api/appointments/waitlist — Remove from waitlist
export async function DELETE(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('appointments:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Waitlist entry ID is required' }, { status: 400 })
    }

    const entry = await prisma.waitlist.findFirst({
      where: { id, hospitalId },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }

    if (!(OPEN_WAITLIST_STATUSES as readonly string[]).includes(entry.status)) {
      return NextResponse.json(
        { error: 'This entry is already closed. Only a waiting or offered entry can be removed.' },
        { status: 409 }
      )
    }

    await prisma.waitlist.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })

    return NextResponse.json({ message: 'Removed from waitlist' })
  } catch (err) {
    console.error('Error removing from waitlist:', err)
    return NextResponse.json({ error: 'Failed to remove from waitlist' }, { status: 500 })
  }
}

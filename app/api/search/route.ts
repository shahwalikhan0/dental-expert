import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { clinicTimezone, formatCalendarDay, wallClockIn } from '@/lib/appointment-time'
import { subjectName } from '@/lib/visitors'
import { everyTermMatches, like } from '@/lib/search-terms'

interface SearchResult {
  id: string
  label: string
  sublabel: string
  href: string
}

export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = new URL(req.url).searchParams.get('q')?.trim() || ''
  if (q.length < 2) {
    return NextResponse.json({
      patients: [],
      appointments: [],
      invoices: [],
      staff: [],
      treatments: [],
    })
  }

  try {
    const timezone = await clinicTimezone(prisma, hospitalId)
    const [patients, appointments, invoices, staff, treatments] = await Promise.all([
      // Patients
      prisma.patient.findMany({
        where: {
          hospitalId,
          isActive: true,
          // Every word has to match somewhere, so a full name narrows
          // rather than contradicting itself — see lib/search-terms.ts.
          ...everyTermMatches(q, (term) => [
            { patientId: like(term) },
            { firstName: like(term) },
            { lastName: like(term) },
            { phone: { contains: term } },
            { email: like(term) },
          ]),
        },
        select: { id: true, patientId: true, firstName: true, lastName: true, phone: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      }),

      // Appointments
      prisma.appointment.findMany({
        where: {
          hospitalId,
          ...everyTermMatches(q, (term) => [
            { appointmentNo: like(term) },
            { patient: { firstName: like(term) } },
            { patient: { lastName: like(term) } },
            { patient: { phone: { contains: term } } },
            // A walk-in is looked for in the same box, and has no patient row.
            { visitor: { name: like(term) } },
          ]),
        },
        select: {
          id: true,
          appointmentNo: true,
          startsAt: true,
          status: true,
          patient: { select: { firstName: true, lastName: true } },
          // Selected as well as searched. The walk-in clause above meant
          // searching a visitor's name found their appointment and then
          // labelled it "Unknown", because the name it matched on was never
          // fetched back.
          visitor: { select: { name: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
        take: 5,
        orderBy: { startsAt: 'desc' },
      }),

      // Invoices
      prisma.invoice.findMany({
        where: {
          hospitalId,
          ...everyTermMatches(q, (term) => [
            { invoiceNo: like(term) },
            { patient: { firstName: like(term) } },
            { patient: { lastName: like(term) } },
            { patient: { patientId: like(term) } },
          ]),
        },
        select: {
          id: true,
          invoiceNo: true,
          totalAmount: true,
          status: true,
          patient: { select: { firstName: true, lastName: true } },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),

      // Staff
      prisma.staff.findMany({
        where: {
          hospitalId,
          isActive: true,
          ...everyTermMatches(q, (term) => [
            { firstName: like(term) },
            { lastName: like(term) },
            { phone: { contains: term } },
            { email: like(term) },
            { employeeId: like(term) },
          ]),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialization: true,
          employeeId: true,
          user: { select: { role: true } },
        },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      }),

      // Treatments
      prisma.treatment.findMany({
        where: {
          hospitalId,
          ...everyTermMatches(q, (term) => [
            { treatmentNo: like(term) },
            { patient: { firstName: like(term) } },
            { patient: { lastName: like(term) } },
            { patient: { patientId: like(term) } },
          ]),
        },
        select: {
          id: true,
          treatmentNo: true,
          status: true,
          patient: { select: { firstName: true, lastName: true } },
          procedure: { select: { name: true } },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Map to uniform search result shape
    const result = {
      patients: patients.map((p): SearchResult => ({
        id: p.id,
        label: `${p.firstName} ${p.lastName}`,
        sublabel: `${p.patientId} · ${p.phone}`,
        href: `/patients/${p.id}`,
      })),
      appointments: appointments.map((a): SearchResult => ({
        id: a.id,
        label: `${a.appointmentNo} — ${subjectName(a)}`,
        sublabel: `${formatCalendarDay(a.startsAt, timezone)} ${wallClockIn(a.startsAt, timezone).scheduledTime} · Dr. ${a.doctor.firstName} ${a.doctor.lastName} · ${a.status}`,
        href: `/appointments/${a.id}`,
      })),
      invoices: invoices.map((inv): SearchResult => ({
        id: inv.id,
        label: `${inv.invoiceNo} — ${inv.patient.firstName} ${inv.patient.lastName}`,
        sublabel: `Rs ${Number(inv.totalAmount).toLocaleString('en-PK')} · ${inv.status}`,
        href: `/billing/invoices/${inv.id}`,
      })),
      staff: staff.map((s): SearchResult => ({
        id: s.id,
        label: `${s.firstName} ${s.lastName}`,
        sublabel: `${s.employeeId || ''} · ${s.specialization || s.user?.role || ''}`,
        href: `/staff/${s.id}`,
      })),
      treatments: treatments.map((t): SearchResult => ({
        id: t.id,
        label: `${t.treatmentNo} — ${t.patient.firstName} ${t.patient.lastName}`,
        sublabel: `${t.procedure?.name || '—'} · ${t.status}`,
        href: `/treatments/${t.id}`,
      })),
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('Global search error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}

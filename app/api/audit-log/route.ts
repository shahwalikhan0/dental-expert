import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

/**
 * A stored value, read back. Written by `recordAudit` as JSON; anything that
 * does not parse (an older row, a hand-written one) is returned as the text it
 * is rather than dropped.
 */
function parseValues(raw: string | null): Record<string, unknown> | string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : raw
  } catch {
    return raw
  }
}

type Entry = { entityType: string; entityId: string; values: unknown[] }

/**
 * The patient each entry belongs to, by entry, for one page of the log.
 *
 * An entry names a record, not a person: `invoice.created` carries an invoice
 * ID. So the records on the page are looked up in one query per kind — never
 * one per row — and then their patients in one more. A record that has since
 * been deleted (a deleted invoice or treatment) is found through the
 * `patientId` its entry recorded instead.
 */
async function patientsFor(hospitalId: string, entries: Entry[]) {
  const ids = (type: string) => [
    ...new Set(entries.filter((e) => e.entityType === type).map((e) => e.entityId)),
  ]
  const byId = { hospitalId } as const
  const pick = { id: true, patientId: true } as const

  const [
    invoices,
    appointments,
    treatments,
    prescriptions,
    notes,
    labOrders,
    portal,
    forms,
    payments,
    visitors,
  ] = await Promise.all([
    prisma.invoice.findMany({ where: { ...byId, id: { in: ids('Invoice') } }, select: pick }),
    prisma.appointment.findMany({
      where: { ...byId, id: { in: ids('Appointment') } },
      select: pick,
    }),
    prisma.treatment.findMany({ where: { ...byId, id: { in: ids('Treatment') } }, select: pick }),
    prisma.prescription.findMany({
      where: { ...byId, id: { in: ids('Prescription') } },
      select: pick,
    }),
    prisma.clinicalNote.findMany({
      where: { ...byId, id: { in: ids('ClinicalNote') } },
      select: pick,
    }),
    prisma.labOrder.findMany({ where: { ...byId, id: { in: ids('LabOrder') } }, select: pick }),
    prisma.patientPortalAccount.findMany({
      where: { ...byId, id: { in: ids('PatientPortalAccount') } },
      select: pick,
    }),
    prisma.formSubmission.findMany({
      where: { ...byId, id: { in: ids('FormSubmission') } },
      select: pick,
    }),
    prisma.payment.findMany({
      where: { ...byId, id: { in: ids('Payment') } },
      select: { id: true, invoice: { select: { patientId: true } } },
    }),
    prisma.visitor.findMany({
      where: { ...byId, id: { in: ids('Visitor') } },
      select: { id: true, convertedPatientId: true },
    }),
  ])

  const owner = new Map<string, string | null>()
  for (const row of [
    ...invoices,
    ...appointments,
    ...treatments,
    ...prescriptions,
    ...notes,
    ...labOrders,
    ...portal,
    ...forms,
  ]) {
    owner.set(row.id, row.patientId)
  }
  for (const row of payments) owner.set(row.id, row.invoice.patientId)
  for (const row of visitors) owner.set(row.id, row.convertedPatientId)

  const patientIdOf = (entry: Entry): string | null => {
    if (entry.entityType === 'Patient') return entry.entityId
    const found = owner.get(entry.entityId)
    if (found) return found
    for (const values of entry.values) {
      if (values && typeof values === 'object') {
        const recorded = (values as Record<string, unknown>).patientId
        if (typeof recorded === 'string' && recorded) return recorded
      }
    }
    return null
  }

  const wanted = entries.map(patientIdOf)
  const patients = await prisma.patient.findMany({
    where: { hospitalId, id: { in: [...new Set(wanted.filter((id): id is string => !!id))] } },
    select: { id: true, patientId: true, firstName: true, lastName: true },
  })
  const patientById = new Map(patients.map((p) => [p.id, p]))

  return wanted.map((id) => {
    const patient = id ? patientById.get(id) : undefined
    return patient
      ? {
          id: patient.id,
          patientNo: patient.patientId,
          name: `${patient.firstName} ${patient.lastName}`.trim(),
        }
      : null
  })
}

export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('audit:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const action = searchParams.get('action') || undefined
    const userId = searchParams.get('userId') || undefined
    const entity = searchParams.get('entity') || undefined
    const search = searchParams.get('q') || undefined

    const where: Record<string, unknown> = { hospitalId }
    /**
     * One action, or several separated by commas.
     *
     * The screen filters by *group* — "signing in", "records read" — which is
     * the question somebody actually has of an audit trail, and a group is a
     * handful of actions. Sending the list rather than a group name keeps the
     * grouping in one place (lib/audit-labels.ts) instead of duplicating it
     * here where it could drift.
     */
    if (action) {
      const actions = action
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      if (actions.length === 1) where.action = actions[0]
      else if (actions.length > 1) where.action = { in: actions }
    }
    if (userId) where.userId = userId
    if (entity) where.entityType = entity
    // Both halves of the change: most entries name the record in what it
    // became (an invoice number, a PO number), not in what it was.
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { oldValues: { contains: search, mode: 'insensitive' } },
        { newValues: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [logs, total, kinds] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { name: true, email: true, role: true } },
        },
      }),
      prisma.auditLog.count({ where: where as any }),
      // The entity filter offers what this clinic's log actually holds, not a
      // list typed into the screen that falls behind each new kind of entry.
      prisma.auditLog.groupBy({ by: ['entityType'], where: { hospitalId } }),
    ])

    const entries = logs.map((log) => {
      const oldValues = parseValues(log.oldValues)
      const newValues = parseValues(log.newValues)
      return {
        log,
        oldValues,
        newValues,
        entityType: log.entityType,
        entityId: log.entityId,
        values: [newValues, oldValues],
      }
    })
    const patients = await patientsFor(hospitalId, entries)

    return NextResponse.json({
      data: entries.map(({ log, oldValues, newValues }, index) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        oldValues,
        newValues,
        patient: patients[index],
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
        user: log.user ? { name: log.user.name, email: log.user.email, role: log.user.role } : null,
      })),
      entityTypes: kinds.map((k) => k.entityType).sort(),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('Audit log error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

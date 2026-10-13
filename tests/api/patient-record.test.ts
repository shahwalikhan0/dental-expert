// @ts-nocheck
/**
 * The patient record route: who is shown what, and deactivating and
 * reactivating (bug report 12 Oct, findings 5, 22, 30 and 52).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => {
  const client: any = {
    patient: { findFirst: vi.fn(), update: vi.fn() },
    hospital: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Karachi' }) },
    treatment: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) },
    dentalChartEntry: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    appointment: { findFirst: vi.fn(), updateMany: vi.fn() },
  }
  client.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client)))
  return { prisma: client, default: client }
})

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/record-access', () => ({ noteRecordAccess: vi.fn() }))
vi.mock('@/lib/security-settings', () => ({
  readSecuritySettings: vi.fn().mockResolvedValue({ restrictToOwnPatients: false }),
}))
vi.mock('@/lib/ledger', () => ({ buildLedger: vi.fn() }))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal()),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  // The real permission matrix, run against the role the test signs in as.
  helpers.requirePermission = vi.fn(async (p: string) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
    if (!can(res.user?.role, p)) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
      }
    }
    return res
  })
  return helpers
})

import { GET, PUT, DELETE } from '@/app/api/patients/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildLedger } from '@/lib/ledger'
import { recordAudit } from '@/lib/audit'

function signedInAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    user: { id: 'u1', role },
    hospitalId: 'h1',
  })
}

const ctx = { params: Promise.resolve({ id: 'p1' }) }

const PATIENT = {
  id: 'p1',
  patientId: 'PAT202600001',
  firstName: 'Usman',
  lastName: 'Ali',
  isActive: true,
  mergedIntoId: null,
  aiSummary: { stale: true },
  aiSummaryAt: new Date('2026-01-01'),
  appointments: [],
  _count: { appointments: 0, treatments: 3, invoices: 2, prescriptions: 1 },
}

function req(method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost/api/patients/p1', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/patients/[id]', () => {
  it('leaves the clinical record out for the front desk', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const res = await GET(req(), ctx)
    const { patient } = await res.json()

    expect(res.status).toBe(200)
    expect(patient).not.toHaveProperty('treatments')
    expect(patient).not.toHaveProperty('prescriptions')
    expect(patient).not.toHaveProperty('dentalChart')
    expect(patient._count).not.toHaveProperty('treatments')
    expect(prisma.treatment.findMany).not.toHaveBeenCalled()
    expect(prisma.prescription.findMany).not.toHaveBeenCalled()
    // Reception does bill, so the invoices stay.
    expect(patient).toHaveProperty('invoices')
  })

  it('leaves the invoices out for a role without billing access', async () => {
    signedInAs('LAB_TECH')
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const { patient } = await (await GET(req(), ctx)).json()

    expect(patient).not.toHaveProperty('invoices')
    expect(patient).not.toHaveProperty('treatments')
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
  })

  it('gives a clinician the clinical record', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const { patient } = await (await GET(req(), ctx)).json()

    expect(patient).toHaveProperty('treatments')
    expect(patient).toHaveProperty('prescriptions')
    expect(patient).toHaveProperty('dentalChart')
  })

  it('never sends the leftover AI summary', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const { patient } = await (await GET(req(), ctx)).json()

    expect(patient).not.toHaveProperty('aiSummary')
    expect(patient).not.toHaveProperty('aiSummaryAt')
  })
})

describe('DELETE /api/patients/[id] — deactivating', () => {
  beforeEach(() => {
    signedInAs('ADMIN')
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.appointment.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(buildLedger).mockResolvedValue({ ageing: { total: 0 }, summary: {}, entries: [] })
  })

  it('refuses a patient who still owes money, and says how much', async () => {
    vi.mocked(buildLedger).mockResolvedValue({
      ageing: { total: 17000.28 },
      summary: {},
      entries: [],
    })

    const res = await DELETE(req('DELETE'), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toContain('17,000.28')
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })

  it('refuses a patient who is in the clinic now', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      appointmentNo: 'APT0008',
      status: 'CHECKED_IN',
    })

    const res = await DELETE(req('DELETE'), ctx)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('APT0008')
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })

  it('cancels upcoming bookings as cancellations, leaving their notes alone', async () => {
    const res = await DELETE(req('DELETE'), ctx)

    expect(res.status).toBe(200)
    const { where, data } = vi.mocked(prisma.appointment.updateMany).mock.calls[0][0]
    expect(where.status).toEqual({ in: ['SCHEDULED', 'CONFIRMED'] })
    expect(where.startsAt.gte).toBeInstanceOf(Date)
    expect(data).toEqual({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
      cancellationReason: 'Patient deactivated',
    })
    expect(data).not.toHaveProperty('notes')
    expect(prisma.patient.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false },
    })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'patient.deactivated', entityId: 'p1' })
    )
  })

  it('is refused to the front desk', async () => {
    signedInAs('RECEPTIONIST')
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/patients/[id]', () => {
  beforeEach(() => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.patient.update).mockImplementation(async ({ data }) => ({
      ...PATIENT,
      ...data,
    }))
  })

  it('reactivates a deactivated patient, and records who did', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({ ...PATIENT, isActive: false })

    const res = await PUT(req('PUT', { isActive: true }), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prisma.patient.update.mock.calls[0][0].data.isActive).toBe(true)
    expect(body.patient).not.toHaveProperty('aiSummary')
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'patient.reactivated', entityId: 'p1' })
    )
  })

  it('will not bring back a record that was merged into another', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      ...PATIENT,
      isActive: false,
      mergedIntoId: 'p2',
    })

    const res = await PUT(req('PUT', { isActive: true }), ctx)

    expect(res.status).toBe(409)
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })

  it('does not deactivate through an edit', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const res = await PUT(req('PUT', { isActive: false }), ctx)

    expect(res.status).toBe(400)
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })

  it.each([
    [{ dateOfBirth: '2030-01-01' }, /future/],
    [{ phone: 'xyz' }, /Phone/],
    [{ email: 'nope' }, /Email/],
  ])('refuses %j', async (body, message) => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(PATIENT)

    const res = await PUT(req('PUT', body), ctx)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(message)
    expect(prisma.patient.update).not.toHaveBeenCalled()
  })
})

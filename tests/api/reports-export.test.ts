import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => {
  const requireAuthAndRole = vi.fn()
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const { can } = await import('@/lib/rbac')
    const { NextResponse } = await import('next/server')
    const res = await requireAuthAndRole()
    if (!res || res.error) return res
    // Fixtures shallow-spread their overrides, so a test that sets
    // `session.user.role` leaves the default `user.role` behind (and vice
    // versa). Reading just one of them would silently use the stale default,
    // so require the capability for every role the fixture names.
    const roles = [res.user?.role, res.session?.user?.role].filter(Boolean)
    if (roles.length === 0) return res
    if (!roles.every((r: string) => perms.every((p) => can(r, p)))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  return {
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.stubGlobal('fetch', mockFetch)

const mod = await import('@/app/api/reports/export/route')

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/reports/export')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString()) as any
}

describe('GET /api/reports/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
    ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic' })
  })

  it('returns Excel file for patient analytics export', async () => {
    // Mock internal fetch to analytics endpoint
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          newPatients: 10,
          returningPatients: 50,
          totalPatients: 60,
          retentionRate: 83.33,
          demographics: { male: 30, female: 28, other: 2 },
          acquisitionSources: [{ source: 'Walk-in', count: 40, percentage: 66.67 }],
        }),
    })

    const req = makeRequest({ type: 'patient', format: 'excel', preset: 'this_month' })
    const res = await mod.GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.headers.get('Content-Disposition')).toContain('patient_analytics')
  })

  it('returns the HTML print view, named as HTML (finding 49)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalTreatments: 100,
          completedTreatments: 80,
          inProgressTreatments: 20,
          completionRate: 80.0,
          avgTreatmentDuration: 45,
          commonProcedures: [],
        }),
    })

    const req = makeRequest({ type: 'clinical', format: 'html', preset: 'this_month' })
    const res = await mod.GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    // Nothing about it claims to be a PDF.
    expect(res.headers.get('Content-Disposition')).toMatch(/\.html"$/)
    expect(res.headers.get('Content-Disposition')).not.toContain('pdf')
    const body = await res.text()
    expect(body).toContain('Clinical Analytics Report')
    expect(body).toContain('Total Treatments')
  })

  it('exports financial report with payment method breakdown', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalRevenue: 500000,
          totalExpenses: 200000,
          profitMargin: 60.0,
          avgBillValue: 5000,
          collectionEfficiency: 85.0,
          outstandingAmount: 75000,
          paymentMethodBreakdown: [{ method: 'UPI', amount: 300000, percentage: 60.0 }],
          revenueByMonth: [],
        }),
    })

    const req = makeRequest({ type: 'financial', format: 'html' })
    const res = await mod.GET(req)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Financial')
    expect(body).toContain('Total Revenue')
  })

  it('exports operational report', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalAppointments: 200,
          completedAppointments: 180,
          cancelledAppointments: 10,
          noShowCount: 10,
          noShowRate: 5.0,
          appointmentUtilization: 90.0,
          avgWaitTime: 15,
          inventoryTurnover: 3.5,
          lowStockItems: 5,
          staffProductivity: [],
        }),
    })

    const req = makeRequest({ type: 'operational', format: 'html' })
    const res = await mod.GET(req)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Operational')
    expect(body).toContain('No-Show')
  })

  it('returns 400 for invalid export format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          newPatients: 0,
          returningPatients: 0,
          totalPatients: 0,
          retentionRate: 0,
          demographics: { male: 0, female: 0, other: 0 },
          acquisitionSources: [],
        }),
    })

    const req = makeRequest({ type: 'patient', format: 'csv' })
    const res = await mod.GET(req)
    expect(res.status).toBe(400)
  })

  it('escapes names from the database in the print view', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalTreatments: 1,
          completedTreatments: 1,
          inProgressTreatments: 0,
          completionRate: 100,
          avgTreatmentDuration: 30,
          commonProcedures: [
            { name: '<img src=x onerror=alert(1)>', code: 'X1', count: 1, successRate: 100 },
          ],
        }),
    })

    const res = await mod.GET(makeRequest({ type: 'clinical', format: 'html' }))
    const body = await res.text()
    expect(body).not.toContain('<img src=x')
    expect(body).toContain('&lt;img src=x')
  })

  it('refuses format=pdf, saying what to use instead', async () => {
    const res = await mod.GET(makeRequest({ type: 'patient', format: 'pdf' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('format=html')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 naming the valid types for an unknown report type (finding 49)', async () => {
    const res = await mod.GET(makeRequest({ type: 'inventory', format: 'excel' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('inventory')
    expect(body.error).toContain('patient, clinical, financial, operational')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('accepts the plural "patients" for the patient report', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          newPatients: 0,
          returningPatients: 0,
          totalPatients: 0,
          retentionRate: 0,
          demographics: { male: 0, female: 0, other: 0 },
          acquisitionSources: [],
        }),
    })

    const res = await mod.GET(makeRequest({ type: 'patients', format: 'excel' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('patient_analytics')
    const analyticsUrl = new URL(mockFetch.mock.calls[0][0])
    expect(analyticsUrl.searchParams.get('type')).toBe('patient')
  })

  it('returns 500 when analytics fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const req = makeRequest({ type: 'patient', format: 'excel' })
    const res = await mod.GET(req)
    expect(res.status).toBe(500)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      hospitalId: null,
    })

    const req = makeRequest({ type: 'patient', format: 'excel' })
    const res = await mod.GET(req)
    expect(res.status).toBe(401)
  })
})

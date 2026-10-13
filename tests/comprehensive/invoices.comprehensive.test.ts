// @ts-nocheck
/**
 * Comprehensive Invoice/Billing API Tests
 * Tests all invoice-related endpoints with full business logic validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock billing-utils
vi.mock('@/lib/billing-utils', async (importOriginal) => ({
  // The discount rule is the real one (finding 37): it is pure, and a stub
  // that always said yes would let these tests pass a 150% discount.
  discountProblem: (await importOriginal()).discountProblem,
  generateInvoiceNo: vi.fn().mockResolvedValue('INV202501290001'),
  // The real arithmetic, watched: the route stores the per-line amounts it
  // returns, and checks the discount against the subtotal it computes, so a
  // canned answer would describe an invoice the request never sent.
  calculateInvoiceTotals: vi.fn((await importOriginal<any>()).calculateInvoiceTotals),
  // The route resolves the rate from the clinic record rather than a constant.
  resolveTaxRate: vi.fn().mockReturnValue(0),
  taxConfig: { rate: 0, label: 'Sales Tax', defaultTaxable: true },
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => {
  const client: any = {
    // Reference numbers come from a counter row via one INSERT … ON CONFLICT
    // … RETURNING, so anything that numbers a document needs this to answer.
    // It also answers the treatment row locks taken while billing them.
    $queryRaw: vi.fn().mockResolvedValue([{ seq: 1 }]),
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    hospital: {
      findUnique: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    treatment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    // FR-013 reads the clinic's discount approval threshold from Setting.
    setting: {
      findUnique: vi.fn(),
    },
    // Finding 13: a treatment already on a live invoice is refused.
    invoiceItem: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // Finding 24: invoices are audited.
    auditLog: {
      create: vi.fn(),
    },
  }
  // The invoice is created inside a transaction, so the number it draws is
  // rolled back with a refused request (finding 68).
  client.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client)))
  return { prisma: client }
})

// Mock auth
vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
  }
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
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
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { GET, POST } from '@/app/api/invoices/route'
import { calculateInvoiceTotals, generateInvoiceNo } from '@/lib/billing-utils'

const mockPrisma = vi.mocked(prisma)
const mockRequireAuth = vi.mocked(requireAuthAndRole)
const mockCalculateTotals = vi.mocked(calculateInvoiceTotals)
const mockGenerateInvoiceNo = vi.mocked(generateInvoiceNo)

describe('Invoices API - Comprehensive Tests', () => {
  const mockHospitalId = 'hospital-123'
  const mockUserId = 'user-123'
  const mockPatientId = 'patient-123'

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAuth.mockResolvedValue({
      error: null,
      hospitalId: mockHospitalId,
      user: { id: mockUserId, role: 'ACCOUNTANT' },
      session: { user: { id: mockUserId, role: 'ACCOUNTANT', hospitalId: mockHospitalId } },
    })
  })

  describe('GET /api/invoices', () => {
    it('should return paginated invoices list', async () => {
      const mockInvoices = [
        {
          id: '1',
          invoiceNo: 'INV202501290001',
          totalAmount: 10355,
          status: 'PENDING',
          patient: { id: mockPatientId, firstName: 'John', lastName: 'Doe' },
          items: [],
          payments: [],
        },
      ]

      mockPrisma.invoice.findMany.mockResolvedValue(mockInvoices)
      mockPrisma.invoice.count.mockResolvedValue(1)

      const request = new NextRequest('http://localhost/api/invoices')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.invoices).toHaveLength(1)
      expect(data.pagination).toBeDefined()
    })

    it('should filter invoices by status', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/invoices?status=PAID')
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PAID',
          }),
        })
      )
    })

    it('should filter invoices by patient', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest(`http://localhost/api/invoices?patientId=${mockPatientId}`)
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: mockPatientId,
          }),
        })
      )
    })

    it('should filter invoices by date range', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest(
        'http://localhost/api/invoices?dateFrom=2025-01-01&dateTo=2025-01-31'
      )
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      )
    })

    it('should filter overdue invoices', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/invoices?overdue=true')
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dueDate: { lt: expect.any(Date) },
            status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          }),
        })
      )
    })

    it('should filter by payment method', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/invoices?paymentMethod=CASH')
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payments: {
              some: {
                paymentMethod: 'CASH',
              },
            },
          }),
        })
      )
    })

    it('should search invoices by various fields', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/invoices?search=INV2025')
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { invoiceNo: { contains: 'INV2025', mode: 'insensitive' } },
            ]),
          }),
        })
      )
    })

    it('should include payment and item counts', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([])
      mockPrisma.invoice.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/invoices')
      await GET(request)

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: {
              select: {
                payments: true,
                items: true,
              },
            },
          }),
        })
      )
    })
  })

  describe('POST /api/invoices', () => {
    beforeEach(() => {
      mockPrisma.patient.findUnique.mockResolvedValue({
        id: mockPatientId,
        hospitalId: mockHospitalId,
      })
    })

    it('should create a new invoice with valid data', async () => {
      mockPrisma.invoice.create.mockResolvedValue({
        id: 'inv-1',
        invoiceNo: 'INV202501290001',
        totalAmount: 10355,
        status: 'DRAFT',
      })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Root Canal Treatment', quantity: 1, unitPrice: 10000 }],
          discountType: 'FIXED',
          discountValue: 500,
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.invoiceNo).toBe('INV202501290001')
    })

    it('should reject invoice without patient', async () => {
      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Patient is required')
    })

    it('should reject invoice without items', async () => {
      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('At least one item is required')
    })

    it('should reject invoice for non-existent patient', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: 'non-existent',
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Patient not found')
    })

    it('should validate item data', async () => {
      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [
            { description: '', quantity: 0, unitPrice: -100 }, // Invalid
          ],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Line 1')
    })

    it('should stamp the resolved tax rate onto the invoice', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 10000 }],
          taxRate: 0,
        }),
      })
      await POST(request)

      expect(mockCalculateTotals).toHaveBeenCalled()
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taxRate: 0,
            taxAmount: 0,
          }),
        })
      )
    })

    it('should handle percentage discount', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 10000 }],
          discountType: 'PERCENTAGE',
          discountValue: 10,
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discountType: 'PERCENTAGE',
            discountValue: 10,
          }),
        })
      )
    })

    it('should calculate due date from payment terms', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
          paymentTermDays: 30,
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dueDate: expect.any(Date),
          }),
        })
      )
    })

    it('should handle explicit due date', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
          dueDate: '2099-02-28',
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dueDate: expect.any(Date),
          }),
        })
      )
    })

    // Invoice review 6.6: an invoice cannot fall due before it is raised.
    it('should refuse a due date in the past', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
            dueDate: '2020-02-28',
          }),
        })
      )

      expect(response.status).toBe(400)
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    // Invoice review 1.3: the stored line amount is the rounded one the
    // totals were built from.
    it('should store each line at its rounded amount', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Floss', quantity: 3, unitPrice: 33.335 }],
          }),
        })
      )

      const created = mockPrisma.invoice.create.mock.calls[0][0].data
      expect(created.items.create[0]).toMatchObject({ unitPrice: 33.34, amount: 100.02 })
      expect(created.subtotal).toBe(100.02)
    })

    // Invoice review 4.1: a treatment billed below its price counts towards
    // the approval threshold, as a discount would.
    it('should ask for a reason when a treatment is priced far below its price', async () => {
      mockPrisma.treatment.findMany.mockResolvedValue([
        {
          id: 'crown-1',
          patientId: mockPatientId,
          treatmentNo: 'TRT-7',
          status: 'COMPLETED',
          cost: 20000,
        },
      ])
      mockPrisma.invoiceItem.findFirst.mockResolvedValue(null)

      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Crown', quantity: 1, unitPrice: 5000, treatmentId: 'crown-1' }],
          }),
        })
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('below their price')
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    it('should create invoice items with treatment links', async () => {
      const mockTreatmentId = 'treatment-123'
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })
      mockPrisma.treatment.findMany.mockResolvedValue([
        {
          id: mockTreatmentId,
          patientId: mockPatientId,
          treatmentNo: 'TRT-1',
          status: 'COMPLETED',
        },
      ])
      mockPrisma.invoiceItem.findFirst.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [
            {
              description: 'Root Canal',
              quantity: 1,
              unitPrice: 5000,
              treatmentId: mockTreatmentId,
            },
          ],
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  treatmentId: mockTreatmentId,
                }),
              ]),
            },
          }),
        })
      )
    })

    // Finding 13: Fatima's scaling went on Hina's invoice.
    it("should refuse another patient's treatment", async () => {
      mockPrisma.treatment.findMany.mockResolvedValue([
        { id: 'treatment-9', patientId: 'someone-else', treatmentNo: 'TRT-9', status: 'COMPLETED' },
      ])

      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [
              { description: 'Scaling', quantity: 1, unitPrice: 3000, treatmentId: 'treatment-9' },
            ],
          }),
        })
      )

      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('another patient')
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
      expect(mockGenerateInvoiceNo).not.toHaveBeenCalled()
    })

    // Finding 13: Ahmed's filling went on two invoices.
    it('should refuse a treatment already on a live invoice', async () => {
      mockPrisma.treatment.findMany.mockResolvedValue([
        { id: 'treatment-1', patientId: mockPatientId, treatmentNo: 'TRT-1', status: 'COMPLETED' },
      ])
      mockPrisma.invoiceItem.findFirst.mockResolvedValueOnce({
        treatment: { treatmentNo: 'TRT-1' },
        invoice: { invoiceNo: 'INV-202610-0001' },
      })

      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [
              { description: 'Filling', quantity: 1, unitPrice: 5800, treatmentId: 'treatment-1' },
            ],
          }),
        })
      )

      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('INV-202610-0001')
      // A cancelled invoice does not count as billing it.
      expect(mockPrisma.invoiceItem.findFirst.mock.calls[0][0].where).toMatchObject({
        invoice: { status: { not: 'CANCELLED' } },
      })
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    it('should refuse the same treatment on two lines', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [
              { description: 'Filling', quantity: 1, unitPrice: 5800, treatmentId: 't1' },
              { description: 'Filling', quantity: 1, unitPrice: 5800, treatmentId: 't1' },
            ],
          }),
        })
      )

      expect(response.status).toBe(409)
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    // Finding 22.
    it('should refuse an invoice for an inactive patient', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({
        id: mockPatientId,
        hospitalId: mockHospitalId,
        isActive: false,
      })

      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
          }),
        })
      )

      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('inactive')
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    // Finding 37: both were accepted and billed at zero.
    it('should refuse a percentage discount above 100', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Consultation', quantity: 1, unitPrice: 1500 }],
            discountType: 'PERCENTAGE',
            discountValue: 150,
          }),
        })
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('between 0 and 100')
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    it('should refuse a fixed discount larger than the bill', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Consultation', quantity: 1, unitPrice: 1500 }],
            discountType: 'FIXED',
            discountValue: 5000,
          }),
        })
      )

      expect(response.status).toBe(400)
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })

    // Finding 24.
    it('should audit the invoice with its total and discount', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1', invoiceNo: 'INV202501290001' })

      await POST(
        new NextRequest('http://localhost/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            patientId: mockPatientId,
            items: [{ description: 'Service', quantity: 1, unitPrice: 10000 }],
            discountType: 'FIXED',
            discountValue: 500,
          }),
        })
      )

      const entry = mockPrisma.auditLog.create.mock.calls[0][0].data
      expect(entry).toMatchObject({ action: 'invoice.created', entityId: 'inv-1' })
      expect(JSON.parse(entry.newValues)).toMatchObject({
        totalAmount: 9500,
        discountAmount: 500,
      })
    })

    it('should handle taxable and non-taxable items', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [
            { description: 'Taxable Service', quantity: 1, unitPrice: 1000, taxable: true },
            { description: 'Non-taxable Item', quantity: 1, unitPrice: 500, taxable: false },
          ],
        }),
      })
      await POST(request)

      expect(mockCalculateTotals).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ taxable: true }),
          expect.objectContaining({ taxable: false }),
        ]),
        expect.anything(),
        expect.anything(),
        expect.anything()
      )
    })

    it('should set initial paidAmount to 0', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidAmount: 0,
          }),
        })
      )
    })

    it('should set balanceAmount equal to totalAmount', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 100,
            balanceAmount: 100,
          }),
        })
      )
    })
  })

  describe('Permission Checks', () => {
    it('should reject invoice creation by unauthorized roles', async () => {
      mockRequireAuth.mockResolvedValue({
        error: null,
        hospitalId: mockHospitalId,
        user: { id: mockUserId, role: 'LAB_TECH' },
        session: { user: { id: mockUserId, role: 'LAB_TECH', hospitalId: mockHospitalId } },
      })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('should allow ADMIN to create invoices', async () => {
      mockRequireAuth.mockResolvedValue({
        error: null,
        hospitalId: mockHospitalId,
        user: { id: mockUserId, role: 'ADMIN' },
        session: { user: { id: mockUserId, role: 'ADMIN', hospitalId: mockHospitalId } },
      })

      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })

    it('should allow ACCOUNTANT to create invoices', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })

    it('should allow RECEPTIONIST to create invoices', async () => {
      mockRequireAuth.mockResolvedValue({
        error: null,
        hospitalId: mockHospitalId,
        user: { id: mockUserId, role: 'RECEPTIONIST' },
        session: { user: { id: mockUserId, role: 'RECEPTIONIST', hospitalId: mockHospitalId } },
      })

      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })
  })

  describe('Invoice Status Lifecycle', () => {
    const validStatuses = [
      'DRAFT',
      'PENDING',
      'PARTIALLY_PAID',
      'PAID',
      'OVERDUE',
      'CANCELLED',
      'REFUNDED',
    ]

    it('should have defined statuses', () => {
      expect(validStatuses).toHaveLength(7)
    })

    it('should set default status to DRAFT', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DRAFT',
          }),
        })
      )
    })

    // Finding 15: INV-202610-0008 was created PAID with nothing paid. A new
    // invoice is a draft whatever the request says; issuing it is a separate
    // step, and PAID comes only from payments.
    it('should ignore a status in the request', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
          status: 'PAID',
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DRAFT',
          }),
        })
      )
    })
  })

  describe('Tax Calculations', () => {
    it('stamps the clinic-resolved rate onto the invoice', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 1000 }],
          // No rate specified — should come from the clinic's settings
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // Resolved from the clinic record, which is exempt.
            taxRate: 0,
          }),
        })
      )
    })

    // Finding 14: `taxRate: -50` billed a Rs 1,500 consultation at Rs 750.
    it('ignores a tax rate in the request', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Service', quantity: 1, unitPrice: 1000 }],
          taxRate: -50,
        }),
      })
      await POST(request)

      expect(mockCalculateTotals).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        0
      )
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taxRate: 0 }),
        })
      )
    })

    it('should handle zero GST for exempt items', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Exempt Service', quantity: 1, unitPrice: 1000, taxable: false }],
        }),
      })
      await POST(request)

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({}),
        })
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle very large invoice amounts', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Major Surgery', quantity: 1, unitPrice: 10000000 }],
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })

    it('should handle many line items', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const items = Array.from({ length: 50 }, (_, i) => ({
        description: `Item ${i + 1}`,
        quantity: 1,
        unitPrice: 100,
      }))

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items,
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })

    it('should handle decimal quantities', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: 'Partial Service', quantity: 0.5, unitPrice: 1000 }],
        }),
      })
      const response = await POST(request)

      // Should handle or reject based on business rules
      expect([201, 400]).toContain(response.status)
    })

    it('should handle very long description', async () => {
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const longDescription = 'A'.repeat(1000)

      const request = new NextRequest('http://localhost/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: mockPatientId,
          items: [{ description: longDescription, quantity: 1, unitPrice: 100 }],
        }),
      })
      const response = await POST(request)

      expect([201, 400]).toContain(response.status)
    })

    it('should handle concurrent invoice creation', async () => {
      // Multiple invoices being created simultaneously should get unique numbers
      mockGenerateInvoiceNo
        .mockResolvedValueOnce('INV202501290001')
        .mockResolvedValueOnce('INV202501290002')
        .mockResolvedValueOnce('INV202501290003')

      mockPrisma.invoice.create
        .mockResolvedValueOnce({ id: 'inv-1', invoiceNo: 'INV202501290001' })
        .mockResolvedValueOnce({ id: 'inv-2', invoiceNo: 'INV202501290002' })
        .mockResolvedValueOnce({ id: 'inv-3', invoiceNo: 'INV202501290003' })

      const requests = Array.from(
        { length: 3 },
        () =>
          new NextRequest('http://localhost/api/invoices', {
            method: 'POST',
            body: JSON.stringify({
              patientId: mockPatientId,
              items: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
            }),
          })
      )

      const responses = await Promise.all(requests.map((req) => POST(req)))
      const data = await Promise.all(responses.map((res) => res.json()))

      // Each should get unique invoice number
      const invoiceNos = data.map((d) => d.invoiceNo)
      expect(new Set(invoiceNos).size).toBe(3)
    })
  })
})

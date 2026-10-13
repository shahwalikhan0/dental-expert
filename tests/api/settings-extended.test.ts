// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

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

const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn((val: string) => `enc_${val}`),
  mockDecrypt: vi.fn((val: string) => val.replace('enc_', '')),
}))

vi.mock('@/lib/encryption', () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}))

const { mockSmsService, mockEmailService } = vi.hoisted(() => ({
  mockSmsService: {
    initialize: vi.fn(),
    sendSMS: vi.fn(),
  },
  mockEmailService: {
    initialize: vi.fn(),
    sendEmail: vi.fn(),
  },
}))

vi.mock('@/lib/services/sms.service', () => ({
  smsService: mockSmsService,
}))

vi.mock('@/lib/services/email.service', () => ({
  emailService: mockEmailService,
}))

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  GET as holidaysGET,
  POST as holidaysPOST,
  DELETE as holidaysDELETE,
} from '@/app/api/settings/holidays/route'
import { GET as proceduresGET, POST as proceduresPOST } from '@/app/api/settings/procedures/route'
import {
  GET as procedureDetailGET,
  PUT as procedureDetailPUT,
  DELETE as procedureDetailDELETE,
} from '@/app/api/settings/procedures/[id]/route'
import { POST as commTestPOST } from '@/app/api/settings/communications/test/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
    session: { user: { id: 'u1', name: 'Admin', role: 'ADMIN' } },
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function makeReq(path: string, method = 'GET', body?: any): NextRequest {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/settings/billing/gateway
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/settings/holidays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await holidaysGET(makeReq('/api/settings/holidays'))
    expect(res.status).toBe(401)
  })

  it('returns all holidays', async () => {
    mockAuth()
    const mockHolidays = [
      { id: 'h1', name: 'Republic Day', date: new Date('2026-01-26'), isRecurring: true },
      { id: 'h2', name: 'Diwali', date: new Date('2026-10-20'), isRecurring: false },
    ]
    vi.mocked(prisma.availability.findMany).mockResolvedValue(mockHolidays as any)

    const res = await holidaysGET(makeReq('/api/settings/holidays'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.count).toBe(2)
  })

  it('filters holidays by year', async () => {
    mockAuth()
    vi.mocked(prisma.availability.findMany).mockResolvedValue([])

    await holidaysGET(makeReq('/api/settings/holidays?year=2026'))

    const whereArg = vi.mocked(prisma.availability.findMany).mock.calls[0][0]?.where
    expect(whereArg.date).toBeDefined()
    expect(whereArg.date.gte).toBeDefined()
    expect(whereArg.date.lte).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. POST /api/settings/holidays
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/settings/holidays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', {
        name: 'Test',
        date: '2026-01-01T00:00:00.000Z',
      })
    )
    expect(res.status).toBe(401)
  })

  it('creates a holiday', async () => {
    mockAuth()
    vi.mocked(prisma.availability.findMany).mockResolvedValue([])
    const mockHoliday = {
      id: 'h1',
      name: 'Republic Day',
      date: new Date('2026-01-26'),
      isRecurring: true,
    }
    vi.mocked(prisma.availability.create).mockResolvedValue(mockHoliday as any)

    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', {
        name: 'Republic Day',
        date: '2026-01-26T00:00:00.000Z',
        isRecurring: true,
      })
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Republic Day')
  })

  it('returns 400 with a readable message for invalid data (finding 25)', async () => {
    mockAuth()
    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', {
        name: 'Founders Day',
        date: 'not-a-date',
      })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/YYYY-MM-DD/)
    expect(body.error).not.toMatch(/\[|\{/)
  })

  it('accepts a plain calendar date and stores that day', async () => {
    mockAuth()
    vi.mocked(prisma.availability.findMany).mockResolvedValue([])
    vi.mocked(prisma.availability.create).mockResolvedValue({ id: 'h9' } as any)

    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', { name: 'Iqbal Day', date: '2026-10-21' })
    )

    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.availability.create).mock.calls[0][0].data
    expect(data.date.toISOString()).toBe('2026-10-21T00:00:00.000Z')
  })

  it('refuses a day that is not on the calendar', async () => {
    mockAuth()
    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', { name: 'Nope', date: '2026-02-30' })
    )
    expect(res.status).toBe(400)
  })

  it('refuses a second holiday on the same date, naming the first (finding 51)', async () => {
    mockAuth()
    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      { name: 'Diwali', date: new Date('2026-10-20T00:00:00.000Z'), isRecurring: false },
    ] as any)

    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', { name: 'Another', date: '2026-10-20' })
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toContain('Diwali')
    expect(prisma.availability.create).not.toHaveBeenCalled()
  })

  it('refuses a date a yearly holiday already falls on', async () => {
    mockAuth()
    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      { name: 'Independence Day', date: new Date('2025-08-14T00:00:00.000Z'), isRecurring: true },
    ] as any)

    const res = await holidaysPOST(
      makeReq('/api/settings/holidays', 'POST', { name: 'Flag day', date: '2027-08-14' })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Independence Day')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. DELETE /api/settings/holidays
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/settings/holidays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when id is missing', async () => {
    mockAuth()
    const res = await holidaysDELETE(makeReq('/api/settings/holidays', 'DELETE'))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('ID')
  })

  it('deletes a holiday', async () => {
    mockAuth()
    vi.mocked(prisma.availability.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await holidaysDELETE(makeReq('/api/settings/holidays?id=hol-1', 'DELETE'))
    const body = await res.json()

    expect(body.success).toBe(true)
    // A closure is one row among staff shifts and leave in the same table, so
    // the statement names what it is allowed to remove as well as the clinic.
    expect(prisma.availability.deleteMany).toHaveBeenCalledWith({
      where: { id: 'hol-1', hospitalId: 'h1', staffId: null, date: { not: null } },
    })
  })

  it('404s rather than reporting success when nothing matched', async () => {
    mockAuth()
    vi.mocked(prisma.availability.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await holidaysDELETE(makeReq('/api/settings/holidays?id=someone-elses', 'DELETE'))

    expect(res.status).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/settings/procedures
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/settings/procedures', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await proceduresGET(makeReq('/api/settings/procedures'))
    expect(res.status).toBe(401)
  })

  it('returns procedures with pagination', async () => {
    mockAuth()
    const mockProcs = [
      { id: 'p1', code: 'D0100', name: 'Cleaning', category: 'PREVENTIVE', basePrice: 500 },
    ]
    vi.mocked(prisma.procedure.findMany).mockResolvedValue(mockProcs as any)
    vi.mocked(prisma.procedure.count).mockResolvedValue(1)

    const res = await proceduresGET(makeReq('/api/settings/procedures'))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.pagination.total).toBe(1)
  })

  it('filters by category', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findMany).mockResolvedValue([])
    vi.mocked(prisma.procedure.count).mockResolvedValue(0)

    await proceduresGET(makeReq('/api/settings/procedures?category=ENDODONTIC'))

    const whereArg = vi.mocked(prisma.procedure.findMany).mock.calls[0][0]?.where
    expect(whereArg.category).toBe('ENDODONTIC')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. POST /api/settings/procedures
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/settings/procedures', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a procedure', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.procedure.create).mockResolvedValue({
      id: 'p1',
      code: 'D0100',
      name: 'Cleaning',
      category: 'PREVENTIVE',
      basePrice: 500,
    } as any)

    const res = await proceduresPOST(
      makeReq('/api/settings/procedures', 'POST', {
        code: 'D0100',
        name: 'Cleaning',
        category: 'PREVENTIVE',
        basePrice: 500,
      })
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.code).toBe('D0100')
  })

  it('rejects duplicate procedure code', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue({ id: 'existing' } as any)

    const res = await proceduresPOST(
      makeReq('/api/settings/procedures', 'POST', {
        code: 'D0100',
        name: 'Cleaning',
        category: 'PREVENTIVE',
        basePrice: 500,
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('already exists')
  })

  // A request that is simply wrong is a 400 that says what, not a 500 with
  // zod's issue list for the toast (bug report 12 Oct, finding 25).
  it('returns 400 for invalid category', async () => {
    mockAuth()
    const res = await proceduresPOST(
      makeReq('/api/settings/procedures', 'POST', {
        code: 'D0100',
        name: 'Cleaning',
        category: 'INVALID',
        basePrice: 500,
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('category')
  })

  // A free consultation or a warranty redo is a price of nothing (finding 50).
  it('accepts a price of 0 and refuses a negative one', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.procedure.create).mockResolvedValue({ id: 'p1', basePrice: 0 } as any)

    const free = await proceduresPOST(
      makeReq('/api/settings/procedures', 'POST', {
        code: 'CONS0',
        name: 'Free consultation',
        category: 'DIAGNOSTIC',
        basePrice: 0,
      })
    )
    expect(free.status).toBe(200)

    const negative = await proceduresPOST(
      makeReq('/api/settings/procedures', 'POST', {
        code: 'NEG1',
        name: 'Negative',
        category: 'DIAGNOSTIC',
        basePrice: -1,
      })
    )
    expect(negative.status).toBe(400)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. GET /api/settings/procedures/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/settings/procedures/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when procedure not found', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue(null)
    const res = await procedureDetailGET(
      makeReq('/api/settings/procedures/p1'),
      makeParams('p1') as any
    )
    const body = await res.json()
    expect(res.status).toBe(404)
  })

  it('returns procedure detail', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue({
      id: 'p1',
      code: 'D0100',
      name: 'Cleaning',
      category: 'PREVENTIVE',
      basePrice: 500,
    } as any)

    const res = await procedureDetailGET(
      makeReq('/api/settings/procedures/p1'),
      makeParams('p1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.id).toBe('p1')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. PUT /api/settings/procedures/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/settings/procedures/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when procedure not found', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue(null)
    const res = await procedureDetailPUT(
      makeReq('/api/settings/procedures/p1', 'PUT', { name: 'Updated' }),
      makeParams('p1') as any
    )
    expect(res.status).toBe(404)
  })

  it('updates a procedure', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue({
      id: 'p1',
      code: 'D0100',
      name: 'Cleaning',
    } as any)
    vi.mocked(prisma.procedure.update).mockResolvedValue({
      id: 'p1',
      code: 'D0100',
      name: 'Deep Cleaning',
      basePrice: 800,
    } as any)

    const res = await procedureDetailPUT(
      makeReq('/api/settings/procedures/p1', 'PUT', { name: 'Deep Cleaning', basePrice: 800 }),
      makeParams('p1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Deep Cleaning')
  })

  it('rejects duplicate code on code change', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue({
      id: 'p1',
      code: 'D0100',
      name: 'Cleaning',
    } as any)
    vi.mocked(prisma.procedure.findFirst).mockResolvedValue({ id: 'p2' } as any)

    const res = await procedureDetailPUT(
      makeReq('/api/settings/procedures/p1', 'PUT', { code: 'D0200' }),
      makeParams('p1') as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('already exists')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 10. DELETE /api/settings/procedures/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/settings/procedures/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when procedure not found', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue(null)
    const res = await procedureDetailDELETE(
      makeReq('/api/settings/procedures/p1', 'DELETE'),
      makeParams('p1') as any
    )
    expect(res.status).toBe(404)
  })

  it('soft deletes (deactivates) a procedure', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue({ id: 'p1' } as any)
    vi.mocked(prisma.procedure.update).mockResolvedValue({
      id: 'p1',
      isActive: false,
    } as any)

    const res = await procedureDetailDELETE(
      makeReq('/api/settings/procedures/p1', 'DELETE'),
      makeParams('p1') as any
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(prisma.procedure.update).toHaveBeenCalledWith({
      where: { id: 'p1', hospitalId: 'h1' },
      data: { isActive: false },
    })
  })

  it('records the deactivation on the audit trail (finding 24)', async () => {
    mockAuth()
    vi.mocked(prisma.procedure.findUnique).mockResolvedValue({
      id: 'p1',
      code: 'FIL01',
      name: 'Composite filling',
      isActive: true,
    } as any)
    vi.mocked(prisma.procedure.update).mockResolvedValue({ id: 'p1', isActive: false } as any)

    await procedureDetailDELETE(
      makeReq('/api/settings/procedures/p1', 'DELETE'),
      makeParams('p1') as any
    )

    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data).toMatchObject({
      action: 'procedure.deactivated',
      entityId: 'p1',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 11. POST /api/settings/communications/test
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/settings/communications/test', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', { type: 'sms' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when type is missing', async () => {
    mockAuth()
    const res = await commTestPOST(makeReq('/api/settings/communications/test', 'POST', {}))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('Type is required')
  })

  it('returns 400 for invalid type', async () => {
    mockAuth()
    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', { type: 'whatsapp' })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain("'sms' or 'email'")
  })

  it('returns 400 when phone is missing for SMS test', async () => {
    mockAuth()
    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'sms',
        testData: {},
      })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('Phone number')
  })

  it('sends test SMS successfully', async () => {
    mockAuth()
    mockSmsService.initialize.mockResolvedValue(undefined)
    mockSmsService.sendSMS.mockResolvedValue(undefined)

    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'sms',
        testData: { phone: '9876543210' },
      })
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.message).toContain('SMS sent')
    expect(mockSmsService.sendSMS).toHaveBeenCalled()
  })

  it('returns 400 when SMS send fails', async () => {
    mockAuth()
    mockSmsService.initialize.mockResolvedValue(undefined)
    mockSmsService.sendSMS.mockRejectedValue(new Error('SMS gateway unreachable'))

    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'sms',
        testData: { phone: '9876543210' },
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('returns 400 when email address is missing for email test', async () => {
    mockAuth()
    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'email',
        testData: {},
      })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('Email address')
  })

  it('sends test email successfully', async () => {
    mockAuth()
    mockEmailService.initialize.mockResolvedValue(undefined)
    mockEmailService.sendEmail.mockResolvedValue(undefined)

    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'email',
        testData: { email: 'test@example.com' },
      })
    )
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.message).toContain('email sent')
    expect(mockEmailService.sendEmail).toHaveBeenCalled()
  })

  it('returns 400 when email send fails', async () => {
    mockAuth()
    mockEmailService.initialize.mockResolvedValue(undefined)
    mockEmailService.sendEmail.mockRejectedValue(new Error('SMTP error'))

    const res = await commTestPOST(
      makeReq('/api/settings/communications/test', 'POST', {
        type: 'email',
        testData: { email: 'test@example.com' },
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
  })
})

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

vi.mock('@/lib/services/template.service', () => ({
  templateService: {
    validateTemplate: vi.fn(),
    createTemplate: vi.fn(),
    getTemplates: vi.fn(),
    findByName: vi.fn(),
  },
}))

vi.mock('@/lib/services/sms.service', () => ({
  smsService: {
    sendSMS: vi.fn(),
    getSMSHistory: vi.fn(),
  },
}))

vi.mock('@/lib/services/email.service', () => ({
  emailService: {
    sendEmail: vi.fn(),
    sendWithTemplate: vi.fn(),
    getEmailHistory: vi.fn(),
  },
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  POST as templatesPOST,
  GET as templatesGET,
} from '@/app/api/communications/templates/route'
import { POST as smsPOST, GET as smsGET } from '@/app/api/communications/sms/route'
import { POST as emailPOST, GET as emailGET } from '@/app/api/communications/email/route'
import { POST as bulkSmsPOST } from '@/app/api/communications/sms/bulk/route'
import { prisma } from '@/lib/prisma'

import { requireAuthAndRole } from '@/lib/api-helpers'
import { templateService } from '@/lib/services/template.service'
import { smsService } from '@/lib/services/sms.service'
import { emailService } from '@/lib/services/email.service'

// ── Auth helpers ─────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
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

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /api/communications/templates
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/communications/templates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await templatesPOST(
      makeReq('/api/communications/templates', 'POST', {
        name: 'T',
        category: 'GENERAL',
        channel: 'SMS',
        content: 'Hi',
      })
    )
    expect(res.status).toBe(401)
  })

  it('creates template when validation passes', async () => {
    mockAuth()
    vi.mocked(templateService.validateTemplate).mockReturnValue({
      isValid: true,
      errors: [],
      unknownVariables: [],
    })
    vi.mocked(templateService.createTemplate).mockResolvedValue({
      id: 't1',
      name: 'Reminder',
      category: 'APPOINTMENT',
      channel: 'SMS',
      content: 'Hello {{patientName}}',
    } as any)

    const res = await templatesPOST(
      makeReq('/api/communications/templates', 'POST', {
        name: 'Reminder',
        category: 'APPOINTMENT',
        channel: 'SMS',
        content: 'Hello {{patientName}}',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('t1')
    expect(templateService.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ hospitalId: 'h1', name: 'Reminder' })
    )
  })

  it('returns 400 when template validation fails', async () => {
    mockAuth()
    vi.mocked(templateService.validateTemplate).mockReturnValue({
      isValid: false,
      errors: ['Unknown variable {{badVar}}'],
      unknownVariables: ['badVar'],
    })

    const res = await templatesPOST(
      makeReq('/api/communications/templates', 'POST', {
        name: 'Bad',
        category: 'GENERAL',
        channel: 'SMS',
        content: 'Hello {{badVar}}',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    // The toast shows `error`, so it carries the reason rather than a heading.
    expect(body.error).toBe('Unknown variable {{badVar}}')
    expect(body.unknownVariables).toContain('badVar')
    expect(body.validVariables).toContain('firstName')
    expect(templateService.createTemplate).not.toHaveBeenCalled()
  })

  it('returns 409 when the clinic already has a template of that name (finding 62)', async () => {
    mockAuth()
    vi.mocked(templateService.validateTemplate).mockReturnValue({
      isValid: true,
      errors: [],
      unknownVariables: [],
    })
    vi.mocked(templateService.findByName).mockResolvedValueOnce({
      id: 't0',
      name: 'Post-op care (SMS)',
    } as any)

    const res = await templatesPOST(
      makeReq('/api/communications/templates', 'POST', {
        name: 'post-op care (sms)',
        category: 'GENERAL',
        channel: 'SMS',
        content: 'Rinse gently, {{firstName}}.',
      })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Post-op care (SMS)')
    expect(templateService.findByName).toHaveBeenCalledWith('h1', 'post-op care (sms)')
    expect(templateService.createTemplate).not.toHaveBeenCalled()
  })

  it('returns 400 naming the valid categories for an invalid category (finding 25)', async () => {
    mockAuth()
    const res = await templatesPOST(
      makeReq('/api/communications/templates', 'POST', {
        name: 'T',
        category: 'INVALID_CAT',
        channel: 'SMS',
        content: 'Hi',
      })
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/^category:/)
    expect(body.error).toContain('APPOINTMENT')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /api/communications/templates
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/communications/templates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await templatesGET(makeReq('/api/communications/templates'))
    expect(res.status).toBe(401)
  })

  it('returns templates with count', async () => {
    mockAuth()
    const mockTemplates = [
      { id: 't1', name: 'Reminder', category: 'APPOINTMENT' },
      { id: 't2', name: 'Payment', category: 'PAYMENT' },
    ]
    vi.mocked(templateService.getTemplates).mockResolvedValue(mockTemplates as any)

    const res = await templatesGET(makeReq('/api/communications/templates'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.count).toBe(2)
  })

  it('passes filters to service', async () => {
    mockAuth()
    vi.mocked(templateService.getTemplates).mockResolvedValue([])

    await templatesGET(
      makeReq('/api/communications/templates?category=PAYMENT&channel=EMAIL&isActive=true')
    )

    expect(templateService.getTemplates).toHaveBeenCalledWith('h1', {
      category: 'PAYMENT',
      channel: 'EMAIL',
      isActive: true,
    })
  })

  it('returns empty array when no templates exist', async () => {
    mockAuth()
    vi.mocked(templateService.getTemplates).mockResolvedValue([])

    const res = await templatesGET(makeReq('/api/communications/templates'))
    const body = await res.json()

    expect(body.data).toEqual([])
    expect(body.count).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/communications/sms
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/communications/sms', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await smsPOST(
      makeReq('/api/communications/sms', 'POST', {
        phone: '9876543210',
        message: 'Hello',
      })
    )
    expect(res.status).toBe(401)
  })

  it('sends SMS successfully', async () => {
    mockAuth()
    vi.mocked(smsService.sendSMS).mockResolvedValue('sms1' as any)

    const res = await smsPOST(
      makeReq('/api/communications/sms', 'POST', {
        phone: '9876543210',
        message: 'Test message',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.smsLogId).toBe('sms1')
  })

  it('returns 400 for validation error (phone too short)', async () => {
    mockAuth()
    const res = await smsPOST(
      makeReq('/api/communications/sms', 'POST', {
        phone: '123',
        message: 'Hello',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^phone:/)
  })

  it('returns 400 for validation error (message too long)', async () => {
    mockAuth()
    const res = await smsPOST(
      makeReq('/api/communications/sms', 'POST', {
        phone: '9876543210',
        message: 'x'.repeat(501),
      })
    )
    expect(res.status).toBe(400)
  })

  it("repeats the service's own refusal, and nothing else", async () => {
    mockAuth()
    const { SendRefusal } = await import('@/lib/services/send-refusal')
    vi.mocked(smsService.sendSMS).mockRejectedValueOnce(
      new SendRefusal('SMS gateway not configured')
    )
    const refused = await smsPOST(
      makeReq('/api/communications/sms', 'POST', { phone: '3001234567', message: 'Hi' })
    )
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toBe('SMS gateway not configured')

    vi.mocked(smsService.sendSMS).mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.5:443 at /srv/app/node_modules/x.js')
    )
    const crashed = await smsPOST(
      makeReq('/api/communications/sms', 'POST', { phone: '3001234567', message: 'Hi' })
    )
    expect(crashed.status).toBe(500)
    expect((await crashed.json()).error).toBe('Failed to send SMS')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET /api/communications/sms
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/communications/sms', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await smsGET(makeReq('/api/communications/sms'))
    expect(res.status).toBe(401)
  })

  it('returns SMS history', async () => {
    mockAuth()
    const mockHistory = [{ id: 'sms1', phone: '9876543210', status: 'DELIVERED' }]
    vi.mocked(smsService.getSMSHistory).mockResolvedValue(mockHistory as any)

    const res = await smsGET(makeReq('/api/communications/sms'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('passes filters to service', async () => {
    mockAuth()
    vi.mocked(smsService.getSMSHistory).mockResolvedValue([])

    await smsGET(makeReq('/api/communications/sms?status=DELIVERED&phone=9876543210&limit=50'))

    expect(smsService.getSMSHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'h1',
        status: 'DELIVERED',
        phone: '9876543210',
        limit: 50,
      })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /api/communications/email
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/communications/email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await emailPOST(
      makeReq('/api/communications/email', 'POST', {
        to: 'test@example.com',
        subject: 'Hi',
        body: 'Hello',
      })
    )
    expect(res.status).toBe(401)
  })

  it('sends email successfully', async () => {
    mockAuth()
    vi.mocked(emailService.sendEmail).mockResolvedValue('em1' as any)

    const res = await emailPOST(
      makeReq('/api/communications/email', 'POST', {
        to: 'patient@example.com',
        subject: 'Appointment Reminder',
        body: 'Your appointment is tomorrow.',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.emailLogId).toBe('em1')
  })

  it('sends email with template', async () => {
    mockAuth()
    vi.mocked(emailService.sendWithTemplate).mockResolvedValue('em2' as any)

    const res = await emailPOST(
      makeReq('/api/communications/email', 'POST', {
        to: 'patient@example.com',
        templateId: 't1',
        variables: { patientName: 'John' },
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/communications/email
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/communications/email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await emailGET(makeReq('/api/communications/email'))
    expect(res.status).toBe(401)
  })

  it('returns email history', async () => {
    mockAuth()
    const mockHistory = [{ id: 'em1', to: 'test@example.com', status: 'SENT' }]
    vi.mocked(emailService.getEmailHistory).mockResolvedValue(mockHistory as any)

    const res = await emailGET(makeReq('/api/communications/email'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it('passes filters to service', async () => {
    mockAuth()
    vi.mocked(emailService.getEmailHistory).mockResolvedValue([])

    await emailGET(makeReq('/api/communications/email?status=SENT&email=test@example.com&limit=25'))

    expect(emailService.getEmailHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'h1',
        status: 'SENT',
        email: 'test@example.com',
        limit: 25,
      })
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/communications/sms/bulk — a paid feature (finding 26)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/communications/sms/bulk', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a clinic on the Free plan, saying so', async () => {
    mockAuth()
    vi.mocked(prisma.hospital.findUnique).mockResolvedValueOnce({
      id: 'h1',
      name: 'Smile Clinic',
      slug: 'smile',
      isActive: true,
      onboardingCompleted: true,
      subscription: { plan: 'FREE', status: 'ACTIVE' },
    } as any)

    const res = await bulkSmsPOST(
      makeReq('/api/communications/sms/bulk', 'POST', {
        recipients: [{ phone: '3001234567', message: 'Hi' }],
      })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('PLAN_FEATURE')
    expect(body.error).toContain('Bulk messaging')
  })
})

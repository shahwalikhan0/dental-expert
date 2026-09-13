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

const mockOpenRouter = vi.hoisted(() => ({
  complete: vi.fn(),
  extractJSON: vi.fn((s: string) => s),
}))

const mockModels = vi.hoisted(() => ({
  getModelByTier: vi.fn(() => ({ model: 'test-model', maxTokens: 4096 })),
}))

const mockContext = vi.hoisted(() => ({
  buildContext: vi.fn().mockResolvedValue({}),
  serializeContext: vi.fn().mockReturnValue('context-string'),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/ai/openrouter', () => mockOpenRouter)
vi.mock('@/lib/ai/models', () => mockModels)
vi.mock('@/lib/ai/context-builder', () => mockContext)

const suggestionsModule = await import('@/app/api/ai/suggestions/route')
const briefingModule = await import('@/app/api/ai/briefing/route')

describe('GET /api/ai/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
      user: { id: 'user-1', name: 'Admin', role: 'ADMIN' },
    })
  })

  it('returns suggestions for dashboard page', async () => {
    ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', plan: 'PRO' })
    const suggestions = [
      {
        title: 'Check appointments',
        description: 'Review upcoming',
        action: 'view_patients',
        urgency: 'normal',
      },
    ]
    mockOpenRouter.complete.mockResolvedValue({ content: JSON.stringify(suggestions) })
    mockOpenRouter.extractJSON.mockReturnValue(JSON.stringify(suggestions))

    const req = new Request('http://localhost/api/ai/suggestions?page=/dashboard') as any
    req.nextUrl = new URL('http://localhost/api/ai/suggestions?page=/dashboard')
    const res = await suggestionsModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toHaveLength(1)
  })

  it('enriches billing page context with overdue count', async () => {
    ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', plan: 'PRO' })
    ;(prisma.invoice.count as any).mockResolvedValue(5)
    mockOpenRouter.complete.mockResolvedValue({ content: '[]' })
    mockOpenRouter.extractJSON.mockReturnValue('[]')

    const req = new Request('http://localhost/api/ai/suggestions?page=/billing') as any
    req.nextUrl = new URL('http://localhost/api/ai/suggestions?page=/billing')
    await suggestionsModule.GET(req)
    expect(prisma.invoice.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OVERDUE' }) })
    )
  })

  it('returns empty array when AI fails', async () => {
    ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test', plan: 'FREE' })
    mockOpenRouter.complete.mockRejectedValue(new Error('AI error'))

    const req = new Request('http://localhost/api/ai/suggestions') as any
    req.nextUrl = new URL('http://localhost/api/ai/suggestions')
    const res = await suggestionsModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toEqual([])
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      hospitalId: null,
      user: null,
    })
    const req = new Request('http://localhost/api/ai/suggestions') as any
    req.nextUrl = new URL('http://localhost/api/ai/suggestions')
    const res = await suggestionsModule.GET(req)
    expect(res.status).toBe(401)
  })
})

describe('GET /api/ai/briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
      user: { id: 'user-1', name: 'Admin', role: 'ADMIN' },
    })
  })

  it('generates a morning briefing with all data sources', async () => {
    ;(prisma.appointment.findMany as any).mockResolvedValue([
      {
        scheduledTime: '09:00',
        patient: { firstName: 'John', lastName: 'Doe' },
        doctor: { firstName: 'Jane', lastName: 'Smith' },
        appointmentType: 'CHECKUP',
      },
    ])
    ;(prisma.invoice.findMany as any).mockResolvedValue([])
    ;(prisma.inventoryItem.findMany as any).mockResolvedValue([])
    ;(prisma.patientRiskScore.findMany as any).mockResolvedValue([])
    ;(prisma.treatment.findMany as any).mockResolvedValue([])

    mockOpenRouter.complete.mockResolvedValue({ content: 'Good morning! Here is your briefing.' })
    ;(prisma.aIInsight.create as any).mockResolvedValue({})

    const res = await briefingModule.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.briefing).toBe('Good morning! Here is your briefing.')
    expect(body.generatedAt).toBeDefined()
    expect(prisma.aIInsight.create).toHaveBeenCalled()
  })

  it('returns 401 for non-ADMIN users', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
      hospitalId: null,
      user: null,
    })
    const res = await briefingModule.GET()
    expect(res.status).toBe(403)
  })

  it('returns 502 when AI fails', async () => {
    ;(prisma.appointment.findMany as any).mockResolvedValue([])
    ;(prisma.invoice.findMany as any).mockResolvedValue([])
    ;(prisma.inventoryItem.findMany as any).mockResolvedValue([])
    ;(prisma.patientRiskScore.findMany as any).mockResolvedValue([])
    ;(prisma.treatment.findMany as any).mockResolvedValue([])

    mockOpenRouter.complete.mockRejectedValue(new Error('AI service error'))

    const res = await briefingModule.GET()
    expect(res.status).toBe(502)
  })
})

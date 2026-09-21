// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock modules with inline factories - these get hoisted
vi.mock('@/lib/prisma', () => {
  const client: any = {
    // Reference numbers come from a counter row via one INSERT … ON CONFLICT
    // … RETURNING, so anything that numbers a document needs this to answer.
    $queryRaw: vi.fn().mockResolvedValue([{ seq: 1 }]),
    // Registering a patient also starts their recall date, in the same
    // transaction — see app/api/patients/route.ts.
    recareType: { findFirst: vi.fn().mockResolvedValue(null) },
    recare: { upsert: vi.fn() },
    patient: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    hospital: {
      findUnique: vi.fn(),
    },
  }

  client.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client)))

  return { prisma: client }
})

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
    checkPatientLimit: vi.fn(),
    requireRole: vi.fn(),
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

// Import after mocks are set up
import { GET, POST } from '@/app/api/patients/route'
import { requireAuthAndRole, checkPatientLimit } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

describe('Patients API - GET /api/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: authenticated user with hospital
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN' },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })
  })

  it('should return 401 for unauthenticated requests', async () => {
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const request = new NextRequest('http://localhost:3000/api/patients')
    const response = await GET(request)

    expect(response.status).toBe(401)
  })

  it('should return patients list with pagination', async () => {
    const mockPatients = [
      {
        id: 'patient-1',
        patientId: 'PAT202500001',
        firstName: 'John',
        lastName: 'Doe',
        phone: '9876543210',
        email: 'john@example.com',
        gender: 'MALE',
        age: 35,
        bloodGroup: 'O+',
        city: 'Mumbai',
      },
    ]

    vi.mocked(prisma.patient.findMany).mockResolvedValue(mockPatients as any)
    vi.mocked(prisma.patient.count).mockResolvedValue(1)

    const request = new NextRequest('http://localhost:3000/api/patients?page=1&limit=10')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.patients).toHaveLength(1)
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.limit).toBe(10)
    expect(data.pagination.total).toBe(1)
  })

  it('should support search functionality', async () => {
    vi.mocked(prisma.patient.findMany).mockResolvedValue([])
    vi.mocked(prisma.patient.count).mockResolvedValue(0)

    const request = new NextRequest('http://localhost:3000/api/patients?search=john')
    await GET(request)

    expect(prisma.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hospitalId: 'hospital-1',
          isActive: true,
          // Case-insensitively: `contains` alone is `LIKE`, which on
          // PostgreSQL would not have matched "John".
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  firstName: { contains: 'john', mode: 'insensitive' },
                }),
              ]),
            }),
          ]),
        }),
      })
    )
  })

  it('matches a full name across both name columns', async () => {
    vi.mocked(prisma.patient.findMany).mockResolvedValue([])
    vi.mocked(prisma.patient.count).mockResolvedValue(0)

    const request = new NextRequest('http://localhost:3000/api/patients?search=john%20smith')
    await GET(request)

    // One clause per word, each of which must match somewhere. Matching the
    // whole string against each column on its own found nothing at all:
    // "John Smith" is contained in neither `firstName` nor `lastName`.
    const where = vi.mocked(prisma.patient.findMany).mock.calls[0][0]?.where as any
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: { contains: 'john', mode: 'insensitive' } }),
      ])
    )
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lastName: { contains: 'smith', mode: 'insensitive' } }),
      ])
    )
  })

  it('should handle database errors gracefully', async () => {
    vi.mocked(prisma.patient.findMany).mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/patients')
    const response = await GET(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to fetch patients')
  })
})

describe('Patients API - POST /api/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN' },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })

    vi.mocked(checkPatientLimit).mockResolvedValue({
      allowed: true,
      current: 5,
      max: 100,
    })
  })

  it('should return 401 for unauthenticated requests', async () => {
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({ firstName: 'John', lastName: 'Doe', phone: '9876543210' }),
    })
    const response = await POST(request)

    expect(response.status).toBe(401)
  })

  it('should create a patient with valid data', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.patient.create).mockResolvedValue({
      id: 'new-patient-id',
      patientId: 'PAT202500001',
      firstName: 'John',
      lastName: 'Doe',
      phone: '9876543210',
      hospitalId: 'hospital-1',
    } as any)

    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        phone: '9876543210',
        email: 'john@example.com',
        gender: 'MALE',
        age: 35,
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.firstName).toBe('John')
  })

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'John',
        // Missing lastName and phone
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('required')
  })

  it('allows a shared phone number, and names who else is on it', async () => {
    // Families share a number. The CNIC is what identifies a person here, and
    // that is still unique; this is a warning, not a refusal.
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'existing-patient',
      patientId: 'P-0001',
      firstName: 'Fatima',
      lastName: 'Khan',
    } as any)

    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Ali',
        lastName: 'Khan',
        phone: '9876543210',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.sharedPhoneWith.name).toBe('Fatima Khan')
  })

  it('should return 403 when patient limit is reached', async () => {
    vi.mocked(checkPatientLimit).mockResolvedValue({
      allowed: false,
      current: 100,
      max: 100,
    })

    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        phone: '9876543210',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe('Patient limit reached')
  })

  it('should handle database errors gracefully', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.patient.create).mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/patients', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Doe',
        phone: '9876543210',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to create patient')
  })
})

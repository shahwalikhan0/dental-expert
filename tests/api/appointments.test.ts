// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock modules with inline factories - these get hoisted
vi.mock('@/lib/prisma', () => {
  // Booking writes the walk-in and the appointment together, so the create path
  // runs inside a transaction; the callback gets this same client.
  const client: any = {
    // Reference numbers come from a counter row via one INSERT … ON CONFLICT
    // … RETURNING, so anything that numbers a document needs this to answer.
    $queryRaw: vi.fn().mockResolvedValue([{ seq: 1 }]),
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    patient: {
      findFirst: vi.fn(),
    },
    staff: {
      findFirst: vi.fn(),
    },
    visitor: {
      create: vi.fn().mockResolvedValue({ id: 'visitor-1' }),
    },
    setting: {
      findUnique: vi.fn(),
      // Settings → Appointments is read on every booking now (the horizon, the
      // slot grid, the buffer). Empty means "this clinic has set nothing", so
      // the defaults in lib/appointment-settings.ts apply.
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Appointments are stored as instants and rendered against the clinic's
    // own timezone, so every route that touches one reads this row.
    hospital: {
      findUnique: vi.fn().mockResolvedValue({ id: 'h1', timezone: 'Asia/Karachi' }),
    },
    // Clinic holidays and the dentist's shifts and leave, read on every
    // booking (lib/appointment-availability.ts). Empty: none.
    availability: {
      findMany: vi.fn().mockResolvedValue([]),
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

// Import after mocks
import { GET, POST } from '@/app/api/appointments/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { instantAt } from '@/lib/appointment-time'
import { NOT_A_DENTIST } from '@/lib/clinicians'
import { INACTIVE_PATIENT } from '@/lib/appointment-status'

const KARACHI = 'Asia/Karachi'

/** A wall-clock time on the fixtures' day, as the instant it refers to. */
const at = (time: string) => instantAt('2030-06-15', time, KARACHI)!

describe('Appointments API - GET /api/appointments', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

    const request = new NextRequest('http://localhost:3000/api/appointments')
    const response = await GET(request)

    expect(response.status).toBe(401)
  })

  it('should return appointments list with pagination', async () => {
    const mockAppointments = [
      {
        id: 'apt-1',
        appointmentNo: 'APT202501150001',
        startsAt: at('09:00'),
        status: 'SCHEDULED',
        patient: {
          id: 'patient-1',
          patientId: 'PAT202500001',
          firstName: 'John',
          lastName: 'Doe',
          phone: '9876543210',
          email: 'john@example.com',
        },
        doctor: {
          id: 'doctor-1',
          firstName: 'Priya',
          lastName: 'Patel',
          specialization: 'General Dentistry',
        },
      },
    ]

    vi.mocked(prisma.appointment.findMany).mockResolvedValue(mockAppointments as any)
    vi.mocked(prisma.appointment.count).mockResolvedValue(1)

    const request = new NextRequest('http://localhost:3000/api/appointments?page=1&limit=10')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.appointments).toHaveLength(1)
    expect(data.pagination.page).toBe(1)
    expect(data.pagination.total).toBe(1)
  })

  it('should filter by status', async () => {
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.count).mockResolvedValue(0)

    const request = new NextRequest('http://localhost:3000/api/appointments?status=SCHEDULED')
    await GET(request)

    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SCHEDULED',
        }),
      })
    )
  })

  it('should handle database errors gracefully', async () => {
    vi.mocked(prisma.appointment.findMany).mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/appointments')
    const response = await GET(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to fetch appointments')
  })
})

describe('Appointments API - POST /api/appointments', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request)

    expect(response.status).toBe(401)
  })

  it('should create appointment with valid data', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      hospitalId: 'hospital-1',
      isActive: true,
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({
      id: 'doctor-1',
      hospitalId: 'hospital-1',
    } as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]) // No conflict
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'new-apt-id',
      appointmentNo: 'APT202501150001',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      startsAt: at('09:00'),
      status: 'SCHEDULED',
      patient: {
        id: 'patient-1',
        patientId: 'PAT202500001',
        firstName: 'John',
        lastName: 'Doe',
        phone: '9876543210',
      },
      doctor: {
        id: 'doctor-1',
        firstName: 'Priya',
        lastName: 'Patel',
      },
    } as any)

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: '2030-06-15',
        scheduledTime: '09:00',
        duration: 30,
        appointmentType: 'CONSULTATION',
        priority: 'NORMAL',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
  })

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'patient-1',
        // Missing doctorId, scheduledDate, scheduledTime
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('required')
  })

  it('should return 404 when patient not found', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'non-existent-patient',
        doctorId: 'doctor-1',
        scheduledDate: '2030-06-15',
        scheduledTime: '09:00',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Patient not found')
  })

  // Not found, another clinic's, not a dentist, or deactivated: one answer
  // (bug report 12 Oct, findings 2 and 7).
  it('should return 400 when the doctor is not an active dentist here', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      hospitalId: 'hospital-1',
      isActive: true,
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'patient-1',
        doctorId: 'non-existent-doctor',
        scheduledDate: '2030-06-15',
        scheduledTime: '09:00',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe(NOT_A_DENTIST)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('should return 409 for conflicting appointments', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      hospitalId: 'hospital-1',
      isActive: true,
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({
      id: 'doctor-1',
      hospitalId: 'hospital-1',
    } as any)
    // Deliberately a *partial* overlap rather than the same start time: this is
    // the case the previous exact-match check let through.
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        id: 'existing-apt',
        appointmentNo: 'APT00001',
        startsAt: at('09:00'),
        duration: 60,
        doctorId: 'doctor-1',
        chairId: null,
        patient: { firstName: 'Ali', lastName: 'Raza' },
        doctor: { firstName: 'Imran', lastName: 'Shah' },
        chair: null,
      },
    ] as any)
    vi.mocked(prisma.setting.findUnique).mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: '2030-06-15',
        scheduledTime: '09:30',
        duration: 30,
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toContain('Dr. Imran Shah')
    expect(data.conflicts).toHaveLength(1)
    expect(data.conflicts[0].resource).toBe('doctor')
  })

  it('should handle database errors gracefully', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      hospitalId: 'hospital-1',
      isActive: true,
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({
      id: 'doctor-1',
      hospitalId: 'hospital-1',
    } as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.create).mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        scheduledDate: '2030-06-15',
        scheduledTime: '09:00',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toBe('Failed to create appointment')
  })
})

/**
 * Booking keeps to the clinic's calendar (bug report 12 Oct, finding 6): the
 * slot picker refused holidays, closed hours and lunch, and the API checked
 * none of them. 15 June 2030 is a Saturday; with no hours configured the
 * clinic is open 09:00–21:00 with lunch 13:00–14:00.
 */
describe('Appointments API - POST /api/appointments — the clinic calendar', () => {
  const book = (overrides: Record<string, unknown> = {}) =>
    POST(
      new NextRequest('http://localhost:3000/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          scheduledDate: '2030-06-15',
          scheduledTime: '10:00',
          duration: 30,
          ...overrides,
        }),
      })
    )

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuthAndRole).mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'admin@test.com', role: 'ADMIN' },
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1' } },
    })
    vi.mocked(prisma.availability.findMany).mockResolvedValue([])
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      isActive: true,
    } as any)
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: 'doctor-1' } as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([])
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'new-apt-id',
      startsAt: at('10:00'),
      status: 'SCHEDULED',
    } as any)
  })

  it('refuses a clinic holiday', async () => {
    vi.mocked(prisma.availability.findMany).mockResolvedValue([
      {
        id: 'hol-1',
        staffId: null,
        dayOfWeek: null,
        date: new Date('2030-06-15T00:00:00.000Z'),
        startTime: null,
        endTime: null,
        isAvailable: false,
        name: 'QA closure day',
        isRecurring: false,
      },
    ] as any)

    const res = await book()

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('QA closure day')
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('refuses a time after the clinic closes', async () => {
    const res = await book({ scheduledTime: '23:30' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('opening hours')
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('refuses an appointment that would run past closing', async () => {
    const res = await book({ scheduledTime: '20:45', duration: 30 })

    expect(res.status).toBe(400)
  })

  it('refuses the lunch break', async () => {
    const res = await book({ scheduledTime: '13:15' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('lunch')
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('refuses a day the clinic does not open', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      timezone: 'Asia/Karachi',
      workingHours: JSON.stringify({
        monday: { open: '09:00', close: '17:00' },
        saturday: { open: null, close: null },
      }),
    } as any)

    const res = await book()

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('closed')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      timezone: 'Asia/Karachi',
    } as any)
  })

  it('books an open slot', async () => {
    const res = await book()

    expect(res.status).toBe(201)
  })

  // Finding 22: a deactivated patient could still be booked.
  it('refuses an inactive patient', async () => {
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      id: 'patient-1',
      isActive: false,
    } as any)

    const res = await book()

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(INACTIVE_PATIENT)
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  // Finding 49: an unknown type was a 500.
  it('refuses an unknown appointment type with a 400 naming the valid ones', async () => {
    const res = await book({ appointmentType: 'TREATMENT' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('CONSULTATION')
    expect(prisma.appointment.create).not.toHaveBeenCalled()
  })

  it('asks only for an active dentist of this clinic', async () => {
    await book()

    expect(prisma.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'doctor-1',
          hospitalId: 'hospital-1',
          isActive: true,
        }),
      })
    )
  })
})

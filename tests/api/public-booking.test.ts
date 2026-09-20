// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { GET as publicDoctorsGET } from '@/app/api/public/[slug]/doctors/route'
import { POST as publicBookPOST } from '@/app/api/public/[slug]/book/route'
import { prisma } from '@/lib/prisma'
import { instantAt } from '@/lib/appointment-time'

const KARACHI = 'Asia/Karachi'

/** A wall-clock time on the fixtures' day, as the instant it refers to. */
const at = (time: string) => instantAt('2026-03-15', time, KARACHI)!

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, method = 'GET', body?: any): NextRequest {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init)
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/public/[slug]/doctors
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/[slug]/doctors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when clinic not found', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null)

    const res = await publicDoctorsGET(
      makeReq('/api/public/nonexistent/doctors'),
      makeParams('nonexistent')
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when portal not enabled', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'Test Clinic',
      patientPortalEnabled: false,
    } as any)

    const res = await publicDoctorsGET(
      makeReq('/api/public/test-clinic/doctors'),
      makeParams('test-clinic')
    )
    expect(res.status).toBe(403)
  })

  it('returns doctors list with hospital name', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      name: 'Smile Dental',
      patientPortalEnabled: true,
    } as any)
    vi.mocked(prisma.staff.findMany).mockResolvedValue([
      { id: 'd1', firstName: 'Dr', lastName: 'Smith', specialization: 'General' },
      { id: 'd2', firstName: 'Dr', lastName: 'Jones', specialization: 'Ortho' },
    ] as any)

    const res = await publicDoctorsGET(
      makeReq('/api/public/smile-dental/doctors'),
      makeParams('smile-dental')
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.doctors).toHaveLength(2)
    expect(body.hospitalName).toBe('Smile Dental')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/public/[slug]/book
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Booking as a patient.
 *
 * The contract changed when the booking page was built. It used to require an
 * existing patient record, matched on phone number, and answer "No patient
 * account found with this phone number" when it found none — which refused the
 * one person a clinic most wants to hear from, and told any caller whether a
 * given number belongs to a patient of this practice. Anyone may book now; an
 * unknown number becomes a visitor, which is the record a walk-in gets.
 */
describe('POST /api/public/[slug]/book', () => {
  // A fixed clock, because the route now applies a notice period and a horizon
  // and "2026-03-15" is otherwise in the past or the far future depending on
  // when the suite runs.
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T06:00:00Z'))
  })

  afterEach(() => vi.useRealTimers())

  const openClinic = () =>
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      isActive: true,
      patientPortalEnabled: true,
      timezone: KARACHI,
    } as any)

  const dentistExists = () =>
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({
      id: 'd1',
      firstName: 'Ayesha',
      lastName: 'Noor',
    } as any)

  const nothingBooked = () => {
    vi.mocked(prisma.appointment.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as any)
  }

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: 'Hamza Sheikh',
    phone: '0321 9998877',
    doctorId: 'd1',
    date: '2026-03-15',
    time: '10:00',
    ...overrides,
  })

  const book = (payload: Record<string, unknown>, slug = 'test') =>
    publicBookPOST(makeReq(`/api/public/${slug}/book`, 'POST', payload), makeParams(slug))

  it('returns 400 when required fields are missing', async () => {
    const res = await book({ phone: '9876543210' })
    expect(res.status).toBe(400)
  })

  it('asks for a name, which it never used to', async () => {
    const res = await book({ ...body(), name: undefined })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it('returns 404 when the clinic is not found', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null)
    expect((await book(body(), 'nonexistent')).status).toBe(404)
  })

  it('returns 404 for a deactivated clinic, the same as for no clinic', async () => {
    // Telling them apart would confirm which slugs exist.
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      isActive: false,
      patientPortalEnabled: true,
      timezone: KARACHI,
    } as any)
    expect((await book(body())).status).toBe(404)
  })

  it('returns 403 when online booking is switched off', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      id: 'h1',
      isActive: true,
      patientPortalEnabled: false,
      timezone: KARACHI,
    } as any)
    expect((await book(body())).status).toBe(403)
  })

  it('refuses a slot sooner than the notice period', async () => {
    openClinic()
    const res = await book(body({ date: '2026-03-10', time: '11:30' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/notice/i)
  })

  it('refuses a slot past the horizon', async () => {
    openClinic()
    const res = await book(body({ date: '2027-03-10' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ahead/i)
  })

  it('returns 404 when the dentist is not found', async () => {
    openClinic()
    vi.mocked(prisma.staff.findFirst).mockResolvedValue(null)
    expect((await book(body({ doctorId: 'd-none' }))).status).toBe(404)
  })

  it('refuses when the number already holds its allowance of bookings', async () => {
    // The only abuse control on an unauthenticated write.
    openClinic()
    dentistExists()
    vi.mocked(prisma.appointment.count).mockResolvedValue(3 as any)

    const res = await book(body())
    expect(res.status).toBe(429)
  })

  it('refuses a slot the dentist is already occupying', async () => {
    // The staff routes honour a WARN policy that lets the desk overbook on
    // purpose. Overbooking is a decision for the front desk, not for whoever
    // is on the website, so this route never waves one through.
    openClinic()
    dentistExists()
    vi.mocked(prisma.appointment.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        id: 'a-existing',
        appointmentNo: 'APT202603100000',
        doctorId: 'd1',
        startsAt: at('10:00'),
        duration: 30,
        status: 'SCHEDULED',
        patient: { firstName: 'Rabia', lastName: 'Anwar' },
        visitor: null,
        doctor: { firstName: 'Ayesha', lastName: 'Noor' },
      },
    ] as any)

    expect((await book(body())).status).toBe(409)
  })

  it('books a stranger as a visitor rather than refusing them', async () => {
    openClinic()
    dentistExists()
    nothingBooked()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.visitor.create).mockResolvedValue({ id: 'vis-1' } as any)
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT202603100001',
      startsAt: at('10:00'),
    } as any)

    const res = await book(body())
    const payload = await res.json()

    expect(res.status).toBe(201)
    expect(payload.appointment.reference).toBe('APT202603100001')
    expect(payload.appointment.doctor).toBe('Dr. Ayesha Noor')

    expect(prisma.visitor.create).toHaveBeenCalled()
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visitorId: 'vis-1', patientId: null, status: 'SCHEDULED' }),
      })
    )
  })

  it('attaches a known number to that patient instead', async () => {
    openClinic()
    dentistExists()
    nothingBooked()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([{ id: 'pat-1' }] as any)
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT202603100002',
      startsAt: at('10:00'),
    } as any)

    const res = await book(body({ phone: '+92 300 1234308' }))

    expect(res.status).toBe(201)
    expect(prisma.visitor.create).not.toHaveBeenCalled()
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ patientId: 'pat-1', visitorId: null }),
      })
    )
  })

  it('answers the same either way', async () => {
    // Known patient or new visitor, the response must be indistinguishable —
    // otherwise the page is still an oracle for who is a patient here.
    openClinic()
    dentistExists()
    nothingBooked()
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT202603100003',
      startsAt: at('10:00'),
    } as any)

    vi.mocked(prisma.patient.findMany).mockResolvedValue([{ id: 'pat-1' }] as any)
    const known = await (await book(body({ phone: '03001234308' }))).json()

    vi.mocked(prisma.patient.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.visitor.create).mockResolvedValue({ id: 'vis-1' } as any)
    const stranger = await (await book(body())).json()

    expect(Object.keys(stranger).sort()).toEqual(Object.keys(known).sort())
    expect(Object.keys(stranger.appointment).sort()).toEqual(Object.keys(known.appointment).sort())
  })

  it('books it unconfirmed, for the desk to confirm', async () => {
    openClinic()
    dentistExists()
    nothingBooked()
    vi.mocked(prisma.patient.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.visitor.create).mockResolvedValue({ id: 'vis-1' } as any)
    vi.mocked(prisma.appointment.create).mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT202603100004',
      startsAt: at('10:00'),
    } as any)

    await book(body())

    // Nobody at the clinic has seen this yet, and that distinction is what
    // lets the desk work through what came in overnight.
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) })
    )
  })
})

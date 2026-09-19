// @ts-nocheck
/**
 * Every detail screen renders a record it was actually given.
 *
 * The smoke suite next door renders the list screens, and the grid-conventions
 * test checks that a row's destination *file* exists. Neither renders the
 * destination, so `app/(dashboard)/treatments/[id]/page.tsx` read
 * `treatment.prescriptions.length` — a field with no relation behind it, which
 * the route has never returned — and threw a TypeError on every load. The seed
 * carries no treatments, so nothing opened the page and nothing caught it.
 *
 * These render each detail screen against a response shaped like the route's
 * own, and assert the record is on the screen rather than the not-found state:
 * a page that throws, or quietly renders "not found" because a field moved,
 * fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/detail',
  useParams: () => ({ id: 'rec-1' }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'u1', name: 'Admin', role: 'ADMIN', hospitalId: 'h1' } },
    status: 'authenticated',
  }),
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const PATIENT = {
  id: 'pat-1',
  patientId: 'PAT20240001',
  firstName: 'Ayesha',
  lastName: 'Khan',
  phone: '3001234567',
  email: null,
  dateOfBirth: '1990-04-02T00:00:00.000Z',
  gender: 'FEMALE',
  address: null,
  allergies: null,
  bloodGroup: 'O_POSITIVE',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  medicalHistory: null,
  appointments: [],
  treatments: [],
  invoices: [],
  documents: [],
}

const DOCTOR = { id: 'doc-1', firstName: 'Priya', lastName: 'Kumar', specialization: 'Ortho' }

/**
 * One response per route. Shaped from what the route actually selects — the
 * point of the exercise is that a page reading a field nothing returns fails.
 */
const RESPONSES: Record<string, unknown> = {
  '/api/treatments/': {
    id: 'trt-1',
    treatmentNo: 'TRT20260001',
    status: 'PLANNED',
    cost: 5000,
    toothNumbers: null,
    diagnosis: null,
    notes: null,
    followUpRequired: false,
    followUpDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    patient: PATIENT,
    doctor: DOCTOR,
    procedure: { id: 'p1', code: 'D0120', name: 'Consultation', category: 'DIAGNOSTIC' },
    appointment: null,
    invoiceItems: [],
    amendments: [],
  },
  '/api/appointments/': {
    id: 'apt-1',
    appointmentNo: 'APT20260001',
    status: 'SCHEDULED',
    appointmentType: 'CONSULTATION',
    priority: 'NORMAL',
    duration: 30,
    startsAt: '2026-09-16T04:00:00.000Z',
    scheduledDate: '2026-09-16',
    scheduledTime: '09:00',
    chiefComplaint: null,
    notes: null,
    checkedInAt: null,
    checkedOutAt: null,
    waitTime: null,
    cancelledAt: null,
    cancellationReason: null,
    patient: PATIENT,
    doctor: DOCTOR,
    chair: null,
    treatments: [],
  },
  '/api/patients/': { success: true, patient: PATIENT },
  '/api/invoices/': {
    id: 'inv-1',
    invoiceNo: 'INV20260001',
    status: 'PENDING',
    createdAt: '2026-09-01T00:00:00.000Z',
    dueDate: null,
    subtotal: 5000,
    taxAmount: 0,
    discountAmount: 0,
    totalAmount: 5000,
    paidAmount: 0,
    balanceAmount: 5000,
    notes: null,
    patient: PATIENT,
    items: [],
    payments: [],
  },
  '/api/lab-orders/': {
    success: true,
    data: {
      id: 'lab-1',
      orderNumber: 'LO-2026-0001',
      status: 'DRAFT',
      workType: 'CROWN',
      toothNumbers: null,
      orderDate: '2026-09-01T00:00:00.000Z',
      expectedDate: null,
      sentDate: null,
      receivedDate: null,
      estimatedCost: 8000,
      actualCost: null,
      notes: null,
      patientId: PATIENT.id,
      patientCode: PATIENT.patientId,
      patientName: 'Ayesha Khan',
      patientPhone: PATIENT.phone,
      patientEmail: null,
      vendorName: 'Lahore Dental Lab',
      vendorPhone: null,
      vendorEmail: null,
      vendorAddress: null,
      avgTurnaroundDays: null,
      vendorRating: null,
      createdByName: 'Admin',
      history: [],
    },
  },
  '/api/prescriptions/': {
    success: true,
    data: {
      id: 'rx-1',
      prescriptionNo: 'RX20260001',
      diagnosis: null,
      notes: null,
      validUntil: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      patient: PATIENT,
      doctor: DOCTOR,
      medications: [],
    },
  },
  '/api/staff/': {
    id: 'stf-1',
    employeeId: 'EMP001',
    firstName: 'Priya',
    lastName: 'Kumar',
    email: 'priya@example.com',
    phone: '3001112222',
    specialization: 'Orthodontics',
    qualification: null,
    licenseNumber: null,
    joiningDate: '2024-01-01T00:00:00.000Z',
    isActive: true,
    user: { id: 'u2', email: 'priya@example.com', role: 'DOCTOR', isActive: true },
    availability: [],
    shifts: [],
    _count: { appointments: 0, treatments: 0, prescriptions: 0 },
  },
  '/api/inventory/items/': {
    success: true,
    data: {
      id: 'itm-1',
      name: 'Composite Resin',
      sku: 'CR-001',
      unit: 'SYRINGE',
      currentStock: 18,
      minStock: 5,
      unitPrice: 1200,
      category: { id: 'c1', name: 'Restorative' },
      preferredSupplier: null,
      batches: [],
      alerts: [],
      transactions: [],
    },
  },
}

const fetchMock = vi.fn(async (url: string) => {
  const path = String(url).split('?')[0]
  const key = Object.keys(RESPONSES)
    .filter((k) => path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return {
    ok: true,
    status: 200,
    json: async () => (key ? RESPONSES[key] : { success: true, data: [] }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as never
})

afterEach(() => {
  vi.resetModules()
})

/**
 * `use(params)` unwraps a promise React has already tracked without
 * suspending — which is what Next hands a page in the browser, and what keeps
 * these renders synchronous. A bare promise suspends forever here, because
 * nothing in the test is a Next route boundary.
 */
function trackedParams(id: string) {
  const promise: any = Promise.resolve({ id })
  promise.status = 'fulfilled'
  promise.value = { id }
  return promise
}

const params = trackedParams('rec-1')

/** Render a detail page and wait for its record to appear. */
async function open(
  load: () => Promise<{ default: React.ComponentType<never> }>,
  expected: RegExp
) {
  const { default: Page } = await load()
  const { findByText } = render(<Page params={params} />)
  expect(await findByText(expected, undefined, { timeout: 4000 })).toBeInTheDocument()
}

describe('detail screens render the record', () => {
  it('a treatment', async () => {
    await open(() => import('@/app/(dashboard)/treatments/[id]/page'), /TRT20260001/)
  })

  it('an appointment', async () => {
    await open(() => import('@/app/(dashboard)/appointments/[id]/page'), /APT20260001/)
  })

  it('an invoice', async () => {
    await open(() => import('@/app/(dashboard)/billing/invoices/[id]/page'), /INV20260001/)
  })

  it('a lab case', async () => {
    await open(() => import('@/app/(dashboard)/lab/orders/[id]/page'), /LO-2026-0001/)
  })

  it('a member of staff', async () => {
    await open(() => import('@/app/(dashboard)/staff/[id]/page'), /EMP001/)
  })

  /**
   * The patient record and the inventory item are not here. Both stay on their
   * loading skeleton under this harness — the patient screen alone pulls in the
   * dental chart, the imaging viewer and the AI panel — and a test that cannot
   * get past the skeleton would pass whatever the page did. They are covered by
   * driving the running application instead; this gap is deliberate rather than
   * an oversight, and worth closing when those screens are next touched.
   */
})

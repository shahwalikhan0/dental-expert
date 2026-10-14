import { describe, it, expect } from 'vitest'
import { InvoiceStatus, PaymentStatus, AppointmentStatus, LabOrderStatus } from '@prisma/client'
import {
  STATUS_TABLE,
  TONE_BADGE_VARIANT,
  prescriptionStatus,
  statusLabel,
  statusMeaning,
  statusOptions,
  statusTone,
  type StatusKind,
} from '@/lib/status'

describe('lib/status — one meaning per status', () => {
  it('maps every member of the enums it covers', () => {
    const covered: Array<[StatusKind, Record<string, string>]> = [
      ['invoice', InvoiceStatus],
      ['payment', PaymentStatus],
      ['appointment', AppointmentStatus],
      ['labOrder', LabOrderStatus],
    ]
    for (const [kind, members] of covered) {
      const table = STATUS_TABLE[kind] as Record<string, unknown>
      const missing = Object.values(members).filter((member) => !(member in table))
      expect(missing, `${kind} is missing statuses`).toEqual([])
    }
  })

  it('draws the same idea in the same tone on every entity', () => {
    // The clashes the audit found: cancelled was grey on some records and red
    // on others; expired red on the waitlist and grey on invitations.
    for (const kind of [
      'appointment',
      'treatment',
      'treatmentPlan',
      'invoice',
      'labOrder',
      'purchaseOrder',
      'waitlist',
    ] as const) {
      expect(statusTone(kind, 'CANCELLED'), kind).toBe('neutral')
    }
    expect(statusTone('waitlist', 'EXPIRED')).toBe('neutral')
    expect(statusTone('invite', 'EXPIRED')).toBe('neutral')
    expect(statusTone('invoice', 'OVERDUE')).toBe('danger')
    expect(statusTone('appointment', 'NO_SHOW')).toBe('danger')
    expect(statusTone('labOrder', 'REMAKE_REQUIRED')).toBe('danger')
    expect(statusTone('supplier', 'BLOCKED')).toBe('danger')
    expect(statusTone('invoice', 'REFUNDED')).toBe('purple')
    expect(statusTone('invoice', 'PARTIALLY_PAID')).toBe('progress')
    expect(statusTone('appointment', 'CHECKED_IN')).toBe('progress')
    expect(statusTone('purchaseOrder', 'RECEIVED')).toBe('success')
    expect(statusTone('purchaseOrder', 'ORDERED')).toBe('info')
  })

  it('labels in sentence case', () => {
    expect(statusLabel('invoice', 'PARTIALLY_PAID')).toBe('Partially paid')
    expect(statusLabel('appointment', 'NO_SHOW')).toBe('No-show')
    expect(statusLabel('appointment', 'CHECKED_IN')).toBe('Checked in')
  })

  it('shows an unknown status humanised and neutral rather than hiding it', () => {
    expect(statusMeaning('invoice', 'WRITTEN_OFF')).toEqual({
      tone: 'neutral',
      label: 'Written off',
    })
    expect(statusMeaning('invoice', null)).toEqual({ tone: 'neutral', label: '—' })
  })

  it('reads a boolean as active or inactive', () => {
    expect(statusMeaning('staff', true)).toEqual({ tone: 'success', label: 'Active' })
    expect(statusMeaning('staff', false)).toEqual({ tone: 'neutral', label: 'Inactive' })
    expect(statusLabel('prescriptionTemplate', false)).toBe('Retired')
  })

  it('has a badge variant for every tone', () => {
    for (const table of Object.values(STATUS_TABLE)) {
      for (const meaning of Object.values(
        table as Record<string, { tone: keyof typeof TONE_BADGE_VARIANT }>
      )) {
        expect(TONE_BADGE_VARIANT[meaning.tone]).toBeTruthy()
      }
    }
  })

  it('lists filter options in table order, with the badge labels', () => {
    expect(statusOptions('purchaseOrder')).toEqual([
      { value: 'DRAFT', label: 'Draft' },
      { value: 'ORDERED', label: 'Ordered' },
      { value: 'PARTIALLY_RECEIVED', label: 'Partially received' },
      { value: 'RECEIVED', label: 'Received' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ])
    expect(statusOptions('invoice', ['PAID', 'OVERDUE'])).toEqual([
      { value: 'PAID', label: 'Paid' },
      { value: 'OVERDUE', label: 'Overdue' },
    ])
  })

  it('works out whether a prescription is still valid', () => {
    expect(prescriptionStatus(null, '2026-10-14')).toBe('ACTIVE')
    expect(prescriptionStatus('2026-10-14', '2026-10-14')).toBe('ACTIVE')
    expect(prescriptionStatus('2026-10-13T00:00:00.000Z', '2026-10-14')).toBe('EXPIRED')
  })
})

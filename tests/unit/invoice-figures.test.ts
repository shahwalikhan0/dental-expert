import { describe, it, expect } from 'vitest'
import type { Prisma } from '@prisma/client'
import {
  billedInvoiceWhere,
  calendarDayOf,
  daysPastDue,
  invoiceDueState,
  isInvoiceOverdue,
  isInvoiceOwed,
  netLineAmounts,
  outstandingOf,
  overdueInvoiceWhere,
} from '@/lib/invoice-figures'
import { AGEING_BUCKETS, ageInvoices, ageingBucket, overdueOf } from '@/lib/ageing'
import { dateRangeFromDays, getDateRangeFromPreset } from '@/lib/billing-utils'

/**
 * One meaning for each money word (invoice review, 14 Oct, §2.4 and §3).
 *
 * The four invoices of §3.1 run through most of this file, because they are
 * the ones six screens used to total six ways:
 *
 *   A  10,000, 6,000 paid       PARTIALLY_PAID   owes 4,000
 *   B   3,000, refunded in full REFUNDED         owes nothing — charge reversed
 *   C   2,000                   DRAFT            not a bill yet
 *   D   1,500                   CANCELLED        written off
 */

const KARACHI = 'Asia/Karachi'
const NEW_YORK = 'America/New_York'
const TODAY = '2026-10-14'

const A = {
  status: 'PARTIALLY_PAID',
  totalAmount: 10000,
  balanceAmount: 4000,
  dueDate: new Date('2026-10-01T12:00:00.000Z'),
  issuedAt: new Date('2026-10-01T06:00:00.000Z'),
  createdAt: new Date('2026-10-01T06:00:00.000Z'),
}
const B = { ...A, status: 'REFUNDED', totalAmount: 3000, balanceAmount: 3000 }
const C = {
  ...A,
  status: 'DRAFT',
  totalAmount: 2000,
  balanceAmount: 2000,
  dueDate: null,
  issuedAt: null,
}
const D = { ...A, status: 'CANCELLED', totalAmount: 1500, balanceAmount: 1500 }
const FOUR = [A, B, C, D]

describe('owed and outstanding', () => {
  it('counts only issued, unpaid invoices', () => {
    expect(FOUR.map(isInvoiceOwed)).toEqual([true, false, false, false])
  })

  it('is 4,000 for the four invoices of review §3.1', () => {
    expect(outstandingOf(FOUR)).toBe(4000)
  })

  it('counts a manually OVERDUE invoice, and a PAID one only if it still has a balance', () => {
    expect(isInvoiceOwed({ status: 'OVERDUE', balanceAmount: 500 })).toBe(true)
    expect(isInvoiceOwed({ status: 'PAID', balanceAmount: 0 })).toBe(false)
    expect(isInvoiceOwed({ status: 'PAID', balanceAmount: 10 })).toBe(true)
    expect(isInvoiceOwed({ status: 'PENDING', balanceAmount: 0 })).toBe(false)
  })
})

describe('calendarDayOf', () => {
  it('reads a stored UTC midnight as the calendar day it names, in any zone', () => {
    const picked = new Date('2026-10-20T00:00:00.000Z')
    expect(calendarDayOf(picked, KARACHI)).toBe('2026-10-20')
    expect(calendarDayOf(picked, NEW_YORK)).toBe('2026-10-20')
  })

  it('reads a midday-UTC due date as its day', () => {
    expect(calendarDayOf(new Date('2026-10-20T12:00:00.000Z'), KARACHI)).toBe('2026-10-20')
    expect(calendarDayOf(new Date('2026-10-20T12:00:00.000Z'), NEW_YORK)).toBe('2026-10-20')
  })

  it("reads an instant on the clinic's calendar", () => {
    // 02:00 in Karachi on the 15th is still the 14th in UTC.
    expect(calendarDayOf(new Date('2026-10-14T21:00:00.000Z'), KARACHI)).toBe('2026-10-15')
  })
})

describe('overdue', () => {
  it('is owed and due before today', () => {
    expect(isInvoiceOverdue(A, TODAY, KARACHI)).toBe(true)
    expect(daysPastDue(A, TODAY, KARACHI)).toBe(13)
  })

  it('is never a refunded, draft or cancelled invoice, however old', () => {
    expect([B, C, D].some((invoice) => isInvoiceOverdue(invoice, TODAY, KARACHI))).toBe(false)
  })

  it('is not an invoice due today', () => {
    const dueToday = { ...A, dueDate: new Date(`${TODAY}T12:00:00.000Z`) }
    expect(isInvoiceOverdue(dueToday, TODAY, KARACHI)).toBe(false)
    expect(invoiceDueState(dueToday, TODAY, KARACHI)?.label).toBe('Due today')
  })

  it('falls back to the issue date, then the creation date', () => {
    const issuedYesterday = {
      status: 'PENDING',
      balanceAmount: 1000,
      dueDate: null,
      issuedAt: new Date('2026-10-13T06:00:00.000Z'),
      createdAt: new Date('2026-10-01T06:00:00.000Z'),
    }
    expect(daysPastDue(issuedYesterday, TODAY, KARACHI)).toBe(1)
    expect(daysPastDue({ ...issuedYesterday, issuedAt: null }, TODAY, KARACHI)).toBe(13)
  })

  it('does not depend on the manual OVERDUE status, either way', () => {
    const notYetDue = { ...A, status: 'OVERDUE', dueDate: new Date('2026-11-01T12:00:00.000Z') }
    expect(isInvoiceOverdue(notYetDue, TODAY, KARACHI)).toBe(false)
    expect(isInvoiceOverdue({ ...A, status: 'PENDING' }, TODAY, KARACHI)).toBe(true)
  })

  it('labels only owed invoices', () => {
    expect(invoiceDueState(A, TODAY, KARACHI)).toEqual({
      overdue: true,
      days: 13,
      label: '13 days overdue',
    })
    expect(invoiceDueState({ ...A, status: 'PAID', balanceAmount: 0 }, TODAY, KARACHI)).toBeNull()
    expect(invoiceDueState(B, TODAY, KARACHI)).toBeNull()
  })
})

/**
 * Just enough of Prisma's `where` semantics to run the filter against rows, so
 * the database filter and the row predicate can be checked against each other.
 */
function matches(row: Record<string, unknown>, where: Prisma.InvoiceWhereInput): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND')
      return (condition as Prisma.InvoiceWhereInput[]).every((w) => matches(row, w))
    if (key === 'OR') return (condition as Prisma.InvoiceWhereInput[]).some((w) => matches(row, w))
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    const filter = condition as Record<string, unknown>
    if (value === null || value === undefined) return false
    const n = value instanceof Date ? value.getTime() : Number(value)
    const at = (x: unknown) => (x instanceof Date ? x.getTime() : Number(x))
    if ('in' in filter && !(filter.in as unknown[]).includes(value)) return false
    if ('notIn' in filter && (filter.notIn as unknown[]).includes(value)) return false
    if ('lt' in filter && !(n < at(filter.lt))) return false
    if ('lte' in filter && !(n <= at(filter.lte))) return false
    if ('gt' in filter && !(n > at(filter.gt))) return false
    if ('gte' in filter && !(n >= at(filter.gte))) return false
    return true
  })
}

describe('overdueInvoiceWhere agrees with isInvoiceOverdue', () => {
  const instants = [
    '2026-10-12T00:00:00.000Z',
    '2026-10-13T00:00:00.000Z',
    '2026-10-13T12:00:00.000Z',
    '2026-10-13T18:59:59.999Z',
    '2026-10-13T19:00:00.000Z',
    '2026-10-13T23:30:00.000Z',
    '2026-10-14T00:00:00.000Z',
    '2026-10-14T03:00:00.000Z',
    '2026-10-14T04:59:59.999Z',
    '2026-10-14T05:00:00.000Z',
    '2026-10-14T12:00:00.000Z',
    '2026-10-15T00:00:00.000Z',
  ].map((iso) => new Date(iso))

  for (const zone of [KARACHI, NEW_YORK, 'UTC']) {
    it(`in ${zone}`, () => {
      const where = overdueInvoiceWhere(TODAY, zone)
      for (const at of instants) {
        for (const shape of [
          { dueDate: at, issuedAt: null, createdAt: at },
          { dueDate: null, issuedAt: at, createdAt: at },
          { dueDate: null, issuedAt: null, createdAt: at },
        ]) {
          for (const status of ['PENDING', 'OVERDUE', 'REFUNDED', 'DRAFT']) {
            const row = { ...shape, status, balanceAmount: 100 }
            expect(matches(row, where), `${zone} ${status} ${at.toISOString()}`).toBe(
              isInvoiceOverdue(row, TODAY, zone)
            )
          }
        }
      }
    })
  }
})

describe('billed', () => {
  it('leaves drafts and cancelled invoices out, and dates by issue', () => {
    const window = { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') }
    const billed = FOUR.filter((invoice) => matches(invoice, billedInvoiceWhere(window)))
    // A and B: 13,000 billed. The refund is a collections event, not a bill.
    expect(billed.reduce((sum, invoice) => sum + invoice.totalAmount, 0)).toBe(13000)
  })
})

describe('netLineAmounts', () => {
  it('takes the discount off each line pro rata and adds up exactly', () => {
    const net = netLineAmounts([1000, 2000, 333.33], 100)
    expect(net.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(3233.33, 2)
    expect(net[0]).toBeCloseTo(970, 0)
  })

  it('leaves lines alone without a discount', () => {
    expect(netLineAmounts([500, '250.50'], 0)).toEqual([500, 250.5])
  })
})

describe('ageing', () => {
  it('uses one set of buckets everywhere', () => {
    expect(AGEING_BUCKETS.map((bucket) => bucket.label)).toEqual([
      'Not yet due',
      '1–30',
      '31–60',
      '61–90',
      '90+',
    ])
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual([
      'notDue',
      'days1_30',
      'days1_30',
      'days31_60',
      'days31_60',
      'days61_90',
      'days61_90',
      'over90',
    ])
  })

  it('ages only what is owed', () => {
    const ageing = ageInvoices(FOUR, TODAY, KARACHI)
    expect(ageing.total).toBe(4000)
    expect(ageing.days1_30).toBe(4000)
    expect(overdueOf(ageing)).toBe(4000)
  })

  it('calls an invoice issued yesterday and due on receipt 1–30, on every screen', () => {
    // Bug report item 5: Receivables said Current, Claims Aging and Reports
    // said overdue. "Due on receipt" is due on the issue day.
    const yesterday = {
      status: 'PENDING',
      balanceAmount: 2000,
      dueDate: new Date('2026-10-13T12:00:00.000Z'),
      createdAt: new Date('2026-10-13T06:00:00.000Z'),
    }
    const ageing = ageInvoices([yesterday], TODAY, KARACHI)
    expect(ageing.days1_30).toBe(2000)
    expect(ageing.notDue).toBe(0)
  })
})

describe('report windows on the clinic calendar', () => {
  // 02:00 on 15 Oct in Karachi, still the 14th on a UTC server.
  const now = new Date('2026-10-14T21:00:00.000Z')

  it("starts today at the clinic's midnight", () => {
    // The 15th in Karachi, though a UTC host still thinks it is the 14th.
    const { startDate, endDate } = getDateRangeFromPreset('today', KARACHI, now)
    expect(startDate.toISOString()).toBe('2026-10-14T19:00:00.000Z')
    expect(endDate.toISOString()).toBe('2026-10-15T18:59:59.999Z')
  })

  it('takes last month whole, through its last millisecond', () => {
    // Already the 15th of October in Karachi, so last month is September.
    const { startDate, endDate } = getDateRangeFromPreset('last_month', KARACHI, now)
    expect(startDate.toISOString()).toBe('2026-08-31T19:00:00.000Z')
    expect(endDate.toISOString()).toBe('2026-09-30T18:59:59.999Z')
  })

  it('runs this month from the first to today', () => {
    const { startDate } = getDateRangeFromPreset('this_month', KARACHI, now)
    expect(startDate.toISOString()).toBe('2026-09-30T19:00:00.000Z')
  })

  it('builds a custom range from whole clinic days', () => {
    const { startDate, endDate } = dateRangeFromDays('2026-10-01', '2026-10-14', KARACHI)
    expect(startDate.toISOString()).toBe('2026-09-30T19:00:00.000Z')
    expect(endDate.toISOString()).toBe('2026-10-14T18:59:59.999Z')
  })
})

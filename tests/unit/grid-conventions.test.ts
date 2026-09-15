/**
 * Every list screen pages its results, and none of them writes its own pager.
 *
 * This is a grep because the defect is textual and spread across twenty files
 * that share no code. The pagination block was copied from screen to screen and
 * had drifted: some were hidden below one page, so a short list gave no total
 * at all; some counted from one on an empty result; most called the records
 * "results" where the screen called them patients. Three screens had no pager,
 * rendering however many rows the route returned.
 *
 * A reviewer will not notice the twenty-first copy. This test will.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DASHBOARD = join(process.cwd(), 'app', '(dashboard)')

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files(full, acc)
    else if (entry.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

const ALL = files(DASHBOARD).map((path) => ({
  name: path.slice(DASHBOARD.length + 1),
  source: readFileSync(path, 'utf8'),
}))

/**
 * The screens that list records, as opposed to a detail page, a form, or a
 * report of totals. Each one must page.
 */
const LIST_SCREENS = [
  'appointments/page.tsx',
  'appointments/waitlist/page.tsx',
  'billing/invoices/page.tsx',
  'billing/payments/page.tsx',
  'inventory/page.tsx',
  'inventory/purchase-orders/page.tsx',
  'inventory/suppliers/page.tsx',
  'inventory/transactions/page.tsx',
  'lab/page.tsx',
  'lab/vendors/page.tsx',
  'medications/page.tsx',
  'patients/page.tsx',
  'platform/tenants/tenant-console.tsx',
  'prescriptions/page.tsx',
  'reports/audit-log/page.tsx',
  'settings/forms/page.tsx',
  'settings/procedures/page.tsx',
  'staff/invites/page.tsx',
  'staff/page.tsx',
  'treatments/page.tsx',
  'treatments/plans/page.tsx',
]

/**
 * The pager idiom, as it was written by hand: a control that steps the page
 * number. Anything still doing this is a copy that will drift.
 */
const HAND_ROLLED =
  /page:\s*\w+\.page\s*[-+]\s*1|setPage\(\s*\w+\s*[-+]\s*1\s*\)|page:\s*pagination\.page\s*[-+]\s*1/

describe('list screens', () => {
  it('are all present — the list below is not stale', () => {
    const names = new Set(ALL.map((f) => f.name))
    const missing = LIST_SCREENS.filter((s) => !names.has(s))

    expect(missing, 'these screens were renamed or removed').toEqual([])
  })

  it('every one of them pages its results', () => {
    const without = LIST_SCREENS.filter(
      (name) => !ALL.find((f) => f.name === name)!.source.includes('<GridPagination')
    )

    expect(
      without,
      'a list screen that does not page renders however many rows the route returns'
    ).toEqual([])
  })

  it('none of them writes its own pager', () => {
    const rolled = ALL.filter((f) => HAND_ROLLED.test(f.source)).map((f) => f.name)

    expect(
      rolled,
      'use GridPagination from components/ui/data-grid rather than another copy'
    ).toEqual([])
  })
})

describe('clickable rows', () => {
  /**
   * A row that opens a record, and the screen it opens. Each destination is
   * checked against the router, because a row that navigates to a page which
   * does not exist is worse than a row that does nothing — it looks like it
   * worked.
   */
  const ROW_DESTINATIONS: Record<string, string> = {
    'appointments/page.tsx': 'appointments/[id]/page.tsx',
    'billing/invoices/page.tsx': 'billing/invoices/[id]/page.tsx',
    'billing/payments/page.tsx': 'billing/invoices/[id]/page.tsx',
    'billing/reports/page.tsx': 'billing/invoices/[id]/page.tsx',
    'inventory/purchase-orders/page.tsx': 'inventory/purchase-orders/[id]/page.tsx',
    'patients/page.tsx': 'patients/[id]/page.tsx',
    'prescriptions/page.tsx': 'prescriptions/[id]/page.tsx',
    'settings/forms/page.tsx': 'settings/forms/[id]/page.tsx',
    'staff/page.tsx': 'staff/[id]/page.tsx',
    'treatments/page.tsx': 'treatments/[id]/page.tsx',
    'treatments/plans/page.tsx': 'treatments/plans/[id]/page.tsx',
  }

  it('are on every screen whose records can be opened', () => {
    const without = Object.keys(ROW_DESTINATIONS).filter(
      (name) => !ALL.find((f) => f.name === name)!.source.includes('<ClickableRow')
    )

    expect(without).toEqual([])
  })

  it('open a page that exists', () => {
    const names = new Set(ALL.map((f) => f.name))
    const broken = Object.values(ROW_DESTINATIONS).filter((target) => !names.has(target))

    expect(broken, 'a row cannot open a page that is not there').toEqual([])
  })

  it('are not added where there is nothing to open', () => {
    // Inventory items and lab cases have no detail page — their "View Details"
    // menu item has always been a 404 — so their rows are deliberately not
    // links. If a detail page is built, add the row link with it.
    for (const name of ['inventory/page.tsx', 'lab/page.tsx']) {
      expect(ALL.find((f) => f.name === name)!.source).not.toContain('<ClickableRow')
    }
  })
})

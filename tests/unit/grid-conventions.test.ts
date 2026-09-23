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
  'inventory/alerts/page.tsx',
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
    'inventory/page.tsx': 'inventory/[id]/page.tsx',
    'inventory/purchase-orders/page.tsx': 'inventory/purchase-orders/[id]/page.tsx',
    'lab/page.tsx': 'lab/orders/[id]/page.tsx',
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

  it('name a record the reader can recognise', () => {
    // "Open Ayesha Khan", not "Open row 4". A row is not a link element, so
    // the accessible name has to be written.
    for (const name of Object.keys(ROW_DESTINATIONS)) {
      expect(ALL.find((f) => f.name === name)!.source).toMatch(/label=\{`Open /)
    }
  })
})

/**
 * Going back.
 *
 * Every back arrow in the dashboard was a hard-coded link to its own module's
 * list page — not one used the history, and none of them could know that the
 * reader had arrived from somewhere else. Opening a patient from an appointment
 * and pressing back put you in the patient list.
 *
 * A grep again, because the defect is one line repeated across a dozen files
 * that share nothing. See lib/trail.ts.
 */
describe('detail screens', () => {
  /** The screens that open one record, and the list each falls back to. */
  const DETAIL_SCREENS: Record<string, string> = {
    'appointments/[id]/page.tsx': '/appointments',
    'billing/invoices/[id]/page.tsx': '/billing/invoices',
    'inventory/[id]/page.tsx': '/inventory',
    'lab/orders/[id]/page.tsx': '/lab',
    'patients/[id]/page.tsx': '/patients',
    'prescriptions/[id]/page.tsx': '/prescriptions',
    'staff/[id]/page.tsx': '/staff',
    'treatments/[id]/page.tsx': '/treatments',
    'treatments/plans/[id]/page.tsx': '/treatments/plans',
  }

  it('are all present — the list below is not stale', () => {
    const names = new Set(ALL.map((f) => f.name))
    const missing = Object.keys(DETAIL_SCREENS).filter((s) => !names.has(s))

    expect(missing, 'these screens were renamed or removed').toEqual([])
  })

  it('offer a way back that knows where the reader came from', () => {
    const without = Object.keys(DETAIL_SCREENS).filter(
      (name) => !ALL.find((f) => f.name === name)!.source.includes('<BackLink')
    )

    expect(
      without,
      'use BackLink from components/ui/trail rather than a link to the module list'
    ).toEqual([])
  })

  it('name the list they fall back to when the reader arrived directly', () => {
    for (const [name, fallback] of Object.entries(DETAIL_SCREENS)) {
      expect(ALL.find((f) => f.name === name)!.source).toContain(`fallback="${fallback}"`)
    }
  })

  it('put themselves on the trail, so the next screen can come back here', () => {
    const without = Object.keys(DETAIL_SCREENS).filter(
      (name) => !ALL.find((f) => f.name === name)!.source.includes('useTrail(')
    )

    expect(without).toEqual([])
  })
})

/**
 * A link that leaves the record being read has to carry the trail, or the
 * screen it opens has nothing to go back to. This checks the crossings the
 * audit found — a patient reached from four different modules, and the records
 * hanging off a treatment.
 */
describe('links between modules', () => {
  const CROSSINGS: Array<[string, string]> = [
    ['appointments/[id]/page.tsx', '/patients/'],
    ['treatments/[id]/page.tsx', '/patients/'],
    ['treatments/[id]/page.tsx', '/appointments/'],
    ['billing/invoices/[id]/page.tsx', '/patients/'],
    ['billing/invoices/[id]/page.tsx', '/treatments/'],
    ['lab/orders/[id]/page.tsx', '/patients/'],
    ['prescriptions/[id]/page.tsx', '/patients/'],
    ['patients/[id]/page.tsx', '/appointments/'],
    ['patients/[id]/page.tsx', '/treatments/'],
    ['patients/[id]/page.tsx', '/billing/invoices/'],
  ]

  it('exist at all', () => {
    const missing = CROSSINGS.filter(
      ([name, target]) => !ALL.find((f) => f.name === name)!.source.includes(target)
    )

    expect(missing, 'a record named on the screen with no way to open it').toEqual([])
  })

  it('carry the trail', () => {
    const bare = CROSSINGS.filter(([name, target]) => {
      const source = ALL.find((f) => f.name === name)!.source
      // Every mention of the destination has to sit inside a `trail.to(...)`.
      // Looked for just behind each one rather than by an exact prefix, because
      // some of these links are built by concatenation.
      for (let at = source.indexOf(target); at !== -1; at = source.indexOf(target, at + 1)) {
        const preceding = source.slice(Math.max(0, at - 80), at)
        if (!preceding.includes('trail.to(')) return true
      }
      return false
    })

    expect(
      bare.map(([name, target]) => `${name} -> ${target}`),
      'use trail.to() so the screen it opens can come back'
    ).toEqual([])
  })
})

describe('row actions', () => {
  /**
   * The actions column is faded back until the row is hovered, which is a
   * presentational choice with three ways to get it wrong — all of them
   * invisible to whoever makes the change, because they only show up on a
   * keyboard, on a touch screen, or with a menu open.
   */
  const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')

  it('hides the actions column only where there is a pointer that can hover', () => {
    // Without this guard a phone hides the actions and never shows them.
    expect(CSS).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/)
  })

  it('brings the actions back for a keyboard', () => {
    // Reachable by Tab and invisible is worse than either on its own.
    expect(CSS).toMatch(/tr:focus-within \.row-actions/)
  })

  it('keeps the trigger visible while its own menu is open', () => {
    // Radix portals the menu out of the row, so `:focus-within` goes false
    // and the trigger would fade out from under the menu it opened.
    expect(CSS).toMatch(/\.row-actions:has\(\[data-state='open'\]\)/)
  })

  it('does not animate for somebody who asked for less motion', () => {
    expect(CSS).toMatch(/prefers-reduced-motion: reduce/)
  })

  /**
   * Screens whose rows carry actions. Not every list has them — an audit log
   * and a walk-in board are read-only — so this is a list rather than a rule
   * over all of them.
   */
  const WITH_ACTIONS = [
    'appointments/page.tsx',
    'appointments/waitlist/page.tsx',
    'billing/invoices/page.tsx',
    'billing/payments/page.tsx',
    'inventory/page.tsx',
    'inventory/suppliers/page.tsx',
    'lab/page.tsx',
    'lab/vendors/page.tsx',
    'medications/page.tsx',
    'patients/page.tsx',
    'platform/tenants/tenant-console.tsx',
    'prescriptions/page.tsx',
    'recare/page.tsx',
    'settings/forms/page.tsx',
    'settings/procedures/page.tsx',
    'settings/recare/page.tsx',
    'staff/invites/page.tsx',
    'staff/page.tsx',
    'treatments/page.tsx',
    'treatments/plans/page.tsx',
  ]

  it('tag their actions cell, so the twenty-first grid is not the odd one out', () => {
    const untagged = WITH_ACTIONS.filter(
      (name) => !ALL.find((f) => f.name === name)?.source.includes('row-actions')
    )

    expect(untagged, 'add `row-actions` to the actions cell').toEqual([])
  })

  it("leaves the recall list's Book visible", () => {
    // The one grid whose actions column is not all icons. Book is the whole
    // point of the screen, so the class goes on the icons beside it rather
    // than on the cell — hiding the call to action would be the bug.
    const recare = ALL.find((f) => f.name === 'recare/page.tsx')!.source

    expect(recare).not.toMatch(/<TableCell className="text-right row-actions">/)
    expect(recare).toMatch(/className="row-actions inline-flex/)
    // Book is outside the faded group: it comes before it in the cell.
    const book = recare.indexOf('Book')
    const faded = recare.indexOf('className="row-actions inline-flex')
    expect(book).toBeLessThan(faded)
  })

  it('leave the line-item editors alone', () => {
    // A remove button on a row somebody is actively filling in should not
    // have to be found by hovering; these are forms, not grids.
    const editors = [
      'billing/invoices/new/page.tsx',
      'billing/invoices/[id]/edit/page.tsx',
      'treatments/plans/new/page.tsx',
      'treatments/plans/[id]/edit/page.tsx',
    ]
    const hidden = editors.filter((name) =>
      ALL.find((f) => f.name === name)?.source.includes('row-actions')
    )

    expect(hidden, 'a form row is not a grid row').toEqual([])
  })
})

/**
 * Which navigation item owns the page you are on.
 *
 * The sidebar used to answer this per item — `pathname === href ||
 * pathname.startsWith(href)` — so every nested pair in `config/nav.ts` lit up
 * twice. There are thirteen such pairs: standing on `/billing/invoices`
 * highlighted Billing *and* Invoices, and `/settings/forms` highlighted
 * Settings *and* Forms.
 */
import { describe, it, expect } from 'vitest'
import { activeHref, getNavigationForRole, type NavSection } from '@/config/nav'

const sections: NavSection[] = [
  {
    title: 'Clinic',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: (() => null) as any },
      { title: 'Prescriptions', href: '/prescriptions', icon: (() => null) as any },
      { title: 'Rx Templates', href: '/prescriptions/templates', icon: (() => null) as any },
      { title: 'Billing', href: '/billing', icon: (() => null) as any },
    ],
  },
]

describe('activeHref', () => {
  it('matches the item exactly', () => {
    expect(activeHref('/billing', sections)).toBe('/billing')
  })

  it('gives a nested page to the most specific item, not to both', () => {
    expect(activeHref('/prescriptions/templates', sections)).toBe('/prescriptions/templates')
  })

  it('still gives a child of the general item to the general item', () => {
    expect(activeHref('/prescriptions/new', sections)).toBe('/prescriptions')
    expect(activeHref('/billing/invoices/abc', sections)).toBe('/billing')
  })

  it('matches on path segments, not on characters', () => {
    // `/prescriptions-archive` is not inside `/prescriptions`, and a plain
    // `startsWith` would have said it was.
    expect(activeHref('/prescriptions-archive', sections)).toBeNull()
  })

  it('answers null on a page no item owns', () => {
    expect(activeHref('/some/unlisted/page', sections)).toBeNull()
  })

  it('does not let /dashboard swallow the application', () => {
    // The old rule carved out `/dashboard` by hand because it would otherwise
    // have matched nothing else; segment matching makes the exception
    // unnecessary.
    expect(activeHref('/prescriptions', sections)).toBe('/prescriptions')
  })
})

describe('the real navigation', () => {
  it('highlights exactly one item for every nested pair it contains', () => {
    const real = getNavigationForRole('ADMIN', null, { isPlatformAdmin: false })
    const hrefs = real.flatMap((section) => section.items.map((item) => item.href))

    const nested = hrefs.filter((href) => hrefs.some((other) => href.startsWith(other + '/')))
    // If this is ever zero the test has stopped proving anything.
    expect(nested.length).toBeGreaterThan(0)

    for (const href of nested) {
      expect(activeHref(href, real)).toBe(href)
    }
  })
})

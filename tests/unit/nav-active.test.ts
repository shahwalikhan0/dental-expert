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
import { activeHref, childrenOf, getNavigationForRole, type NavSection } from '@/config/nav'

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
    // Children as well as parents. This counted only top-level hrefs, which
    // worked while nesting was expressed by sibling rows — "Rx Templates"
    // beside "Prescriptions". Now that each module carries its catalogue as a
    // sub-item, every nested pair in the menu lives one level down, and
    // counting only the top level found nothing to check. The guard below is
    // what caught it.
    const hrefs = real.flatMap((section) =>
      section.items.flatMap((item) => [item.href, ...(item.subItems ?? []).map((sub) => sub.href)])
    )

    const nested = hrefs.filter((href) => hrefs.some((other) => href.startsWith(other + '/')))
    // If this is ever zero the test has stopped proving anything.
    expect(nested.length).toBeGreaterThan(0)

    for (const href of nested) {
      expect(activeHref(href, real)).toBe(href)
    }
  })
})

describe('groups and their children', () => {
  const real = getNavigationForRole('ADMIN', null, { isPlatformAdmin: false })
  const appointments = real
    .flatMap((section) => section.items)
    .find((item) => item.title === 'Appointments')!

  it('draws walk-ins under appointments, where a walk-in is created', () => {
    // Every visitor in the system is written by the appointment form, in a
    // transaction with the appointment. See app/api/appointments/route.ts.
    const walkIns = appointments.subItems?.find((child) => child.href === '/walk-ins')

    expect(walkIns, 'walk-ins belongs to the appointments group').toBeDefined()
  })

  it('highlights a child that does not live under its parent path', () => {
    // `/walk-ins` is not a prefix of `/appointments`, so this only works if
    // activeHref looks at children rather than matching parents alone.
    expect(activeHref('/walk-ins', real)).toBe('/walk-ins')
  })

  it('still highlights a child that does live under its parent path', () => {
    expect(activeHref('/appointments/waitlist', real)).toBe('/appointments/waitlist')
  })

  it('drops the child that duplicates its parent, so one page is one row', () => {
    // Every group declares a first child pointing at the group's own href.
    // Drawing it would give two links to one page, both highlighted on it.
    const drawn = childrenOf(appointments).map((child) => child.href)

    expect(drawn).not.toContain(appointments.href)
    expect(drawn).toContain('/walk-ins')
  })

  it('leaves a group with no children alone', () => {
    const patients = real.flatMap((s) => s.items).find((item) => item.title === 'Patients')!

    expect(childrenOf(patients)).toEqual([])
  })
})

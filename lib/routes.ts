/**
 * Every page this application serves.
 *
 * The breadcrumb builds its fallback crumbs from the URL path, one per segment,
 * and used to link all of them. Plenty of those intermediate paths are not
 * pages: standing on /billing/payments/<id>/refund produced a "Details" crumb
 * pointing at /billing/payments/<id>, which has never existed. A breadcrumb
 * that 404s is worse than one that does not link, because it is the control a
 * lost reader reaches for.
 *
 * Generated from the filesystem and checked against it by
 * tests/unit/route-links.test.ts, so it cannot drift from the routes that
 * actually exist without a test going red.
 */
export const APP_ROUTES = [
  '/',
  '/appointments',
  '/appointments/[id]',
  '/appointments/[id]/edit',
  '/appointments/new',
  '/appointments/queue',
  '/appointments/waitlist',
  '/billing',
  '/billing/invoices',
  '/billing/invoices/[id]',
  '/billing/invoices/[id]/edit',
  '/billing/invoices/new',
  '/billing/payments',
  '/billing/payments/[id]/receipt',
  '/billing/payments/[id]/refund',
  '/billing/reports',
  // The patient-facing booking page. It is not a dashboard route and never
  // appears in a staff breadcrumb; it is listed because this file is checked
  // against the filesystem, and an exception would be a hole in that check.
  '/book/[slug]',
  '/communications',
  '/communications/analytics',
  '/communications/feedback',
  '/dashboard',
  '/forgot-password',
  '/inventory',
  '/inventory/[id]',
  '/inventory/[id]/edit',
  '/inventory/alerts',
  '/inventory/new',
  '/inventory/purchase-orders',
  '/inventory/purchase-orders/[id]',
  '/inventory/purchase-orders/new',
  '/inventory/reports',
  '/inventory/suppliers',
  '/inventory/suppliers/[id]',
  '/inventory/suppliers/[id]/edit',
  '/inventory/transactions',
  '/invite/accept',
  '/lab',
  '/lab/orders/[id]',
  '/lab/orders/[id]/edit',
  '/lab/orders/new',
  '/lab/vendors',
  '/login',
  '/medications',
  '/onboarding',
  '/patients',
  '/patients/[id]',
  '/patients/[id]/edit',
  '/patients/new',
  '/platform/tenants',
  '/prescriptions',
  '/prescriptions/[id]',
  '/prescriptions/new',
  '/pricing',
  '/recare',
  '/reports',
  '/reports/audit-log',
  '/reset-password',
  '/settings',
  '/settings/appointments',
  '/settings/billing',
  '/settings/clinic',
  '/settings/communications',
  '/settings/forms',
  '/settings/forms/[id]',
  '/settings/forms/new',
  '/settings/import',
  '/settings/pricing',
  '/settings/procedures',
  '/settings/profile',
  '/settings/recare',
  '/settings/password',
  '/settings/security',
  '/settings/setup-guide',
  '/settings/system',
  '/signup',
  '/staff',
  '/staff/[id]',
  '/staff/[id]/edit',
  '/staff/[id]/performance',
  '/staff/invites',
  '/staff/new',
  '/treatments',
  '/treatments/[id]',
  '/treatments/[id]/edit',
  '/treatments/new',
  '/treatments/plans',
  '/treatments/plans/[id]',
  '/treatments/plans/[id]/edit',
  '/treatments/plans/new',
  '/verify-email',
  '/walk-ins',
  '/walk-ins/[id]',
] as const

/** Does this path match a page, treating [segments] as wildcards? */
export function routeExists(path: string): boolean {
  const want = path.split('?')[0].split('#')[0].split('/').filter(Boolean)

  return APP_ROUTES.some((route) => {
    const have = route.split('/').filter(Boolean)
    if (have.length !== want.length) return false
    return have.every((segment, i) => segment.startsWith('[') || segment === want[i])
  })
}

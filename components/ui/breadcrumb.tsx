'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import { hopHref } from '@/lib/trail'
import { routeExists } from '@/lib/routes'
import { useTrailHops } from '@/components/ui/trail'

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  appointments: 'Appointments',
  treatments: 'Treatments',
  billing: 'Billing',
  inventory: 'Inventory',
  staff: 'Staff',
  settings: 'Settings',
  reports: 'Reports',
  communications: 'Communications',
  lab: 'Lab Orders',
  prescriptions: 'Prescriptions',
  medications: 'Drug Catalog',
  video: 'Video Consults',
  chat: 'AI Chat',
  crm: 'CRM',
  sterilization: 'Sterilization',
  devices: 'Devices',
  onboarding: 'Onboarding',
  // Sub-routes
  new: 'New',
  edit: 'Edit',
  invoices: 'Invoices',
  payments: 'Payments',
  'payment-plans': 'Payment Plans',
  'pre-auth': 'Pre-Authorizations',
  providers: 'Providers',
  waitlist: 'Waitlist',
  queue: 'Queue',
  plans: 'Treatment Plans',
  memberships: 'Memberships',
  loyalty: 'Loyalty',
  referrals: 'Referrals',
  segments: 'Segments',
  instruments: 'Instruments',
  logs: 'Cycle Logs',
  vendors: 'Vendors',
  transactions: 'Transactions',
  suppliers: 'Suppliers',
  attendance: 'Attendance',
  report: 'Report',
  leaves: 'Leaves',
  invites: 'Invites',
  performance: 'Performance',
  analytics: 'Analytics',
  automations: 'Automations',
  clinic: 'Clinic',
  ai: 'AI Features',
  forms: 'Forms',
  integrations: 'Integrations',
  security: 'Security',
  system: 'System',
  subscription: 'Subscription',
  procedures: 'Procedures',
}

function isUUID(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^c[a-z0-9]{24,}$/i.test(segment)
  )
}

/**
 * Where the reader is, and how they got here.
 *
 * The path alone cannot answer the second half. A patient opened from the
 * appointment book and a patient opened from the patient list have the same
 * URL, and this used to read "Patients › Details" for both — so the reader had
 * no way back to the appointment except the browser's own button, and no way
 * to see that they had come from one.
 *
 * When the URL carries a trail (lib/trail.ts) the crumbs are the pages actually
 * walked, each named after its record. Without one — a shared link, a bookmark,
 * a page reached from the sidebar — it falls back to the path, which is still
 * the right answer for a list opened directly. A fallback crumb is only a link
 * when there is a page at that path; see lib/routes.ts.
 */
export function Breadcrumb({ className }: { className?: string }) {
  const pathname = usePathname()
  const trail = useTrailHops()

  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1 && trail.length === 0) return null

  const here = segments[segments.length - 1] ?? ''
  const hereLabel = isUUID(here)
    ? 'Details'
    : ROUTE_LABELS[here] || here.charAt(0).toUpperCase() + here.slice(1).replace(/-/g, ' ')

  // `href: null` means "show it, do not link it" — a crumb can be a step in the
  // URL without being a place you can go.
  const crumbs: { label: string; href: string | null; isLast: boolean }[] =
    trail.length > 0
      ? [
          ...trail.map((hop, index) => ({
            label: hop.label,
            href: hopHref(trail, index),
            isLast: false,
          })),
          { label: hereLabel, href: null, isLast: true },
        ]
      : segments.map((segment, index) => {
          const href = '/' + segments.slice(0, index + 1).join('/')
          const isLast = index === segments.length - 1
          const label = isUUID(segment)
            ? 'Details'
            : ROUTE_LABELS[segment] ||
              segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')

          // Not every path segment is a page. /billing/payments/<id> is a step
          // in the URL of the refund screen and nothing more, so linking it
          // would hand the reader a 404 from the one control they reach for
          // when they are lost.
          return { label, href: isLast || !routeExists(href) ? null : href, isLast }
        })

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', className)}
    >
      <Link href="/dashboard" className="hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, index) => (
        <div key={`${index}-${crumb.label}`} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5" />
          {crumb.href === null ? (
            <span
              className={cn(
                'truncate',
                crumb.isLast ? 'font-medium text-foreground max-w-[200px]' : 'max-w-[150px]'
              )}
            >
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors truncate max-w-[150px]"
            >
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  )
}

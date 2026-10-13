import {
  LayoutDashboard,
  Users,
  UserPlus,
  CalendarCheck,
  Calendar,
  Stethoscope,
  Receipt,
  Package,
  FlaskConical,
  UserCog,
  BarChart3,
  Settings,
  FileText,
  CreditCard,
  Shield,
  TrendingUp,
  MessageSquare,
  BotMessageSquare,
  Sparkles,
  Pill,
  ClipboardList,
  ClipboardCheck,
  Building2,
  FileCheck,
  Heart,
  Crown,
  Gift,
  Share2,
  Clock,
  Link2,
  CalendarClock,
  Video,
  Zap,
  Star,
  Cpu,
  Activity,
  Upload,
  BookOpen,
  ListTree,
  UserCheck,
  FileSpreadsheet,
  Vault,
  type LucideIcon,
} from 'lucide-react'
import { holderCan, permissionForRoute, type Permission, type RoleHolder } from '@/lib/rbac'

/** Live counts the menu can show. */
export type NavBadgeKey = 'openVisitors'

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /**
   * Override the capability this item needs. Normally omitted: visibility is
   * derived from `href` through the same route -> permission map that
   * middleware uses, so the menu cannot show a page the router will bounce.
   */
  permission?: Permission
  badge?: string
  /**
   * A count fetched while the menu is on screen, rather than a fixed string.
   * The sidebar looks the key up in `useNavBadges`; an absent or zero count
   * draws nothing, so an empty queue is not advertised.
   */
  badgeKey?: NavBadgeKey
  subItems?: NavItem[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const navigation: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        title: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: 'Patient Care',
    items: [
      {
        title: 'Patients',
        href: '/patients',
        icon: Users,
      },
      {
        title: 'Appointments',
        href: '/appointments',
        icon: Calendar,
        subItems: [
          {
            title: 'All Appointments',
            href: '/appointments',
            icon: Calendar,
          },
          // The screen a receptionist works all day. It existed, complete, and
          // nothing in the application linked to it — no menu entry, no button.
          {
            title: "Today's Queue",
            href: '/appointments/queue',
            icon: Clock,
          },
          {
            title: 'Waitlist',
            href: '/appointments/waitlist',
            icon: Clock,
          },
          /*
           * Walk-ins sat at the top level, beside Recare and Treatments, as
           * though it were a module of its own. Every visitor in the system is
           * created by the appointment form — see the transaction in
           * app/api/appointments/route.ts, which is the only path that writes
           * one — so this is the third front-desk workflow, next to the queue
           * and the waitlist, rather than a fourth place to go.
           *
           * The screen itself stays what it is: a decision queue about people,
           * not a list of visits. The visits are already in the appointments
           * list.
           */
          {
            title: 'Walk-ins',
            href: '/walk-ins',
            icon: UserPlus,
            badgeKey: 'openVisitors',
          },
        ],
      },
      {
        title: 'Recare',
        href: '/recare',
        icon: CalendarCheck,
      },
      {
        // Each clinical module carries the catalogue it writes from, rather
        // than the catalogues sitting as loose top-level rows. Treatment Plans
        // is here because it had no menu entry at all: a whole sub-module —
        // list, create, detail, edit — reachable only from one button partway
        // down the treatments list.
        title: 'Treatments',
        href: '/treatments',
        icon: Stethoscope,
        subItems: [
          {
            title: 'All Treatments',
            href: '/treatments',
            icon: Stethoscope,
          },
          {
            title: 'Treatment Plans',
            href: '/treatments/plans',
            icon: ClipboardCheck,
          },
          {
            // A Procedure is the template a treatment is written from — it
            // carries the name, duration, price, materials, both instruction
            // sheets and the default clinical note. Putting it here says so.
            //
            // It lives at a /settings URL for historical reasons; see
            // ROUTE_PERMISSIONS in lib/rbac.ts for why that URL does not make
            // it administrator-only. A child whose href sits outside its
            // parent's path is already normal here — Walk-ins does the same.
            title: 'Procedure Catalog',
            href: '/settings/procedures',
            icon: ListTree,
          },
        ],
      },
      {
        // Templates were a sibling row ("Rx Templates") first, which put two
        // top-level entries in the menu for one idea and read as a second
        // module. Drug Catalog was a third. Nothing outside prescribing
        // references the drug catalogue, so this is where it belongs.
        title: 'Prescriptions',
        href: '/prescriptions',
        icon: ClipboardList,
        subItems: [
          {
            title: 'All Prescriptions',
            href: '/prescriptions',
            icon: ClipboardList,
          },
          {
            title: 'Templates',
            href: '/prescriptions/templates',
            icon: FileText,
          },
          {
            title: 'Drug Catalog',
            href: '/medications',
            icon: Pill,
          },
        ],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        title: 'Billing',
        href: '/billing',
        icon: Receipt,
        subItems: [
          {
            title: 'Overview',
            href: '/billing',
            icon: Receipt,
          },
          {
            title: 'Invoices',
            href: '/billing/invoices',
            icon: FileText,
          },
          {
            title: 'Payments',
            href: '/billing/payments',
            icon: CreditCard,
          },
          {
            // Open the drawer, count it down (FR-015). Payments are refused with
            // no till open (finding 38), so the desk needs this in reach. Shown
            // to those who can open a till — the same `billing:write` the open
            // route asks for — rather than to everyone who can read billing.
            title: 'Till',
            href: '/billing/till',
            icon: Vault,
            permission: 'billing:write',
          },
          {
            title: 'Receivables',
            href: '/billing/receivables',
            icon: Clock,
          },
          {
            title: 'Financial Reports',
            href: '/billing/reports',
            icon: TrendingUp,
          },
        ],
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        title: 'Inventory',
        href: '/inventory',
        icon: Package,
      },
      {
        title: 'Lab Orders',
        href: '/lab',
        icon: FlaskConical,
      },
      {
        title: 'Communications',
        href: '/communications',
        icon: MessageSquare,
        subItems: [
          {
            title: 'Send Messages',
            href: '/communications',
            icon: MessageSquare,
          },
          {
            title: 'Analytics',
            href: '/communications/analytics',
            icon: BarChart3,
          },
        ],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        title: 'Staff',
        href: '/staff',
        icon: UserCog,
        subItems: [
          {
            title: 'All Staff',
            href: '/staff',
            icon: UserCog,
          },
          {
            title: 'Invites',
            href: '/staff/invites',
            icon: UserCog,
          },
        ],
      },
      {
        title: 'Attendance',
        href: '/attendance',
        icon: UserCheck,
        subItems: [
          {
            title: 'Register',
            href: '/attendance',
            icon: UserCheck,
          },
          {
            title: 'Report',
            href: '/attendance/report',
            icon: FileSpreadsheet,
          },
        ],
      },
      {
        title: 'Reports',
        href: '/reports',
        icon: BarChart3,
        subItems: [
          {
            title: 'Overview',
            href: '/reports',
            icon: BarChart3,
          },
          {
            title: 'Audit Log',
            href: '/reports/audit-log',
            icon: Activity,
          },
        ],
      },
      {
        title: 'Settings',
        href: '/settings',
        icon: Settings,
        subItems: [
          {
            title: 'General',
            href: '/settings',
            icon: Settings,
          },
          {
            title: 'Setup Guide',
            href: '/settings/setup-guide',
            icon: BookOpen,
          },
          {
            title: 'Forms',
            href: '/settings/forms',
            icon: ClipboardCheck,
          },
          {
            title: 'Data Import',
            href: '/settings/import',
            icon: Upload,
          },
        ],
      },
    ],
  },
]

/**
 * Running the platform, as opposed to running a clinic.
 *
 * Kept out of `navigation` because it is not gated by a capability: every
 * clinic has an ADMIN and none of them has any business seeing another
 * clinic's row. It is appended only for a user whose `isPlatformAdmin` flag is
 * set, and the pages behind it check the database rather than the session.
 */
export const PLATFORM_SECTION: NavSection = {
  title: 'Platform',
  items: [
    {
      title: 'Clinics',
      href: '/platform/tenants',
      icon: Building2,
    },
  ],
}

/**
 * The capability an item needs: its explicit `permission`, else whatever the
 * route map says its href requires, else nothing (visible to any staff user).
 */
function requiredPermission(item: NavItem): Permission | null {
  return item.permission ?? permissionForRoute(item.href)
}

function visible(item: NavItem, holder: RoleHolder): boolean {
  const needed = requiredPermission(item)
  return !needed || holderCan(holder, needed)
}

/**
 * Build the menu for a role.
 *
 * This used to filter on per-item `roles` arrays, which was a third copy of
 * the access rules alongside middleware and the API routes — and the copy that
 * went stale first, since adding a role meant editing 26 arrays. Deriving from
 * lib/rbac means a new role gets a correct menu for free.
 *
 * A parent whose children are all hidden is dropped, so a role never sees a
 * section header with nothing under it.
 */
export function getNavigationForRole(
  role: string | RoleHolder,
  clinicalRole?: string | null,
  options: { isPlatformAdmin?: boolean } = {}
): NavSection[] {
  // Accepts a bare role for the common single-role case, or a RoleHolder for
  // someone who also holds a clinical role.
  const holder: RoleHolder = typeof role === 'string' ? { role, clinicalRole } : role
  const sections = options.isPlatformAdmin ? [...navigation, PLATFORM_SECTION] : navigation
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => visible(item, holder))
        .map((item) => ({
          ...item,
          subItems: item.subItems?.filter((subItem) => visible(subItem, holder)),
        }))
        .filter((item) => !item.subItems || item.subItems.length > 0),
    }))
    .filter((section) => section.items.length > 0)
}

/**
 * The children a group draws under itself.
 *
 * Every group declares a first child pointing at the group's own href — "All
 * Appointments", "Overview", "General". The parent row is already that link,
 * so drawing the child as well is two links to one page, and both of them
 * highlighted when you are standing on it.
 */
export function childrenOf(item: NavItem): NavItem[] {
  return (item.subItems ?? []).filter((child) => child.href !== item.href)
}

/**
 * Which navigation item the current page belongs to.
 *
 * The sidebar decided this per item, as `pathname === href || pathname
 * .startsWith(href)`. Every nested pair in this file therefore lit up twice:
 * standing on `/billing/invoices` highlighted both Billing and Invoices, and
 * `/settings/forms` highlighted both Settings and Forms. Two highlighted items
 * is not a stronger signal than one — it is an unanswered question about which
 * section you are in.
 *
 * The longest matching href wins, which is the specific one. Matching is on
 * path segments, so `/prescriptions/templates` is under `/prescriptions` while
 * a hypothetical `/prescriptions-archive` would not be.
 *
 * Returns the winning href, or null on a page no item owns.
 */
export function activeHref(pathname: string, sections: NavSection[]): string | null {
  let best: string | null = null

  for (const section of sections) {
    for (const item of section.items) {
      // Children as well as parents. A child is not always underneath its
      // parent's path — Walk-ins lives at `/walk-ins` under Appointments —
      // so this cannot be left to the prefix match on the parent alone.
      for (const candidate of [item, ...(item.subItems ?? [])]) {
        const matches = pathname === candidate.href || pathname.startsWith(candidate.href + '/')
        if (!matches) continue
        if (best === null || candidate.href.length > best.length) best = candidate.href
      }
    }
  }

  return best
}

import {
  LayoutDashboard,
  Users,
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
  DollarSign,
  Activity,
  Upload,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import { holderCan, permissionForRoute, type Permission, type RoleHolder } from '@/lib/rbac'

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
        title: 'AI Chat',
        href: '/chat',
        icon: BotMessageSquare,
      },
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
          {
            title: 'Waitlist',
            href: '/appointments/waitlist',
            icon: Clock,
          },
        ],
      },
      {
        title: 'Video Consults',
        href: '/video',
        icon: Video,
      },
      {
        title: 'Treatments',
        href: '/treatments',
        icon: Stethoscope,
      },
      {
        title: 'Prescriptions',
        href: '/prescriptions',
        icon: ClipboardList,
      },
      {
        title: 'Drug Catalog',
        href: '/medications',
        icon: Pill,
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
            title: 'Payment Plans',
            href: '/billing/payment-plans',
            icon: CalendarClock,
          },
          {
            title: 'Insurance Claims',
            href: '/billing/insurance',
            icon: Shield,
          },
          {
            title: 'Pre-Authorizations',
            href: '/billing/insurance/pre-auth',
            icon: FileCheck,
          },
          {
            title: 'Insurance Providers',
            href: '/billing/insurance/providers',
            icon: Building2,
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
    title: 'Engagement',
    items: [
      {
        title: 'CRM',
        href: '/crm',
        icon: Heart,
        subItems: [
          {
            title: 'Dashboard',
            href: '/crm',
            icon: Heart,
          },
          {
            title: 'Memberships',
            href: '/crm/memberships',
            icon: Crown,
          },
          {
            title: 'Loyalty',
            href: '/crm/loyalty',
            icon: Gift,
          },
          {
            title: 'Referrals',
            href: '/crm/referrals',
            icon: Share2,
          },
          {
            title: 'Segments',
            href: '/crm/segments',
            icon: Users,
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
        title: 'Sterilization',
        href: '/sterilization',
        icon: Shield,
        subItems: [
          {
            title: 'Dashboard',
            href: '/sterilization',
            icon: Shield,
          },
          {
            title: 'Instruments',
            href: '/sterilization/instruments',
            icon: Package,
          },
          {
            title: 'Cycle Logs',
            href: '/sterilization/logs',
            icon: ClipboardList,
          },
          {
            title: 'Compliance',
            href: '/sterilization/reports',
            icon: BarChart3,
          },
        ],
      },
      {
        title: 'Devices',
        href: '/devices',
        icon: Cpu,
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
          {
            title: 'Automations',
            href: '/communications/automations',
            icon: Zap,
          },
          {
            title: 'Feedback',
            href: '/communications/feedback',
            icon: Star,
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
          {
            title: 'Attendance',
            href: '/staff/attendance',
            icon: Calendar,
          },
          {
            title: 'Leaves',
            href: '/staff/leaves',
            icon: Calendar,
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
            title: 'AI Features',
            href: '/settings/ai',
            icon: Sparkles,
          },
          {
            title: 'Forms',
            href: '/settings/forms',
            icon: ClipboardCheck,
          },
          {
            title: 'Integrations',
            href: '/settings/integrations',
            icon: Link2,
          },
          {
            title: 'Pricing Advisor',
            href: '/settings/pricing',
            icon: DollarSign,
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
  clinicalRole?: string | null
): NavSection[] {
  // Accepts a bare role for the common single-role case, or a RoleHolder for
  // someone who also holds a clinical role.
  const holder: RoleHolder = typeof role === 'string' ? { role, clinicalRole } : role
  return navigation
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

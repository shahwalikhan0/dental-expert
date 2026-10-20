'use client'

import { useSyncExternalStore, type ComponentType } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormSection } from '@/components/ui/form-section'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { PageHeader } from '@/components/ui/page-header'
import { uploadsEnabled } from '@/lib/storage/enabled'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Building2,
  Calendar,
  Receipt,
  MessageSquare,
  Database,
  Settings as SettingsIcon,
  Users,
  Shield,
  Sun,
  Moon,
  Monitor,
  Upload,
  BookOpen,
  Languages,
  KeyRound,
  Printer,
  ChevronRight,
  FileText,
  RefreshCw,
} from 'lucide-react'

interface SettingsLink {
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  href: string
  color: string
  /** Left out where the deployment takes no uploads. See lib/storage/enabled.ts. */
  requiresUploads?: boolean
}

/**
 * The settings pages grouped the way a phone's settings app groups them, so a
 * reader scans four short headings rather than a wall of fifteen equal cards:
 * what to do first, how the clinic runs, who can get in, and what is theirs.
 */
const settingsGroups: { heading: string; items: SettingsLink[] }[] = [
  {
    heading: 'Get started',
    items: [
      {
        title: 'Setup guide',
        description: 'Step-by-step instructions to set up everything — start here!',
        icon: BookOpen,
        href: '/settings/setup-guide',
        color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
      },
      {
        title: 'Data import',
        description: 'Import data from CSV, Excel, or PDF files from your previous ERP',
        icon: Upload,
        href: '/settings/import',
        color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30',
        requiresUploads: true,
      },
    ],
  },
  {
    heading: 'Clinic',
    items: [
      {
        title: 'Clinic information',
        description: 'Manage clinic details, contact information, and branding',
        icon: Building2,
        href: '/settings/clinic',
        color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30',
      },
      {
        title: 'Appointment settings',
        description: 'Configure time slots, working hours, and holiday calendar',
        icon: Calendar,
        href: '/settings/appointments',
        color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
      },
      {
        title: 'Procedure settings',
        description: 'Manage dental procedures and default pricing',
        icon: SettingsIcon,
        href: '/settings/procedures',
        color: 'text-pink-600 bg-pink-50 dark:text-pink-400 dark:bg-pink-950/30',
      },
      {
        title: 'Billing settings',
        description: 'Set up tax rates, invoice format, and payment terms',
        icon: Receipt,
        href: '/settings/billing',
        color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30',
      },
      {
        title: 'Printing',
        description: 'Leave room for your letterhead on every printed page',
        icon: Printer,
        href: '/settings/printing',
        color: 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/30',
      },
      {
        title: 'Communication settings',
        description: 'Configure SMS gateways, email SMTP, and notifications',
        icon: MessageSquare,
        href: '/settings/communications',
        color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30',
      },
      // These two pages existed with no way to them from here; they were only
      // reachable by typing the address.
      {
        title: 'Form templates',
        description: 'Intake, consent and custom forms patients fill in',
        icon: FileText,
        href: '/settings/forms',
        color: 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/30',
      },
      {
        title: 'Recare types',
        description: 'What patients are recalled for, and how often',
        icon: RefreshCw,
        href: '/settings/recare',
        color: 'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/30',
      },
    ],
  },
  {
    heading: 'Team & security',
    items: [
      {
        title: 'User management',
        description: 'Manage staff accounts, roles, and permissions',
        icon: Users,
        href: '/staff',
        color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30',
      },
      {
        title: 'Security settings',
        description: 'Password policies, session timeout, and security logs',
        icon: Shield,
        href: '/settings/security',
        color: 'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/30',
      },
      {
        title: 'System settings',
        description: 'Backup, export data, and view audit logs',
        icon: Database,
        href: '/settings/system',
        color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
      },
    ],
  },
  {
    heading: 'Your account',
    items: [
      {
        title: 'My profile',
        description: 'Your own language and formatting preferences — affects nobody else',
        icon: Languages,
        href: '/settings/profile',
        color: 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/30',
      },
      {
        // Listed for everybody, not gated on a settings capability: Inventory /
        // Store and Lab Technician hold none, and somebody who cannot open the page
        // that changes their password cannot change their password.
        title: 'My password',
        description: 'Change your own sign-in password',
        icon: KeyRound,
        href: '/settings/password',
        color: 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/30',
      },
    ],
  },
]

const noSubscription = () => () => {}

type ThemeChoice = 'light' | 'dark' | 'system'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  // next-themes knows the theme only in the browser. Rendering the selection
  // from it on the server drew every button as unselected, and the browser's
  // first render then disagreed — a hydration mismatch on every visit. The
  // selection waits for the client; the server and the first client render
  // both show none.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )

  // A card for a page that answers "unavailable" is a dead end, so the ones
  // that need somewhere to put a file are left out rather than shown broken.
  // A group emptied by that is dropped with them.
  const uploads = uploadsEnabled()
  const groups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => uploads || !item.requiresUploads),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings & configuration"
        description="Manage all system settings and configurations"
      />

      {groups.map((group) => (
        <section key={group.heading} className="space-y-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.heading}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.color}`}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{item.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Preferences
        </h2>
        <FormSection title="Appearance" description="Choose how the application looks for you">
          <SegmentedControl
            aria-label="Theme"
            size="md"
            options={THEME_OPTIONS}
            // Nothing is selected until hydrated: see above.
            value={(hydrated ? theme : '') as ThemeChoice}
            onChange={setTheme}
          />
        </FormSection>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          About
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-4">
              <CardTitle>System information</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-3">
                <InfoItem label="Version">1.0.0</InfoItem>
                <InfoItem label="Database">PostgreSQL</InfoItem>
                <InfoItem label="Environment">Production</InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Quick tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                <li>Regular backups are crucial for data safety</li>
                <li>Review audit logs periodically for security</li>
                <li>Keep clinic information updated</li>
                <li>Configure SMS/Email for automated reminders</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}

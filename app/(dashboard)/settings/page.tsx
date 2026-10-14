'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
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
} from 'lucide-react'

const settingsCategories = [
  {
    title: 'Setup guide',
    description: 'Step-by-step instructions to set up everything — start here!',
    icon: BookOpen,
    href: '/settings/setup-guide',
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
  },
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
    title: 'Billing settings',
    description: 'Set up tax rates, invoice format, and payment terms',
    icon: Receipt,
    href: '/settings/billing',
    color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30',
  },
  {
    title: 'Communication settings',
    description: 'Configure SMS gateways, email SMTP, and notifications',
    icon: MessageSquare,
    href: '/settings/communications',
    color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30',
  },
  {
    title: 'Procedure settings',
    description: 'Manage dental procedures and default pricing',
    icon: SettingsIcon,
    href: '/settings/procedures',
    color: 'text-pink-600 bg-pink-50 dark:text-pink-400 dark:bg-pink-950/30',
  },
  {
    title: 'User management',
    description: 'Manage staff accounts, roles, and permissions',
    icon: Users,
    href: '/staff',
    color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30',
  },
  {
    title: 'System settings',
    description: 'Backup, export data, and view audit logs',
    icon: Database,
    href: '/settings/system',
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
  },
  {
    title: 'Security settings',
    description: 'Password policies, session timeout, and security logs',
    icon: Shield,
    href: '/settings/security',
    color: 'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/30',
  },
  {
    title: 'Data import',
    description: 'Import data from CSV, Excel, or PDF files from your previous ERP',
    icon: Upload,
    href: '/settings/import',
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30',
  },
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & configuration"
        description="Manage all system settings and configurations"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsCategories.map((category) => (
          <Link key={category.href} href={category.href}>
            <Card className="h-full card-interactive">
              <CardHeader>
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center ${category.color} mb-3`}
                >
                  <category.icon className="w-6 h-6" />
                </div>
                <CardTitle className="text-xl">{category.title}</CardTitle>
                <CardDescription className="text-sm">{category.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {/* Appearance */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sun className="w-5 h-5" />
              Appearance
            </CardTitle>
            <CardDescription>Choose how the application looks for you</CardDescription>
          </CardHeader>
          <CardContent>
            <SegmentedControl
              aria-label="Theme"
              size="md"
              options={THEME_OPTIONS}
              // Nothing is selected until hydrated: see above.
              value={(hydrated ? theme : '') as ThemeChoice}
              onChange={setTheme}
            />
          </CardContent>
        </Card>
      </div>

      {/* Quick Info */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>System information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version:</span>
              <span className="font-medium">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Database:</span>
              <span className="font-medium">PostgreSQL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Environment:</span>
              <span className="font-medium">Production</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick tips</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Regular backups are crucial for data safety</p>
            <p>• Review audit logs periodically for security</p>
            <p>• Keep clinic information updated</p>
            <p>• Configure SMS/Email for automated reminders</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

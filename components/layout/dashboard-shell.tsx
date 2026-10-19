'use client'

import { Sidebar } from './sidebar'
import { MobileSidebar } from './mobile-sidebar'
import { Header } from './header'
import { SidebarProvider } from './sidebar-context'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { TooltipProvider } from '@/components/ui/tooltip'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'
import { SessionWatch } from '@/components/layout/session-watch'
import { roleThemeStyle } from '@/lib/rbac'

interface DashboardShellProps {
  children: React.ReactNode
  user: {
    name: string
    email: string
    role: string
    /** Optional second role; the menu is the union. See lib/rbac.ts. */
    clinicalRole?: string | null
    /** Staff of the platform, not of this clinic. See lib/platform.ts. */
    isPlatformAdmin?: boolean
  }
  hospital?: {
    name: string
    plan: string
    logo?: string | null
  }
}

export function DashboardShell({ children, user, hospital }: DashboardShellProps) {
  return (
    <>
      {/*
        One provider for every tooltip under the dashboard. The icon-only
        actions in the grids each need one, and a provider per button would
        give each its own open-delay timing — a row of actions would feel like
        a dozen unrelated controls rather than one strip.
      */}
      <TooltipProvider delayDuration={200}>
        <SidebarProvider>
          {/*
          A plain grey page, with the cards and the sidebar on it in white.
          The role's colour is set here, once, for the header and the sidebar's
          own header to tint themselves with (`.role-surface`). It is the account's own role
          that colours the screen, not a second clinical one: an administrator
          who also treats patients is still signed in as the administrator.
        */}
          <div
            className="role-tint flex h-screen overflow-hidden bg-background"
            style={roleThemeStyle(user.role)}
          >
            {/* Sidebar - hidden on mobile. Flush to the edge of the screen. */}
            <aside className="hidden md:flex">
              <Sidebar
                role={user.role}
                clinicalRole={user.clinicalRole}
                hospitalName={hospital?.name}
                hospitalLogo={hospital?.logo}
                plan={hospital?.plan}
                isPlatformAdmin={user.isPlatformAdmin}
              />
            </aside>

            {/* Mobile sidebar overlay */}
            <MobileSidebar
              role={user.role}
              clinicalRole={user.clinicalRole}
              hospitalName={hospital?.name}
              hospitalLogo={hospital?.logo}
              plan={hospital?.plan}
              isPlatformAdmin={user.isPlatformAdmin}
            />

            {/* Main content */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header user={user} />
              <main className="flex-1 overflow-auto p-4 md:p-6">
                <Breadcrumb className="mb-4" />
                {children}
              </main>
            </div>
          </div>
        </SidebarProvider>
      </TooltipProvider>
      <KeyboardShortcutHelp />
      <SessionWatch role={user.role} clinicalRole={user.clinicalRole} />
    </>
  )
}

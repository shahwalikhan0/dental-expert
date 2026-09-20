'use client'

import { Sidebar } from './sidebar'
import { MobileSidebar } from './mobile-sidebar'
import { Header } from './header'
import { SidebarProvider } from './sidebar-context'
import { AIProvider } from '@/components/ai/ai-provider'
import { CommandBar } from '@/components/ai/command-bar'
import { ChatWidget } from '@/components/ai/chat-widget'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { KeyboardShortcutHelp } from '@/components/layout/keyboard-shortcut-help'

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
    <AIProvider>
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar - hidden on mobile */}
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
            {/* The floating chat button sits at bottom-right over this area.
                The extra bottom padding is what stops it covering the last row
                of a list — on a phone it was landing on top of one. */}
            <main className="flex-1 overflow-auto bg-muted/30 p-4 pb-24 md:p-6 md:pb-24">
              <Breadcrumb className="mb-4" />
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
      <CommandBar />
      <ChatWidget />
      <KeyboardShortcutHelp />
    </AIProvider>
  )
}

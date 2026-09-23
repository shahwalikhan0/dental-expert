'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getNavigationForRole } from '@/config/nav'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebar } from './sidebar-context'

interface SidebarProps {
  role: string
  /** Optional second role; the menu is the union. See lib/rbac.ts. */
  clinicalRole?: string | null
  hospitalName?: string
  hospitalLogo?: string | null
  plan?: string
  /** Staff of the platform, not of this clinic — adds the Platform section. */
  isPlatformAdmin?: boolean
}

/**
 * The internal rules, hard-lined against the panel, were the only thing telling
 * one region of the sidebar from another. On glass a hairline in the surface's
 * own highlight colour separates without cutting the panel in two.
 */
const RULE = 'border-[hsl(var(--glass-ring)/0.08)]'

export function Sidebar({
  role,
  clinicalRole,
  hospitalName,
  hospitalLogo,
  plan,
  isPlatformAdmin,
}: SidebarProps) {
  const pathname = usePathname()
  const navigation = getNavigationForRole(role, clinicalRole, { isPlatformAdmin })
  const { isCollapsed, toggleSidebar } = useSidebar()

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'glass glass-raised flex h-full flex-col overflow-hidden rounded-2xl transition-[width] duration-300 ease-in-out',
          isCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Header with Logo and Toggle */}
        <div
          className={cn(
            'flex h-16 items-center border-b',
            RULE,
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          )}
        >
          {/* Logo */}
          <Link
            href="/dashboard"
            className={cn(
              'flex items-center gap-3 transition-all duration-300',
              isCollapsed && 'justify-center'
            )}
          >
            {hospitalLogo ? (
              <img
                src={hospitalLogo}
                alt={hospitalName || 'Logo'}
                className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-md shadow-primary/20 ring-1 ring-white/40 dark:ring-white/10"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-white/40 dark:ring-white/10">
                {hospitalName?.charAt(0) || 'D'}
              </div>
            )}
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="max-w-[140px] truncate text-sm font-semibold leading-tight tracking-tight">
                  {hospitalName || 'Dental Clinic'}
                </span>
                {plan && (
                  <span
                    className={cn(
                      'text-[10px] leading-tight',
                      plan === 'FREE' ? 'text-muted-foreground' : 'text-primary'
                    )}
                  >
                    {plan === 'FREE'
                      ? 'Free Plan'
                      : plan === 'PROFESSIONAL'
                        ? 'Professional'
                        : plan === 'ENTERPRISE'
                          ? 'Enterprise'
                          : 'Self-Hosted'}
                  </span>
                )}
              </div>
            )}
          </Link>

          {/* Toggle Button - only show when expanded */}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-lg hover:bg-foreground/[0.06]"
              onClick={toggleSidebar}
            >
              <PanelLeftClose className="h-4 w-4" />
              <span className="sr-only">Collapse sidebar</span>
            </Button>
          )}
        </div>

        {/* Toggle Button when collapsed - separate row */}
        {isCollapsed && (
          <div className={cn('flex justify-center border-b py-2', RULE)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl hover:bg-foreground/[0.06]"
                  onClick={toggleSidebar}
                >
                  <PanelLeft className="h-5 w-5" />
                  <span className="sr-only">Expand sidebar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className={cn('flex flex-col gap-1 py-3', isCollapsed ? 'px-2' : 'px-3')}>
            {navigation.map((section, sectionIndex) => (
              <div key={section.title} className={sectionIndex > 0 ? 'mt-5' : ''}>
                {/* Section Title - hidden when collapsed */}
                {!isCollapsed && (
                  <h4 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                    {section.title}
                  </h4>
                )}
                <div className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== '/dashboard' && pathname.startsWith(item.href))
                    const Icon = item.icon

                    if (isCollapsed) {
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link
                              href={item.href}
                              className={cn(
                                'flex h-10 w-full items-center justify-center rounded-xl transition-colors',
                                isActive
                                  ? 'bg-primary/15 text-primary ring-1 ring-primary/20'
                                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                              )}
                            >
                              <Icon className="h-5 w-5" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="flex items-center gap-2">
                            {item.title}
                            {item.badge && (
                              <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                {item.badge}
                              </span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        /*
                         * The active row used to be a flat grey fill, which on a
                         * translucent panel is indistinguishable from hover. It
                         * is now a tinted pill with a bar at its leading edge —
                         * two signals rather than one, and the bar survives on a
                         * display that flattens the tint.
                         */
                        className={cn(
                          'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                          isActive
                            ? 'bg-gradient-to-r from-primary/20 to-primary/5 font-medium text-foreground shadow-sm shadow-primary/10'
                            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                        )}
                      >
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                          />
                        )}
                        <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                        <span className="truncate">{item.title}</span>
                        {item.badge && (
                          <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className={cn('border-t py-3 text-center', RULE, isCollapsed ? 'px-2' : 'px-4')}>
          <p className="text-[10px] text-muted-foreground/70">
            {isCollapsed ? 'v1.0' : 'Dental ERP v1.0'}
          </p>
        </div>
      </div>
    </TooltipProvider>
  )
}

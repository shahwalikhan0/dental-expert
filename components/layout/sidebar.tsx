'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PanelLeftClose, PanelLeft, ChevronDown, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { activeHref, childrenOf, getNavigationForRole } from '@/config/nav'
import { useNavBadges } from '@/hooks/use-nav-badges'
import { NavBadge } from './nav-badge'
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
  const badges = useNavBadges()
  /**
   * Which groups are showing their children.
   *
   * Only the groups somebody has clicked the arrow on: everything else falls
   * back to "open if you are inside it". Storing the exceptions rather than
   * the whole state means a group you have never touched follows you around
   * the application instead of holding an opinion from three pages ago.
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  // Takes what the group is showing now, because that is not always stored:
  // an untouched group is open or shut according to where you are, and
  // guessing a default here made the first click on a shut group do nothing.
  const toggle = (href: string, isOpen: boolean) =>
    setOpenGroups((open) => ({ ...open, [href]: !isOpen }))
  const navigation = getNavigationForRole(role, clinicalRole, { isPlatformAdmin })
  // One item is highlighted, not every ancestor of the page. See activeHref.
  const current = activeHref(pathname, navigation)
  const { isCollapsed, toggleSidebar } = useSidebar()

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          // Flush to the screen's edges, so only the right-hand border is drawn.
          // The role's colour is on the header only, not the whole panel:
          // a tinted menu the height of the screen was a lot of colour to read
          // text on.
          'glass glass-raised flex h-full flex-col overflow-hidden !border-y-0 !border-l-0 transition-[width] duration-300 ease-in-out',
          isCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Header with Logo and Toggle */}
        <div
          className={cn(
            'role-surface flex h-16 items-center border-b',
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
                  <h4 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {section.title}
                  </h4>
                )}
                <div className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const isActive = current === item.href
                    const Icon = item.icon
                    const children = childrenOf(item)
                    // Open by default when you are somewhere inside the group,
                    // which is how you got here; a click on the arrow wins
                    // after that.
                    const holdsCurrent =
                      isActive || children.some((child) => child.href === current)
                    const isOpen = openGroups[item.href] ?? holdsCurrent

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
                            <NavBadge item={item} badges={badges} />
                          </TooltipContent>
                        </Tooltip>
                      )
                    }

                    return (
                      <div key={item.href} className="flex flex-col gap-1">
                        {/*
                         * The row is a container rather than a link, because it
                         * holds two controls: the link to the section, and the
                         * toggle for its children. A button inside an anchor is
                         * not valid markup and, on a keyboard, not operable.
                         *
                         * The active row used to be a flat grey fill, which on a
                         * translucent panel is indistinguishable from hover. It
                         * is now a tinted pill with a bar at its leading edge —
                         * two signals rather than one, and the bar survives on a
                         * display that flattens the tint.
                         */}
                        <div
                          className={cn(
                            'relative flex h-10 items-center rounded-xl text-sm transition-colors',
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
                          <Link
                            href={item.href}
                            className="flex min-w-0 flex-1 items-center gap-3 px-3"
                          >
                            <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                            <span className="truncate">{item.title}</span>
                            <NavBadge item={item} badges={badges} />
                          </Link>
                          {children.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggle(item.href, isOpen)}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Hide' : 'Show'} ${item.title} pages`}
                              className="mr-1 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 transition-transform duration-200',
                                  // Pointing down when the children are showing,
                                  // and turned to point at the row when they are
                                  // not — the arrow says which way it will move.
                                  !isOpen && '-rotate-90'
                                )}
                              />
                            </button>
                          )}
                        </div>

                        {/*
                        The children were declared in config/nav.ts and drawn by
                        nobody: both sidebars mapped over `section.items` and
                        stopped. Today's Queue — which a file comment calls "the
                        screen a receptionist works all day" — has been in the
                        config and unreachable from the menu this whole time.

                        The child whose href equals its parent's is skipped:
                        every group has one ("All Appointments", "Overview",
                        "General") and the parent row already goes there, so
                        drawing it twice is two links to one page and two
                        things highlighted when you are on it.
                      */}
                        {isOpen &&
                          children.map((child) => {
                            const ChildIcon = child.icon
                            const childActive = current === child.href
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={cn(
                                  'relative ml-4 flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                                  childActive
                                    ? 'bg-primary/10 font-medium text-foreground'
                                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                                )}
                              >
                                <ChildIcon
                                  className={cn('h-4 w-4 shrink-0', childActive && 'text-primary')}
                                />
                                <span className="truncate">{child.title}</span>
                                <NavBadge item={child} badges={badges} />
                              </Link>
                            )
                          })}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* The user guide, for every role: it sits below the menu rather than
            in it, because it is not a part of the clinic's work. It opens in a
            new tab, so reading it does not lose the screen it was opened from. */}
        <div className={cn('border-t p-3', RULE)}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Docs (opens in a new tab)"
                  className="flex h-10 w-full items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <BookOpen className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Docs</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              <span>Docs</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          )}
        </div>

        {/* Footer */}
        <div className={cn('border-t py-3 text-center', RULE, isCollapsed ? 'px-2' : 'px-4')}>
          <p className="text-[10px] text-muted-foreground">
            {isCollapsed ? 'v1.0' : 'Dental Expert v1.0'}
          </p>
        </div>
      </div>
    </TooltipProvider>
  )
}

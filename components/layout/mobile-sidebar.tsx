'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X, ChevronDown, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { activeHref, childrenOf, getNavigationForRole } from '@/config/nav'
import { useNavBadges } from '@/hooks/use-nav-badges'
import { NavBadge } from './nav-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSidebar } from './sidebar-context'

interface MobileSidebarProps {
  role: string
  /** Optional second role; the menu is the union. See lib/rbac.ts. */
  clinicalRole?: string | null
  hospitalName?: string
  hospitalLogo?: string | null
  plan?: string
  /** Staff of the platform, not of this clinic — adds the Platform section. */
  isPlatformAdmin?: boolean
}

export function MobileSidebar({
  role,
  clinicalRole,
  hospitalName,
  hospitalLogo,
  isPlatformAdmin,
}: MobileSidebarProps) {
  const pathname = usePathname()
  const badges = useNavBadges()
  // Only the groups somebody has clicked the arrow on; everything else falls
  // back to "open if you are inside it". See the sidebar for the reasoning.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const toggle = (href: string, isOpen: boolean) =>
    setOpenGroups((open) => ({ ...open, [href]: !isOpen }))
  const navigation = getNavigationForRole(role, clinicalRole, { isPlatformAdmin })
  // One item is highlighted, not every ancestor of the page. See activeHref.
  const current = activeHref(pathname, navigation)
  const { mobileOpen, setMobileOpen } = useSidebar()

  // Close on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    if (mobileOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mobileOpen, setMobileOpen])

  if (!mobileOpen) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-foreground/20 backdrop-blur-md"
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar panel */}
      <div className="glass glass-raised role-surface animate-in slide-in-from-left fixed inset-y-0 left-0 flex w-[min(288px,80vw)] flex-col rounded-r-2xl duration-200">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[hsl(var(--glass-ring)/0.08)] px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-3"
            onClick={() => setMobileOpen(false)}
          >
            {hospitalLogo ? (
              <img
                src={hospitalLogo}
                alt={hospitalName || 'Logo'}
                className="h-8 w-8 rounded-xl object-cover shadow-md shadow-primary/20 ring-1 ring-white/40 dark:ring-white/10"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-white/40 dark:ring-white/10">
                {hospitalName?.charAt(0) || 'D'}
              </div>
            )}
            <span className="text-sm font-semibold truncate">
              {hospitalName || 'Dental Clinic'}
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl hover:bg-foreground/[0.06]"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-1 p-3">
            {navigation.map((section, sectionIndex) => (
              <div key={section.title} className={sectionIndex > 0 ? 'mt-4' : ''}>
                <h4 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {section.title}
                </h4>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const isActive = current === item.href
                    const Icon = item.icon
                    const children = childrenOf(item)
                    const holdsCurrent =
                      isActive || children.some((child) => child.href === current)
                    const isOpen = openGroups[item.href] ?? holdsCurrent
                    return (
                      <div key={item.href} className="flex flex-col gap-0.5">
                        {/* A container, not a link: it holds the section link
                            and the toggle for its children, and a button inside
                            an anchor is neither valid nor operable. */}
                        <div
                          className={cn(
                            'relative flex h-10 items-center rounded-xl text-sm transition-colors',
                            isActive
                              ? 'bg-gradient-to-r from-primary/20 to-primary/5 font-medium text-foreground'
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
                                  !isOpen && '-rotate-90'
                                )}
                              />
                            </button>
                          )}
                        </div>

                        {/* The same children the desktop sidebar draws; a menu
                            that differs between the two is worse than either. */}
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

        {/* The user guide, below the menu as on the desktop sidebar. */}
        <div className="border-t border-[hsl(var(--glass-ring)/0.08)] p-3">
          <Link
            href="/docs"
            onClick={() => setMobileOpen(false)}
            className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span>Docs</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

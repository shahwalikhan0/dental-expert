'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getNavigationForRole } from '@/config/nav'
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
  const navigation = getNavigationForRole(role, clinicalRole, { isPlatformAdmin })
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
      <div className="glass glass-raised animate-in slide-in-from-left fixed inset-y-0 left-0 w-[min(288px,80vw)] rounded-r-2xl duration-200">
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
        <ScrollArea className="flex-1 h-[calc(100vh-3.5rem)]">
          <nav className="flex flex-col gap-1 p-3">
            {navigation.map((section, sectionIndex) => (
              <div key={section.title} className={sectionIndex > 0 ? 'mt-4' : ''}>
                <h4 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {section.title}
                </h4>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== '/dashboard' && pathname.startsWith(item.href))
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
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
      </div>
    </div>
  )
}

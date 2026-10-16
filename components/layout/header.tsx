'use client'

import dynamic from 'next/dynamic'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlobalSearch } from './global-search'
import { ThemeToggle } from './theme-toggle'
import { useSidebar } from './sidebar-context'
import { cn } from '@/lib/utils'
import { roleColor, roleLabel } from '@/lib/rbac'

const UserMenu = dynamic(() => import('./user-menu').then((m) => m.UserMenu), {
  ssr: false,
  loading: () => <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />,
})

interface HeaderProps {
  user: {
    name: string
    email: string
    role: string
  }
}

export function Header({ user }: HeaderProps) {
  const { setMobileOpen } = useSidebar()

  return (
    // Left unglazed the header was an opaque band butting against a floating
    // panel, which reads as a seam rather than as a layer. It takes the role's
    // colour more lightly than the sidebar does: it runs the width of the
    // screen, and at the sidebar's strength it would tint the whole page.
    <header className="role-surface sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-[hsl(var(--glass-ring)/0.08)] bg-background/70 px-4 backdrop-blur-xl backdrop-saturate-150 [--role-wash:0.16] md:px-6">
      {/* Mobile menu button */}
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle menu</span>
      </Button>

      {/* Global Search */}
      <GlobalSearch />

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* The role in words, beside its colour, so the colour is never the
            only thing saying whose screen this is. */}
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex',
            roleColor(user.role)
          )}
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--role))]" />
          <span className="sr-only">Signed in as </span>
          {roleLabel(user.role)}
        </span>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* User menu */}
        <UserMenu user={user} />
      </div>
    </header>
  )
}

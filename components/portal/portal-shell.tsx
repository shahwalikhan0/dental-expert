'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Building2,
  LayoutDashboard,
  Calendar,
  Stethoscope,
  CreditCard,
  Pill,
  KeyRound,
  LogOut,
  Menu,
  X,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface PortalShellProps {
  patient: {
    name: string
    patientId: string
  }
  hospital: {
    name: string
    logo: string | null
    slug: string
  }
  children: React.ReactNode
}

/**
 * Every item here leads somewhere that exists.
 *
 * This list used to hold nine, including Forms, Book Appointment and Upload
 * Photo — pages nobody had written, in a component nothing imported. A
 * navigation entry is a promise, and one that leads to a 404 is worse than an
 * absent feature: the patient believes the clinic offers it.
 *
 * Nothing here writes. Changing an appointment means telephoning the desk,
 * which is what the booking confirmation already tells patients to do; the
 * clinic's number is on the overview page.
 */
const navItems = [
  { href: '/portal', label: 'Overview', icon: LayoutDashboard },
  { href: '/portal/appointments', label: 'Appointments', icon: Calendar },
  { href: '/portal/treatments', label: 'Treatments', icon: Stethoscope },
  { href: '/portal/prescriptions', label: 'Prescriptions', icon: Pill },
  { href: '/portal/bills', label: 'Bills', icon: CreditCard },
  { href: '/portal/password', label: 'Password', icon: KeyRound },
]

export function PortalShell({ patient, hospital, children }: PortalShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await fetch('/api/portal/auth/logout', { method: 'POST' })
    router.push('/portal/login?clinic=' + hospital.slug)
  }

  const isActive = (href: string) => {
    if (href === '/portal') return pathname === '/portal'
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/[0.06] via-background to-primary/[0.04]">
      {/* Top navbar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <button className="md:hidden p-1" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            {hospital.logo ? (
              <img
                src={hospital.logo}
                alt={hospital.name}
                className="h-8 w-8 rounded-xl object-cover ring-1 ring-white/40 dark:ring-white/10"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
            )}
            <span className="font-semibold text-sm hidden sm:block">{hospital.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{patient.name}</p>
              <p className="text-xs text-muted-foreground">{patient.patientId}</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              aria-label="Sign out"
              className="text-muted-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-56 shrink-0 border-r border-border/60 bg-card/50 backdrop-blur-xl min-h-[calc(100vh-3.5rem)]">
          <nav className="p-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                  isActive(item.href)
                    ? 'bg-gradient-to-r from-primary/20 to-primary/5 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Mobile nav overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <div
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="glass glass-raised absolute left-0 top-14 bottom-0 w-56 rounded-r-2xl">
              <nav className="p-3 space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                      isActive(item.href)
                        ? 'bg-gradient-to-r from-primary/20 to-primary/5 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 min-h-[calc(100vh-3.5rem)]">{children}</main>
      </div>
    </div>
  )
}

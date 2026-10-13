import { cache } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardShell } from '@/components/layout/dashboard-shell'

/**
 * The signed-in clinic, fetched once per request.
 *
 * `generateMetadata` and the layout body are two separate calls into this
 * module and both need the same row — the title wants the clinic's name and
 * the shell wants its logo and plan. Wrapped in `cache` so that is one query
 * rather than two: React de-duplicates by argument for the life of the
 * request, and both callers pass nothing.
 */
const currentHospital = cache(async () => {
  const session = await auth()
  const hospitalId = session?.user?.hospitalId

  const hospital = hospitalId
    ? await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: {
          name: true,
          logo: true,
          onboardingCompleted: true,
          subscription: { select: { plan: true } },
        },
      })
    : null

  return { session, hospital }
})

/**
 * `{Clinic} | Dental Expert`, on every screen behind the sign-in.
 *
 * The clinic comes first because it is the part that differs: somebody
 * covering two practices has a tab open on each, and the browser truncates
 * from the right. A title of `Dental Expert — Patients` in both tabs is two
 * identical tabs.
 *
 * `absolute` rather than a template, so no page can put its own name in front
 * of the clinic's — the root layout's `%s | Dental Expert` still applies
 * everywhere a stranger can reach, where there is no clinic to name.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { hospital } = await currentHospital()

  return {
    title: { absolute: hospital?.name ? `${hospital.name} | Dental Expert` : 'Dental Expert' },
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, hospital } = await currentHospital()

  if (!session?.user) {
    redirect('/login')
  }

  // A clinic that has not finished setup is sent to it. Safe to do on every
  // request because /onboarding is not under this layout — it has its own route
  // group, app/(onboarding). It used to live here, and this redirect sent it
  // to itself forever (bug report 12 Oct, finding 1).
  if (hospital && !hospital.onboardingCompleted) {
    redirect('/onboarding')
  }

  const user = {
    name: session.user.name || 'User',
    email: session.user.email || '',
    role: session.user.role || 'RECEPTIONIST',
    clinicalRole: session.user.clinicalRole,
    isPlatformAdmin: session.user.isPlatformAdmin ?? false,
  }

  const hospitalInfo = hospital
    ? {
        name: hospital.name,
        plan: hospital.subscription?.plan ?? 'FREE',
        logo: hospital.logo,
      }
    : undefined

  return (
    <DashboardShell user={user} hospital={hospitalInfo}>
      {children}
    </DashboardShell>
  )
}

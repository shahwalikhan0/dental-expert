import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = {
  title: 'Set up your clinic',
}

/**
 * First-run setup, outside the dashboard.
 *
 * The onboarding page used to live in `app/(dashboard)/`, whose layout sends
 * every request to `/onboarding` until the clinic has finished it — including
 * the request for `/onboarding` itself. So the page redirected to itself, the
 * browser made hundreds of requests a second, and no clinic that signed up
 * could ever get in (bug report 12 Oct, finding 1).
 *
 * It has its own route group now, with this layout and no dashboard shell: no
 * sidebar to wander off into, and no redirect to loop on. The guard here is
 * the dashboard's in reverse — signed in, and not finished yet. A clinic that
 * has finished is sent on to the dashboard, so the page cannot be used to
 * re-run setup over a working clinic's details.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login?callbackUrl=%2Fonboarding')
  }

  const hospital = session.user.hospitalId
    ? await prisma.hospital.findUnique({
        where: { id: session.user.hospitalId },
        select: { onboardingCompleted: true },
      })
    : null

  if (!hospital || hospital.onboardingCompleted) {
    redirect('/dashboard')
  }

  return <>{children}</>
}

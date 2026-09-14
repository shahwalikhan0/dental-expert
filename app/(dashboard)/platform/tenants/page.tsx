import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TenantConsole } from './tenant-console'

/**
 * The platform console — every clinic on the installation.
 *
 * Gated on a database read of `User.isPlatformAdmin`, not on the session flag:
 * a token lives eight hours, and for the one privilege that crosses every
 * tenant boundary, waiting up to eight hours for its removal to take effect is
 * not an answer. `notFound()` rather than a 403, for the same reason the API
 * returns 404 — there is nothing here for a clinic user, so the page says so.
 */
export default async function PlatformTenantsPage() {
  const session = await auth()
  if (!session?.user?.id) notFound()

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, isPlatformAdmin: true },
  })

  if (!actor?.isActive || !actor.isPlatformAdmin) notFound()

  return <TenantConsole />
}

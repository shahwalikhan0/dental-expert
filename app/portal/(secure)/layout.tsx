import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PortalShell } from '@/components/portal/portal-shell'
import { requirePortalPatient } from '@/lib/portal/auth'

/**
 * The gate on every portal page that shows a record.
 *
 * Server-side and on every request, rather than a check in the browser: a
 * client-side guard decides what to *render*, and the data has already been
 * fetched by then. The same `requirePortalPatient` the API routes use, so the
 * page and the endpoints behind it cannot disagree about who is signed in.
 *
 * `/portal/password` deliberately sits outside this group. It is where somebody
 * with a desk-issued password is sent, so it cannot be behind a gate that
 * sends them here.
 */
export default async function SecurePortalLayout({ children }: { children: React.ReactNode }) {
  const { error, caller } = await requirePortalPatient()

  if (error) redirect('/portal/login')

  if (caller.mustChangePassword) redirect('/portal/password')

  const hospital = await prisma.hospital.findUnique({
    where: { id: caller.patient.hospitalId },
    select: { name: true, logo: true, slug: true },
  })

  return (
    <PortalShell
      patient={{
        name: `${caller.patient.firstName} ${caller.patient.lastName}`.trim(),
        patientId: caller.patient.patientId,
      }}
      hospital={{
        name: hospital?.name ?? '',
        logo: hospital?.logo ?? null,
        slug: hospital?.slug ?? '',
      }}
    >
      {children}
    </PortalShell>
  )
}

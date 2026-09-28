import { redirect } from 'next/navigation'
import { requirePortalPatient } from '@/lib/portal/auth'
import { PortalPasswordForm } from '@/components/portal/password-form'

/**
 * Choosing your own password.
 *
 * Outside the `(secure)` group on purpose: that layout sends anybody still
 * holding a desk-issued password here, so this page cannot sit behind it. It
 * does its own check instead.
 */
export default async function PortalPasswordPage() {
  const { error, caller } = await requirePortalPatient()
  if (error) redirect('/portal/login')

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
      <PortalPasswordForm
        forced={caller.mustChangePassword}
        name={`${caller.patient.firstName} ${caller.patient.lastName}`.trim()}
      />
    </div>
  )
}

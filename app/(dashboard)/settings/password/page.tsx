import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/ui/page-header'
import { ChangePasswordCard } from '@/components/settings/change-password-card'
import { auth } from '@/lib/auth'
import { SESSION_ENDED_PATH } from '@/lib/session-ended'

/**
 * Where everybody changes their own password.
 *
 * Deliberately outside the settings permission. Every role has an account and
 * every account has a password, including Inventory / Store and Lab Technician,
 * who hold no `settings:read` — gating this on a settings capability would have
 * left two roles unable to change their own password at all.
 *
 * It is also where somebody with an expired or administrator-set password is
 * sent, by middleware, before they can reach anything else.
 */
export default async function ChangePasswordPage() {
  const session = await auth()
  if (!session?.user) redirect(SESSION_ENDED_PATH)

  const forced = session.user.mustChangePassword === true

  return (
    <div className="space-y-6">
      <PageHeader
        title="Change password"
        description={
          forced ? 'Choose a new password to carry on.' : 'Your sign-in password for this clinic.'
        }
      />

      <ChangePasswordCard forced={forced} />
    </div>
  )
}

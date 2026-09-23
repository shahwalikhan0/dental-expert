import { redirect } from 'next/navigation'

import { ChangePasswordCard } from '@/components/settings/change-password-card'
import { auth } from '@/lib/auth'

export const metadata = {
  title: 'Change password',
}

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
  if (!session?.user) redirect('/login')

  const forced = session.user.mustChangePassword === true

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Change password</h1>
        <p className="text-muted-foreground">
          {forced ? 'Choose a new password to carry on.' : 'Your sign-in password for this clinic.'}
        </p>
      </div>

      <ChangePasswordCard forced={forced} />
    </div>
  )
}

import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/ui/page-header'
import { LanguagePreferenceCard } from '@/components/i18n/language-preference-card'
import { auth } from '@/lib/auth'
import { locales } from '@/lib/i18n/config'
import { prisma } from '@/lib/prisma'
import { SESSION_ENDED_PATH } from '@/lib/session-ended'

export default async function ProfileSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect(SESSION_ENDED_PATH)
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      locale: true,
      hospital: { select: { locale: true, currency: true } },
    },
  })

  if (!user) {
    redirect(SESSION_ENDED_PATH)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My profile"
        description={`Preferences that apply to your account only — ${user.name} (${user.email})`}
      />

      <LanguagePreferenceCard
        locale={user.locale}
        hospitalLocale={user.hospital?.locale ?? null}
        currency={user.hospital?.currency ?? 'PKR'}
        supportedLocales={locales}
        endpoint="/api/settings/profile"
      />
    </div>
  )
}

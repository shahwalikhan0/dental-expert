import { getRequestConfig } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { defaultLocale, getLocaleDefaults, resolveLocaleCascade, type Locale } from './config'

/**
 * Locale resolution, most specific first.
 *
 * There is deliberately no `/[locale]/` URL segment — see docs/LOCALIZATION.md.
 * Three surfaces resolve differently because they authenticate differently:
 *
 *   Staff UI      User.locale    ?? Hospital.locale ?? default
 *   Patient portal Patient.locale ?? Hospital.locale ?? default
 *   Public pages  ?lang=         ?? Hospital.locale ?? default
 *
 * `null` on the person means "inherit from the clinic" — it is not a stored
 * preference. That is why these go through `resolveLocaleCascade` rather than
 * `resolveLocale(a ?? b)`: the latter would treat an unsupported stored value
 * as a decision and skip the clinic entirely.
 *
 * Anything that goes wrong here (no session, unreachable database, a locale
 * string that is no longer supported) falls back to the default rather than
 * throwing: a formatting concern must never be able to take a page down.
 */

/**
 * Staff locale, or `null` when there is no staff session.
 *
 * One query, not two. This runs on every server-rendered request, so the
 * clinic's locale is joined rather than fetched separately.
 */
async function resolveStaffLocale(): Promise<Locale | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true, hospital: { select: { locale: true } } },
  })
  if (!user) return null

  return resolveLocaleCascade(user.locale, user.hospital?.locale)
}

/**
 * The locale for the current request, whoever is making it.
 *
 * Anonymous requests get the default; public pages that know which clinic they
 * belong to should call `resolvePublicLocale` from ./config instead — it is
 * pure, so importing it does not drag next-auth into a page that has no
 * session to read.
 *
 * There used to be a patient branch here for the portal. The portal is gone
 * (it is a §16 future enhancement, not part of this release), and with it the
 * only caller that was not staff.
 */
export async function getLocaleForRequest(): Promise<Locale> {
  try {
    const staff = await resolveStaffLocale()
    if (staff) return staff

    return defaultLocale
  } catch {
    return defaultLocale
  }
}

async function loadMessages(locale: Locale) {
  return (await import(`../../messages/${locale}.json`)).default
}

export default getRequestConfig(async () => {
  const locale = await getLocaleForRequest()
  const { timezone } = getLocaleDefaults(locale)

  return {
    locale,
    timeZone: timezone,
    messages: await loadMessages(locale),
  }
})

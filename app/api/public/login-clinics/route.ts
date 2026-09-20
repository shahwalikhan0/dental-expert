import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requestContext } from '@/lib/audit'
import { resolveLogin } from '@/lib/login'

/**
 * Why was that sign-in refused?
 *
 * The credentials provider can only answer yes or no — NextAuth gives it no
 * way to return a reason without also deciding how the reason is rendered — so
 * the sign-in page asks here when it is told no. Three answers matter to the
 * person at the keyboard, and "invalid email or password" is wrong for two of
 * them:
 *
 *  - they hold accounts at several clinics and did not say which;
 *  - the account is locked after too many wrong passwords;
 *  - the clinic does not permit signing in from this address.
 *
 * Two properties make it safe to answer:
 *
 *  - **The clinic list needs the password.** Every candidate account is opened
 *    with bcrypt before it can appear, so the caller is already able to sign in
 *    to every clinic named. Nothing is disclosed that they could not obtain by
 *    signing in.
 *  - **It never signs anyone in and never writes an audit entry.** The attempt
 *    it is asking about has already been recorded by the sign-in that failed;
 *    logging it twice would double every wrong-password entry in the trail.
 *
 * The lockout and address answers do disclose that an account exists at the
 * address given. That is inherent in having a lockout at all — see the note in
 * `resolveLogin` — and this endpoint discloses no more than the sign-in
 * endpoint beside it already does.
 *
 * It is a second door onto the same lock, so whatever rate limiting eventually
 * guards /api/auth must guard this too.
 */
const schema = z.object({
  email: z.string().email(),
  // No minimum: this asks about a password that was just tried, whatever it
  // was. See the same note in lib/auth.ts.
  password: z.string().min(1),
  clinic: z.string().optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ clinics: [], reason: null })
  }

  const validated = schema.safeParse(body)
  if (!validated.success) return NextResponse.json({ clinics: [], reason: null })

  const outcome = await resolveLogin({
    email: validated.data.email,
    password: validated.data.password,
    clinicSlug: validated.data.clinic || null,
    // The address matters: the allow/block lists are checked against it, and
    // without it this endpoint would report "not locked, not blocked" for a
    // sign-in the real endpoint had just refused on exactly those grounds.
    context: requestContext(request.headers),
    audit: false,
  })

  if (outcome.status === 'ambiguous') {
    return NextResponse.json({ clinics: outcome.clinics, reason: 'ambiguous' })
  }

  if (outcome.status === 'locked_out') {
    return NextResponse.json({ clinics: [], reason: 'locked_out', minutes: outcome.minutes })
  }

  if (outcome.status === 'ip_refused') {
    return NextResponse.json({ clinics: [], reason: 'ip_refused' })
  }

  // Everything else — a wrong password, a deactivated account, a deactivated
  // clinic — keeps the page's own generic message. The first is the common
  // case and the other two must not be told apart from it by anyone who does
  // not hold the password.
  return NextResponse.json({ clinics: [], reason: null })
}

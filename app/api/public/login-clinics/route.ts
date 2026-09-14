import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveLogin } from '@/lib/login'

/**
 * Which clinics does this email and password open an account at?
 *
 * The sign-in page calls this only after a sign-in attempt has been refused,
 * to tell the two reasons for refusal apart: a wrong password, and a person
 * who holds accounts at several clinics and has not said which one they meant.
 *
 * Two properties make it safe to answer:
 *
 *  - **It answers nothing without the password.** Every candidate account is
 *    opened with bcrypt before it can appear in the list, so the caller is
 *    already able to sign in to every clinic named. Nothing is disclosed that
 *    they could not obtain by signing in.
 *  - **It never signs anyone in and never writes an audit entry.** The attempt
 *    it is asking about has already been recorded by the sign-in that failed;
 *    logging it twice would double every wrong-password entry in the trail.
 *
 * It is exactly as exposed to password guessing as the sign-in endpoint it sits
 * beside, and no more — but it is a second door onto the same lock, so whatever
 * rate limiting eventually guards /api/auth must guard this too.
 */
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ clinics: [] })
  }

  const validated = schema.safeParse(body)
  if (!validated.success) return NextResponse.json({ clinics: [] })

  const outcome = await resolveLogin({ ...validated.data, audit: false })

  // Everything except an ambiguous match is an empty list. The page already
  // has a message for "that did not work"; this endpoint exists only to add
  // the one case where the credentials were right and the clinic was missing.
  if (outcome.status !== 'ambiguous') return NextResponse.json({ clinics: [] })

  return NextResponse.json({ clinics: outcome.clinics })
}

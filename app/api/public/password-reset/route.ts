import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { generateToken } from '@/lib/api-helpers'
import { resetExpiry, RESET_TTL_MINUTES } from '@/lib/password-reset'
import { sendPasswordResetEmail } from '@/lib/email-helpers'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { emailField } from '@/lib/email-address'

/**
 * POST /api/public/password-reset — ask for a reset link.
 *
 * Unauthenticated, which is the whole point: somebody who cannot sign in is
 * asking for a way back in.
 *
 * **The answer never varies.** Known address or not, active account or not,
 * the response is the same 200 with the same sentence. An endpoint that
 * distinguishes them is an endpoint anybody can use to find out which of a
 * clinic's staff hold accounts, and it is reachable by anyone on the internet.
 * The cost of that silence is that somebody who mistypes their address waits
 * for an email that never comes, which is the trade every application makes
 * here.
 *
 * **One address may hold accounts at several clinics.** `User.email` is unique
 * within a clinic, not across the platform. Every matching account gets its own
 * token and its own link, named by clinic, in one email.
 *
 * Rate limiting is applied in `middleware.ts` alongside the sign-in routes —
 * without it this is a way to send mail to any address, repeatedly.
 */
const schema = z.object({
  // Trimmed and lower-cased before it is checked, so an address pasted with a
  // trailing space is still an address (finding 29).
  email: emailField(),
})

/** What the caller is told, whatever actually happened. */
const SAME_ANSWER = {
  success: true,
  message: 'If that address has an account, a reset link is on its way.',
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(SAME_ANSWER)
  }

  const parsed = schema.safeParse(body)
  // Even a malformed address gets the same answer: "that is not an email" is a
  // smaller disclosure than the rest, but there is no reason to vary at all.
  if (!parsed.success) return NextResponse.json(SAME_ANSWER)

  const email = parsed.data.email

  try {
    const accounts = await prisma.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        isActive: true,
        // An invitation is a row with no password. Resetting one is not a
        // reset — those people already have a link, and it is a different one.
        password: { not: null },
      },
      select: {
        id: true,
        name: true,
        hospitalId: true,
        hospital: { select: { name: true } },
      },
    })

    if (accounts.length === 0) return NextResponse.json(SAME_ANSWER)

    const expiresAt = resetExpiry()
    const issued: { clinicName: string; token: string }[] = []

    for (const account of accounts) {
      const token = generateToken(48)
      await prisma.user.update({
        where: { id: account.id },
        // Any reset already outstanding for this account is replaced. Asking
        // twice should leave one working link, not two.
        data: { resetToken: token, resetExpiresAt: expiresAt },
      })
      issued.push({ clinicName: account.hospital.name, token })

      void recordAudit({
        hospitalId: account.hospitalId,
        // Nobody is signed in. The trail should say that rather than leave it
        // looking like an administrator reset somebody's password.
        userId: null,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        entityType: 'User',
        entityId: account.id,
        ...requestContext(request.headers),
      })
    }

    await sendPasswordResetEmail({
      hospitalId: accounts[0].hospitalId,
      to: email,
      name: accounts[0].name || email.split('@')[0],
      accounts: issued,
      expiresInMinutes: RESET_TTL_MINUTES,
    })
  } catch (err) {
    // A failure here must not tell the caller anything either — including, by
    // way of a 500, that the address was one worth looking up.
    console.error('Password reset request failed:', err)
  }

  return NextResponse.json(SAME_ANSWER)
}

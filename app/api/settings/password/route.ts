import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getAuthenticatedHospital } from '@/lib/api-helpers'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import prisma from '@/lib/prisma'
import { describePolicy, validatePassword } from '@/lib/password-policy'
import { passwordPolicyFor } from '@/lib/security-settings'

/**
 * Changing your own password.
 *
 * There was no way to. An administrator could set somebody else's from the
 * staff screen, and that was the whole of it — a dentist who thought their
 * password had been seen over their shoulder had to ask the practice owner to
 * change it for them, which means telling the owner, and means the owner then
 * knows it.
 *
 * It is also what makes the expiry in Settings → Security honest. A policy that
 * requires a password to be changed every ninety days, in an application with
 * no way to change a password, is a policy that locks out the entire staff on
 * day ninety-one.
 *
 * No capability is named here on purpose. Every role may change its own
 * password, including the two roles that hold no settings permission at all,
 * so the check is authentication and identity: you may change yours, and this
 * route offers no way to name anybody else's.
 */

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(1, 'Enter a new password'),
})

/** GET — the rules this clinic requires, so the form can state them up front. */
export async function GET(_req: NextRequest) {
  const { error, hospitalId } = await getAuthenticatedHospital()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const policy = await passwordPolicyFor(prisma, hospitalId)
  return NextResponse.json({ rules: describePolicy(policy) })
}

export async function POST(req: NextRequest) {
  const { error, user, hospitalId } = await getAuthenticatedHospital()
  if (error || !user || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const { currentPassword, newPassword } = parsed.data

    const account = await prisma.user.findFirst({
      where: { id: user.id, hospitalId },
      select: { id: true, password: true },
    })

    if (!account?.password) {
      return NextResponse.json({ error: 'This account has no password set' }, { status: 400 })
    }

    if (!(await bcrypt.compare(currentPassword, account.password))) {
      // Deliberately not audited as a failed login: this is somebody already
      // signed in mistyping a field, which is not the event the trail is for.
      return NextResponse.json({ error: 'That is not your current password' }, { status: 400 })
    }

    const weak = validatePassword(newPassword, await passwordPolicyFor(prisma, hospitalId))
    if (weak) return NextResponse.json({ error: weak }, { status: 400 })

    if (await bcrypt.compare(newPassword, account.password)) {
      // Reusing the same password would satisfy an expiry without changing
      // anything, which makes the expiry theatre.
      return NextResponse.json(
        { error: 'The new password must be different from the old one' },
        { status: 400 }
      )
    }

    await prisma.user.update({
      where: { id: account.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    })

    await recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      newValues: { setBy: 'self' },
      ...requestContext(req.headers),
    })

    /**
     * The session is left standing.
     *
     * Signing the person out here would be the stricter choice, and it would be
     * the wrong one: the token was issued to this person, they have just proved
     * they hold the current password, and the common reason to be on this page
     * is an expiry that has just sent them here. Ending the session would
     * bounce them back to sign-in with a password they set four seconds ago.
     *
     * The token still says `mustChangePassword` at this point — it was issued
     * before this request — so the page calls NextAuth's `update()` on success
     * to clear it. Without that, the middleware would keep redirecting back to
     * this form for the rest of the session. See the `jwt` callback in
     * lib/auth.config.ts.
     */
    return NextResponse.json({ success: true, message: 'Your password has been changed' })
  } catch (err) {
    console.error('Password change failed:', err)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}

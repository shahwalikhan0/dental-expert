import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { PASSWORD_RULES, validatePassword } from '@/lib/password-policy'
import { resetRefusal } from '@/lib/password-reset'

/**
 * POST /api/public/password-reset/confirm — spend a reset link.
 *
 * Unlike the request beside it, this one *does* answer honestly: the caller is
 * holding a token, and telling them a bad token is bad discloses nothing they
 * could not learn by trying it. What it must never do is say which account the
 * token belongs to before the password is set.
 *
 * The same 8-to-32-character rule applies as everywhere a password is set
 * (lib/password-policy.ts).
 *
 * Setting the password clears the token, in the same update and conditioned on
 * the token still being there, so two people who both opened the link cannot
 * both use it.
 */
const schema = z.object({
  token: z.string().min(16),
  password: z.string().min(1, 'Choose a password'),
})

/** GET — is this link usable, and what does the clinic require of a password? */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) {
    return NextResponse.json({ valid: false, error: 'That reset link is not valid.' })
  }

  const account = await prisma.user.findUnique({
    where: { resetToken: token },
    select: {
      resetToken: true,
      resetExpiresAt: true,
      password: true,
      isActive: true,
      hospitalId: true,
      hospital: { select: { name: true } },
    },
  })

  const refusal = resetRefusal(account)
  if (refusal || !account) {
    return NextResponse.json({ valid: false, error: refusal })
  }

  return NextResponse.json({
    valid: true,
    // Named so somebody who works at two clinics can see which account this
    // link is for before they change anything.
    clinicName: account.hospital.name,
    rules: PASSWORD_RULES,
  })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 }
    )
  }

  const { token, password } = parsed.data

  try {
    const account = await prisma.user.findUnique({
      where: { resetToken: token },
      select: {
        id: true,
        hospitalId: true,
        resetToken: true,
        resetExpiresAt: true,
        password: true,
        isActive: true,
      },
    })

    const refusal = resetRefusal(account)
    if (refusal || !account) {
      return NextResponse.json({ error: refusal }, { status: 400 })
    }

    const complaint = validatePassword(password)
    if (complaint) {
      return NextResponse.json({ error: complaint }, { status: 400 })
    }

    // Reusing the password that is already set is not a reset, and it is
    // usually somebody who has remembered it half way through.
    if (account.password && (await bcrypt.compare(password, account.password))) {
      return NextResponse.json(
        { error: 'That is your current password. Choose a different one.' },
        { status: 400 }
      )
    }

    const hashed = await bcrypt.hash(password, 10)

    // `resetToken: token` in the where clause is what makes this safe to run
    // twice: the second attempt matches nothing, because the first cleared it.
    const updated = await prisma.user.updateMany({
      where: { id: account.id, resetToken: token },
      data: {
        password: hashed,
        resetToken: null,
        resetExpiresAt: null,
        passwordChangedAt: new Date(),
        // A reset is a deliberate choice of password, so the "you must change
        // this" flag an administrator may have set is satisfied by it.
        mustChangePassword: false,
      },
    })

    if (updated.count === 0) {
      return NextResponse.json(
        { error: 'That reset link has already been used. Ask for a new one.' },
        { status: 400 }
      )
    }

    void recordAudit({
      hospitalId: account.hospitalId,
      userId: null,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: account.id,
      ...requestContext(request.headers),
    })

    // Deliberately no session. A link that signed you in would be a session
    // handed to whoever can read the mailbox.
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Password reset failed:', err)
    return NextResponse.json({ error: 'That password could not be set' }, { status: 500 })
  }
}

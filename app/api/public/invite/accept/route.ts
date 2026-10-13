import { NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { invitationStatus, isInvitation, inviteeName } from '@/lib/invitations'
import { validatePassword } from '@/lib/password-policy'
import { checkStaffLimit } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { normaliseEmail } from '@/lib/email-address'
import { PHONE_RULE, generateEmployeeId, isValidPhone } from '@/lib/staff'

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  // Checked properly below — 8 to 32 characters, see lib/password-policy.ts.
  password: z.string().min(1, 'A password is required'),
  // The same rule as Add Staff (finding 28): 7 to 15 digits, written however.
  phone: z
    .string()
    .trim()
    .refine((value) => isValidPhone(value), PHONE_RULE),
})

/**
 * Accepting an invitation.
 *
 * The invitation is already the user row — see lib/invitations.ts — so this
 * sets a password on it rather than creating a second account, and adds the
 * `Staff` record that makes the person a member of staff. Because the token is
 * cleared in the same statement that sets the password, two people racing the
 * same link cannot both win: the second finds no invitation.
 */
async function invitationFor(token: string) {
  const row = await prisma.user.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      hospitalId: true,
      email: true,
      name: true,
      role: true,
      password: true,
      inviteToken: true,
      inviteExpiresAt: true,
      hospital: { select: { id: true, name: true, isActive: true } },
    },
  })

  return row && isInvitation(row) ? row : null
}

// Accept an invite and turn it into an account
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = acceptInviteSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { token, password, phone } = validated.data

    const invite = await invitationFor(token)

    if (!invite) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 400 })
    }

    if (invitationStatus(invite) === 'EXPIRED') {
      return NextResponse.json(
        { error: 'This invite has expired. Please ask for a new invite.' },
        { status: 400 }
      )
    }

    if (!invite.hospital.isActive) {
      return NextResponse.json(
        { error: 'This hospital account is no longer active' },
        { status: 400 }
      )
    }

    const weak = validatePassword(password)
    if (weak) return NextResponse.json({ error: weak }, { status: 400 })

    /**
     * The plan's staff limit, again, at the moment the seat is taken.
     *
     * It was checked only when the invitation was sent (finding 63), and an
     * invitation is not an active account — so a Free clinic could send ten
     * while under its limit of three and have all ten accepted. The invitee
     * cannot do anything about the plan, so the message sends them to whoever
     * can, and the invitation stays usable for when there is room.
     */
    const limit = await checkStaffLimit(invite.hospitalId)
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: `${invite.hospital.name} has no free staff accounts on its current plan. Ask the administrator who invited you to upgrade or free one up, then use this link again.`,
          code: 'STAFF_LIMIT',
        },
        { status: 403 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const fullName = inviteeName(invite.name, invite.email)

    // The same series as Add Staff. This used to be the count of staff plus
    // one, which repeats a number as soon as anybody has been removed.
    const employeeId = await generateEmployeeId(prisma, invite.hospitalId)

    /**
     * Claiming the row and adding the staff record, together.
     *
     * Apart, a failure on the second left an active account with no staff
     * record and no token — signed in to nothing, and impossible to invite
     * again. `inviteToken: token` in the where clause is what makes this safe
     * to run twice: whichever request updates the row first clears the token,
     * and the other one's update matches nothing.
     */
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: invite.id, inviteToken: token, password: null },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
          phone,
          name: fullName,
          isActive: true,
          inviteToken: null,
          inviteExpiresAt: null,
        },
      })

      if (updated.count === 0) return false

      await tx.staff.create({
        data: {
          userId: invite.id,
          employeeId,
          firstName: fullName.split(' ')[0],
          lastName: fullName.split(' ').slice(1).join(' ') || '',
          email: normaliseEmail(invite.email),
          phone,
          hospitalId: invite.hospitalId,
        },
      })
      return true
    })

    if (!claimed) {
      return NextResponse.json(
        { error: 'This invite has already been used or cancelled' },
        { status: 400 }
      )
    }

    // Nobody at the clinic is signed in here; the new member of staff is the
    // one acting, and the entry is attributed to them.
    await recordAudit({
      hospitalId: invite.hospitalId,
      userId: invite.id,
      action: AUDIT_ACTIONS.STAFF_CREATED,
      entityType: 'User',
      entityId: invite.id,
      newValues: {
        employeeId,
        name: fullName,
        email: invite.email,
        role: invite.role,
        via: 'invitation',
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({
      success: true,
      message: 'Account created successfully. You can now log in.',
      hospitalName: invite.hospital.name,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Accept invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

// GET endpoint to validate token and get invite details
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const invite = await invitationFor(token)

    if (!invite) {
      return NextResponse.json({ valid: false, error: 'Invalid invite token' }, { status: 400 })
    }

    if (invitationStatus(invite) === 'EXPIRED') {
      return NextResponse.json({ valid: false, error: 'This invite has expired' }, { status: 400 })
    }

    if (!invite.hospital.isActive) {
      return NextResponse.json(
        { valid: false, error: 'This hospital account is no longer active' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      valid: true,
      invite: {
        email: invite.email,
        name: invite.name,
        role: invite.role,
        hospitalName: invite.hospital.name,
        expiresAt: invite.inviteExpiresAt,
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Validate invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

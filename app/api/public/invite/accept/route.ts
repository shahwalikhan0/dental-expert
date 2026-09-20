import { NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { invitationStatus, isInvitation, inviteeName } from '@/lib/invitations'
import { validatePassword } from '@/lib/password-policy'
import { passwordPolicyFor } from '@/lib/security-settings'

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  // Checked against the inviting clinic's own policy below, once the token
  // has told us which clinic that is.
  password: z.string().min(1, 'A password is required'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits'),
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

    const weak = validatePassword(password, await passwordPolicyFor(prisma, invite.hospitalId))
    if (weak) return NextResponse.json({ error: weak }, { status: 400 })

    const hashedPassword = await bcrypt.hash(password, 10)
    const fullName = inviteeName(invite.name, invite.email)

    const staffCount = await prisma.staff.count({
      where: { hospitalId: invite.hospitalId },
    })
    const employeeId = `EMP${String(staffCount + 1).padStart(3, '0')}`

    // `inviteToken: token` in the where clause is what makes this safe to run
    // twice: whichever request updates the row first clears the token, and the
    // other one's update matches nothing.
    const claimed = await prisma.user.updateMany({
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

    if (claimed.count === 0) {
      return NextResponse.json(
        { error: 'This invite has already been used or cancelled' },
        { status: 400 }
      )
    }

    await prisma.staff.create({
      data: {
        userId: invite.id,
        employeeId,
        firstName: fullName.split(' ')[0],
        lastName: fullName.split(' ').slice(1).join(' ') || '',
        email: invite.email,
        phone,
        hospitalId: invite.hospitalId,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Account created successfully. You can now log in.',
      hospitalName: invite.hospital.name,
    })
  } catch (error) {
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
    console.error('Validate invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkStaffLimit, generateToken, requirePermission } from '@/lib/api-helpers'
import { Role } from '@prisma/client'
import { sendInviteEmail } from '@/lib/email-helpers'
import { INVITABLE_ROLES } from '@/lib/rbac'
import { INVITATION_FILTER, invitationStatus, inviteExpiry, isInvitation } from '@/lib/invitations'

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(INVITABLE_ROLES),
})

// Create a new staff invite
export async function POST(request: Request) {
  const { error, user, hospitalId } = await requirePermission('staff:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validated = inviteSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { email, name, role } = validated.data

    // Check staff limit
    const staffLimit = await checkStaffLimit(hospitalId)
    if (!staffLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Staff limit reached',
          message: `Your plan allows up to ${staffLimit.max} staff members. Please upgrade to add more.`,
          current: staffLimit.current,
          max: staffLimit.max,
        },
        { status: 403 }
      )
    }

    // An invitation and an account are the same row, so one lookup answers
    // both "is this person already here" and "have we already invited them" —
    // and the unique index on (hospitalId, email) means the answer cannot go
    // stale between the check and the write.
    const existing = await prisma.user.findUnique({
      where: { hospitalId_email: { hospitalId, email } },
      select: { id: true, password: true, inviteToken: true, inviteExpiresAt: true },
    })

    const token = generateToken(32)
    const expiresAt = inviteExpiry()

    if (existing) {
      if (!isInvitation(existing)) {
        return NextResponse.json(
          { error: 'A user with this email already exists in your hospital' },
          { status: 409 }
        )
      }
      // An invitation that has lapsed is re-sent rather than refused: the
      // clinic is asking for exactly what the expired one was for, and making
      // them cancel it first is a step with no decision in it.
      if (invitationStatus(existing) === 'PENDING') {
        return NextResponse.json(
          { error: 'An invite has already been sent to this email' },
          { status: 409 }
        )
      }
    }

    const invite = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { name, role: role as Role, inviteToken: token, inviteExpiresAt: expiresAt },
        })
      : await prisma.user.create({
          data: {
            email,
            name,
            role: role as Role,
            inviteToken: token,
            inviteExpiresAt: expiresAt,
            hospitalId,
            invitedById: user!.id,
            // Not an account until somebody sets a password with that token.
            password: null,
            isActive: false,
          },
        })

    // Get hospital name for the email
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    })

    // Send invite email (non-blocking — logs error if SMTP not configured)
    const emailSent = await sendInviteEmail({
      hospitalId,
      to: email,
      inviteeName: name,
      hospitalName: hospital?.name || 'Your Dental Clinic',
      role,
      inviterName: user!.name || 'Admin',
      token,
    })

    return NextResponse.json({
      success: true,
      message: emailSent
        ? `Invitation sent to ${email}`
        : `Invite created for ${email} (email delivery pending — check SMTP settings)`,
      invite: {
        id: invite.id,
        email: invite.email,
        name: invite.name,
        role: invite.role,
        expiresAt: invite.inviteExpiresAt,
      },
      emailSent,
      // Development-only: show direct link for testing
      ...(process.env.NODE_ENV === 'development' && {
        inviteLink: `/invite/accept?token=${token}`,
      }),
    })
  } catch (error) {
    console.error('Create invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

// List all invites for the hospital
export async function GET() {
  const { error, hospitalId } = await requirePermission('staff:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const rows = await prisma.user.findMany({
      where: { hospitalId, ...INVITATION_FILTER },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
        inviteToken: true,
        inviteExpiresAt: true,
        createdAt: true,
        invitedById: true,
      },
    })

    // Only outstanding invitations: once accepted, the row is a member of
    // staff and belongs on the staff screen rather than on this one. The
    // status is worked out here rather than stored — a column nothing updates
    // until somebody clicks the link showed a lapsed invitation as pending for
    // as long as it sat there.
    const invites = rows.map(({ password, inviteToken, ...row }) => ({
      ...row,
      status: invitationStatus({ password, inviteToken, inviteExpiresAt: row.inviteExpiresAt }),
      expiresAt: row.inviteExpiresAt,
      invitedBy: row.invitedById,
    }))

    return NextResponse.json({ invites })
  } catch (error) {
    console.error('List invites error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { sendInviteEmail } from '@/lib/email-helpers'
import { invitationStatus, inviteeName, inviteExpiry, isInvitation } from '@/lib/invitations'
import { knownErrorResponse } from '@/lib/api-errors'

/**
 * An invitation is a `User` row with no password — see lib/invitations.ts. Both
 * handlers here load one by id and refuse anything that turns out to be a real
 * account, so neither can be pointed at a colleague's login.
 */
async function loadInvitation(id: string, hospitalId: string) {
  const row = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      hospitalId: true,
      email: true,
      name: true,
      role: true,
      password: true,
      inviteToken: true,
      inviteExpiresAt: true,
      invitedById: true,
    },
  })

  if (!row || row.hospitalId !== hospitalId || !isInvitation(row)) return null
  return row
}

// Cancel/revoke an invite
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('staff:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const invite = await loadInvitation(id, hospitalId)

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // The row is deleted rather than marked cancelled. An invitation nobody
    // accepted holds nothing but the address it was sent to, and leaving it
    // behind would keep that address from ever being invited again.
    await prisma.user.delete({ where: { id } })

    return NextResponse.json({
      success: true,
      message: 'Invite cancelled successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Cancel invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

// Resend an invite
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('staff:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const invite = await loadInvitation(id, hospitalId)

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // Resending an expired invitation is the point of the button, so unlike
    // the old version this does not refuse one that has lapsed.
    const expiresAt = inviteExpiry()
    await prisma.user.update({ where: { id }, data: { inviteExpiresAt: expiresAt } })

    const [hospital, inviter] = await Promise.all([
      prisma.hospital.findUnique({ where: { id: hospitalId }, select: { name: true } }),
      invite.invitedById
        ? prisma.user.findUnique({ where: { id: invite.invitedById }, select: { name: true } })
        : null,
    ])

    // Resend invite email (non-blocking)
    const emailSent = await sendInviteEmail({
      hospitalId,
      to: invite.email,
      inviteeName: inviteeName(invite.name, invite.email),
      hospitalName: hospital?.name || 'Your Dental Clinic',
      role: invite.role,
      inviterName: inviter?.name || 'Admin',
      token: invite.inviteToken!,
    })

    return NextResponse.json({
      success: true,
      message: emailSent
        ? `Invite resent to ${invite.email}`
        : `Invite renewed for ${invite.email} (email delivery pending)`,
      expiresAt,
      status: invitationStatus({ ...invite, inviteExpiresAt: expiresAt }),
      emailSent,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Resend invite error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

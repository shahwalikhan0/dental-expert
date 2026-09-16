/**
 * Accepting an invitation.
 *
 * An invitation is a `User` row with no password — see lib/invitations.ts. This
 * endpoint sets the password on that row and adds the `Staff` record; it does
 * not create a second account, because there was never a second table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@prisma/client', () => ({
  Role: { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR', RECEPTIONIST: 'RECEPTIONIST', STAFF: 'STAFF' },
}))
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
}))

const mod = await import('@/app/api/public/invite/accept/route')

function makePostRequest(body: any) {
  return new Request('http://localhost/api/public/invite/accept', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any
}

function makeGetRequest(token?: string) {
  const url = new URL('http://localhost/api/public/invite/accept')
  if (token) url.searchParams.set('token', token)
  return new Request(url.toString()) as any
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    email: 'jane@example.com',
    name: 'Jane Smith',
    role: 'DOCTOR',
    password: null,
    inviteToken: 'valid-token-123',
    inviteExpiresAt: new Date(Date.now() + 86400000), // +1 day
    hospitalId: 'hospital-1',
    hospital: { id: 'hospital-1', name: 'Test Clinic', isActive: true },
    ...overrides,
  }
}

const accept = () =>
  mod.POST(
    makePostRequest({
      token: 'valid-token-123',
      password: 'SecurePass123!',
      phone: '9876543210',
    })
  )

describe('POST /api/public/invite/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.staff.count as any).mockResolvedValue(5)
    ;(prisma.user.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.staff.create as any).mockResolvedValue({ id: 'staff-new' })
  })

  it('sets the password on the invited row and makes them staff', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation())

    const res = await accept()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.hospitalName).toBe('Test Clinic')

    // The same row, not a new one.
    expect(prisma.user.create).not.toHaveBeenCalled()
    const update = (prisma.user.updateMany as any).mock.calls[0][0]
    expect(update.where).toMatchObject({ id: 'invite-1', inviteToken: 'valid-token-123' })
    expect(update.data).toMatchObject({
      password: 'hashed-password',
      isActive: true,
      // Cleared, so the link cannot be used twice and the row stops being an
      // invitation the moment it becomes an account.
      inviteToken: null,
      inviteExpiresAt: null,
    })

    expect((prisma.staff.create as any).mock.calls[0][0].data).toMatchObject({
      userId: 'invite-1',
      hospitalId: 'hospital-1',
      firstName: 'Jane',
      lastName: 'Smith',
    })
  })

  it('returns 400 for Zod validation failure', async () => {
    const res = await mod.POST(makePostRequest({ token: '', password: 'short', phone: '123' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Validation failed')
  })

  it('returns 400 for invalid token', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null)

    const res = await mod.POST(
      makePostRequest({ token: 'invalid-token', password: 'SecurePass123!', phone: '9876543210' })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid invite token')
  })

  // A row whose token matches but which already has a password is somebody's
  // account, and this endpoint must never set a password on one.
  it('refuses a row that is already an account', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation({ password: 'already-set' }))

    const res = await accept()
    expect(res.status).toBe(400)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  // Two people opening the same emailed link at once. Whoever updates first
  // clears the token, so the second one's update matches nothing.
  it('returns 400 when somebody else claimed the invitation first', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation())
    ;(prisma.user.updateMany as any).mockResolvedValue({ count: 0 })

    const res = await accept()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('already been used')
    expect(prisma.staff.create).not.toHaveBeenCalled()
  })

  it('returns 400 when the invitation has expired', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(
      invitation({ inviteExpiresAt: new Date(Date.now() - 86400000) })
    )

    const res = await accept()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('expired')
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('returns 400 when hospital is inactive', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(
      invitation({ hospital: { id: 'hospital-1', name: 'Test Clinic', isActive: false } })
    )

    const res = await accept()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('no longer active')
  })

  it('falls back to the address when no name was given', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation({ name: null }))

    await accept()
    expect((prisma.staff.create as any).mock.calls[0][0].data).toMatchObject({
      firstName: 'jane',
      lastName: '',
    })
  })
})

describe('GET /api/public/invite/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates a valid token and returns invite details', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation())

    const res = await mod.GET(makeGetRequest('valid-token-123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(true)
    expect(body.invite.email).toBe('jane@example.com')
    expect(body.invite.hospitalName).toBe('Test Clinic')
  })

  it('returns 400 when token query param missing', async () => {
    const res = await mod.GET(makeGetRequest())
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid token', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null)

    const res = await mod.GET(makeGetRequest('bad-token'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.valid).toBe(false)
  })

  it('returns 400 for a row that is already an account', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(invitation({ password: 'already-set' }))

    const res = await mod.GET(makeGetRequest('valid-token-123'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.valid).toBe(false)
  })

  it('returns 400 for expired invite', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(
      invitation({ inviteExpiresAt: new Date(Date.now() - 86400000) })
    )

    const res = await mod.GET(makeGetRequest('valid-token-123'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.valid).toBe(false)
    expect(body.error).toContain('expired')
  })

  it('returns 400 when hospital inactive', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(
      invitation({ hospital: { id: 'hospital-1', name: 'Test Clinic', isActive: false } })
    )

    const res = await mod.GET(makeGetRequest('valid-token-123'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.valid).toBe(false)
    expect(body.error).toContain('no longer active')
  })
})

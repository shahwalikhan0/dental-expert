// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = {
    requireAuthAndRole: vi.fn(),
  }
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
    // Fixtures shallow-spread their overrides, so a test that sets
    // `session.user.role` leaves the default `user.role` behind (and vice
    // versa). Reading just one of them would silently use the stale default,
    // so require the capability for every role the fixture names.
    const roles = [res.user?.role, res.session?.user?.role].filter(Boolean)
    if (roles.length === 0) return res
    if (!roles.every((r: string) => perms.every((p) => can(r, p)))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { GET as profileGET, PATCH as profilePATCH } from '@/app/api/settings/profile/route'
import { getLocaleForRequest } from '@/lib/i18n/request'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, method = 'GET', body?: unknown): NextRequest {
  const init: Record<string, unknown> = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(`http://localhost${path}`, init)
}

const STAFF = { id: 'user-1', role: 'ADMIN', hospitalId: 'hosp-1' }
const PATIENT = { id: 'patient-1', hospitalId: 'hosp-1' }

function signedInAsStaff() {
  requireAuthAndRole.mockResolvedValue({
    error: null,
    user: STAFF,
    hospitalId: 'hosp-1',
    session: { user: STAFF },
  })
}

function signedInAsPatient() {
  requirePatientAuth.mockResolvedValue({ error: null, patient: PATIENT })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/settings/profile
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/settings/profile', () => {
  it('rejects an unauthenticated caller', async () => {
    requireAuthAndRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      hospitalId: null,
      session: null,
    })

    const res = await profilePATCH(makeReq('/api/settings/profile', 'PATCH', { locale: 'en-US' }))
    expect(res.status).toBe(401)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('stores a supported locale', async () => {
    signedInAsStaff()
    prisma.user.update.mockResolvedValue({
      locale: 'en-US',
      hospital: { locale: 'en-IN' },
    })

    const res = await profilePATCH(makeReq('/api/settings/profile', 'PATCH', { locale: 'en-US' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.locale).toBe('en-US')
    expect(body.data.effectiveLocale).toBe('en-US')
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { locale: 'en-US' },
      })
    )
  })

  // The write side of "null means inherit". Clearing has to persist NULL, not
  // the clinic's current value, or the user stops following the clinic.
  it('writes null when the override is cleared', async () => {
    signedInAsStaff()
    prisma.user.update.mockResolvedValue({ locale: null, hospital: { locale: 'en-US' } })

    const res = await profilePATCH(makeReq('/api/settings/profile', 'PATCH', { locale: null }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locale: null } })
    )
    expect(body.data.locale).toBeNull()
    // Still resolves to something usable — the clinic's locale.
    expect(body.data.effectiveLocale).toBe('en-US')
  })

  it('treats an empty string the same as clearing', async () => {
    signedInAsStaff()
    prisma.user.update.mockResolvedValue({ locale: null, hospital: { locale: 'en-IN' } })

    const res = await profilePATCH(makeReq('/api/settings/profile', 'PATCH', { locale: '' }))

    expect(res.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locale: null } })
    )
  })

  // The cascade tolerates junk in the column; the write boundary should not
  // put it there in the first place.
  it('rejects an unsupported locale with 400 rather than storing it', async () => {
    signedInAsStaff()

    const res = await profilePATCH(makeReq('/api/settings/profile', 'PATCH', { locale: 'de-DE' }))

    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects a malformed body with 400 rather than 500', async () => {
    signedInAsStaff()

    const req = new NextRequest('http://localhost/api/settings/profile', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await profilePATCH(req)

    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  // A user id in the body must be ignored — this endpoint is not an admin tool.
  it('always writes the session user, never an id from the body', async () => {
    signedInAsStaff()
    prisma.user.update.mockResolvedValue({ locale: 'en-US', hospital: { locale: 'en-IN' } })

    await profilePATCH(
      makeReq('/api/settings/profile', 'PATCH', { locale: 'en-US', id: 'someone-else' })
    )

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    )
  })
})

describe('GET /api/settings/profile', () => {
  it('returns the raw override alongside the resolved locale', async () => {
    signedInAsStaff()
    prisma.user.findUnique.mockResolvedValue({
      name: 'Asha',
      email: 'asha@example.com',
      locale: null,
      hospital: { locale: 'en-US' },
    })

    const res = await profileGET()
    const body = await res.json()

    expect(res.status).toBe(200)
    // null, not 'en-US' — the UI has to be able to show "use clinic default"
    // as selected rather than pinning the clinic's current value.
    expect(body.data.locale).toBeNull()
    expect(body.data.hospitalLocale).toBe('en-US')
    expect(body.data.effectiveLocale).toBe('en-US')
    expect(body.data.supportedLocales).toContain('en-PK')
  })

  it('returns 404 when the session user no longer exists', async () => {
    signedInAsStaff()
    prisma.user.findUnique.mockResolvedValue(null)

    const res = await profileGET()
    expect(res.status).toBe(404)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// /api/patient-portal/profile
// ═════════════════════════════════════════════════════════════════════════════

describe('getLocaleForRequest', () => {
  it('prefers the staff override over the clinic', async () => {
    auth.mockResolvedValue({ user: STAFF })
    prisma.user.findUnique.mockResolvedValue({
      locale: 'en-US',
      hospital: { locale: 'en-IN' },
    })

    expect(await getLocaleForRequest()).toBe('en-US')
  })

  it('inherits the clinic when the staff override is null', async () => {
    auth.mockResolvedValue({ user: STAFF })
    prisma.user.findUnique.mockResolvedValue({
      locale: null,
      hospital: { locale: 'en-US' },
    })

    expect(await getLocaleForRequest()).toBe('en-US')
  })

  // The reason the clinic is joined rather than fetched separately: this runs
  // on every server-rendered request.
  it('reads the user and the clinic in a single query', async () => {
    auth.mockResolvedValue({ user: STAFF })
    prisma.user.findUnique.mockResolvedValue({
      locale: null,
      hospital: { locale: 'en-IN' },
    })

    await getLocaleForRequest()

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(prisma.hospital.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { locale: true, hospital: { select: { locale: true } } },
    })
  })

  it('returns the default for an anonymous request', async () => {
    auth.mockResolvedValue(null)

    expect(await getLocaleForRequest()).toBe('en-PK')
  })

  // Load-bearing: a formatting concern must never take a page down.
  it('returns the default rather than throwing when the database is down', async () => {
    auth.mockResolvedValue({ user: STAFF })
    prisma.user.findUnique.mockRejectedValue(new Error("Can't reach database server"))

    await expect(getLocaleForRequest()).resolves.toBe('en-PK')
  })

  it('returns the default rather than throwing when auth() fails', async () => {
    auth.mockRejectedValue(new Error('JWT decryption failed'))

    await expect(getLocaleForRequest()).resolves.toBe('en-PK')
  })

  it('falls through an unsupported stored override to the clinic', async () => {
    auth.mockResolvedValue({ user: STAFF })
    prisma.user.findUnique.mockResolvedValue({
      locale: 'de-DE',
      hospital: { locale: 'en-US' },
    })

    expect(await getLocaleForRequest()).toBe('en-US')
  })
})

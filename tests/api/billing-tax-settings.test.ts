/**
 * GET /api/billing/tax-settings
 *
 * The invoice form previews the tax the server is about to charge. If this
 * endpoint and `POST /api/invoices` ever disagree, the figure on screen is not
 * the figure on the invoice — which is the specific failure this endpoint
 * exists to prevent, so the tests below are mostly about them agreeing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
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

import { GET } from '@/app/api/billing/tax-settings/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: 'u1', role },
  } as any)
}

describe('GET /api/billing/tax-settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports no tax for an exempt clinic', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      taxEnabled: false,
      taxRate: 0,
      taxLabel: 'Sales Tax',
    } as any)

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      enabled: false,
      rate: 0,
      label: 'Sales Tax',
      // No setting stored, so the default threshold.
      discountApprovalThreshold: 1000,
    })
  })

  it('reports the configured rate once tax is switched on', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      taxEnabled: true,
      taxRate: 16,
      taxLabel: 'PRA Sales Tax',
    } as any)

    await expect((await GET()).json()).resolves.toEqual({
      enabled: true,
      rate: 16,
      label: 'PRA Sales Tax',
      discountApprovalThreshold: 1000,
    })
  })

  // A rate left behind from a previous configuration must not keep being
  // charged after the switch is turned off.
  it('reports no tax when disabled even if a rate is still stored', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      taxEnabled: false,
      taxRate: 16,
      taxLabel: 'PRA Sales Tax',
    } as any)

    await expect((await GET()).json()).resolves.toMatchObject({ enabled: false, rate: 0 })
  })

  // Reception raises invoices but cannot open clinic settings, so gating this
  // on settings:read would leave them previewing a figure they cannot see.
  it('is available to reception, who raise invoices', async () => {
    signedInAs('RECEPTIONIST')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      taxEnabled: false,
      taxRate: 0,
      taxLabel: 'Sales Tax',
    } as any)

    expect((await GET()).status).toBe(200)
  })

  it('is refused to a role with no billing access', async () => {
    signedInAs('INVENTORY_STAFF')
    expect((await GET()).status).toBe(403)
    expect(prisma.hospital.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to a sane label when the clinic has none', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      taxEnabled: false,
      taxRate: 0,
      taxLabel: '',
    } as any)

    await expect((await GET()).json()).resolves.toMatchObject({ label: 'Sales Tax' })
  })

  it('does not leak the error when the database fails', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.hospital.findUnique).mockRejectedValue(new Error('dsn: secret'))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

/**
 * GET /api/public/[slug] — the clinic identity behind the login page's
 * optional `?clinic=` branding.
 *
 * This is unauthenticated, so what it does *not* return matters more than what
 * it does. The tests below are mostly about that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { GET } from '@/app/api/public/[slug]/route'
import { prisma } from '@/lib/prisma'

const params = (slug: string) => ({ params: Promise.resolve({ slug }) })
const req = () => new Request('http://localhost/api/public/smile-dental')

describe('GET /api/public/[slug]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the clinic name and logo', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      name: 'Smile Dental',
      logo: 'https://cdn.example/logo.png',
      isActive: true,
    } as any)

    const res = await GET(req(), params('smile-dental'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      name: 'Smile Dental',
      logo: 'https://cdn.example/logo.png',
    })
  })

  // The whole point of the endpoint is that it is narrow. If someone later
  // widens the select to `true` or adds a field, this fails.
  it('returns nothing except name and logo', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      name: 'Smile Dental',
      logo: null,
      isActive: true,
    } as any)

    const res = await GET(req(), params('smile-dental'))
    expect(Object.keys(await res.json()).sort()).toEqual(['logo', 'name'])
  })

  it('only ever selects the three fields it needs', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      name: 'X',
      logo: null,
      isActive: true,
    } as any)

    await GET(req(), params('x'))
    expect(prisma.hospital.findUnique).toHaveBeenCalledWith({
      where: { slug: 'x' },
      select: { name: true, logo: true, isActive: true },
    })
  })

  it('404s for an unknown slug', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue(null)
    const res = await GET(req(), params('nope'))
    expect(res.status).toBe(404)
  })

  // Same response for "no such clinic" and "deactivated clinic" — otherwise
  // the difference confirms which slugs exist.
  it('404s for a deactivated clinic, indistinguishably', async () => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({
      name: 'Closed Clinic',
      logo: null,
      isActive: false,
    } as any)

    const res = await GET(req(), params('closed-clinic'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'Not found' })
    expect(JSON.stringify(body)).not.toContain('Closed Clinic')
  })

  it('does not leak the error when the database fails', async () => {
    vi.mocked(prisma.hospital.findUnique).mockRejectedValue(new Error('connection string: secret'))
    const res = await GET(req(), params('x'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

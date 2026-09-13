import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/public/[slug] — a clinic's display identity, by slug.
 *
 * Backs the optional `?clinic=` parameter on the login page, so staff see the
 * name and logo of the clinic they are signing in to. It is **cosmetic only**:
 * the session is resolved from the email address, and nothing about
 * authentication or tenancy depends on this response. A wrong or missing slug
 * just renders the default login form.
 *
 * Two deliberate limits on what this exposes:
 *
 *   - It is a *lookup*, not a search. You must already know the slug, which is
 *     public anyway — it is in the patient booking URL. There is no endpoint
 *     that lists clinics, and there should not be: that would let anyone
 *     enumerate every practice on the system.
 *   - It returns name and logo and nothing else. No email, no phone, no
 *     address, no plan, no counts. Everything else needs a session.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    const hospital = await prisma.hospital.findUnique({
      where: { slug },
      select: { name: true, logo: true, isActive: true },
    })

    // Same 404 for "no such clinic" and "deactivated clinic". Distinguishing
    // them would confirm which slugs exist, which is the one thing this
    // endpoint should not help with.
    if (!hospital || !hospital.isActive) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ name: hospital.name, logo: hospital.logo })
  } catch (error) {
    console.error('Public clinic lookup failed:', error)
    return NextResponse.json({ error: 'Failed to load clinic' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { SignJWT } from 'jose'
import { requestContext } from '@/lib/audit'
import { resolveLogin } from '@/lib/login'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Which clinic, for a person who holds an account at more than one. */
  clinic: z.string().optional(),
})

/**
 * Sign-in for native clients, returning a bearer token instead of a cookie.
 *
 * The identity check itself is `resolveLogin`, the same one the web sign-in
 * uses. It used to be a second, hand-written copy of that logic — which had
 * quietly drifted: it wrote no audit entry at all, so specification §10's
 * record of who signed in had a hole in it exactly the width of the mobile app.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validated = loginSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ error: 'Invalid email or password format' }, { status: 400 })
    }

    const { email, password, clinic } = validated.data

    const outcome = await resolveLogin({
      email,
      password,
      clinicSlug: clinic || null,
      context: requestContext(req.headers),
    })

    if (outcome.status === 'clinic_inactive') {
      return NextResponse.json({ error: 'Your clinic account is inactive' }, { status: 401 })
    }

    // A native client cannot show a clinic picker it was never told about, so
    // the choices are returned and it is left to ask.
    if (outcome.status === 'ambiguous') {
      return NextResponse.json(
        {
          error: 'Choose which clinic to sign in to',
          code: 'CLINIC_REQUIRED',
          clinics: outcome.clinics,
        },
        { status: 409 }
      )
    }

    if (outcome.status !== 'ok') {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const { identity } = outcome
    const hospital = await prisma.hospital.findUnique({
      where: { id: identity.hospitalId },
      select: { name: true },
    })

    // Signed with jose directly rather than NextAuth's encode(), which salts
    // the payload against a cookie name the app never sends.
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
    const token = await new SignJWT({
      sub: identity.id,
      email: identity.email,
      name: identity.name,
      role: identity.role,
      clinicalRole: identity.clinicalRole,
      staffId: identity.staffId,
      hospitalId: identity.hospitalId,
      isHospitalAdmin: identity.isHospitalAdmin,
      isPlatformAdmin: identity.isPlatformAdmin,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(secret)

    return NextResponse.json({
      token,
      user: {
        id: identity.id,
        email: identity.email,
        name: identity.name,
        role: identity.role,
        clinicalRole: identity.clinicalRole,
        hospitalId: identity.hospitalId,
        hospitalName: hospital?.name ?? null,
        staffId: identity.staffId,
        image: identity.image,
      },
    })
  } catch (error) {
    console.error('Mobile auth error:', error)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

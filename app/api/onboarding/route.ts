import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'

const onboardingSchema = z.object({
  // Step 1: Clinic Details
  tagline: z.string().optional(),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(5, 'Valid postalCode is required'),
  alternatePhone: z.string().optional(),
  website: z.string().optional(),

  // Step 2: Business Details
  taxRegistrationNo: z.string().optional(),
  registrationNo: z.string().optional(),

  // Step 3: Working Hours
  workingHours: z.string().optional(), // JSON string

  // Step 4: Payment Details
  mobileWalletId: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIban: z.string().optional(),
  bankAccountName: z.string().optional(),
})

export async function POST(request: Request) {
  const { error, user, hospitalId } = await requireAuthAndRole(['ADMIN'])

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only hospital admin can complete onboarding
  if (!user?.isHospitalAdmin) {
    return NextResponse.json(
      { error: 'Only the hospital admin can complete onboarding' },
      { status: 403 }
    )
  }

  try {
    const body = await request.json()
    const validated = onboardingSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const data = validated.data

    // Update hospital with onboarding data
    const hospital = await prisma.hospital.update({
      where: { id: hospitalId },
      data: {
        tagline: data.tagline,
        address: data.address,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        alternatePhone: data.alternatePhone,
        website: data.website,
        taxRegistrationNo: data.taxRegistrationNo,
        registrationNo: data.registrationNo,
        workingHours: data.workingHours,
        mobileWalletId: data.mobileWalletId,
        bankName: data.bankName,
        bankAccountNo: data.bankAccountNo,
        bankIban: data.bankIban,
        bankAccountName: data.bankAccountName,
        onboardingCompleted: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Onboarding completed successfully',
      hospital: {
        id: hospital.id,
        name: hospital.name,
        slug: hospital.slug,
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Onboarding error:', error)
    return NextResponse.json(
      { error: 'An error occurred during onboarding. Please try again.' },
      { status: 500 }
    )
  }
}

// GET current onboarding status
export async function GET() {
  const { error, hospitalId, user } = await requireAuthAndRole()

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        tagline: true,
        address: true,
        city: true,
        state: true,
        postalCode: true,
        alternatePhone: true,
        website: true,
        taxRegistrationNo: true,
        registrationNo: true,
        workingHours: true,
        mobileWalletId: true,
        bankName: true,
        bankAccountNo: true,
        bankIban: true,
        bankAccountName: true,
        onboardingCompleted: true,
        subscription: { select: { plan: true, status: true, trialEndsAt: true } },
      },
    })

    if (!hospital) {
      return NextResponse.json({ error: 'Hospital not found' }, { status: 404 })
    }

    // Whether this person can finish setup. Every member of a clinic that has
    // not finished it is sent to /onboarding, and only the clinic's own
    // administrator can complete it (POST above) — so the page tells everybody
    // else to wait rather than offer them a form that will refuse them.
    return NextResponse.json({
      ...hospital,
      canComplete: user?.role === 'ADMIN' && !!user?.isHospitalAdmin,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Get onboarding status error:', error)
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 })
  }
}

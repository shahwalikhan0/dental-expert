import { NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generateUniqueSlug, generateToken } from '@/lib/api-helpers'
import { initialSubscription } from '@/lib/tenant'
import { Role } from '@prisma/client'
import { sendVerificationEmail } from '@/lib/email-helpers'

const signupSchema = z.object({
  hospitalName: z.string().min(2, 'Hospital name must be at least 2 characters'),
  adminName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = signupSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const { hospitalName, adminName, email, phone, password } = validated.data

    // A clinic signing up must not collide with an existing *clinic*. The
    // address is checked against Hospital, not User: a person may hold a staff
    // account at one practice and register their own practice later, and the
    // old global-unique check on User.email refused the second with a message
    // about an account they could not see.
    const existingClinic = await prisma.hospital.findUnique({
      where: { email },
    })

    if (existingClinic) {
      return NextResponse.json(
        { error: 'A clinic is already registered with this email address' },
        { status: 409 }
      )
    }

    // Generate unique slug for the hospital
    const slug = await generateUniqueSlug(hospitalName)

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Generate email verification token
    const verificationToken = generateToken(32)
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Create hospital and admin user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the clinic, its owner, and the subscription, or none of them.
      const hospital = await tx.hospital.create({
        data: {
          name: hospitalName,
          slug,
          email,
          phone,
          isActive: true,
          onboardingCompleted: false,
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
          // Every tenant gets a subscription row from the moment it exists, so
          // that "what is this clinic entitled to" never has to be guessed.
          subscription: { create: initialSubscription('FREE') },
        },
      })

      // Create the admin user
      const user = await tx.user.create({
        data: {
          email,
          name: adminName,
          password: hashedPassword,
          phone,
          role: Role.ADMIN,
          isActive: true,
          isHospitalAdmin: true,
          hospitalId: hospital.id,
          staff: {
            create: {
              employeeId: 'EMP001',
              firstName: adminName.split(' ')[0],
              lastName: adminName.split(' ').slice(1).join(' ') || '',
              email,
              phone,
              hospitalId: hospital.id,
            },
          },
        },
      })

      return { hospital, user }
    })

    // Send verification email (non-blocking — logs error if SMTP not configured)
    const emailSent = await sendVerificationEmail({
      to: email,
      userName: adminName,
      hospitalName,
      token: verificationToken,
    })

    return NextResponse.json({
      success: true,
      message: emailSent
        ? 'Account created successfully. Please check your email to verify your account.'
        : 'Account created successfully. Email verification pending — please configure SMTP settings.',
      hospitalId: result.hospital.id,
      emailSent,
      // Development-only: show token for testing
      ...(process.env.NODE_ENV === 'development' && { verificationToken }),
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'An error occurred during signup. Please try again.' },
      { status: 500 }
    )
  }
}

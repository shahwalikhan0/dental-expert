import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import {
  findDuplicates,
  normaliseCnic,
  normaliseName,
  normalisePhone,
  type Enquiry,
} from '@/lib/duplicate-patients'

/**
 * POST /api/patients/duplicates — is this person already registered?
 *
 * Called from the registration form as it is filled in, before anything is
 * saved. It reads; it never writes. The front desk decides.
 *
 * The component that asks this question used to call `/api/ai/clinical`, a
 * route that has never existed in this repository. It 404ed, the component
 * swallowed the error and rendered nothing, so the warning UAT-01 asks for
 * never appeared once — and a second record for the same patient could be
 * created with nothing said.
 */
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('patients:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const enquiry: Enquiry = {
      firstName: String(body.firstName ?? '').trim(),
      lastName: String(body.lastName ?? '').trim(),
      phone: body.phone ?? null,
      email: body.email ?? null,
      cnic: body.cnic ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
    }

    if (!enquiry.firstName || !enquiry.lastName) {
      return NextResponse.json({ duplicates: [] })
    }

    // Narrow in the database to plausible rows, then score those in memory.
    // Fetching every patient to compare names would not survive a clinic with
    // real numbers on file, and scoring is only meaningful against a handful of
    // candidates anyway.
    //
    // Each name part is looked for in both columns. Which half of a name is
    // the family name is not something a registration desk agrees on: the same
    // person is entered as "Sana Malik" one year and "Malik Sana" the next, and
    // matching first-to-first only would miss exactly that.
    const parts = [
      ...normaliseName(enquiry.firstName).split(' '),
      ...normaliseName(enquiry.lastName).split(' '),
    ].filter(Boolean)
    const phoneTail = normalisePhone(enquiry.phone)
    const cnicDigits = normaliseCnic(enquiry.cnic)

    const candidates = await prisma.patient.findMany({
      where: {
        hospitalId,
        isActive: true,
        OR: [
          ...parts.flatMap((part) => [
            { firstName: { contains: part, mode: 'insensitive' as const } },
            { lastName: { contains: part, mode: 'insensitive' as const } },
          ]),
          ...(phoneTail ? [{ phone: { contains: phoneTail } }] : []),
          ...(cnicDigits ? [{ cnic: cnicDigits }] : []),
          ...(enquiry.email
            ? [{ email: { equals: enquiry.email, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: {
        id: true,
        patientId: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        cnic: true,
        dateOfBirth: true,
      },
      take: 50,
    })

    return NextResponse.json({ duplicates: findDuplicates(enquiry, candidates) })
  } catch (err) {
    console.error('Duplicate check failed:', err)
    return NextResponse.json({ error: 'Failed to check for duplicates' }, { status: 500 })
  }
}

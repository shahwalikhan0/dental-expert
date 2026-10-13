import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffLimit, requirePermission } from '@/lib/api-helpers'
import {
  SECONDARY_ROLES,
  holderCan,
  isAssignableSecondaryRole,
  isRole,
  staffChangeRefusal,
} from '@/lib/rbac'
import { parseOptionalCNIC } from '@/lib/cnic'
import bcrypt from 'bcryptjs'
import { validatePassword } from '@/lib/password-policy'
import { knownErrorResponse } from '@/lib/api-errors'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { emailEquals, isValidEmail, normaliseEmail } from '@/lib/email-address'
import { planName } from '@/lib/plans'
import { getTenant } from '@/lib/tenant'
import {
  clinicToday,
  generateEmployeeId,
  parseJoiningDate,
  phoneProblem,
  withoutHrFields,
} from '@/lib/staff'

// GET - List staff members
export async function GET(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('staff:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const role = searchParams.get('role') || ''
    const status = searchParams.get('status') || ''
    const all = searchParams.get('all') === 'true'

    const skip = (page - 1) * limit

    const where: any = { hospitalId }

    if (status === 'active') {
      where.isActive = true
    } else if (status === 'inactive') {
      where.isActive = false
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (role && role !== 'all') {
      where.user = {
        role: role,
      }
    }

    const [staff, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              role: true,
              clinicalRole: true,
              isActive: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: all ? undefined : skip,
        take: all ? undefined : limit,
      }),
      prisma.staff.count({ where }),
    ])

    // CNIC, date of birth, home address and emergency contact are for
    // `staff:hr` — see STAFF_HR_FIELDS in lib/staff-rules.ts. Everybody else
    // reading the directory gets the record without them.
    const seesHr = holderCan(session?.user, 'staff:hr')

    return NextResponse.json({
      staff: seesHr ? staff : staff.map((member) => withoutHrFields(member)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching staff:', error)
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 })
  }
}

// POST - Create new staff member
export async function POST(request: NextRequest) {
  const { error, hospitalId, session } = await requirePermission('staff:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check staff limit
    const limitCheck = await checkStaffLimit(hospitalId)
    if (!limitCheck.allowed) {
      // `upgradeUrl` so the form can link to the plans rather than leave the
      // administrator to find them (finding 53).
      const tenant = await getTenant(hospitalId).catch(() => null)
      return NextResponse.json(
        {
          error: `Staff limit reached. The ${planName(tenant?.plan)} plan allows ${limitCheck.max} active staff accounts, and ${limitCheck.current} are in use. Upgrade to add more, or deactivate somebody who has left.`,
          code: 'STAFF_LIMIT',
          current: limitCheck.current,
          max: limitCheck.max,
          upgradeUrl: '/pricing',
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      firstName,
      lastName,
      email: rawEmail,
      phone,
      role,
      clinicalRole,
      password,
      dateOfBirth,
      gender,
      alternatePhone,
      address,
      city,
      state,
      postalCode,
      cnic,
      nationalTaxNo,
      qualification,
      specialization,
      licenseNumber,
      joiningDate,
      emergencyContact,
      emergencyPhone,
    } = body

    // Validate required fields
    if (!firstName || !lastName || !rawEmail || !phone || !role || !password) {
      return NextResponse.json(
        { error: 'Missing required fields: firstName, lastName, email, phone, role, password' },
        { status: 400 }
      )
    }

    // `not-an-email` and the phone `abc` were both accepted, and the first
    // became somebody's sign-in (finding 28). Lower-cased so the same address
    // typed with a capital is the same person (finding 29).
    if (!isValidEmail(rawEmail)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }
    const email = normaliseEmail(rawEmail)

    const badPhone =
      phoneProblem(phone, 'Phone', { required: true }) ??
      phoneProblem(alternatePhone, 'Alternate phone') ??
      phoneProblem(emergencyPhone, 'Emergency phone')
    if (badPhone) return NextResponse.json({ error: badPhone }, { status: 400 })

    let joinedOn: Date = new Date()
    if (joiningDate) {
      const parsed = parseJoiningDate(joiningDate, await clinicToday(hospitalId))
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      joinedOn = parsed.date
    }

    if (!isRole(role)) {
      return NextResponse.json({ error: 'That is not a role' }, { status: 400 })
    }
    const refusal = staffChangeRefusal(session?.user, { newRole: role })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 })

    // A second role is clinical only, and must differ from the primary one —
    // see SECONDARY_ROLES in lib/rbac.ts for why this is not a general
    // "grant extra permissions" field.
    if (clinicalRole) {
      if (!isAssignableSecondaryRole(clinicalRole)) {
        return NextResponse.json(
          { error: `clinicalRole must be one of: ${SECONDARY_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      if (clinicalRole === role) {
        return NextResponse.json(
          { error: 'clinicalRole must differ from the primary role' },
          { status: 400 }
        )
      }
    }

    // Within this clinic. The same address may hold an account at another
    // clinic on the platform — a locum, or a dentist with sessions at two
    // practices — and that is none of this clinic's business. Matched without
    // regard to case, because rows written before addresses were lower-cased
    // may still carry a capital.
    const existingUser = await prisma.user.findFirst({
      where: { hospitalId, email: emailEquals(email) },
      select: { id: true },
    })

    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const cnicResult = parseOptionalCNIC(cnic)
    if (!cnicResult.ok) {
      return NextResponse.json({ error: cnicResult.error }, { status: 400 })
    }
    const parsedCnic = cnicResult.value

    if (parsedCnic) {
      const holder = await prisma.staff.findFirst({
        where: { hospitalId, cnic: parsedCnic },
        select: { id: true, employeeId: true, firstName: true, lastName: true },
      })
      if (holder) {
        return NextResponse.json(
          {
            error: `That CNIC is already on file for ${holder.firstName} ${holder.lastName} (${holder.employeeId})`,
            existingStaff: holder,
          },
          { status: 409 }
        )
      }
    }

    // The one password rule: 8 to 32 characters (lib/password-policy.ts). This
    // screen used to accept any six characters while signup demanded eight —
    // two answers to one question.
    const weak = validatePassword(password)
    if (weak) return NextResponse.json({ error: weak }, { status: 400 })

    // Generate employee ID
    const employeeId = await generateEmployeeId(prisma, hospitalId)

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user and staff in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user account
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          passwordChangedAt: new Date(),
          name: `${firstName} ${lastName}`,
          phone: phone.trim(),
          role,
          clinicalRole: clinicalRole || null,
          isActive: true,
          hospitalId,
        },
      })

      // Create staff profile
      const staff = await tx.staff.create({
        data: {
          userId: user.id,
          hospitalId,
          employeeId,
          firstName,
          lastName,
          email,
          phone: phone.trim(),
          alternatePhone,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          gender,
          address,
          city,
          state,
          postalCode,
          cnic: parsedCnic,
          nationalTaxNo,
          qualification,
          specialization,
          licenseNumber,
          joiningDate: joinedOn,
          emergencyContact,
          emergencyPhone,
          isActive: true,
        },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              clinicalRole: true,
              isActive: true,
              email: true,
            },
          },
        },
      })

      return staff
    })

    // Who added whom, as what. Never the password — `recordAudit` redacts
    // anything named like one, and it is not passed in the first place.
    await recordAudit({
      hospitalId,
      userId: session?.user?.id,
      action: AUDIT_ACTIONS.STAFF_CREATED,
      entityType: 'Staff',
      entityId: result.id,
      newValues: {
        employeeId: result.employeeId,
        name: `${firstName} ${lastName}`,
        email,
        role,
        clinicalRole: clinicalRole || null,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating staff:', error)
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 })
  }
}

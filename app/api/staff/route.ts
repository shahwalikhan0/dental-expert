import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffLimit, requirePermission } from '@/lib/api-helpers'
import { SECONDARY_ROLES, isAssignableSecondaryRole } from '@/lib/rbac'
import { parseOptionalCNIC } from '@/lib/cnic'
import bcrypt from 'bcryptjs'

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
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { employeeId: { contains: search } },
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

    return NextResponse.json({
      staff,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching staff:', error)
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 })
  }
}

// Helper to generate employee ID
async function generateEmployeeId(hospitalId: string): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2)
  const lastStaff = await prisma.staff.findFirst({
    where: {
      hospitalId,
      employeeId: {
        startsWith: `EMP${year}`,
      },
    },
    orderBy: { employeeId: 'desc' },
  })

  let nextNum = 1
  if (lastStaff) {
    const lastNum = parseInt(lastStaff.employeeId.slice(-4))
    nextNum = lastNum + 1
  }

  return `EMP${year}${nextNum.toString().padStart(4, '0')}`
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
      return NextResponse.json(
        {
          error: `Staff limit reached. Your plan allows ${limitCheck.max} staff members. Current: ${limitCheck.current}.`,
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      firstName,
      lastName,
      email,
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
    if (!firstName || !lastName || !email || !phone || !role || !password) {
      return NextResponse.json(
        { error: 'Missing required fields: firstName, lastName, email, phone, role, password' },
        { status: 400 }
      )
    }

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
    // practices — and that is none of this clinic's business.
    const existingUser = await prisma.user.findUnique({
      where: { hospitalId_email: { hospitalId, email } },
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

    // Generate employee ID
    const employeeId = await generateEmployeeId(hospitalId)

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user and staff in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user account
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name: `${firstName} ${lastName}`,
          phone,
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
          phone,
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
          joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
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

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('Error creating staff:', error)
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextPatientId } from '@/lib/numbering'
import { checkPatientLimit, requirePermission } from '@/lib/api-helpers'
import { parseOptionalCNIC } from '@/lib/cnic'
import { ageInYears } from '@/lib/age'
import { startDefaultRecare } from '@/lib/recare'
import { orderByFrom, sortFromParams, type SortMap } from '@/lib/sorting'
import { mayBeScoped, patientScopeFilter } from '@/lib/patient-scope'
import { readSecuritySettings } from '@/lib/security-settings'

/**
 * The columns the patient list can be sorted by.
 *
 * A name sorts on the family name first, which is how a register is read —
 * sorting on the given name puts every Muhammad together and tells nobody
 * anything.
 */
const PATIENT_SORTS: SortMap = {
  name: (direction) => [{ lastName: direction }, { firstName: direction }],
  patientId: (direction) => ({ patientId: direction }),
  phone: (direction) => ({ phone: direction }),
  dateOfBirth: (direction) => ({ dateOfBirth: direction }),
  createdAt: (direction) => ({ createdAt: direction }),
  city: (direction) => ({ city: direction }),
}

// GET - List patients
export async function GET(request: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('patients:read')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10') || 10))
    const search = searchParams.get('search') || ''
    const all = searchParams.get('all') === 'true'

    const skip = (page - 1) * limit

    const where: any = {
      hospitalId,
      isActive: true,
    }

    if (search) {
      where.OR = [
        { patientId: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ]
    }

    /**
     * "Own patients only", when the clinic has asked for it (§10).
     *
     * ANDed rather than merged into `where.OR`, which the search above already
     * owns — putting both in one OR would widen the search to the whole
     * register instead of narrowing the register to the search.
     *
     * The setting is read only for the roles it could apply to, so the front
     * desk pays nothing for it.
     */
    if (mayBeScoped(user)) {
      const { restrictToOwnPatients } = await readSecuritySettings(prisma, hospitalId)
      const scope = patientScopeFilter(
        {
          userId: user.id,
          staffId: user.staffId,
          role: user.role,
          clinicalRole: user.clinicalRole,
        },
        restrictToOwnPatients
      )
      if (scope) where.AND = [...(where.AND ?? []), scope]
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          gender: true,
          dateOfBirth: true,
          bloodGroup: true,
          city: true,
        },
        orderBy: orderByFrom(sortFromParams(searchParams), PATIENT_SORTS, {
          createdAt: 'desc',
        }) as never,
        skip: all ? undefined : skip,
        take: all ? undefined : limit,
      }),
      prisma.patient.count({ where }),
    ])

    return NextResponse.json({
      // Age is computed, not stored. The column it replaces was written once
      // at registration and never updated.
      patients: patients.map(({ dateOfBirth, ...patient }) => ({
        ...patient,
        age: ageInYears(dateOfBirth),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching patients:', error)
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 })
  }
}

// POST - Create new patient
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('patients:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check patient limit
    const patientLimit = await checkPatientLimit(hospitalId)
    if (!patientLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Patient limit reached',
          message: `Your plan allows up to ${patientLimit.max} patients. Please upgrade to add more.`,
          current: patientLimit.current,
          max: patientLimit.max,
        },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      bloodGroup,
      phone,
      alternatePhone,
      email,
      address,
      city,
      state,
      postalCode,
      cnic,
      occupation,
      referredBy,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      medicalHistory,
    } = body

    // Validate required fields
    if (!firstName || !lastName || !phone) {
      return NextResponse.json(
        { error: 'First name, last name, and phone are required' },
        { status: 400 }
      )
    }

    // Check for duplicate phone within this hospital
    const existingPatient = await prisma.patient.findFirst({
      where: { hospitalId, phone },
    })

    if (existingPatient) {
      return NextResponse.json(
        { error: 'A patient with this phone number already exists' },
        { status: 409 }
      )
    }

    // A CNIC that is wrong is worse than one that is absent: it is what tells
    // two patients of the same name apart. Blank stays acceptable — children
    // hold a B-Form, and plenty of people do not have theirs at the desk.
    const cnicResult = parseOptionalCNIC(cnic)
    if (!cnicResult.ok) {
      return NextResponse.json({ error: cnicResult.error }, { status: 400 })
    }
    const parsedCnic = cnicResult.value

    // FR-002. Checked before writing rather than left to the unique index, so
    // the desk gets the existing patient's name and ID and can open that record
    // instead of being told only that something went wrong.
    if (parsedCnic) {
      const holder = await prisma.patient.findFirst({
        where: { hospitalId, cnic: parsedCnic },
        select: { id: true, patientId: true, firstName: true, lastName: true },
      })
      if (holder) {
        return NextResponse.json(
          {
            error: `That CNIC is already registered to ${holder.firstName} ${holder.lastName} (${holder.patientId})`,
            existingPatient: holder,
          },
          { status: 409 }
        )
      }
    }

    // Generate patient ID for this hospital
    const patientId = await nextPatientId(prisma, hospitalId)

    // Registration and the first recall date are written together.
    //
    // Not one after the other: the patient row would already exist when the
    // recare write failed, so the 500 would tell the front desk that
    // registration had failed when it had in fact succeeded — and they would
    // register the person again.
    const patient = await prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: {
          patientId,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          gender,
          bloodGroup,
          phone,
          alternatePhone,
          email,
          address,
          city,
          state,
          postalCode,
          cnic: parsedCnic,
          occupation,
          referredBy,
          emergencyContactName,
          emergencyContactPhone,
          emergencyContactRelation,
          hospitalId,
          medicalHistory: medicalHistory
            ? {
                create: medicalHistory,
              }
            : undefined,
        },
        include: {
          medicalHistory: true,
        },
      })

      // A newly registered patient joins the recall list straight away, on the
      // clinic's default interval. A practice that has set no default gets
      // nothing — see lib/recare.ts; that is a policy decision, not an
      // oversight.
      await startDefaultRecare(tx, hospitalId, created.id)

      return created
    })

    return NextResponse.json(patient, { status: 201 })
  } catch (error) {
    console.error('Error creating patient:', error)
    return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 })
  }
}

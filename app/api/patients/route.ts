import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nextPatientId } from '@/lib/numbering'
import { checkPatientLimit, requirePermission } from '@/lib/api-helpers'
import { parseOptionalCNIC } from '@/lib/cnic'
import { everyTermMatches, like } from '@/lib/search-terms'
import { ageInYears } from '@/lib/age'
import { startRegistrationRecare } from '@/lib/registration-recall'
import { orderByFrom, sortFromParams, type SortMap } from '@/lib/sorting'
import { mayBeScoped, patientScopeFilter } from '@/lib/patient-scope'
import { readSecuritySettings } from '@/lib/security-settings'
import { isBlankMedicalHistory, medicalHistoryInput } from '@/lib/medical-history'
import { blankToNull, knownErrorResponse } from '@/lib/api-errors'
import { patientContactProblem } from '@/lib/patient-validation'
import { withoutAiSummary } from '@/lib/patient-record'
import { BLOOD_GROUP_LABELS, GENDER_LABELS } from '@/lib/labels'

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

    /**
     * Which part of the register. Active by default, as it always was; the
     * other two are how a deactivated patient is found again so that they can
     * be reactivated (bug report 12 Oct, finding 22) — before, a deactivated
     * record could be reached only by somebody who already had its URL.
     *
     * A record merged away as a duplicate is inactive too, but it is not a
     * patient anybody should bring back, so it is left out of both.
     */
    const status = searchParams.get('status') || 'active'
    const where: any = { hospitalId }
    if (status === 'inactive') {
      where.isActive = false
      where.mergedIntoId = null
    } else if (status === 'all') {
      where.mergedIntoId = null
    } else {
      where.isActive = true
    }

    // The list screen has offered these two filters all along and the route
    // ignored them, so choosing "Female" changed nothing. Unknown values are
    // ignored rather than refused: they come from a dropdown, not a person.
    const gender = searchParams.get('gender')
    if (gender && Object.prototype.hasOwnProperty.call(GENDER_LABELS, gender)) where.gender = gender
    const bloodGroup = searchParams.get('bloodGroup')
    if (bloodGroup && Object.prototype.hasOwnProperty.call(BLOOD_GROUP_LABELS, bloodGroup))
      where.bloodGroup = bloodGroup

    if (search) {
      /**
       * Two things this used to get wrong, both of which end with the desk
       * being told a registered patient does not exist.
       *
       * `contains` without `mode` is `LIKE`, which on PostgreSQL is
       * case-sensitive: a search for "muhammad" did not match "Muhammad".
       * Half the routes in this application already passed `insensitive`;
       * this one did not, so the same query behaved differently depending on
       * which screen you typed it into.
       *
       * And each word was matched against each column on its own, so a full
       * name found nothing: "John Smith" is not contained in `firstName`
       * ("John") nor in `lastName` ("Smith"). Typing somebody's whole name is
       * the first thing anybody does, so every term now has to match
       * *somewhere*, which lets the surname narrow the forename.
       */
      const matched = everyTermMatches(search, (term) => [
        { patientId: like(term) },
        { firstName: like(term) },
        { lastName: like(term) },
        // A phone number has no case, so it is the one field left literal.
        { phone: { contains: term } },
        { email: like(term) },
      ])

      where.AND = [...(where.AND ?? []), ...(matched?.AND ?? [])]
    }

    /**
     * "Own patients only", when the clinic has asked for it (§10).
     *
     * Appended to `where.AND`, alongside whatever the search above put there —
     * folding it into an OR would widen the query to the whole register
     * instead of narrowing the register to this user's own patients.
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
          isActive: true,
          // Carried on the list, not only on the full record, because every
          // screen that picks a patient out of a search box is a screen where
          // somebody is about to prescribe, treat or anaesthetise them. The
          // prescription form showed an allergy warning against a field this
          // route never sent, so the warning never appeared.
          medicalHistory: {
            select: { allergies: true, conditions: true, isPregnant: true },
          },
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
    const known = knownErrorResponse(error)
    if (known) return known
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

    // A date of birth in 2030, `xyz` as a phone number and `nope` as an email
    // address were all registered (bug report 12 Oct, finding 30). See
    // lib/patient-validation.ts for what each has to look like.
    const contactProblem = patientContactProblem({
      phone,
      alternatePhone,
      emergencyContactPhone,
      email,
      dateOfBirth,
    })
    if (contactProblem) {
      return NextResponse.json({ error: contactProblem }, { status: 400 })
    }

    /**
     * A repeated phone number is no longer refused.
     *
     * It used to be a hard 409 — "A patient with this phone number already
     * exists" — which is a statement about households, not about people. A
     * mother registering three children gives one number; a husband and wife
     * share one; a grandparent who does not own a phone gives their son's.
     * Every one of those is a real registration the desk could not complete,
     * and the way round it was to invent a number, which puts a wrong number
     * in a medical record and silently breaks every reminder sent to it.
     *
     * The identifier this clinic actually has is the CNIC, and that is still
     * unique below. A shared number is instead surfaced as a warning — the
     * same soft check the registration form already runs while it is being
     * filled in (`/api/patients/duplicates`), which scores name, date of
     * birth, phone, email and CNIC together and offers the existing record.
     * That catches the real duplicate this block never could: the same person
     * returning with a new number.
     */
    const sharesPhoneWith = await prisma.patient.findFirst({
      where: { hospitalId, phone },
      select: { id: true, patientId: true, firstName: true, lastName: true },
    })

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

    /*
     * Three lists, not whatever arrived.
     *
     * This was `create: medicalHistory` — the request body spread straight into
     * a Prisma create, which would have accepted `id`, `patientId` or any other
     * column of the table. It is now the three fields the registration form
     * offers, trimmed and de-duplicated.
     *
     * Skipped entirely when all three are empty, so a patient nobody was asked
     * about has no row rather than a blank one.
     */
    const history = medicalHistoryInput(medicalHistory)

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
          // Both selects submit "" when nothing is chosen, and both columns
          // are nullable. See blankToNull.
          gender: blankToNull(gender),
          bloodGroup: blankToNull(bloodGroup),
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
          medicalHistory: isBlankMedicalHistory(history) ? undefined : { create: history },
        },
        include: {
          medicalHistory: true,
        },
      })

      // A newly registered patient joins the recall list straight away: a
      // child on the clinic's child check-up, anybody else on its default
      // interval. A practice that has set no default gets nothing — see
      // lib/recare.ts; that is a policy decision, not an oversight.
      await startRegistrationRecare(tx, hospitalId, created.id, created.dateOfBirth)

      return created
    })

    // Registered. If the number is shared with somebody already on the books,
    // the desk is told who — after the fact, because it is a thing worth
    // knowing and not a reason to have refused.
    const body201 = withoutAiSummary(patient)
    return NextResponse.json(
      sharesPhoneWith
        ? {
            ...body201,
            sharedPhoneWith: {
              id: sharesPhoneWith.id,
              patientId: sharesPhoneWith.patientId,
              name: `${sharesPhoneWith.firstName} ${sharesPhoneWith.lastName}`,
            },
          }
        : body201,
      { status: 201 }
    )
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error creating patient:', error)
    return NextResponse.json({ error: 'Failed to create patient' }, { status: 500 })
  }
}

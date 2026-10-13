import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffLimit, requirePermission } from '@/lib/api-helpers'
import { parseOptionalCNIC } from '@/lib/cnic'
import bcrypt from 'bcryptjs'
import {
  SECONDARY_ROLES,
  holderCan,
  isAssignableSecondaryRole,
  isRole,
  staffChangeRefusal,
} from '@/lib/rbac'
import { validatePassword } from '@/lib/password-policy'
import { AUDIT_ACTIONS, REDACTED, diffValues, recordAudit, requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'
import { emailEquals, isValidEmail, normaliseEmail } from '@/lib/email-address'
import { planName } from '@/lib/plans'
import { getTenant } from '@/lib/tenant'
import {
  STAFF_HR_FIELDS,
  clinicToday,
  openAppointmentsFor,
  openAppointmentsRefusal,
  parseJoiningDate,
  phoneProblem,
  staffAuditSnapshot,
  withoutHrFields,
} from '@/lib/staff'

/**
 * Before and after for STAFF_UPDATED, with the private fields' values left out.
 *
 * The audit log is a plaintext table. That a CNIC or a home address changed is
 * worth recording; what it changed to is already on the staff record, behind
 * `staff:hr`, and does not need a second copy behind `audit:read`.
 */
function staffDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff = diffValues(before, after)
  for (const field of STAFF_HR_FIELDS) {
    if (diff.changed.includes(field)) {
      diff.before[field] = REDACTED
      diff.after[field] = REDACTED
    }
  }
  return diff
}

/** The staff limit, refused the way Add Staff refuses it. */
async function staffLimitRefusal(hospitalId: string): Promise<NextResponse | null> {
  const limit = await checkStaffLimit(hospitalId)
  if (limit.allowed) return null
  const tenant = await getTenant(hospitalId).catch(() => null)
  return NextResponse.json(
    {
      error: `Staff limit reached. The ${planName(tenant?.plan)} plan allows ${limit.max} active staff accounts, and ${limit.current} are in use. Upgrade, or deactivate somebody else first.`,
      code: 'STAFF_LIMIT',
      current: limit.current,
      max: limit.max,
      upgradeUrl: '/pricing',
    },
    { status: 403 }
  )
}

/**
 * Today's queue and the future diary, before somebody is switched off.
 *
 * Returns the 409 to send unless the caller has seen the list and confirmed.
 * Nothing is reassigned: see `openAppointmentsFor` in lib/staff.ts.
 */
async function openDiaryRefusal(
  hospitalId: string,
  staff: { id: string; firstName: string; lastName: string },
  confirmed: boolean
): Promise<{ refusal: NextResponse | null; openCount: number }> {
  const open = await openAppointmentsFor(hospitalId, staff.id)
  if (open.length === 0 || confirmed) return { refusal: null, openCount: open.length }
  return {
    refusal: NextResponse.json(
      openAppointmentsRefusal(`${staff.firstName} ${staff.lastName}`, open),
      { status: 409 }
    ),
    openCount: open.length,
  }
}

// GET - Get single staff member details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('staff:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const staff = await prisma.staff.findUnique({
      where: { id, hospitalId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            clinicalRole: true,
            isActive: true,
            createdAt: true,
          },
        },
        availability: {
          where: { dayOfWeek: { not: null } },
          orderBy: { dayOfWeek: 'asc' },
        },
        _count: {
          select: {
            appointments: true,
            treatments: true,
            prescriptions: true,
          },
        },
      },
    })

    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // The weekly rows are still called shifts on the wire and on the screen —
    // that is what a working pattern is. `Availability` is the table they sit
    // in alongside clinic closures and leave; see lib/availability.ts.
    const { availability, ...rest } = staff

    // CNIC, date of birth, home address, emergency contact and NTN go only to
    // `staff:hr` (finding 42). They are left out rather than nulled, so the
    // screens can tell "withheld" from "never entered".
    const visible = holderCan(session?.user, 'staff:hr') ? rest : withoutHrFields(rest)
    return NextResponse.json({ ...visible, shifts: availability })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching staff:', error)
    return NextResponse.json({ error: 'Failed to fetch staff details' }, { status: 500 })
  }
}

// PATCH - Update staff member
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, session } = await requirePermission('staff:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const existingStaff = await prisma.staff.findUnique({
      where: { id, hospitalId },
      include: { user: true },
    })

    if (!existingStaff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // Somebody who cannot read the private fields cannot write them either:
    // a form that never showed them would otherwise send them back blank and
    // wipe them. Ignored rather than refused, for the same reason.
    const seesHr = holderCan(session?.user, 'staff:hr')
    const hr = (field: (typeof STAFF_HR_FIELDS)[number]) => (seesHr ? body[field] : undefined)

    const {
      firstName,
      lastName,
      email: rawEmail,
      phone,
      alternatePhone,
      gender,
      qualification,
      specialization,
      licenseNumber,
      joiningDate,
      isActive,
      role,
      clinicalRole,
      newPassword,
      confirm,
    } = body
    const dateOfBirth = hr('dateOfBirth')
    const address = hr('address')
    const city = hr('city')
    const state = hr('state')
    const postalCode = hr('postalCode')
    const cnic = hr('cnic')
    const nationalTaxNo = hr('nationalTaxNo')
    const emergencyContact = hr('emergencyContact')
    const emergencyPhone = hr('emergencyPhone')

    // Phone numbers that are numbers (finding 28). The main one may be left
    // out of a partial update, but not blanked.
    const badPhone =
      (phone !== undefined ? phoneProblem(phone, 'Phone', { required: true }) : null) ??
      phoneProblem(alternatePhone, 'Alternate phone') ??
      phoneProblem(emergencyPhone, 'Emergency phone')
    if (badPhone) return NextResponse.json({ error: badPhone }, { status: 400 })

    // A changed sign-in address: valid, lower-cased, and not somebody else's
    // at this clinic in any case (findings 28 and 29).
    let email: string | undefined
    if (rawEmail !== undefined && rawEmail !== null && rawEmail !== '') {
      if (!isValidEmail(rawEmail)) {
        return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
      }
      const normalised = normaliseEmail(rawEmail)
      if (normalised !== normaliseEmail(existingStaff.user.email)) {
        const taken = await prisma.user.findFirst({
          where: { hospitalId, email: emailEquals(normalised), id: { not: existingStaff.userId } },
          select: { id: true },
        })
        if (taken) {
          return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
        }
        email = normalised
      }
    }

    /**
     * The joining date (finding 47) — it used to be silently ignored, and the
     * register refuses every day before it, so a person added today with the
     * default date could never have last week filled in.
     *
     * Moving it earlier is always safe. Moving it later is refused while
     * attendance is recorded before the new date: those rows would sit on days
     * the register says the person had not joined, unreachable from the screen
     * and still counted in reports. Deleting them silently is worse. The person
     * correcting the date clears those days first, deliberately.
     */
    let joinedOn: Date | undefined
    if (joiningDate !== undefined && joiningDate !== null && joiningDate !== '') {
      const parsed = parseJoiningDate(joiningDate, await clinicToday(hospitalId))
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const currentDay = existingStaff.joiningDate.toISOString().slice(0, 10)
      if (parsed.day !== currentDay) {
        const earlier = await prisma.attendance.count({
          where: { hospitalId, userId: existingStaff.userId, date: { lt: parsed.date } },
        })
        if (earlier > 0) {
          return NextResponse.json(
            {
              error: `${earlier} attendance day${earlier === 1 ? ' is' : 's are'} recorded before ${parsed.day}. Clear ${earlier === 1 ? 'it' : 'them'} on the attendance register before moving the joining date later.`,
            },
            { status: 409 }
          )
        }
        joinedOn = parsed.date
      }
    }

    const cnicResult = parseOptionalCNIC(cnic)
    if (!cnicResult.ok) {
      return NextResponse.json({ error: cnicResult.error }, { status: 400 })
    }
    const parsedCnic = cnicResult.value

    if (parsedCnic) {
      const holder = await prisma.staff.findFirst({
        where: { hospitalId, cnic: parsedCnic, id: { not: id } },
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

    if (role !== undefined && role !== null && role !== '' && !isRole(role)) {
      return NextResponse.json({ error: 'That is not a role' }, { status: 400 })
    }

    const wasActive = existingStaff.isActive && existingStaff.user.isActive
    const deactivating = isActive === false && wasActive
    const reactivating = isActive === true && !wasActive

    const refusal = staffChangeRefusal(session?.user, {
      currentRole: existingStaff.user?.role,
      newRole: role || null,
      resetsPassword: !!newPassword,
      // A new sign-in address is a way into the account, through a password
      // reset sent to it, so it is treated as an access change.
      changesAccess:
        (isActive !== undefined && isActive !== existingStaff.user?.isActive) || !!email,
    })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 })

    // `clinicalRole: null` clears it; any other value must be a clinical role
    // that differs from the primary one. See SECONDARY_ROLES in lib/rbac.ts.
    if (clinicalRole) {
      if (!isAssignableSecondaryRole(clinicalRole)) {
        return NextResponse.json(
          { error: `clinicalRole must be one of: ${SECONDARY_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      if (clinicalRole === (role || existingStaff.user?.role)) {
        return NextResponse.json(
          { error: 'clinicalRole must differ from the primary role' },
          { status: 400 }
        )
      }
    }

    if (newPassword) {
      const weak = validatePassword(newPassword)
      if (weak) return NextResponse.json({ error: weak }, { status: 400 })
    }

    // Switching somebody back on takes a seat on the plan like adding them
    // did (finding 63) — otherwise deactivate, add, reactivate gets round it.
    if (reactivating) {
      const overLimit = await staffLimitRefusal(hospitalId)
      if (overLimit) return overLimit
    }

    // Switching somebody off with patients still booked to them (finding 21).
    let openCount = 0
    if (deactivating) {
      const diary = await openDiaryRefusal(hospitalId, existingStaff, confirm === true)
      if (diary.refusal) return diary.refusal
      openCount = diary.openCount
    }

    // Update in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update user if role or password changed
      if (
        role ||
        clinicalRole !== undefined ||
        newPassword ||
        isActive !== undefined ||
        email ||
        firstName ||
        lastName ||
        phone
      ) {
        const userUpdateData: any = {}

        if (role) userUpdateData.role = role
        if (clinicalRole !== undefined) userUpdateData.clinicalRole = clinicalRole || null
        if (isActive !== undefined) userUpdateData.isActive = isActive
        if (email) userUpdateData.email = email
        if (phone) userUpdateData.phone = String(phone).trim()
        if (newPassword) {
          userUpdateData.password = await bcrypt.hash(newPassword, 10)
          // A password an administrator chose is a password somebody else
          // knows, so it is temporary by construction: the holder is sent to
          // the change form at their next sign-in.
          userUpdateData.passwordChangedAt = new Date()
          userUpdateData.mustChangePassword = true
        }
        if (firstName || lastName) {
          userUpdateData.name = `${firstName || existingStaff.firstName} ${lastName || existingStaff.lastName}`
        }

        await tx.user.update({
          where: { id: existingStaff.userId },
          data: userUpdateData,
        })
      }

      // Update staff profile
      const updatedStaff = await tx.staff.update({
        where: { id },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email && { email }),
          ...(phone && { phone: String(phone).trim() }),
          ...(alternatePhone !== undefined && { alternatePhone }),
          ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) }),
          ...(gender && { gender }),
          ...(address !== undefined && { address }),
          ...(city !== undefined && { city }),
          ...(state !== undefined && { state }),
          ...(postalCode !== undefined && { postalCode }),
          ...(cnic !== undefined && { cnic: parsedCnic }),
          ...(nationalTaxNo !== undefined && { nationalTaxNo }),
          ...(qualification !== undefined && { qualification }),
          ...(specialization !== undefined && { specialization }),
          ...(licenseNumber !== undefined && { licenseNumber }),
          ...(joinedOn && { joiningDate: joinedOn }),
          ...(emergencyContact !== undefined && { emergencyContact }),
          ...(emergencyPhone !== undefined && { emergencyPhone }),
          ...(isActive !== undefined && { isActive }),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              clinicalRole: true,
              isActive: true,
            },
          },
        },
      })

      return updatedStaff
    })

    const context = requestContext(request.headers)

    if (newPassword) {
      // §10 asks for configuration and access changes to be auditable, and one
      // person setting another person's password is both. The entry records
      // that it happened and who did it; `recordAudit` redacts anything named
      // like a password, so nothing about the password itself can reach it.
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        entityType: 'User',
        entityId: existingStaff.userId,
        newValues: { setBy: 'administrator', mustChangePassword: true },
        ...context,
      })
    }

    // Finding 24: the edit itself, as the fields that changed. Switching the
    // account on or off has its own entry below and is left out of this one.
    const before = staffAuditSnapshot({
      ...existingStaff,
      email: existingStaff.user.email,
      role: existingStaff.user.role,
      clinicalRole: existingStaff.user.clinicalRole,
    })
    const after = staffAuditSnapshot({
      ...result,
      email: result.user?.email ?? result.email,
      role: result.user?.role,
      clinicalRole: result.user?.clinicalRole,
    })
    delete before.isActive
    delete after.isActive
    const diff = staffDiff(before, after)
    if (diff.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.STAFF_UPDATED,
        entityType: 'Staff',
        entityId: id,
        oldValues: diff.before,
        newValues: { ...diff.after, changed: diff.changed },
        ...context,
      })
    }

    if (deactivating || reactivating) {
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: deactivating ? AUDIT_ACTIONS.STAFF_DEACTIVATED : AUDIT_ACTIONS.STAFF_REACTIVATED,
        entityType: 'Staff',
        entityId: id,
        newValues: {
          employeeId: existingStaff.employeeId,
          name: `${existingStaff.firstName} ${existingStaff.lastName}`,
          ...(deactivating && { openAppointments: openCount }),
        },
        ...context,
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error updating staff:', error)
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 })
  }
}

// DELETE - Deactivate staff member (soft delete)
//
// Send `{ "confirm": true }` (or `?confirm=true`) to go ahead when the 409
// has listed appointments still booked to this person.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId, session } = await requirePermission('staff:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const staff = await prisma.staff.findUnique({
      where: { id, hospitalId },
      include: { user: true },
    })

    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    const refusal = staffChangeRefusal(session?.user, {
      currentRole: staff.user?.role,
      changesAccess: true,
    })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 })

    const body = await request.json().catch(() => null)
    const confirmed =
      (body && typeof body === 'object' && body.confirm === true) ||
      request.nextUrl.searchParams.get('confirm') === 'true'

    const wasActive = staff.isActive || staff.user.isActive
    const diary = wasActive
      ? await openDiaryRefusal(hospitalId, staff, confirmed)
      : { refusal: null, openCount: 0 }
    if (diary.refusal) return diary.refusal

    // Soft delete - deactivate both user and staff
    await prisma.$transaction([
      prisma.user.update({
        where: { id: staff.userId },
        data: { isActive: false },
      }),
      prisma.staff.update({
        where: { id },
        data: { isActive: false },
      }),
    ])

    if (wasActive) {
      await recordAudit({
        hospitalId,
        userId: session?.user?.id,
        action: AUDIT_ACTIONS.STAFF_DEACTIVATED,
        entityType: 'Staff',
        entityId: id,
        newValues: {
          employeeId: staff.employeeId,
          name: `${staff.firstName} ${staff.lastName}`,
          openAppointments: diary.openCount,
        },
        ...requestContext(request.headers),
      })
    }

    return NextResponse.json({ message: 'Staff member deactivated successfully' })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error deactivating staff:', error)
    return NextResponse.json({ error: 'Failed to deactivate staff member' }, { status: 500 })
  }
}

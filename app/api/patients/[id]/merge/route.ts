import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { AUDIT_ACTIONS, recordAudit, requestContext } from '@/lib/audit'
import { knownErrorResponse } from '@/lib/api-errors'
import {
  fillableFrom,
  mergeMedicalHistory,
  mergeRefusal,
  resolveRecallCollisions,
} from '@/lib/patient-merge'

/**
 * POST /api/patients/[id]/merge — fold a duplicate record into this one.
 *
 * `[id]` is the record that survives; `{ mergeId }` in the body is the one
 * being retired. That way round because the desk opens the record it means to
 * keep and merges the other into it, which is how the decision is actually
 * made.
 *
 * Behind `patients:delete` rather than `patients:write`. A merge moves one
 * patient's entire clinical history onto another and retires a record; it is
 * the most destructive thing anybody can do to a patient file short of
 * deleting it, and it should not sit behind the permission that lets somebody
 * correct a misspelled surname.
 *
 * The whole thing is one transaction. A merge that moved the appointments and
 * failed before the invoices would leave a clinic with a state no screen can
 * explain and no button can finish.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:delete')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id: keepId } = await params
    const body = await request.json()
    const mergeId = String(body?.mergeId ?? '')

    if (!mergeId) {
      return NextResponse.json({ error: 'Which record should be merged in?' }, { status: 400 })
    }

    const [keep, retire] = await Promise.all([
      prisma.patient.findFirst({
        where: { id: keepId, hospitalId },
        include: { medicalHistory: true },
      }),
      prisma.patient.findFirst({
        where: { id: mergeId, hospitalId },
        include: { medicalHistory: true },
      }),
    ])

    const refusal = mergeRefusal(keep, retire)
    if (refusal) {
      return NextResponse.json({ error: refusal }, { status: 400 })
    }
    // `mergeRefusal` has already established both are present; this is for the
    // type checker, which cannot see that.
    if (!keep || !retire) {
      return NextResponse.json(
        { error: 'One of those records could not be found' },
        { status: 404 }
      )
    }

    const moved = await prisma.$transaction(async (tx) => {
      // Scoped on the clinic as well as the patient. Both patients were already
      // fetched with `hospitalId`, so this is belt and braces — but a bare
      // `patientId` filter on a write is exactly the shape that stops being
      // safe the day somebody changes how the two are looked up above.
      const reassign = {
        where: { patientId: mergeId, hospitalId },
        data: { patientId: keepId },
      }

      /**
       * Recalls first, because they are the one thing here with a unique index
       * on the patient: one standing recall of each kind. Both records almost
       * always have the default recall from registration, and moving the
       * retired one across broke that index and failed every merge (bug report
       * 12 Oct, finding 23). Where both have one, the surviving row is kept and
       * takes whatever the retired one knew that it did not — see
       * `resolveRecallCollisions`.
       */
      const recallFields = {
        id: true,
        recareTypeId: true,
        dueDate: true,
        lastDoneAt: true,
        snoozedUntil: true,
        snoozeReason: true,
        status: true,
        notes: true,
        lastContactedAt: true,
        contactAttempts: true,
      } as const
      const [keptRecalls, retiredRecalls] = await Promise.all([
        tx.recare.findMany({ where: { patientId: keepId, hospitalId }, select: recallFields }),
        tx.recare.findMany({ where: { patientId: mergeId, hospitalId }, select: recallFields }),
      ])
      const collisions = resolveRecallCollisions(keptRecalls, retiredRecalls)
      for (const { id, data } of collisions.update) {
        await tx.recare.update({ where: { id }, data })
      }
      if (collisions.drop.length > 0) {
        await tx.recare.deleteMany({ where: { id: { in: collisions.drop }, hospitalId } })
      }

      /**
       * Who pays for whom. Family links are on the patient row itself, so the
       * `reassign` above does not reach them.
       *
       * Anybody the retired record paid for is now paid for by the surviving
       * one — the same person settling the same bills. The surviving record
       * itself is the exception: if the retired record was its guarantor, that
       * link would become the record paying for itself, which the database
       * refuses (`Patient_guarantor_not_self`) and the ledger would count
       * twice. It pays for itself again instead.
       */
      if (keep.guarantorId === mergeId) {
        await tx.patient.update({ where: { id: keepId }, data: { guarantorId: null } })
      }
      const dependants = await tx.patient.updateMany({
        where: { hospitalId, guarantorId: mergeId, id: { not: keepId } },
        data: { guarantorId: keepId },
      })

      // Everything the retired record owns, moved. Counted as it goes so the
      // desk can be told what happened rather than just "done".
      const [
        appointments,
        treatments,
        treatmentPlans,
        invoices,
        prescriptions,
        documents,
        labOrders,
        dentalChart,
        perioExams,
        recares,
        clinicalNotes,
        messages,
        formSubmissions,
        waitlist,
      ] = await Promise.all([
        tx.appointment.updateMany(reassign),
        tx.treatment.updateMany(reassign),
        tx.treatmentPlan.updateMany(reassign),
        tx.invoice.updateMany(reassign),
        tx.prescription.updateMany(reassign),
        tx.document.updateMany(reassign),
        tx.labOrder.updateMany(reassign),
        tx.dentalChartEntry.updateMany(reassign),
        tx.perioExam.updateMany(reassign),
        // Only the recalls the surviving record did not already have of the
        // same kind; the colliding ones were settled above.
        tx.recare.updateMany(reassign),
        // Free-standing clinical notes — telephone calls, declined treatment.
        // They were left behind on the retired record, which nobody opens
        // again once it says "merged".
        tx.clinicalNote.updateMany(reassign),
        tx.messageLog.updateMany(reassign),
        tx.formSubmission.updateMany(reassign),
        tx.waitlist.updateMany(reassign),
      ])

      // A walk-in that was converted into the retired record now points at the
      // surviving one, so the visit history follows the person.
      await tx.visitor.updateMany({
        where: { convertedPatientId: mergeId, hospitalId },
        data: { convertedPatientId: keepId },
      })

      /**
       * One medical history out of two.
       *
       * Unioned, never overwritten: an allergy recorded on only one of the two
       * records is still an allergy, and losing it to a tidy-up is the one
       * outcome a merge must never produce.
       */
      const history = mergeMedicalHistory(keep.medicalHistory, retire.medicalHistory)
      if (retire.medicalHistory) {
        // Deleted first: `MedicalHistory.patientId` is unique, so the retired
        // record's row cannot be reassigned alongside the others above.
        await tx.medicalHistory.delete({ where: { patientId: mergeId } })
      }
      if (keep.medicalHistory) {
        await tx.medicalHistory.update({ where: { patientId: keepId }, data: history })
      } else if (retire.medicalHistory) {
        await tx.medicalHistory.create({ data: { patientId: keepId, ...history } })
      }

      // Blanks on the surviving record, filled from the one being retired. A
      // value already there always wins — see lib/patient-merge.ts.
      const patch = fillableFrom(
        keep as unknown as Record<string, unknown>,
        retire as unknown as Record<string, unknown>
      )

      // The CNIC is unique per clinic, so it has to leave the retired record
      // before it can be written onto the surviving one.
      if (patch.cnic) {
        await tx.patient.update({ where: { id: mergeId }, data: { cnic: null } })
      }

      if (Object.keys(patch).length > 0) {
        await tx.patient.update({ where: { id: keepId }, data: patch })
      }

      await tx.patient.update({
        where: { id: mergeId },
        data: { isActive: false, mergedIntoId: keepId, mergedAt: new Date() },
      })

      // A portal sign-in is one per patient (unique on `patientId`), so the
      // retired record's is not moved: it signs in with a patient number that
      // has just been retired, and could collide with one the surviving record
      // already has. It is switched off where it is; the desk issues access on
      // the surviving record if the patient asks for it.
      await tx.patientPortalAccount.updateMany({
        where: { patientId: mergeId, hospitalId },
        data: { isActive: false },
      })

      return {
        filled: Object.keys(patch),
        counts: {
          appointments: appointments.count,
          treatments: treatments.count,
          treatmentPlans: treatmentPlans.count,
          invoices: invoices.count,
          prescriptions: prescriptions.count,
          documents: documents.count,
          labOrders: labOrders.count,
          dentalChart: dentalChart.count,
          perioExams: perioExams.count,
          recares: recares.count,
          recallsCombined: collisions.drop.length,
          clinicalNotes: clinicalNotes.count,
          dependants: dependants.count,
          messages: messages.count,
          formSubmissions: formSubmissions.count,
          waitlist: waitlist.count,
        },
      }
    })

    void recordAudit({
      hospitalId,
      userId: user.id,
      action: AUDIT_ACTIONS.PATIENTS_MERGED,
      entityType: 'Patient',
      entityId: keepId,
      newValues: {
        keptPatientId: keep.patientId,
        retiredPatientId: retire.patientId,
        moved: moved.counts,
        filled: moved.filled,
      },
      ...requestContext(request.headers),
    })

    return NextResponse.json({ success: true, ...moved })
  } catch (err: unknown) {
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Patient merge error:', err)
    return NextResponse.json({ error: 'Those records could not be merged' }, { status: 500 })
  }
}

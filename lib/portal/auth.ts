/**
 * The guard on every portal request.
 *
 * `requirePortalPatient` is to `/api/portal/*` what `requirePermission` is to
 * the clinic's API, with one deliberate difference: it returns the patient's
 * own id, and every query it guards must be scoped by that id **and** the
 * hospital id from the same place. Neither may come from the URL or the body.
 * A portal route that reads `params.patientId` is a portal route that shows one
 * patient another patient's record, and there is no such route here — none of
 * them take a patient id at all.
 *
 * The cookie is checked for authenticity in lib/portal/session.ts. What this
 * adds is currency: a token is valid for four hours, and access withdrawn at
 * the desk has to take effect now rather than then. So every request re-reads
 * the account. One indexed lookup for a portal that serves a handful of people
 * per clinic is the right trade against an access decision the clinic believes
 * it has already made.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readPortalSession, type PortalSession } from './session'

export interface PortalCaller {
  session: PortalSession
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    hospitalId: string
  }
  mustChangePassword: boolean
}

export type PortalGuard =
  { error: NextResponse; caller?: never } | { error?: never; caller: PortalCaller }

/**
 * Who is asking, or a refusal to hand back.
 *
 * Every failure is the same 401 with the same body. Telling "no cookie" apart
 * from "account disabled" apart from "record merged away" would let somebody
 * holding an old cookie learn what happened to the record behind it.
 */
export async function requirePortalPatient(): Promise<PortalGuard> {
  const unauthorised = () => NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })

  const session = await readPortalSession()
  if (!session) return { error: unauthorised() }

  const account = await prisma.patientPortalAccount.findFirst({
    where: {
      id: session.accountId,
      patientId: session.patientId,
      hospitalId: session.hospitalId,
      isActive: true,
    },
    select: {
      mustChangePassword: true,
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          hospitalId: true,
          isActive: true,
          mergedIntoId: true,
        },
      },
    },
  })

  if (!account) return { error: unauthorised() }

  // A deactivated record, or one merged into another, must not be readable.
  // The merge case matters: the losing record is kept so the clinic can find
  // out where the history went, but the history itself has moved, so the
  // portal would show a record that is now empty and imply the treatment never
  // happened.
  const { patient } = account
  if (!patient.isActive || patient.mergedIntoId) return { error: unauthorised() }

  return {
    caller: {
      session,
      patient: {
        id: patient.id,
        patientId: patient.patientId,
        firstName: patient.firstName,
        lastName: patient.lastName,
        hospitalId: patient.hospitalId,
      },
      mustChangePassword: account.mustChangePassword,
    },
  }
}

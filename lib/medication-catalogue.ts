/**
 * When two catalogue entries are the same drug.
 *
 * The medication list accepted "Amoxil / Amoxicillin / 500mg / capsule" twice
 * (bug report 12 Oct, finding 56). Two identical entries split everything that
 * hangs off the catalogue — stock links, templates, the prescribing search —
 * between rows nobody can tell apart.
 *
 * The same drug is the same name, generic name, strength and form, compared
 * without regard to case or surrounding spaces, with a blank and a missing
 * value treated alike. A different strength or form is a different entry: 250mg
 * and 500mg capsules are both real stock.
 */
import { prisma } from '@/lib/prisma'

export interface MedicationIdentity {
  name?: string | null
  genericName?: string | null
  strength?: string | null
  form?: string | null
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isSameMedication(a: MedicationIdentity, b: MedicationIdentity): boolean {
  return (
    norm(a.name) === norm(b.name) &&
    norm(a.genericName) === norm(b.genericName) &&
    norm(a.strength) === norm(b.strength) &&
    norm(a.form) === norm(b.form)
  )
}

/**
 * The active entry this one would duplicate, or null.
 *
 * Narrowed by name in the database, then compared on all four fields here so
 * that the blank-versus-null and spacing rules above apply. Only active
 * entries count: a retired duplicate is history, and a clinic re-adding a
 * drug it once retired should not be told it already has it.
 */
export async function findDuplicateMedication(
  hospitalId: string,
  candidate: MedicationIdentity,
  excludeId?: string
) {
  const name = candidate.name?.trim()
  if (!name) return null

  const sameName = await prisma.medication.findMany({
    where: {
      hospitalId,
      isActive: true,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, name: true, genericName: true, strength: true, form: true },
  })

  return sameName.find((existing) => isSameMedication(existing, candidate)) ?? null
}

/** The 409 sentence for a duplicate. */
export function duplicateMedicationMessage(existing: MedicationIdentity): string {
  const described = [existing.name, existing.strength, existing.form].filter(Boolean).join(' ')
  return `${described} is already in the drug catalogue. Edit that entry rather than adding it again.`
}

/**
 * Turning a template into a prescription.
 *
 * The rule this file exists to enforce: **issuing copies**. A template is the
 * wording a clinic reuses; the prescription handed to a patient is a record of
 * what was decided on a day, and the two must never be the same rows. If the
 * patient's prescription read its dosages through `templateId`, then editing
 * "Amoxicillin 500mg" down to 250mg next year would silently rewrite what was
 * prescribed last year — to every patient who ever received it, with no trace.
 *
 * So `Prescription.templateId` is provenance and nothing more, and the lines
 * are copied into `PrescriptionMedication` at the moment of issue. That is the
 * same arrangement `PrescriptionMedication.medicationId` already has with the
 * `Medication` catalogue, for the same reason.
 */

/** One prescribed medicine, in the shape the form and both tables use. */
export interface PrescriptionLine {
  medicationId: string | null
  medicationName: string
  /** Carried for the allergy check; not stored on the prescription itself. */
  genericName?: string | null
  dosage: string
  frequency: string
  duration: string
  route: string
  timing: string
  quantity: string
  instructions: string
}

export interface TemplateItem {
  medicationId?: string | null
  medicationName: string
  dosage: string
  frequency: string
  duration: string
  route?: string | null
  timing?: string | null
  quantity?: number | null
  instructions?: string | null
  medication?: { genericName?: string | null } | null
}

/** A row the dentist has not typed anything into yet. */
export function isBlankLine(line: Partial<PrescriptionLine>): boolean {
  return (
    !line.medicationName?.trim() &&
    !line.dosage?.trim() &&
    !line.frequency?.trim() &&
    !line.duration?.trim() &&
    !line.instructions?.trim()
  )
}

/** A template's items as prescription lines. A copy, every field. */
export function linesFromTemplate(items: TemplateItem[]): PrescriptionLine[] {
  return items.map((item) => ({
    medicationId: item.medicationId ?? null,
    medicationName: item.medicationName,
    genericName: item.medication?.genericName ?? null,
    dosage: item.dosage,
    frequency: item.frequency,
    duration: item.duration,
    route: item.route || 'Oral',
    timing: item.timing ?? '',
    quantity: item.quantity == null ? '' : String(item.quantity),
    instructions: item.instructions ?? '',
  }))
}

export interface AppendResult {
  lines: PrescriptionLine[]
  /** Names that were already on the prescription before the template was applied. */
  duplicates: string[]
  added: number
}

/**
 * Add a template's lines to what is already on the form.
 *
 * Append rather than replace. A dentist who has typed two medicines and then
 * reaches for "Post-extraction" is adding to their work, and a picker that
 * wiped it would destroy typing with no warning and no undo — the one
 * interaction in this form that cannot be taken back.
 *
 * Two refinements on a plain concatenation:
 *
 * The blank starter row that every new prescription opens with is dropped. It
 * is scaffolding, not something anybody typed, and leaving an empty line above
 * the template's medicines just means deleting it by hand.
 *
 * A medicine already on the form is still added, but named in `duplicates` so
 * the screen can say so. Refusing it would be wrong — the same drug at two
 * strengths is a real prescription, a loading dose then a course — but adding
 * a second amoxicillin silently is how somebody ends up dispensing twice.
 */
export function appendTemplateLines(
  existing: PrescriptionLine[],
  incoming: PrescriptionLine[]
): AppendResult {
  const kept = existing.filter((line) => !isBlankLine(line))
  const already = new Set(kept.map((line) => line.medicationName.trim().toLowerCase()))

  const duplicates: string[] = []
  for (const line of incoming) {
    const name = line.medicationName.trim().toLowerCase()
    if (name && already.has(name)) duplicates.push(line.medicationName.trim())
    already.add(name)
  }

  return {
    lines: [...kept, ...incoming],
    duplicates: [...new Set(duplicates)],
    added: incoming.length,
  }
}

/**
 * Why this template cannot be saved, or null if it can.
 *
 * Returned as a sentence rather than a field map: every one of these is about
 * the template as a whole, and the screen shows them in one place.
 */
export function templateRefusal(template: {
  name?: string | null
  items?: Array<Partial<PrescriptionLine>> | null
}): string | null {
  if (!template.name?.trim()) return 'Give the template a name'

  const items = (template.items ?? []).filter((item) => !isBlankLine(item))
  if (items.length === 0) return 'A template needs at least one medicine'

  const unnamed = items.find((item) => !item.medicationName?.trim())
  if (unnamed) return 'Every line needs a medicine name'

  // Dosage and frequency are what make a line a prescription rather than a
  // note. A template missing them saves the dentist nothing, because they
  // would have to fill them in at every use.
  const incomplete = items.find((item) => !item.dosage?.trim() || !item.frequency?.trim())
  if (incomplete) {
    return `Give ${incomplete.medicationName?.trim() || 'every line'} a dosage and a frequency`
  }

  return null
}

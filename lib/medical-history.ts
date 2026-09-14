/**
 * The medical conditions the intake form offers.
 *
 * `MedicalHistory` used to carry sixteen `hasX` booleans, several with an
 * `xType` column beside them. The list could only ever record what somebody
 * thought of when the schema was written — a patient on warfarin, a transplant
 * recipient, anyone on a bisphosphonate all ended up crammed into
 * `otherConditions` as prose, and all three matter more to an extraction than
 * several of the conditions that did get a column of their own.
 *
 * It is three string lists now. This file is what the form offers, so that the
 * common conditions stay spelled the same way across a clinic's records and
 * stay findable by a query — while leaving a clinician free to write down
 * something this list has not anticipated.
 */

/**
 * Ordered by how much they change what happens in the chair, not
 * alphabetically: the first six alter anaesthesia, bleeding or antibiotic
 * cover, and a form that buries them under "Asthma" is a form people scroll
 * past.
 */
export const COMMON_CONDITIONS = [
  'Bleeding disorder',
  'Anticoagulant therapy',
  'Heart disease',
  'Hypertension',
  'Diabetes',
  'Bisphosphonate therapy',
  'Asthma',
  'Epilepsy',
  'Thyroid disorder',
  'Hepatitis',
  'HIV',
  'Kidney disease',
  'Liver disease',
  'Immunosuppression',
  'Osteoporosis',
  'Stroke',
] as const

/** Allergies worth prompting for, because a clinic has all of them to hand. */
export const COMMON_ALLERGIES = [
  'Penicillin',
  'Local anaesthetic',
  'Latex',
  'Aspirin / NSAIDs',
  'Iodine',
  'Metal / nickel',
  'Sulfa drugs',
] as const

/**
 * Tidy a list on the way in.
 *
 * Trims, drops blanks, and removes case-insensitive duplicates while keeping
 * the spelling the clinician actually typed — a record that reads "Penicillin,
 * penicillin" is a record somebody stops trusting.
 */
export function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }

  return out
}

export interface MedicalAlert {
  label: string
  /** `danger` is shown before treatment starts; `warning` sits on the record. */
  tone: 'danger' | 'warning'
}

/**
 * What to put in front of a clinician before they start.
 *
 * Allergies are always urgent — the wrong anaesthetic or the wrong antibiotic
 * is the one mistake here that is immediately dangerous. Bleeding risk is next,
 * because it changes whether an extraction happens today at all.
 */
const URGENT = /bleed|anticoag|warfarin|heart|cardiac|bisphosphonate|haemophil|hemophil/i

export function medicalAlerts(history: {
  allergies?: string[] | null
  conditions?: string[] | null
  isPregnant?: boolean | null
}): MedicalAlert[] {
  const alerts: MedicalAlert[] = []

  for (const allergy of history.allergies ?? []) {
    alerts.push({ label: `Allergy: ${allergy}`, tone: 'danger' })
  }

  if (history.isPregnant) alerts.push({ label: 'Pregnant', tone: 'danger' })

  for (const condition of history.conditions ?? []) {
    alerts.push({ label: condition, tone: URGENT.test(condition) ? 'danger' : 'warning' })
  }

  return alerts
}

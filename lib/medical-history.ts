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

/**
 * The three lists a screen edits, and the only three it may write.
 *
 * `MedicalHistory` has a dozen other columns — habits, pregnancy, dental
 * anxiety, free-text notes — which belong to a longer intake conversation than
 * registration at the desk. Naming the three explicitly also means the create
 * below is a fixed shape rather than whatever JSON arrived: the POST route used
 * to spread the request body straight into `medicalHistory.create`, so a client
 * could have set `id`, `patientId` or any column it liked.
 */
export interface MedicalHistoryInput {
  allergies: string[]
  conditions: string[]
  currentMedications: string[]
}

export const EMPTY_MEDICAL_HISTORY: MedicalHistoryInput = {
  allergies: [],
  conditions: [],
  currentMedications: [],
}

/** Whatever arrived, reduced to three tidy lists. */
export function medicalHistoryInput(body: unknown): MedicalHistoryInput {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return {
    allergies: normalizeList(raw.allergies),
    conditions: normalizeList(raw.conditions),
    currentMedications: normalizeList(raw.currentMedications),
  }
}

/**
 * Nothing worth recording.
 *
 * Registration skips the write entirely in this case, so a patient nobody was
 * asked about has no row rather than an empty one. On edit it still writes,
 * because clearing the last allergy has to actually clear it.
 */
export function isBlankMedicalHistory(values: MedicalHistoryInput): boolean {
  return (
    values.allergies.length === 0 &&
    values.conditions.length === 0 &&
    values.currentMedications.length === 0
  )
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

  // Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
  // for (const allergy of history.allergies ?? []) {
  //   alerts.push({ label: `Allergy: ${allergy}`, tone: 'danger' })
  // }

  if (history.isPregnant) alerts.push({ label: 'Pregnant', tone: 'danger' })

  for (const condition of history.conditions ?? []) {
    alerts.push({ label: condition, tone: URGENT.test(condition) ? 'danger' : 'warning' })
  }

  return alerts
}

/**
 * Drug families, and the names a clinic actually types.
 *
 * Keyed by the allergy as it is recorded — `COMMON_ALLERGIES` above is what the
 * intake form offers, so those spellings come up most, but the match is on a
 * pattern rather than an exact string because a clinician is free to write
 * "penicillins" or "allergic to penicillin" and mean the same thing.
 *
 * Brand names are included beside generics deliberately. A prescription in this
 * clinic is as likely to say Augmentin as co-amoxiclav, and a check that only
 * knew generic names would stay silent on the commoner spelling.
 */
const DRUG_FAMILIES: { allergy: RegExp; drugs: RegExp; note?: string }[] = [
  {
    allergy: /penicillin|amoxicillin|augmentin/i,
    drugs:
      /penicillin|amoxicillin|amoxycillin|ampicillin|augmentin|co-?amoxiclav|clavulan|cloxacillin|flucloxacillin|piperacillin|dicloxacillin/i,
  },
  {
    // Kept separate and worded as a possibility rather than a clash, because
    // that is what it is: cross-reactivity is real but uncommon, and a warning
    // that overstates it is a warning people learn to click through.
    allergy: /penicillin/i,
    drugs:
      /cephalexin|cefixime|ceftriaxone|cefuroxime|cefadroxil|cefpodoxime|cephradine|\bcef|\bceph/i,
    note: 'possible cross-reaction',
  },
  {
    allergy: /aspirin|nsaid|ibuprofen|diclofenac/i,
    drugs:
      /aspirin|acetylsalicylic|ibuprofen|brufen|diclofenac|voltaren|naproxen|ketorolac|mefenamic|ponstan|aceclofenac|piroxicam|indomethacin|celecoxib|nimesulide/i,
  },
  {
    allergy: /sulfa|sulpha|cotrimoxazole|co-trimoxazole/i,
    drugs:
      /sulfamethoxazole|sulphamethoxazole|co-?trimoxazole|septran|bactrim|sulfadiazine|sulfasalazine/i,
  },
  {
    allergy: /local an(a)?esthetic|lidocaine|lignocaine|articaine|xylocaine/i,
    drugs:
      /lidocaine|lignocaine|xylocaine|articaine|mepivacaine|bupivacaine|prilocaine|septocaine/i,
  },
  {
    allergy: /iodine|povidone|betadine/i,
    drugs: /iodine|povidone|betadine/i,
  },
  {
    allergy: /metronidazole|flagyl/i,
    drugs: /metronidazole|flagyl|tinidazole|ornidazole/i,
  },
  {
    allergy: /erythromycin|macrolide|azithromycin|clarithromycin/i,
    drugs: /erythromycin|azithromycin|clarithromycin|roxithromycin/i,
  },
  {
    allergy: /codeine|opioid|morphine|tramadol/i,
    drugs: /codeine|tramadol|morphine|dihydrocodeine|oxycodone|pethidine/i,
  },
  {
    allergy: /paracetamol|acetaminophen|panadol/i,
    drugs: /paracetamol|acetaminophen|panadol|calpol/i,
  },
  {
    allergy: /tetracycline|doxycycline/i,
    drugs: /tetracycline|doxycycline|minocycline/i,
  },
  {
    allergy: /clindamycin|lincomycin/i,
    drugs: /clindamycin|lincomycin|dalacin/i,
  },
]

export interface AllergyClash {
  /** The allergy as the record spells it, so the clinician recognises it. */
  allergy: string
  /** The medication as the prescription spells it. */
  drug: string
  note?: string
}

/**
 * Does this medication clash with anything the patient is allergic to?
 *
 * Deliberately conservative in both directions. It matches on drug *families*,
 * so an allergy to penicillin catches amoxicillin, which is the mistake worth
 * catching — but it will not catch an allergy this list has never heard of, and
 * it is therefore a second pair of eyes rather than a guarantee. Nothing here
 * blocks a prescription: a clinician may have a reason, and software that
 * refuses outright gets worked around.
 *
 * Both the brand name and the generic are checked, because either may be the
 * one written down.
 */
export function allergyClashes(
  allergies: string[] | null | undefined,
  medication: { name?: string | null; genericName?: string | null }
): AllergyClash[] {
  const recorded = normalizeList(allergies)
  if (recorded.length === 0) return []

  const written = [medication.name, medication.genericName]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join(' ')
  if (!written.trim()) return []

  const clashes: AllergyClash[] = []
  const seen = new Set<string>()

  for (const allergy of recorded) {
    for (const family of DRUG_FAMILIES) {
      if (!family.allergy.test(allergy)) continue
      if (!family.drugs.test(written)) continue

      // One line per allergy, not one per pattern that happened to fire. The
      // penicillin entries below would otherwise report the same allergy twice.
      const key = `${allergy.toLowerCase()}|${family.note ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)

      clashes.push({
        allergy,
        drug: medication.name?.trim() || medication.genericName?.trim() || written.trim(),
        note: family.note,
      })
    }
  }

  return clashes
}

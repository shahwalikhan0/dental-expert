/**
 * What the left column of a clinical sheet prints under Clinical History, and
 * how much room each left-column section leaves for the pen. Shared by the
 * prescription and the treatment record so the two sheets match the one pad.
 */

/** The parts of `MedicalHistory` a sheet prints; every field optional. */
export interface PrintMedicalHistory {
  allergies?: string[]
  conditions?: string[]
  currentMedications?: string[]
  isPregnant?: boolean
  pregnancyWeeks?: number | null
  previousDentalWork?: string | null
}

const listed = (values: string[] | undefined) =>
  values && values.length > 0 ? values.join(', ') : null

/**
 * Label / value lines for the Clinical History section. No allergies: the
 * clinic leaves them off its sheets.
 */
export function clinicalHistoryLines(
  history: PrintMedicalHistory | null | undefined
): [string, string | null][] {
  if (!history) return []
  return [
    ['Conditions', listed(history.conditions)],
    ['Medication', listed(history.currentMedications)],
    [
      'Pregnancy',
      history.isPregnant
        ? history.pregnancyWeeks
          ? `Pregnant, ${history.pregnancyWeeks} weeks`
          : 'Pregnant'
        : null,
    ],
    ['Previous dental work', history.previousDentalWork ?? null],
  ]
}

/**
 * Writing room in mm on an A4 sheet (scaled for smaller paper by the print
 * stylesheet): the larger figure when nothing is on record, the smaller under
 * what was printed. Sized so the left column (patient, dentist and these
 * three) fits one A4 sheet inside the default letterhead margins with room
 * to spare.
 */
export const PRINT_WRITING_SPACE = {
  clinicalHistory: { empty: 38, filled: 14 },
  examination: { empty: 32, filled: 12 },
  treatmentPlanning: { empty: 38, filled: 14 },
} as const

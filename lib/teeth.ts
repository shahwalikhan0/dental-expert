/**
 * A set of teeth, written down.
 *
 * `Treatment`, `TreatmentPlanItem`, `LabOrder` and now `Prescription` all store
 * teeth the same way: FDI numbers in one comma-separated column. It is not the
 * shape a database person would choose — no referential integrity, a parse at
 * every read — but it is the shape three tables already use, and a fourth way
 * of writing down a set of teeth would be worse than a consistent imperfect
 * one. What was missing was one place that does the parsing, so that a column
 * written by the treatment form and read by the prescription form agrees with
 * itself.
 *
 * FDI two-digit notation throughout, matching `lib/treatment-utils.ts`:
 * quadrant first (1 upper right, 2 upper left, 3 lower left, 4 lower right),
 * then the tooth, 1 at the midline out to 8 at the third molar. So 46 is the
 * lower right first molar — the tooth most often extracted, and the one most
 * often typed into these columns.
 *
 * Primary (deciduous) teeth are FDI too, in quadrants 5–8 — 5 upper right, 6
 * upper left, 7 lower left, 8 lower right — with five teeth each, 1 at the
 * midline out to 5 at the second primary molar. So 75 is a child's lower left
 * second molar. Both dentitions are teeth here (bug report 12 Oct, findings 54
 * and 55): a clinic that sees children charts, treats and prescribes for 75 as
 * readily as for 46, and a column that silently dropped it would print a
 * child's extraction as having no tooth at all.
 */

/** Permanent teeth, by quadrant, in the order a chart draws them. */
export const FDI_QUADRANTS = {
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
  lowerLeft: [38, 37, 36, 35, 34, 33, 32, 31],
  lowerRight: [41, 42, 43, 44, 45, 46, 47, 48],
} as const

export const ALL_TEETH: number[] = [
  ...FDI_QUADRANTS.upperRight,
  ...FDI_QUADRANTS.upperLeft,
  ...FDI_QUADRANTS.lowerLeft,
  ...FDI_QUADRANTS.lowerRight,
]

/** Primary teeth, by quadrant, in the same drawing order as the permanent ones. */
export const PRIMARY_QUADRANTS = {
  upperRight: [55, 54, 53, 52, 51],
  upperLeft: [61, 62, 63, 64, 65],
  lowerLeft: [75, 74, 73, 72, 71],
  lowerRight: [81, 82, 83, 84, 85],
} as const

export const ALL_PRIMARY_TEETH: number[] = [
  ...PRIMARY_QUADRANTS.upperRight,
  ...PRIMARY_QUADRANTS.upperLeft,
  ...PRIMARY_QUADRANTS.lowerLeft,
  ...PRIMARY_QUADRANTS.lowerRight,
]

export type Dentition = 'permanent' | 'primary'

/** The quadrants of one dentition, for the screens that draw a mouth. */
export function quadrantsOf(
  dentition: Dentition
): Record<keyof typeof FDI_QUADRANTS, readonly number[]> {
  return dentition === 'primary' ? PRIMARY_QUADRANTS : FDI_QUADRANTS
}

const PERMANENT = new Set(ALL_TEETH)
const PRIMARY = new Set(ALL_PRIMARY_TEETH)

/** Is this a permanent tooth in FDI notation (11–48)? */
export function isPermanentTooth(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && PERMANENT.has(value)
}

/** Is this a primary tooth in FDI notation (51–85)? */
export function isPrimaryTooth(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && PRIMARY.has(value)
}

/** Is this a tooth in FDI notation, permanent or primary? */
export function isTooth(value: unknown): boolean {
  return isPermanentTooth(value) || isPrimaryTooth(value)
}

/** What a refused tooth number is told. One wording, on every form that takes teeth. */
export const TOOTH_NUMBER_HINT =
  'Use FDI numbers: 11–48 for permanent teeth, 51–85 for primary teeth.'

export type TeethInput =
  { ok: true; column: string | null; teeth: number[] } | { ok: false; error: string }

/**
 * Teeth sent by a form, checked before they are stored.
 *
 * `parseTeeth` is tolerant because it reads columns that already exist. This
 * is the other end: what goes *into* a column. A treatment was saved with teeth
 * `"99,ABC"` (bug report 12 Oct, finding 54) because nothing looked, and
 * `parseTeeth` would then have shown it as no teeth at all. So a value that is
 * not a tooth is refused with the number that was wrong, rather than dropped.
 *
 * Takes the comma-separated string the forms send, or an array of numbers.
 * Spacing and empty segments are tolerated — `"46, 47,"` is two teeth, not a
 * mistake. Nothing at all is `null`, the same as `formatTeeth`.
 */
export function readTeeth(value: unknown): TeethInput {
  if (value === undefined || value === null || value === '') {
    return { ok: true, column: null, teeth: [] }
  }

  const parts: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? String(value).split(',')
      : [value]

  const teeth: number[] = []
  for (const part of parts) {
    const text = String(part ?? '').trim()
    if (text === '') continue
    const n = /^\d+$/.test(text) ? Number(text) : NaN
    if (!isTooth(n)) {
      return { ok: false, error: `"${text}" is not a tooth. ${TOOTH_NUMBER_HINT}` }
    }
    teeth.push(n)
  }

  const clean = [...new Set(teeth)].sort((a, b) => a - b)
  return { ok: true, column: clean.length ? clean.join(',') : null, teeth: clean }
}

/**
 * The teeth in a stored column, as numbers.
 *
 * Tolerant on the way in because these columns have been written by hand and
 * by three different forms: spaces, stray commas and empty segments are all
 * dropped rather than producing a `NaN` that would render as "Teeth: NaN" on a
 * prescription. Anything that is not an FDI tooth, permanent or primary, is
 * discarded — an unparseable value is not a tooth, and showing it as one would
 * be worse than showing nothing.
 *
 * Sorted and de-duplicated, so two columns holding the same teeth in different
 * orders compare equal.
 */
export function parseTeeth(value: string | null | undefined): number[] {
  if (!value) return []
  const seen = new Set<number>()
  for (const part of String(value).split(',')) {
    const n = Number(part.trim())
    if (isTooth(n)) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * Teeth back into a column, or null when there are none.
 *
 * Null rather than an empty string: "no teeth recorded" and "the empty set of
 * teeth" are the same thing clinically, and storing both would mean every
 * reader has to check for both.
 */
export function formatTeeth(teeth: number[] | null | undefined): string | null {
  if (!teeth?.length) return null
  const clean = [...new Set(teeth.filter(isTooth))].sort((a, b) => a - b)
  return clean.length ? clean.join(',') : null
}

/**
 * Which quadrant a tooth is in, or null if it is not a tooth.
 *
 * A primary tooth is in the same quadrant of the mouth as the permanent tooth
 * that replaces it — 55 and 15 are both upper right — so both dentitions share
 * the four keys.
 */
export function quadrantOf(tooth: number): keyof typeof FDI_QUADRANTS | null {
  if (!isTooth(tooth)) return null
  switch (Math.floor(tooth / 10)) {
    case 1:
    case 5:
      return 'upperRight'
    case 2:
    case 6:
      return 'upperLeft'
    case 3:
    case 7:
      return 'lowerLeft'
    default:
      return 'lowerRight'
  }
}

/**
 * How a set of teeth reads on screen.
 *
 * Runs of adjacent teeth within one quadrant are collapsed — "16–13" rather
 * than "16, 15, 14, 13" — because a full-arch case otherwise prints sixteen
 * numbers where a dentist reads one span. Runs are never collapsed across the
 * midline: "13–23" would span two quadrants and read as eleven teeth to
 * anybody who knows the notation, when it means four.
 */
export function describeTeeth(teeth: number[] | null | undefined): string {
  const list = [...new Set((teeth ?? []).filter(isTooth))].sort((a, b) => a - b)
  if (list.length === 0) return ''

  const spans: string[] = []
  let start = list[0]
  let previous = list[0]

  const flush = () => {
    if (start === previous) spans.push(String(start))
    else if (previous - start === 1) spans.push(`${start}, ${previous}`)
    else spans.push(`${start}–${previous}`)
  }

  for (const tooth of list.slice(1)) {
    const sameQuadrant = quadrantOf(tooth) === quadrantOf(previous)
    if (sameQuadrant && tooth - previous === 1) {
      previous = tooth
      continue
    }
    flush()
    start = tooth
    previous = tooth
  }
  flush()

  return spans.join(', ')
}

/**
 * The four quadrants, in FDI's own order, with the names people use for them.
 *
 * `short` is the two-letter form a clinician writes on a chart — UR, UL, LL,
 * LR. `side` is the patient's own left and right, not the viewer's: tooth 11
 * is in the patient's upper *right*, which is drawn on the left of every chart
 * in this application because a chart is drawn as you face the patient.
 */
export const QUADRANTS = [
  { key: 'upperRight', short: 'UR', label: 'Upper right', number: 1 },
  { key: 'upperLeft', short: 'UL', label: 'Upper left', number: 2 },
  { key: 'lowerLeft', short: 'LL', label: 'Lower left', number: 3 },
  { key: 'lowerRight', short: 'LR', label: 'Lower right', number: 4 },
] as const satisfies readonly {
  key: keyof typeof FDI_QUADRANTS
  short: string
  label: string
  number: number
}[]

export interface ToothGroup {
  key: keyof typeof FDI_QUADRANTS
  /** UR, UL, LL, LR. */
  short: string
  /** "Upper right". */
  label: string
  /** The teeth themselves, low to high. */
  teeth: number[]
  /** Those teeth with adjacent runs collapsed — "16–13". */
  description: string
}

/**
 * A set of teeth, split into the quadrants it touches.
 *
 * "13, 15, 25, 34, 44" is five numbers and no shape. Nobody reads it as "two
 * on the patient's upper right, one upper left, one lower left, one lower
 * right" without doing the arithmetic in their head, and the arithmetic is the
 * part FDI notation was meant to remove. Grouped, the quadrant is read rather
 * than derived.
 *
 * Empty quadrants are left out, so a case confined to one quadrant reads as
 * one line rather than three blanks and a line.
 */
export function groupTeeth(teeth: number[] | null | undefined): ToothGroup[] {
  const list = [...new Set((teeth ?? []).filter(isTooth))].sort((a, b) => a - b)

  return QUADRANTS.map(({ key, short, label }) => {
    const inQuadrant = list.filter((tooth) => quadrantOf(tooth) === key)
    return { key, short, label, teeth: inQuadrant, description: describeTeeth(inQuadrant) }
  }).filter((group) => group.teeth.length > 0)
}

/**
 * A set of teeth on one line, by quadrant: "UR 13, 15 · UL 25 · LL 34".
 *
 * For the places that have room for a sentence and not a layout — a printed
 * prescription, a grid cell, a tooltip. Where there is room, render
 * {@link groupTeeth} instead and let each quadrant have its own label.
 */
export function describeTeethByQuadrant(teeth: number[] | null | undefined): string {
  return groupTeeth(teeth)
    .map((group) => `${group.short} ${group.description}`)
    .join(' · ')
}

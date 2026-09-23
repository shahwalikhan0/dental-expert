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

const VALID = new Set(ALL_TEETH)

/** Is this a permanent tooth in FDI notation? */
export function isTooth(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && VALID.has(value)
}

/**
 * The teeth in a stored column, as numbers.
 *
 * Tolerant on the way in because these columns have been written by hand and
 * by three different forms: spaces, stray commas and empty segments are all
 * dropped rather than producing a `NaN` that would render as "Teeth: NaN" on a
 * prescription. Anything that is not a permanent FDI tooth is discarded — an
 * unparseable value is not a tooth, and showing it as one would be worse than
 * showing nothing.
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

/** Which quadrant a tooth is in, or null if it is not a tooth. */
export function quadrantOf(tooth: number): keyof typeof FDI_QUADRANTS | null {
  if (!isTooth(tooth)) return null
  switch (Math.floor(tooth / 10)) {
    case 1:
      return 'upperRight'
    case 2:
      return 'upperLeft'
    case 3:
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

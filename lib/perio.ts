import type { PerioSite } from '@prisma/client'

/**
 * The periodontal chart — what the gum around each tooth is doing.
 *
 * §3 puts "periodontal findings where required" in scope. What the application
 * had was `PERIODONTIC` as a procedure category: a billing code, not a clinical
 * record. The tooth chart says what a tooth *is*; this says what is happening
 * around it, and the two are read together.
 *
 * Six sites per tooth is the standard full-mouth chart — three buccal, three
 * lingual — probed in a fixed order so two clinicians reading the same chart
 * are reading the same mouth.
 */

/** Buccal, then lingual, each mesial → distal. The order a probe walks. */
export const BUCCAL_SITES: PerioSite[] = ['DB', 'B', 'MB']
export const LINGUAL_SITES: PerioSite[] = ['DL', 'L', 'ML']
export const ALL_SITES: PerioSite[] = [...BUCCAL_SITES, ...LINGUAL_SITES]

export const SITE_LABELS: Record<PerioSite, string> = {
  MB: 'Mesio-buccal',
  B: 'Buccal',
  DB: 'Disto-buccal',
  ML: 'Mesio-lingual',
  L: 'Lingual',
  DL: 'Disto-lingual',
}

/**
 * FDI quadrants, in the order a chart is laid out on the page: upper right to
 * upper left along the top, lower left to lower right along the bottom. That is
 * the patient's mouth seen from in front, which is how it is written down.
 */
export const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
export const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH]

export function isUpper(toothNumber: number): boolean {
  return UPPER_TEETH.includes(toothNumber)
}

/**
 * Thresholds. 1–3mm is a healthy sulcus, 4–5mm is where a practice starts
 * watching, 6mm and over is disease — the bands every perio chart colours by.
 */
export const HEALTHY_MAX = 3
export const WATCH_MAX = 5

export type Severity = 'HEALTHY' | 'WATCH' | 'DISEASE' | 'UNPROBED'

export function severityOf(pocketDepth: number | null | undefined): Severity {
  if (pocketDepth == null) return 'UNPROBED'
  if (pocketDepth <= HEALTHY_MAX) return 'HEALTHY'
  if (pocketDepth <= WATCH_MAX) return 'WATCH'
  return 'DISEASE'
}

export interface Measurement {
  toothNumber: number
  site: PerioSite
  pocketDepth: number | null
  recession: number | null
  bleeding: boolean
  suppuration: boolean
  plaque: boolean
}

/**
 * Clinical attachment loss — pocket depth plus recession.
 *
 * The number that actually describes how much support a tooth has lost. A 4mm
 * pocket on a gum that has receded 3mm is a very different tooth from a 4mm
 * pocket on one that has not, and reading depth alone flatters the second.
 */
export function attachmentLoss(measurement: {
  pocketDepth: number | null
  recession: number | null
}): number | null {
  if (measurement.pocketDepth == null) return null
  return measurement.pocketDepth + (measurement.recession ?? 0)
}

export interface ExamSummary {
  sitesProbed: number
  /** Bleeding sites as a percentage of probed sites — the BOP score. */
  bleedingPercent: number
  plaquePercent: number
  deepSites: number
  worstPocket: number | null
  meanPocket: number | null
  teethCharted: number
}

/**
 * The figures a practice records at the top of a perio chart.
 *
 * Percentages are of *probed* sites, not of all 192. A partial chart that
 * bled at every site probed is 100% bleeding, and dividing by the whole mouth
 * would report it as 12% — which reads as a healthy patient.
 */
export function summarise(measurements: Measurement[]): ExamSummary {
  const probed = measurements.filter((m) => m.pocketDepth != null)
  const depths = probed.map((m) => m.pocketDepth as number)

  return {
    sitesProbed: probed.length,
    bleedingPercent: probed.length
      ? Math.round((probed.filter((m) => m.bleeding).length / probed.length) * 100)
      : 0,
    plaquePercent: probed.length
      ? Math.round((probed.filter((m) => m.plaque).length / probed.length) * 100)
      : 0,
    deepSites: depths.filter((d) => d > WATCH_MAX).length,
    worstPocket: depths.length ? Math.max(...depths) : null,
    meanPocket: depths.length
      ? Math.round((depths.reduce((sum, d) => sum + d, 0) / depths.length) * 10) / 10
      : null,
    teethCharted: new Set(probed.map((m) => m.toothNumber)).size,
  }
}

/** A probing depth the chart will accept. */
export function validDepth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15
}

/** Recession, which is negative where the margin sits above the CEJ. */
export function validRecession(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -10 && value <= 20
}

export function validTooth(value: unknown): value is number {
  return typeof value === 'number' && ALL_TEETH.includes(value)
}

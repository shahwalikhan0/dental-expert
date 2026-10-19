/**
 * One look for every chart in the application.
 *
 * The charts used to be styled where they were drawn, which is why they did not
 * match: the dashboard read these variables while the reports screen carried
 * its own copy of the Recharts documentation palette (`#8884D8`, `#0088FE`,
 * `#00C49F`), hardcoded. Two screens, two palettes, neither chosen.
 *
 * Everything a chart needs to look like the others is here, so a new chart
 * inherits the decisions rather than making them again.
 */
import { formatCurrency } from '@/lib/i18n/format'

/**
 * The categorical palette — for series that are *different things*, where
 * colour carries identity and nothing else.
 *
 * Six hues in a fixed order. Two rules, and they are what keep the set honest:
 *
 *   1. **Never cycle.** `colors[i % colors.length]` was used in four places;
 *      it means a seventh series silently becomes the same colour as the
 *      first. `seriesColor()` folds instead — see below.
 *   2. **Colour follows the entity, never its rank.** A filter that drops a
 *      series must not repaint the ones that remain, so the index must come
 *      from a stable key, not from the position in a filtered array.
 *
 * The values live in globals.css so light and dark are declared together, and
 * they were validated against this application's own surfaces for lightness,
 * chroma, colour-vision separation and contrast. Three of the light steps sit
 * below 3:1 on white, which obligates every chart using them to carry visible
 * labels or a legend — all of them do.
 */
export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
] as const

/** Anything past the sixth series. Grey, and labelled "Other" by the caller. */
export const CHART_OTHER = 'hsl(var(--muted-foreground))'

/**
 * The colour for series `index`.
 *
 * Past the sixth, grey rather than a repeat of slot 1. A chart with seven
 * series has a problem the palette cannot solve, and showing two of them in the
 * same blue hides it instead of saying so.
 */
export function seriesColor(index: number): string {
  return CHART_COLORS[index] ?? CHART_OTHER
}

/**
 * The sequential ramp — one hue, light to dark, for *parts of one quantity*.
 *
 * This is what a pie or a share-of-total breakdown should use. Those are
 * magnitude questions ("which is the biggest slice?"), and lightness answers
 * magnitude directly, where six arbitrary hues only label the slices and leave
 * the reader to compare areas.
 *
 * It is also the only way a six-slice pie can be read by a colourblind viewer.
 * In a pie every slice can touch every other, and no ordering of six
 * categorical hues clears the separation floor across all fifteen pairs — the
 * measured worst case was ΔE 3.2 for a protanope. A ramp ordered by size has no
 * such problem: the steps differ in lightness, which every kind of colour
 * vision reads.
 */
/**
 * A step of the sequential ramp for slice `index` of `count`.
 *
 * Interpolated between the ramp's two ends rather than picked from a fixed
 * list of six. A list ran out: appointment status has seven values in this
 * clinic's data, and the seventh slice was handed the same shade as the
 * fourth — two slices the reader is being asked to compare, drawn identically.
 *
 * The hue, saturation and both ends are CSS variables, so the direction
 * reverses for dark mode (light-on-dark rather than dark-on-light) without
 * this function knowing which theme is on.
 *
 * Callers pass data sorted largest-first, which puts the far end of the ramp
 * on the biggest slice.
 */
export function sequentialColor(index: number, count: number): string {
  const t = count <= 1 ? 1 : index / (count - 1)
  // `calc` does the interpolation at paint time, against whichever theme's
  // variables are in scope.
  return `hsl(var(--chart-seq-hue) var(--chart-seq-sat) calc(var(--chart-seq-from) + (var(--chart-seq-to) - var(--chart-seq-from)) * ${t.toFixed(4)}))`
}

/**
 * Status colours. Reserved — never reused as "series 4".
 *
 * A reader who has learnt that red means trouble on one screen must not meet it
 * as an ordinary series on the next.
 */
export const CHART_SEMANTIC = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--chart-3))',
  warning: 'hsl(var(--chart-4))',
  danger: 'hsl(var(--destructive))',
  muted: 'hsl(var(--muted-foreground))',
} as const

/**
 * Grid, axes and marks.
 *
 * Spread onto the Recharts elements so every chart has the same weights. The
 * defaults are what made the old charts look dated: a 1px mid-grey dashed grid
 * in both directions, a tick on every axis line, and a 3px line over it all.
 */

/** A horizontal rule only. Vertical grid lines fight the bars they sit behind. */
export const gridProps = {
  stroke: 'hsl(var(--chart-grid))',
  strokeDasharray: '0',
  vertical: false,
} as const

export const axisProps = {
  stroke: 'transparent',
  tickLine: false,
  axisLine: false,
  tick: { fill: 'hsl(var(--chart-axis))', fontSize: 11 },
} as const

/** Lines: 2px, no dot per point, a ring on the hovered one. */
export const lineProps = {
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' },
} as const

/**
 * Bars: rounded at the data end only, so the bar still reads as growing from
 * the baseline rather than floating.
 */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]
export const BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0]

/** The hover band behind a bar. Faint — it marks the column, it is not a mark. */
export const barCursor = { fill: 'hsl(var(--muted))', fillOpacity: 0.5 } as const

/** The crosshair on a line or area chart. */
export const lineCursor = {
  stroke: 'hsl(var(--chart-axis))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
} as const

/**
 * The 2px gap between touching fills — adjacent pie slices, stacked segments.
 * Drawn in the card colour so the separation survives both themes.
 */
export const SLICE_GAP = {
  stroke: 'hsl(var(--card))',
  strokeWidth: 2,
} as const

/**
 * A money value as an axis tick: `Rs 400`, `Rs 40k`, `-Rs 1.2M`.
 *
 * The financial trend's axis was `formatCurrency` in full, which at six
 * figures is wider than the 64px the axis reserves — so Recharts clipped the
 * overflow at the left edge and ate the minus sign. The axis read
 * `Rs 40,000 … Rs 0 … Rs 20,000`, the same two numbers above and below the
 * baseline, with nothing to say which half was a loss.
 *
 * Abbreviating fixes the clipping rather than papering over it, and a tick is
 * the one place a rounded figure is what the reader wants: the exact amount is
 * in the tooltip.
 */
const TICK_UNITS = [
  { limit: 1_000_000, suffix: 'M' },
  { limit: 1_000, suffix: 'k' },
] as const

export function moneyTick(value: number): string {
  const unit = TICK_UNITS.find((candidate) => Math.abs(value) >= candidate.limit)
  if (!unit) return formatCurrency(value, { maximumFractionDigits: 0 })

  const scaled = value / unit.limit
  // One decimal only where it says something: `1.2M`, but `40k`, not `40.0k`.
  const digits = Math.abs(scaled) < 10 && !Number.isInteger(scaled) ? 1 : 0
  const amount = formatCurrency(scaled, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${amount}${unit.suffix}`
}

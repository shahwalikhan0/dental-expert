/**
 * The odontogram printed in the left column of a prescription or treatment
 * record, like the row of teeth on the clinic's own pad.
 *
 * Every tooth is drawn; the ones this document is about are filled in black,
 * so the sheet says "lower right first molar" before anyone reads a number.
 * Under it, the marked teeth in words ("UR 16"), for anyone who reads a chart
 * slower than a line. Drawn as you face the patient, as the chart on screen is: the patient's
 * right is on the left of the sheet. The primary dentition is added under the
 * permanent one only when a primary tooth is involved; most sheets are adults'
 * and a second chart nobody uses is clutter.
 *
 * Plain SVG with fixed colours: a print frame carries none of the app's CSS
 * variables, and a sheet has to read the same in black and white.
 */
import { toothShape } from '@/components/dental-chart/tooth-glyph'
import { describeTeethByQuadrant, FDI_QUADRANTS, PRIMARY_QUADRANTS } from '@/lib/teeth'

/** One tooth's cell, in SVG units. A glyph is drawn in 40, so a quarter scale. */
const CELL = 10
/** The gap either side of the midline. */
const MIDLINE = 3
/** Height of a row of numbers. */
const LABEL = 6

const INK = '#111827'
const LINE = '#6b7280'

interface Rows {
  upper: number[]
  lower: number[]
}

/** Left to right as the sheet is read: patient's right first. */
function rowsOf(quadrants: typeof FDI_QUADRANTS | typeof PRIMARY_QUADRANTS): Rows {
  return {
    upper: [...quadrants.upperRight, ...quadrants.upperLeft],
    lower: [...[...quadrants.lowerRight].reverse(), ...[...quadrants.lowerLeft].reverse()],
  }
}

function Arch({
  rows,
  x0,
  y0,
  marked,
}: {
  rows: Rows
  x0: number
  y0: number
  marked: Set<number>
}) {
  const half = rows.upper.length / 2
  const xOf = (index: number) => x0 + index * CELL + (index >= half ? MIDLINE : 0)
  const width = rows.upper.length * CELL + MIDLINE
  const upperY = y0 + LABEL
  const lowerY = upperY + CELL + 1.5

  const tooth = (number: number, index: number, arch: 'upper' | 'lower', y: number) => {
    const shape = toothShape(number, arch)
    const on = marked.has(number)
    const x = xOf(index)
    return (
      <g key={number}>
        <g transform={`translate(${x} ${y}) scale(0.25)`}>
          <path
            d={shape.outline}
            fill={on ? INK : '#fff'}
            stroke={on ? INK : LINE}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
          {shape.lines.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke={on ? '#fff' : LINE}
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={on ? 0.9 : 0.5}
            />
          ))}
        </g>
        <text
          x={x + CELL / 2}
          y={arch === 'upper' ? y - 1.2 : y + CELL + 4.6}
          textAnchor="middle"
          fontSize={4.2}
          fontWeight={on ? 700 : 400}
          fill={on ? INK : LINE}
        >
          {number}
        </text>
      </g>
    )
  }

  const midX = x0 + half * CELL + MIDLINE / 2
  return (
    <g>
      {rows.upper.map((n, i) => tooth(n, i, 'upper', upperY))}
      {rows.lower.map((n, i) => tooth(n, i, 'lower', lowerY))}
      {/* The cross every odontogram is drawn on: midline and occlusal plane. */}
      <line
        x1={midX}
        x2={midX}
        y1={upperY - 1}
        y2={lowerY + CELL + 1}
        stroke={INK}
        strokeWidth={0.4}
      />
      <line
        x1={x0 - 1}
        x2={x0 + width + 1}
        y1={upperY + CELL + 0.75}
        y2={upperY + CELL + 0.75}
        stroke={INK}
        strokeWidth={0.4}
      />
    </g>
  )
}

export function PrintToothChart({ teeth }: { teeth: number[] }) {
  const marked = new Set(teeth)
  const withPrimary = teeth.some((t) => t >= 51)

  const permanent = rowsOf(FDI_QUADRANTS)
  const primary = rowsOf(PRIMARY_QUADRANTS)
  const width = permanent.upper.length * CELL + MIDLINE
  // Each arch: numbers, upper row, plane, lower row, numbers.
  const archHeight = LABEL + CELL * 2 + 1.5 + LABEL
  const sideLabels = 5
  const height = sideLabels + archHeight + (withPrimary ? archHeight + 2 : 0)
  const primaryX = (width - (primary.upper.length * CELL + MIDLINE)) / 2

  return (
    <div className="pd-chart-block">
      <svg
        className="pd-chart"
        viewBox={`-1 0 ${width + 2} ${height}`}
        role="img"
        aria-label={
          teeth.length > 0 ? `Dental chart, teeth ${teeth.join(', ')} marked` : 'Dental chart'
        }
      >
        <text x={0} y={3.8} fontSize={3.8} fill={LINE}>
          Patient&apos;s right
        </text>
        <text x={width} y={3.8} fontSize={3.8} fill={LINE} textAnchor="end">
          Patient&apos;s left
        </text>
        <Arch rows={permanent} x0={0} y0={sideLabels} marked={marked} />
        {withPrimary && (
          <Arch rows={primary} x0={primaryX} y0={sideLabels + archHeight + 2} marked={marked} />
        )}
      </svg>
      {teeth.length > 0 && (
        <p className="pd-teeth">
          <span className="pd-muted">{teeth.length === 1 ? 'Tooth' : 'Teeth'}: </span>
          {describeTeethByQuadrant(teeth)}
        </p>
      )}
    </div>
  )
}

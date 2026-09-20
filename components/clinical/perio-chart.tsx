'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  BUCCAL_SITES,
  LINGUAL_SITES,
  LOWER_TEETH,
  UPPER_TEETH,
  attachmentLoss,
  severityOf,
  type Measurement,
  type Severity,
} from '@/lib/perio'
import type { PerioSite } from '@prisma/client'

/**
 * The periodontal chart.
 *
 * Drawn as an SVG because that is what this is: a picture of a mouth with a
 * number under every site, read left to right the way it was probed. A table of
 * 192 inputs holds the same data and tells a clinician nothing — the point of
 * the chart is the *shape* of the line the pocket depths make, because a run of
 * deep sites on adjacent teeth is periodontal disease and the same numbers
 * scattered across the mouth are usually probing error.
 *
 * Each tooth is one column: buccal sites above the tooth, lingual below, in
 * probing order. Colour follows the standard bands — 1–3mm healthy, 4–5mm
 * watch, 6mm and over disease — and a bleeding site is marked whatever its
 * depth, because bleeding on probing is the earliest sign there is.
 */

const SEVERITY_FILL: Record<Severity, string> = {
  HEALTHY: 'fill-green-500/70',
  WATCH: 'fill-amber-500/80',
  DISEASE: 'fill-red-500/80',
  UNPROBED: 'fill-muted-foreground/20',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  HEALTHY: 'text-green-700 dark:text-green-400',
  WATCH: 'text-amber-700 dark:text-amber-400',
  DISEASE: 'text-red-700 dark:text-red-400',
  UNPROBED: 'text-muted-foreground',
}

const TOOTH_WIDTH = 34
const SITE_HEIGHT = 16
const TOOTH_HEIGHT = 30

export interface PerioChartProps {
  measurements: Measurement[]
  toothFindings?: { toothNumber: number; isMissing?: boolean; isImplant?: boolean }[]
  /** Editing turns every site into an input. Read-only renders the same chart. */
  onChange?: (toothNumber: number, site: PerioSite, patch: Partial<Measurement>) => void
  className?: string
}

function key(toothNumber: number, site: PerioSite) {
  return `${toothNumber}-${site}`
}

/**
 * One arch.
 *
 * Declared at module scope: a component created inside the chart's render is a
 * new type on every keystroke, so every probing-depth input would lose focus as
 * soon as it was typed into.
 *
 * The rows go site-row, teeth, site-row. The lingual row sits nearest the
 * midline of the page in both arches — upper reads buccal then lingual
 * downwards, lower the other way round — which is how a chart is drawn and how
 * it is read back.
 */
function Arch({
  teeth,
  lowerArch,
  byKey,
  missing,
  onChange,
  focus,
  setFocus,
}: {
  teeth: number[]
  lowerArch: boolean
  byKey: Map<string, Measurement>
  missing: Set<number>
  onChange?: (toothNumber: number, site: PerioSite, patch: Partial<Measurement>) => void
  focus: string | null
  setFocus: (value: string | null) => void
}) {
  const siteRow = (sites: PerioSite[], label: string) => (
    <div className="flex items-stretch">
      <div className="w-16 shrink-0 self-center pr-2 text-right text-[10px] text-muted-foreground">
        {label}
      </div>
      {teeth.map((tooth) => (
        <div
          key={`${tooth}-${label}`}
          className="flex border-l last:border-r"
          style={{ width: TOOTH_WIDTH }}
        >
          {sites.map((site) => {
            const measurement = byKey.get(key(tooth, site))
            const severity = severityOf(measurement?.pocketDepth)
            const cellKey = key(tooth, site)

            return (
              <div
                key={site}
                className="relative flex-1"
                style={{ height: SITE_HEIGHT }}
                title={`${tooth} ${site}${
                  measurement?.pocketDepth != null
                    ? ` · ${measurement.pocketDepth}mm${
                        attachmentLoss(measurement) != null
                          ? ` · CAL ${attachmentLoss(measurement)}mm`
                          : ''
                      }`
                    : ' · not probed'
                }`}
              >
                {onChange ? (
                  <input
                    inputMode="numeric"
                    aria-label={`Probing depth, tooth ${tooth}, ${site}`}
                    value={measurement?.pocketDepth ?? ''}
                    onFocus={() => setFocus(cellKey)}
                    onBlur={() => setFocus(null)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
                      onChange(tooth, site, { pocketDepth: raw === '' ? null : Number(raw) })
                    }}
                    className={cn(
                      'h-full w-full bg-transparent text-center text-[11px] tabular-nums outline-none',
                      'focus:bg-primary/10',
                      SEVERITY_TEXT[severity],
                      focus === cellKey && 'ring-1 ring-ring'
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      'flex h-full w-full items-center justify-center text-[11px] tabular-nums',
                      SEVERITY_TEXT[severity]
                    )}
                  >
                    {measurement?.pocketDepth ?? '·'}
                  </span>
                )}

                {/* Bleeding is a dot rather than a colour: a site can bleed at
                    any depth, and the colour is already saying the depth. */}
                {measurement?.bleeding && (
                  <span
                    aria-label="bleeding on probing"
                    className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-600"
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )

  const toothRow = (
    <div className="flex">
      <div className="w-16 shrink-0" />
      {teeth.map((tooth) => {
        const worst = worstOnTooth(byKey, tooth)
        return (
          <svg
            key={tooth}
            width={TOOTH_WIDTH}
            height={TOOTH_HEIGHT}
            viewBox="0 0 34 30"
            className="border-l last:border-r"
            role="img"
            aria-label={`Tooth ${tooth}`}
          >
            {missing.has(tooth) ? (
              <g className="stroke-muted-foreground" strokeWidth="1.5">
                <line x1="9" y1="7" x2="25" y2="23" />
                <line x1="25" y1="7" x2="9" y2="23" />
              </g>
            ) : (
              <>
                {/* Crown and a suggestion of roots — enough to read as a tooth
                    at this size without pretending to be anatomy. */}
                <path
                  d="M8 4 h18 a3 3 0 0 1 3 3 v8 a3 3 0 0 1 -3 3 h-18 a3 3 0 0 1 -3 -3 v-8 a3 3 0 0 1 3 -3 z"
                  className={cn('stroke-border', SEVERITY_FILL[worst])}
                  strokeWidth="1"
                />
                <path
                  d="M11 18 l-2 8 M23 18 l2 8"
                  className="stroke-border"
                  strokeWidth="1.5"
                  fill="none"
                />
              </>
            )}
          </svg>
        )
      })}
    </div>
  )

  const numbers = (
    <div className="flex">
      <div className="w-16 shrink-0" />
      {teeth.map((tooth) => (
        <div
          key={tooth}
          className={cn(
            'text-center text-[11px] font-medium tabular-nums',
            missing.has(tooth) && 'text-muted-foreground line-through'
          )}
          style={{ width: TOOTH_WIDTH }}
        >
          {tooth}
        </div>
      ))}
    </div>
  )

  return (
    <div className="min-w-max">
      {numbers}
      {lowerArch ? (
        <>
          {siteRow(LINGUAL_SITES, 'Lingual')}
          {toothRow}
          {siteRow(BUCCAL_SITES, 'Buccal')}
        </>
      ) : (
        <>
          {siteRow(BUCCAL_SITES, 'Buccal')}
          {toothRow}
          {siteRow(LINGUAL_SITES, 'Lingual')}
        </>
      )}
    </div>
  )
}

export function PerioChart({
  measurements,
  toothFindings = [],
  onChange,
  className,
}: PerioChartProps) {
  const [focus, setFocus] = useState<string | null>(null)

  const byKey = useMemo(() => {
    const map = new Map<string, Measurement>()
    for (const m of measurements) map.set(key(m.toothNumber, m.site), m)
    return map
  }, [measurements])

  const missing = useMemo(
    () => new Set(toothFindings.filter((f) => f.isMissing).map((f) => f.toothNumber)),
    [toothFindings]
  )

  return (
    <div className={cn('space-y-6 overflow-x-auto', className)}>
      <Arch
        teeth={UPPER_TEETH}
        lowerArch={false}
        byKey={byKey}
        missing={missing}
        onChange={onChange}
        focus={focus}
        setFocus={setFocus}
      />
      <Arch
        teeth={LOWER_TEETH}
        lowerArch
        byKey={byKey}
        missing={missing}
        onChange={onChange}
        focus={focus}
        setFocus={setFocus}
      />

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-green-500/70" /> 1–3mm
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-500/80" /> 4–5mm
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-red-500/80" /> 6mm and over
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-600" /> bleeding on probing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-muted-foreground/20" /> not probed
        </span>
      </div>
    </div>
  )
}

/** The deepest pocket on a tooth decides how the tooth itself is coloured. */
function worstOnTooth(byKey: Map<string, Measurement>, tooth: number): Severity {
  let worst: number | null = null
  for (const site of [...BUCCAL_SITES, ...LINGUAL_SITES]) {
    const depth = byKey.get(key(tooth, site))?.pocketDepth
    if (depth != null && (worst === null || depth > worst)) worst = depth
  }
  return severityOf(worst)
}

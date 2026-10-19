'use client'

/**
 * The tooltip every chart uses.
 *
 * Recharts' default is a white box with a 1px grey border and a stack of
 * `name : value` lines in the series colour. Three things were wrong with it
 * here: it is white in dark mode as well, it has no idea what this application
 * looks like, and it puts the text in the series colour — which fails as soon
 * as the colour is one of the pale steps.
 *
 * This one wears the card surface, the app's radius and shadow, and its text
 * in ordinary ink. A colour swatch beside each row carries identity, which is
 * what colour is for.
 */
/**
 * Declared here rather than extended from Recharts' own `TooltipProps`, whose
 * generic shape has changed between majors. These are the four fields Recharts
 * passes to a `content` element and the two this component adds; a narrower
 * surface is also a smaller thing to fix when it changes again.
 */
export interface ChartTooltipProps {
  active?: boolean
  label?: unknown
  payload?: readonly {
    value?: number | string
    name?: unknown
    color?: string
    dataKey?: string | number
  }[]
  /** How to render each value. Defaults to the number as written. */
  format?: (value: number, name: string) => string
  /** Shown above the rows — usually the x value. Defaults to the Recharts label. */
  heading?: (label: unknown) => string
}

export function ChartTooltip({ active, payload, label, format, heading }: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
      {label !== undefined && label !== '' && (
        <p className="mb-1 text-xs font-medium text-foreground">
          {heading ? heading(label) : String(label)}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((row, index) => {
          const value = typeof row.value === 'number' ? row.value : Number(row.value)
          const name = String(row.name ?? '')
          return (
            <div key={`${name}-${index}`} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                // The one place a series colour is allowed outside the plot:
                // a swatch, never the text.
                style={{ backgroundColor: row.color ?? 'hsl(var(--muted-foreground))' }}
              />
              <span className="text-muted-foreground">{name}</span>
              <span className="ml-auto font-medium tabular-nums text-foreground">
                {Number.isFinite(value) ? (format ? format(value, name) : value) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The legend every chart uses.
 *
 * Present whenever there are two or more series — identity must never be
 * carried by colour alone. A single-series chart gets none: its title already
 * names the thing.
 */
export function ChartLegend({
  payload,
}: {
  payload?: readonly { value?: unknown; color?: string }[]
}) {
  if (!payload?.length) return null

  return (
    <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {payload.map((entry, index) => (
        <li key={index} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color ?? 'hsl(var(--muted-foreground))' }}
          />
          {String(entry.value ?? '')}
        </li>
      ))}
    </ul>
  )
}

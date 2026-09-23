'use client'

/**
 * Choosing teeth, and seeing what is wrong with them while you choose.
 *
 * The picker this replaces drew the arches as two straight rows of identical
 * squares with a hardcoded `#374151` outline — invisible against the dark
 * theme — and listed all fourteen tooth conditions in its header whether or
 * not the patient had any of them. Worse, the one screen that used it rendered
 * it without the `entries` prop, so the chart it drew was always a healthy
 * mouth: a dentist picking teeth for a treatment could not see the caries they
 * were treating.
 *
 * This one fetches the patient's chart itself and colours what it finds, so
 * "select the defective teeth" is something you can do by looking. Three
 * decisions worth stating:
 *
 * **Findings are shown, never edited.** Charting a tooth is its own clinical
 * act with its own screen, author and date. A picker that quietly wrote
 * findings would put a diagnosis in the record as a side effect of filling in
 * a form.
 *
 * **Every tooth is a real `<button>`** with `aria-pressed`, not an SVG path
 * with a click handler. The arch shape is a transform on the row; the
 * accessibility tree stays a list of toggle buttons in anatomical order.
 *
 * **The legend shows only what this mouth has.** Fourteen swatches above a
 * healthy patient is decoration; three above a patient with three problems is
 * a key.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { FDI_QUADRANTS, describeTeeth, parseTeeth } from '@/lib/teeth'
import { toothConditionConfig, toothNames } from '@/lib/treatment-utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { X, Stethoscope } from 'lucide-react'

/** What the chart says about one tooth, reduced to what a picker can show. */
export interface ToothFinding {
  condition: string
  severity?: string | null
  notes?: string | null
}

export interface ToothPickerProps {
  selected: number[]
  onChange: (teeth: number[]) => void
  /** Whose chart to read. Omit for a picker with no findings behind it. */
  patientId?: string | null
  /** Supply findings directly instead of letting the picker fetch them. */
  findings?: Record<number, ToothFinding>
  disabled?: boolean
  className?: string
}

/** Conditions that mean "there is something wrong here, now". */
const DEFECTIVE = new Set([
  'CARIES',
  'FRACTURED',
  'ABSCESS',
  'PERIODONTAL',
  'MOBILITY',
  'SENSITIVE',
  'EXTRACTION',
])

/**
 * How far each tooth sits from its row's baseline, in pixels, by its position
 * in the quadrant — index 0 is the central incisor, index 7 the third molar.
 *
 * An arch, not a line: the incisors sit at the midline and the molars fall
 * away behind them, so the upper row reads as ∩ and the lower as ∪. That is
 * the shape a dentist is used to, and it makes the midline findable at a
 * glance rather than counted to.
 *
 * Keyed off the tooth's own number rather than its position in the rendered
 * row, because the four quadrants are drawn in two different directions — the
 * right-hand ones run molar-first and the left-hand ones incisor-first. An
 * index-based curve was right for one quadrant and mirrored in the other
 * three, which drew a shallow W.
 */
const ARCH_OFFSET = [0, 0, 1, 2, 4, 6, 8, 10]

/** The arch offset for a tooth, from its FDI position (1 central – 8 third molar). */
function archOffset(tooth: number): number {
  return ARCH_OFFSET[Math.min(7, Math.max(0, (tooth % 10) - 1))]
}

/** Wider for molars, narrow for incisors — a mouth is not eight equal squares. */
function toothWidth(tooth: number): string {
  const position = tooth % 10
  if (position >= 6) return 'w-8'
  if (position >= 4) return 'w-7'
  if (position === 3) return 'w-6'
  return 'w-5'
}

export function ToothPicker({
  selected,
  onChange,
  patientId,
  findings: givenFindings,
  disabled,
  className,
}: ToothPickerProps) {
  const [fetched, setFetched] = React.useState<Record<number, ToothFinding>>({})

  React.useEffect(() => {
    if (givenFindings || !patientId) return
    let cancelled = false

    // `isActive=true` is the API's word for "not resolved". A filling placed
    // two years ago is history; this picker is about the mouth as it is now.
    fetch(`/api/dental-chart?patientId=${encodeURIComponent(patientId)}&isActive=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.chartData) return
        const map: Record<number, ToothFinding> = {}
        for (const [tooth, entries] of Object.entries(data.chartData)) {
          const list = entries as ToothFinding[]
          // The most recent entry for a tooth is the current story; the API
          // already returns them newest first within each tooth.
          if (list?.length) map[Number(tooth)] = list[0]
        }
        setFetched(map)
      })
      .catch(() => {
        /* A chart we cannot read is a picker with no colours, not a broken
           form. The dentist can still choose teeth. */
      })

    return () => {
      cancelled = true
    }
  }, [patientId, givenFindings])

  const findings = givenFindings ?? fetched
  const chosen = React.useMemo(() => new Set(selected), [selected])

  const toggle = (tooth: number) => {
    if (disabled) return
    const next = new Set(chosen)
    if (next.has(tooth)) next.delete(tooth)
    else next.add(tooth)
    onChange([...next].sort((a, b) => a - b))
  }

  const toggleQuadrant = (teeth: readonly number[]) => {
    if (disabled) return
    const next = new Set(chosen)
    const allChosen = teeth.every((t) => next.has(t))
    for (const t of teeth) {
      if (allChosen) next.delete(t)
      else next.add(t)
    }
    onChange([...next].sort((a, b) => a - b))
  }

  /** Only the conditions this mouth actually has, in the order they appear. */
  const presentConditions = React.useMemo(() => {
    const seen = new Set<string>()
    for (const tooth of Object.keys(findings)
      .map(Number)
      .sort((a, b) => a - b)) {
      const condition = findings[tooth]?.condition
      if (condition && condition !== 'HEALTHY') seen.add(condition)
    }
    return [...seen]
  }, [findings])

  const defective = React.useMemo(
    () =>
      Object.keys(findings)
        .map(Number)
        .filter((t) => DEFECTIVE.has(findings[t]?.condition ?? ''))
        .sort((a, b) => a - b),
    [findings]
  )

  const renderTooth = (tooth: number, arch: 'upper' | 'lower') => {
    const finding = findings[tooth]
    const config = finding ? toothConditionConfig[finding.condition] : undefined
    const isChosen = chosen.has(tooth)
    const offset = archOffset(tooth)

    return (
      <Tooltip key={tooth}>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={isChosen}
            aria-label={`Tooth ${tooth}, ${toothNames[tooth] ?? 'tooth'}${
              config ? `, ${config.label}` : ''
            }`}
            onClick={() => toggle(tooth)}
            style={{ transform: `translateY(${arch === 'upper' ? offset : -offset}px)` }}
            className={cn(
              'group relative flex h-9 flex-col items-center justify-center rounded-lg border text-[10px] font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              toothWidth(tooth),
              disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5 hover:shadow-md',
              isChosen
                ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/30'
                : 'border-border/70 bg-card/80 text-muted-foreground hover:border-primary/40'
            )}
          >
            {tooth}
            {/*
              The finding, as a dot rather than a fill. A filled tooth would
              fight the selected state for the same pixels, and both need to be
              readable at once — you are choosing among the defective ones.
            */}
            {config && finding?.condition !== 'HEALTHY' && (
              <span
                aria-hidden
                className={cn(
                  'absolute -bottom-0.5 h-1.5 w-1.5 rounded-full ring-1',
                  isChosen ? 'ring-primary-foreground/60' : 'ring-card'
                )}
                style={{ backgroundColor: config.fillColor }}
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side={arch === 'upper' ? 'top' : 'bottom'}>
          <p className="font-medium">
            {tooth} · {toothNames[tooth] ?? 'Tooth'}
          </p>
          {config ? (
            <p className="text-xs">
              {config.label}
              {finding?.severity ? ` · ${finding.severity.toLowerCase()}` : ''}
            </p>
          ) : (
            <p className="text-xs opacity-80">No finding recorded</p>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  const quadrantButton = (label: string, teeth: readonly number[]) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => toggleQuadrant(teeth)}
      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed"
    >
      {label}
    </button>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('rounded-xl border border-border/60 bg-card/60 p-4', className)}>
        {/* The arches */}
        <div className="overflow-x-auto">
          <div className="mx-auto w-fit space-y-1 pb-1">
            <div className="flex items-end justify-center gap-6 pb-1">
              {quadrantButton('Upper right', FDI_QUADRANTS.upperRight)}
              {quadrantButton('Upper left', FDI_QUADRANTS.upperLeft)}
            </div>
            <div className="flex items-end justify-center gap-1 pb-8">
              <div className="flex items-end gap-1">
                {FDI_QUADRANTS.upperRight.map((t) => renderTooth(t, 'upper'))}
              </div>
              <div className="mx-1 h-9 w-px self-center bg-border" aria-hidden />
              <div className="flex items-end gap-1">
                {FDI_QUADRANTS.upperLeft.map((t) => renderTooth(t, 'upper'))}
              </div>
            </div>

            <div className="flex items-start justify-center gap-1 pt-8">
              {/*
                Both lower quadrants are stored counting outwards from the
                midline and have to be drawn counting towards it, so that 41
                and 31 meet at the centre line the way they do in a mouth.
                Reversed here rather than in `FDI_QUADRANTS`, which is shared
                and is in FDI's own order.
              */}
              <div className="flex items-start gap-1">
                {[...FDI_QUADRANTS.lowerRight].reverse().map((t) => renderTooth(t, 'lower'))}
              </div>
              <div className="mx-1 h-9 w-px self-center bg-border" aria-hidden />
              <div className="flex items-start gap-1">
                {[...FDI_QUADRANTS.lowerLeft].reverse().map((t) => renderTooth(t, 'lower'))}
              </div>
            </div>
            <div className="flex items-start justify-center gap-6 pt-1">
              {quadrantButton('Lower right', FDI_QUADRANTS.lowerRight)}
              {quadrantButton('Lower left', FDI_QUADRANTS.lowerLeft)}
            </div>
          </div>
        </div>

        {/* A key, only for what this mouth has */}
        {presentConditions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-3">
            {presentConditions.map((condition) => {
              const config = toothConditionConfig[condition]
              if (!config) return null
              return (
                <span key={condition} className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: config.fillColor }}
                  />
                  <span className="text-muted-foreground">{config.label}</span>
                </span>
              )
            })}
          </div>
        )}

        {/*
          One click for the thing the dentist is usually about to do by hand.
          Offered only when the chart has something to offer and it is not
          already exactly what is selected.
        */}
        {defective.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(defective)}
            >
              <Stethoscope className="mr-2 h-3.5 w-3.5" />
              Select the {defective.length} {defective.length === 1 ? 'tooth' : 'teeth'} with
              findings
            </Button>
            <span className="text-xs text-muted-foreground">{describeTeeth(defective)}</span>
          </div>
        )}

        {/* What is chosen, and a way out of each */}
        <div className="mt-3 flex min-h-[2rem] flex-wrap items-center gap-2 border-t border-border/50 pt-3">
          {selected.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No teeth selected. Click a tooth, or a quadrant name to take all eight.
            </p>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                {selected.length} selected · {describeTeeth(selected)}
              </span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {[...selected]
                  .sort((a, b) => a - b)
                  .map((tooth) => (
                    <button
                      key={tooth}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(tooth)}
                      aria-label={`Remove tooth ${tooth}`}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed"
                    >
                      {tooth}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

/** Read a stored column straight into the picker. */
export function useToothSelection(initial: string | null | undefined) {
  return React.useState<number[]>(() => parseTeeth(initial))
}

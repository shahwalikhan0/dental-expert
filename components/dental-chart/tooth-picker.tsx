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
 * **The arch is not drawn here.** `ToothArch` draws it, and the chart on the
 * patient's record draws the same one, so the same tooth is in the same place
 * at the same width on both screens.
 *
 * **The legend shows only what this mouth has.** Fourteen swatches above a
 * healthy patient is decoration; three above a patient with three problems is
 * a key.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { describeTeeth, groupTeeth, parseTeeth } from '@/lib/teeth'
import { toothConditionConfig, toothNames } from '@/lib/treatment-utils'
import { ToothArch, ToothButton } from '@/components/dental-chart/tooth-arch'
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
  /**
   * Start on the chart's answer when the chart gives an unambiguous one.
   *
   * See {@link ToothPicker} — this selects the single tooth with a finding, and
   * only that case.
   */
  defaultToFindings?: boolean
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

/** Conditions that mean the tooth is no longer in the mouth. */
const ABSENT = new Set(['MISSING', 'EXTRACTION'])

export function ToothPicker({
  selected,
  onChange,
  patientId,
  findings: givenFindings,
  defaultToFindings,
  disabled,
  className,
}: ToothPickerProps) {
  const [fetched, setFetched] = React.useState<Record<number, ToothFinding>>({})

  /*
   * The latest selection, readable from the fetch callback below without
   * putting `selected` in that effect's dependencies — which would re-run the
   * request on every click.
   */
  const selectedRef = React.useRef(selected)
  React.useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  /** Whether the default has had its one chance. */
  const defaulted = React.useRef(false)

  /*
   * Take the chart's answer, but only when the chart has exactly one.
   *
   * One tooth with a finding is not a guess: there is nothing else the
   * prescription could be about, and making the dentist press a button that
   * says "select the 1 tooth with findings" is asking them to confirm
   * arithmetic nobody disputes.
   *
   * Two or more is a different question. A patient with a standing chart of
   * eight findings is not being prescribed for all eight, and pre-selecting
   * them would put seven teeth on a record that nobody chose — which is worse
   * than an empty field, because an empty field is obviously unfinished. There
   * the button stays an offer.
   *
   * Once only, and never over an existing selection, so a prescription written
   * from a treatment keeps the treatment's teeth whichever request lands first,
   * and a dentist who clears the field does not have it filled back in.
   */
  const applyDefault = (found: Record<number, ToothFinding>) => {
    if (!defaultToFindings || disabled || defaulted.current) return
    if (selectedRef.current.length > 0) return

    const withFindings = Object.keys(found)
      .map(Number)
      .filter((tooth) => DEFECTIVE.has(found[tooth]?.condition ?? ''))

    defaulted.current = true
    if (withFindings.length === 1) onChange(withFindings)
  }

  /*
   * Held in a ref so the request below does not list it as a dependency.
   * `onChange` is an inline arrow on one of the two callers, so a dependency
   * on it would re-read the patient's chart on every render of the form.
   */
  const applyDefaultRef = React.useRef(applyDefault)
  React.useEffect(() => {
    applyDefaultRef.current = applyDefault
  })

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
        applyDefaultRef.current(map)
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

  /** What is chosen, split by quadrant, for the summary under the arch. */
  const groups = React.useMemo(() => groupTeeth(selected), [selected])

  /** Pressing "select the teeth with findings" would change nothing. */
  const sameAsSelected =
    defective.length === selected.length && defective.every((tooth) => chosen.has(tooth))

  const renderTooth = (tooth: number, arch: 'upper' | 'lower') => {
    const finding = findings[tooth]
    const config = finding ? toothConditionConfig[finding.condition] : undefined
    const isChosen = chosen.has(tooth)

    return (
      <Tooltip key={tooth}>
        <TooltipTrigger asChild>
          <ToothButton
            tooth={tooth}
            arch={arch}
            selected={isChosen}
            absent={ABSENT.has(finding?.condition ?? '')}
            disabled={disabled}
            aria-pressed={isChosen}
            aria-label={`Tooth ${tooth}, ${toothNames[tooth] ?? 'tooth'}${
              config ? `, ${config.label}` : ''
            }`}
            onClick={() => toggle(tooth)}
            conditionColor={config && finding?.condition !== 'HEALTHY' ? config.fillColor : null}
          />
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

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('rounded-xl border border-border/60 bg-card/60 p-4', className)}>
        <ToothArch tooth={renderTooth} onQuadrant={toggleQuadrant} disabled={disabled} />

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
        {defective.length > 0 && !sameAsSelected && (
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

        {/*
          What is chosen, and a way out of each — by quadrant, because a flat
          row of chips reading "13 15 25 34 44" is five numbers the reader has
          to sort into a mouth themselves.
        */}
        <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
          {selected.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No teeth selected. Click a tooth, or a quadrant name to take all eight.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {selected.length} selected across{' '}
                {groups.length === 1 ? 'one quadrant' : `${groups.length} quadrants`}
              </p>
              {groups.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="w-24 shrink-0 text-xs font-medium text-muted-foreground"
                    title={group.label}
                  >
                    {group.label}
                  </span>
                  {group.teeth.map((tooth) => (
                    <button
                      key={tooth}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(tooth)}
                      aria-label={`Remove tooth ${tooth}, ${group.label}`}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed"
                    >
                      {tooth}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ))}
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

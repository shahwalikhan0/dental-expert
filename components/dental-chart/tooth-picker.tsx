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
 *
 * **Both dentitions, one selection.** The Permanent/Primary switch is the
 * dental chart's own, so a child's 51–85 can be chosen here as well as charted
 * there — before, 75 could be charted and then not picked for the treatment
 * that followed (bug report 12 Oct, finding 55). Switching changes what is
 * drawn, never what is chosen: a mixed dentition is treated across both, so a
 * tooth chosen on the other view stays chosen, is counted on the switch and is
 * listed in the summary underneath.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  defaultDentition,
  dentitionOf,
  describeTeeth,
  groupTeeth,
  parseTeeth,
  type Dentition,
} from '@/lib/teeth'
import { ageInYears } from '@/lib/age'
import { toothConditionConfig } from '@/lib/treatment-utils'
import { ToothArch, ToothButton, toothName } from '@/components/dental-chart/tooth-arch'
import { DENTITIONS, DentitionSwitch } from '@/components/dental-chart/dentition-switch'
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
  /**
   * How old the patient is, when the caller already knows — the patient
   * search answers with an age rather than a date of birth. A child opens on
   * the primary teeth; see `defaultDentition` in lib/teeth.ts.
   */
  age?: number | null
  /** The same, from a date of birth. Read after mount: it depends on today. */
  dateOfBirth?: string | Date | null
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

/** For `useSyncExternalStore`, used only to tell the server from the client. */
const noSubscription = () => () => {}

export function ToothPicker({
  selected,
  onChange,
  patientId,
  findings: givenFindings,
  defaultToFindings,
  age: givenAge,
  dateOfBirth,
  disabled,
  className,
}: ToothPickerProps) {
  const [fetched, setFetched] = React.useState<Record<number, ToothFinding>>({})

  /**
   * The view somebody chose, or null while the picker is still choosing for
   * them. Set by the switch, and pinned by the first tooth pressed — so the
   * default can follow a selection or a chart that arrives late, but never
   * moves the arch out from under somebody who has started picking.
   */
  const [chosenDentition, setChosenDentition] = React.useState<Dentition | null>(null)

  /*
   * An age worked out from a date of birth depends on today's date, which the
   * server and the browser need not agree on — so it is not read until the
   * picker is on the client, and the first render matches the server's.
   */
  const hydrated = React.useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  )
  const age = givenAge ?? (hydrated ? ageInYears(dateOfBirth) : null)

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

  const dentition: Dentition =
    chosenDentition ??
    defaultDentition({ selected, age, findings: Object.keys(findings).map(Number) })

  /** Keep the view on screen now that somebody is working in it. */
  const pinView = () => {
    if (!chosenDentition) setChosenDentition(dentition)
  }

  /** Selected teeth in each dentition, for the counts on the switch. */
  const selectedCounts = React.useMemo(() => {
    const counts: Record<Dentition, number> = { permanent: 0, primary: 0 }
    for (const tooth of selected) {
      const of = dentitionOf(tooth)
      if (of) counts[of] += 1
    }
    return counts
  }, [selected])

  /** Chosen, and not drawn on the view on screen. */
  const offView = selected.filter((tooth) => {
    const of = dentitionOf(tooth)
    return of !== null && of !== dentition
  })
  const otherDentition: Dentition = dentition === 'primary' ? 'permanent' : 'primary'
  const otherLabel = DENTITIONS.find((d) => d.value === otherDentition)!.label

  const toggle = (tooth: number) => {
    if (disabled) return
    pinView()
    const next = new Set(chosen)
    if (next.has(tooth)) next.delete(tooth)
    else next.add(tooth)
    onChange([...next].sort((a, b) => a - b))
  }

  const toggleQuadrant = (teeth: readonly number[]) => {
    if (disabled) return
    pinView()
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
            aria-label={`Tooth ${tooth}, ${toothName(tooth)}${config ? `, ${config.label}` : ''}`}
            onClick={() => toggle(tooth)}
            conditionColor={config && finding?.condition !== 'HEALTHY' ? config.fillColor : null}
          />
        </TooltipTrigger>
        <TooltipContent side={arch === 'upper' ? 'top' : 'bottom'}>
          <p className="font-medium">
            {tooth} · {toothName(tooth)}
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
      <div className={cn('rounded-xl border border-border/60 bg-card/60 p-3 sm:p-4', className)}>
        {/*
          The switch stays usable on a disabled picker: looking at the other
          dentition changes nothing, and is the only way to see a primary
          tooth that was chosen on a form now read-only.
        */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <DentitionSwitch
            value={dentition}
            onChange={setChosenDentition}
            selectedCounts={selectedCounts}
          />
          {offView.length > 0 && (
            <button
              type="button"
              onClick={() => setChosenDentition(otherDentition)}
              className="text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Also selected on {otherLabel}: {describeTeeth(offView)} — show
            </button>
          )}
        </div>

        <ToothArch
          tooth={renderTooth}
          onQuadrant={toggleQuadrant}
          disabled={disabled}
          dentition={dentition}
        />

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
              onClick={() => {
                pinView()
                onChange(defective)
              }}
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
              No teeth selected. Click a tooth, or a quadrant name to take all{' '}
              {dentition === 'primary' ? 'five' : 'eight'}.
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
                  {group.teeth.map((tooth) => {
                    // Every chosen tooth is listed here, whichever view is
                    // drawn; one not on the arch above is outlined instead
                    // of filled, so it reads as chosen but elsewhere.
                    const elsewhere = dentitionOf(tooth) !== dentition
                    return (
                      <button
                        key={tooth}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggle(tooth)}
                        aria-label={`Remove tooth ${tooth}, ${toothName(tooth)}`}
                        title={elsewhere ? `On the ${otherLabel} view` : undefined}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed',
                          elsewhere ? 'border border-dashed border-primary/50' : 'bg-primary/10'
                        )}
                      >
                        {tooth}
                        <X className="h-3 w-3" />
                      </button>
                    )
                  })}
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

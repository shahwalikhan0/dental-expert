'use client'

/**
 * Choosing a patient on a form. One picker, everywhere.
 *
 * There were nine, with four behaviours: three opened onto the newest ten
 * patients, two showed a "type two letters" hint, four showed nothing at all
 * until the second letter — and none could be driven with the arrow keys. A
 * receptionist moving between the appointment, invoice and prescription forms
 * met a different field each time, and the chosen patient was then drawn four
 * different ways with two different "Change" buttons.
 *
 * Now: a `SearchSelect` that opens onto the ten newest registrations, searches
 * the register from the second character, says "Showing 10 of 2,340 — keep
 * typing to narrow" when there are more, and once somebody is chosen gives way
 * to `PatientSummaryCard` — avatar, name, `PAT-ID · phone`, a ghost "Change".
 *
 *   <PatientPicker value={patient} onChange={setPatient} />
 *
 * Controlled: the form owns the chosen patient, because the form is what
 * clears its lines, reloads its treatments, or refuses to submit without one.
 */
import * as React from 'react'
import Link from 'next/link'
import { Phone, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchSelect, type SearchOption } from '@/components/ui/search-select'
import { useCatalogueSearch } from '@/hooks/use-catalogue-search'
import { cn, formatPhone } from '@/lib/utils'

/** What the picker needs of a patient. Rows carry whatever else the route sent. */
export interface PickedPatient {
  /** The database id. */
  id: string
  /** The clinic's patient number, `PAT-…`. */
  patientId: string
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  age?: number | null
}

export interface PatientPickerProps<P extends PickedPatient = PickedPatient> {
  /** The chosen patient, or null. */
  value: P | null
  /** Called with the chosen patient, or with null when "Change" is pressed. */
  onChange: (patient: P | null) => void
  /**
   * A patient to start with, by database id — the `?patientId=` a link from
   * elsewhere handed over (lib/prefill.ts). Fetched once from
   * `/api/patients/{id}` and passed to `onChange`, unless `value` is already set.
   */
  initialPatientId?: string | null
  /** Leave this patient out of the results — the record being merged, the patient themself. */
  excludeId?: string | null
  /** Leave out any other patient this returns false for. */
  filter?: (patient: P) => boolean
  disabled?: boolean
  /**
   * Drawn inside the summary card under the name — allergies on a
   * prescription, an outstanding balance on an invoice.
   */
  alert?: React.ReactNode
  /** Extra controls in the card, beside "Change". */
  actions?: React.ReactNode
  /**
   * Offer "Add new patient" when nothing matches. Off by default; pass true
   * for `/patients/new`, or an href of your own.
   */
  allowAdd?: boolean | string
  /** Default "Search by name, ID or phone…". */
  placeholder?: string
  /** Default "Patient". */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  id?: string
  className?: string
}

export function patientName(patient: Pick<PickedPatient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName} ${patient.lastName}`.trim()
}

/** `PAT-0012 · 0300 1234567`, or as much of it as is known. */
export function patientIdLine(patient: Pick<PickedPatient, 'patientId' | 'phone'>): string {
  return [patient.patientId, formatPhone(patient.phone)].filter(Boolean).join(' · ')
}

function initials(patient: Pick<PickedPatient, 'firstName' | 'lastName'>): string {
  return `${patient.firstName?.[0] ?? ''}${patient.lastName?.[0] ?? ''}`.toUpperCase() || '?'
}

export function PatientPicker<P extends PickedPatient = PickedPatient>({
  value,
  onChange,
  initialPatientId,
  excludeId,
  filter,
  disabled = false,
  alert,
  actions,
  allowAdd = false,
  placeholder = 'Search by name, ID or phone…',
  'aria-label': ariaLabel = 'Patient',
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  id,
  className,
}: PatientPickerProps<P>) {
  // Nothing is fetched until the list is first opened.
  const [opened, setOpened] = React.useState(false)
  const search = useCatalogueSearch<P>({ endpoint: '/api/patients', enabled: opened && !value })
  // Focus the field when it comes back after "Change", not on first render.
  const [changed, setChanged] = React.useState(false)

  // The hand-over: a patient named in the address. Once, and only if the form
  // has not already chosen somebody (a visit that names its own patient wins).
  //
  // "Once" is counted when the patient is handed over, not when the request is
  // made. It used to be the request: React runs an effect twice in development,
  // the first run's answer was thrown away by its own cleanup, and the second
  // run saw the id already marked and never asked again — so "Book appointment"
  // arrived with the picker empty (bug report 16 Oct, finding 17).
  const handedOver = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!initialPatientId || value || handedOver.current === initialPatientId) return
    let current = true
    ;(async () => {
      try {
        // By id, not through search: search matches a name, a phone or the PAT
        // number, never the database id.
        const response = await fetch(`/api/patients/${encodeURIComponent(initialPatientId)}`)
        if (!response.ok) return
        const data = await response.json()
        if (current && data.patient) {
          handedOver.current = initialPatientId
          onChange(data.patient as P)
        }
      } catch {
        // The picker is still there to search with; nothing is lost.
      }
    })()
    return () => {
      current = false
    }
    // `onChange` is usually an inline arrow; the id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPatientId, value])

  if (value) {
    return (
      <PatientSummaryCard
        patient={value}
        alert={alert}
        actions={actions}
        className={className}
        onChange={
          disabled
            ? undefined
            : () => {
                setChanged(true)
                onChange(null)
              }
        }
      />
    )
  }

  const rows = search.results.filter(
    (patient) => patient.id !== excludeId && (!filter || filter(patient))
  )
  const options: SearchOption<P>[] = rows.map((patient) => ({
    id: patient.id,
    label: patientName(patient),
    detail: patientIdLine(patient),
    data: patient,
  }))
  const addHref = typeof allowAdd === 'string' ? allowAdd : '/patients/new'

  return (
    <SearchSelect<P>
      id={id}
      className={className}
      value={null}
      options={options}
      onSearchChange={search.setTerm}
      onOpen={() => setOpened(true)}
      preload
      loading={search.searching}
      failed={search.failed}
      onRetry={search.retry}
      total={search.total}
      noun="patients"
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      autoFocus={changed}
      onSelect={(option) => option.data && onChange(option.data)}
      renderOption={(option) => {
        const patient = option.data!
        return (
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {initials(patient)}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">
                {option.label}
                {patient.age != null && (
                  <span className="ml-1.5 font-normal text-muted-foreground">{patient.age} y</span>
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>
            </span>
          </span>
        )
      }}
      emptyAction={
        allowAdd ? (
          <Link
            href={addHref}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add new patient
          </Link>
        ) : undefined
      }
    />
  )
}

export interface PatientSummaryCardProps {
  patient: PickedPatient
  /** Shows a ghost "Change" button that calls this. Omit for a read-only card. */
  onChange?: () => void
  /** Under the name: allergies, a balance, a warning. */
  alert?: React.ReactNode
  /** Extra controls beside "Change". */
  actions?: React.ReactNode
  className?: string
}

/**
 * The chosen patient, the one way: avatar, name, `PAT-ID · phone`, "Change".
 * Use it wherever a form shows who it is for, picker or not.
 */
export function PatientSummaryCard({
  patient,
  onChange,
  alert,
  actions,
  className,
}: PatientSummaryCardProps) {
  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/40 p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          >
            {initials(patient)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{patientName(patient)}</div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>{patient.patientId}</span>
              {patient.phone && (
                <>
                  <span aria-hidden="true">·</span>
                  <Phone className="h-3 w-3" aria-hidden="true" />
                  <span>{formatPhone(patient.phone)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {(actions || onChange) && (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {onChange && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onChange}
                aria-label={`Change patient (now ${patientName(patient)})`}
              >
                Change
              </Button>
            )}
          </div>
        )}
      </div>
      {alert && <div className="mt-3">{alert}</div>}
    </div>
  )
}

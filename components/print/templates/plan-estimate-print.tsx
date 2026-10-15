/**
 * The printed treatment estimate: what the patient takes home, and signs to
 * accept. Takes the plan the estimate page or the plan page already loaded.
 *
 * Phased, as on screen: each phase is its own table with its subtotal and the
 * running total, so the sheet answers "and if I do the first two?" without
 * anybody adding up. Deliberately not an invoice: no tax line, no due date,
 * and the wording under the total says it is an estimate.
 *
 * No clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts).
 */
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK, displayDate } from '@/lib/dates'
import { statusLabel } from '@/lib/status'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { groupByPhase } from '@/lib/treatment-phases'
import { formatPhone } from '@/lib/utils'
import {
  PrintColumns,
  PrintedOn,
  PrintFields,
  PrintHeading,
  PrintNote,
  PrintSection,
  PrintSignatures,
  PrintTable,
  PrintTotals,
  type PrintColumn,
} from '@/components/print/blocks'

type Money = string | number

interface PlanEstimateItem {
  id: string
  phase: number
  priority: number
  toothNumbers: string | null
  estimatedCost: Money
  notes: string | null
  status: string
  procedure: { code: string; name: string }
}

/** What both the estimate page and the plan page load for a plan. */
export interface PlanEstimatePrintData {
  planNumber: string
  title: string
  notes: string | null
  /** Draft and cancelled plans are stamped so; the others print unstamped. */
  status?: string
  estimatedCost: Money
  phaseNames: string[] | null
  createdAt: string
  /** When the patient's consent was recorded, if it has been. */
  consentDate?: string | null
  patient: { patientId: string; firstName: string; lastName: string; phone: string }
  items: PlanEstimateItem[]
}

const STAMPS: Record<string, string> = {
  DRAFT: 'Draft',
  CANCELLED: 'Cancelled',
}

export function PlanEstimatePrint({
  plan,
  showItemStatus = false,
}: {
  plan: PlanEstimatePrintData
  /** Add each step's status (the plan page's copy, for the clinic's file). */
  showItemStatus?: boolean
}) {
  const phases = groupByPhase(plan.items, plan.phaseNames)
  const phased = phases.length > 1
  const patientName = `${plan.patient.firstName} ${plan.patient.lastName}`.trim()

  // Only # has a fixed width: on A5 fixed teeth, status and cost columns left
  // the treatment name a few letters wide. The rest size to what is in them.
  const columns: PrintColumn<PlanEstimateItem>[] = [
    { header: '#', cell: (_item, index) => index + 1, width: '7mm' },
    {
      header: 'Treatment',
      cell: (item) => (
        <>
          <span className="pd-strong">{item.procedure.name}</span>
          <span className="pd-detail">
            {item.procedure.code}
            {item.notes ? ` · ${item.notes}` : ''}
          </span>
        </>
      ),
    },
    {
      header: 'Teeth',
      cell: (item) => describeTeethByQuadrant(parseTeeth(item.toothNumbers)) || BLANK,
    },
    ...(showItemStatus
      ? [
          {
            header: 'Status',
            cell: (item: PlanEstimateItem) => statusLabel('treatmentPlanItem', item.status),
          },
        ]
      : []),
    {
      header: 'Cost',
      cell: (item) => formatCurrency(item.estimatedCost),
      numeric: true,
    },
  ]

  return (
    <>
      <PrintHeading
        title="Treatment estimate"
        subtitle={plan.title}
        meta={[<strong key="no">{plan.planNumber}</strong>, `Date: ${displayDate(plan.createdAt)}`]}
        stamp={plan.status ? (STAMPS[plan.status] ?? null) : null}
      />

      <PrintColumns>
        <PrintSection title="Prepared for" keepTogether>
          <div className="pd-strong">{patientName}</div>
          <div>Patient ID: {plan.patient.patientId}</div>
          {plan.patient.phone && <div>{formatPhone(plan.patient.phone)}</div>}
        </PrintSection>
        <PrintSection title="Plan" keepTogether>
          <div className="pd-strong">{plan.title}</div>
          <PrintFields
            fields={[
              ['Steps', plan.items.length],
              ['Phases', phased ? phases.length : null],
              ['Consent', plan.consentDate ? `Recorded ${displayDate(plan.consentDate)}` : null],
            ]}
          />
        </PrintSection>
      </PrintColumns>

      {phases.map((phase) => (
        <PrintSection
          key={phase.number}
          title={phased ? `Phase ${phase.number} · ${phase.name}` : undefined}
        >
          <PrintTable
            rows={phase.items}
            rowKey={(item) => item.id}
            columns={columns}
            empty="No steps left in this phase."
          />
          {/*
            Under the table, not in its footer: a table footer repeats at the
            foot of every sheet the table spans, which would print a phase's
            full subtotal under its first few rows.
          */}
          {phased && phase.items.length > 0 && (
            <PrintTotals
              rows={[
                {
                  label: `Phase ${phase.number} subtotal`,
                  value: formatCurrency(phase.subtotal),
                  emphasis: 'due',
                },
                ...(phase.number > 1
                  ? [{ label: 'Running total', value: formatCurrency(phase.runningTotal) }]
                  : []),
              ]}
            />
          )}
        </PrintSection>
      ))}

      <PrintTotals
        rows={[
          ...(phased
            ? phases.map((phase) => ({
                label: `Phase ${phase.number} · ${phase.name}`,
                value: formatCurrency(phase.subtotal),
              }))
            : []),
          {
            label: phased ? 'Total, all phases' : 'Total',
            value: formatCurrency(plan.estimatedCost),
            emphasis: 'total' as const,
          },
        ]}
      />

      <PrintNote title="Notes">{plan.notes}</PrintNote>

      <PrintNote title="About this estimate">
        This is an estimate, not an invoice. Costs are for the treatment described above and may
        change if what is found during treatment differs from what was expected. You will be told
        before any additional work is carried out.
        {phased && ' Each phase can be agreed to on its own.'}
      </PrintNote>

      <PrintSection title="Acceptance" keepTogether>
        <p className="pd-note">
          The treatment in this plan, its alternatives and its costs have been explained to me, my
          questions have been answered, and I agree to proceed with the treatment above.
        </p>
        <PrintSignatures
          signatures={[
            { label: 'Patient signature', name: patientName },
            { label: 'Dentist signature' },
            { label: 'Date' },
          ]}
        />
        {/* Inside the kept block, so it cannot fall onto a sheet of its own. */}
        <PrintedOn />
      </PrintSection>
    </>
  )
}

/**
 * The printed statement of account. Takes the ledger the statement page
 * already loaded: one patient's account, or with `?family=true` everyone on
 * the guarantor's account.
 *
 * No clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts). This is the document most likely to run to several
 * sheets; the ledger's header row repeats on each one (PrintTable), and the
 * totals and the ageing below it are each kept whole.
 *
 * The ledger is the account from the beginning, not since a cut-off date, so
 * there is no opening balance to print: the first row starts from zero.
 */
import { formatCurrency } from '@/lib/i18n/format'
import { displayDate } from '@/lib/dates'
import { AGEING_BUCKETS, type Ageing } from '@/lib/ageing'
import { formatPhone } from '@/lib/utils'
import {
  PrintColumns,
  PrintedOn,
  PrintFields,
  PrintHeading,
  PrintNote,
  PrintSection,
  PrintTable,
  PrintTotals,
} from '@/components/print/blocks'

interface Person {
  id: string
  patientId: string
  firstName: string
  lastName: string
}

export interface StatementPrintData {
  scope: 'patient' | 'family'
  patient: Person & {
    phone: string
    address: string | null
    city: string | null
  }
  family: { guarantorId: string; members: Person[] } | null
  entries: {
    id: string
    kind: string
    date: Date | string
    reference: string
    description: string
    debit: number
    credit: number
    balance: number
  }[]
  summary: {
    charged: number
    paid: number
    refunded: number
    reversed: number
    balance: number
  }
  ageing: Ageing
}

const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`.trim()

/** Money that can go below zero, with a true minus sign. */
const signed = (amount: number) =>
  amount < 0 ? `−${formatCurrency(-amount)}` : formatCurrency(amount)

export function StatementPrint({
  statement,
  clinicPhone,
}: {
  statement: StatementPrintData
  /** For the "please call" line under a balance. Not a letterhead. */
  clinicPhone?: string | null
}) {
  const { patient, summary, entries, ageing } = statement
  const members =
    statement.scope === 'family' && statement.family && statement.family.members.length > 1
      ? statement.family.members
      : null
  const addressedTo =
    (statement.scope === 'family' &&
      statement.family?.members.find((member) => member.id === statement.family?.guarantorId)) ||
    patient
  const address = [patient.address, patient.city].filter(Boolean).join(', ')

  // On a family statement the ledger prefixes each description with the
  // patient's name ("Sara Khan — Invoice"). On paper the name goes on its own
  // line under the description, which leaves the amounts room on A5.
  const rows = entries.map((entry) => {
    const member = members?.find((m) => entry.description.startsWith(`${fullName(m)} — `))
    return {
      ...entry,
      patient: member ? fullName(member) : '',
      detail: member ? entry.description.slice(fullName(member).length + 3) : entry.description,
    }
  })

  return (
    <>
      <PrintHeading
        title="Statement of account"
        subtitle={members ? 'Family account' : undefined}
        meta={[`Date: ${displayDate(new Date())}`]}
      />

      <PrintColumns>
        <PrintSection title="Account holder" keepTogether>
          <div className="pd-strong">{fullName(addressedTo)}</div>
          <div>Patient ID: {addressedTo.patientId}</div>
          {address && <div>{address}</div>}
          {patient.phone && <div>{formatPhone(patient.phone)}</div>}
        </PrintSection>
        {members && (
          <PrintSection title="Covering treatment for" keepTogether>
            {members.map((member) => (
              <div key={member.id}>
                {fullName(member)} <span className="pd-muted">({member.patientId})</span>
              </div>
            ))}
          </PrintSection>
        )}
      </PrintColumns>

      <PrintTable
        rows={rows}
        rowKey={(row) => `${row.kind}-${row.id}`}
        empty="Nothing has been charged to this account."
        columns={[
          { header: 'Date', cell: (row) => displayDate(row.date), width: '28mm' },
          { header: 'Reference', cell: (row) => row.reference, width: '34mm' },
          {
            header: 'Description',
            cell: (row) => (
              <>
                {row.detail}
                {row.patient && <span className="pd-detail">{row.patient}</span>}
              </>
            ),
          },
          {
            header: 'Charges',
            cell: (row) => (row.debit !== 0 ? signed(row.debit) : ''),
            numeric: true,
          },
          {
            header: 'Payments',
            cell: (row) => (row.credit > 0 ? formatCurrency(row.credit) : ''),
            numeric: true,
          },
          {
            header: 'Balance',
            cell: (row) => signed(row.balance),
            numeric: true,
          },
        ]}
      />

      <PrintTotals
        rows={[
          { label: 'Total charged', value: formatCurrency(summary.charged) },
          { label: 'Total paid', value: formatCurrency(summary.paid) },
          ...(summary.refunded > 0
            ? [{ label: 'Refunded', value: formatCurrency(summary.refunded) }]
            : []),
          // A bill refunded in full is a charge reversed, not a debt. Shown so
          // the lines above still add up to the balance below.
          ...(summary.reversed > 0
            ? [{ label: 'Charges reversed', value: signed(-summary.reversed) }]
            : []),
          { label: 'Balance due', value: signed(summary.balance), emphasis: 'total' },
        ]}
      />

      {ageing.total > 0 && (
        <PrintSection title="Days past due" keepTogether>
          <PrintFields
            fields={AGEING_BUCKETS.map(
              (bucket) =>
                [bucket.label, formatCurrency(ageing[bucket.key])] as [string, React.ReactNode]
            )}
          />
        </PrintSection>
      )}

      {summary.balance > 0 && clinicPhone && (
        <PrintNote>
          To settle this balance or arrange instalments, please call {formatPhone(clinicPhone)}.
        </PrintNote>
      )}

      <PrintedOn />
    </>
  )
}

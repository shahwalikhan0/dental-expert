/**
 * The printed invoice. Takes the record the invoice page already loaded.
 *
 * No clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts). The tax registration numbers are printed when tax was
 * charged, because a tax invoice must carry them and not every letterhead does.
 */
import { formatCurrency, numberToWords, paymentMethodConfig } from '@/lib/billing-utils'
import { displayDate, displayDateTime } from '@/lib/dates'
import { billTo } from '@/lib/invoice-links'
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
} from '@/components/print/blocks'

type Money = string | number

interface Person {
  firstName: string
  lastName: string
}

export interface InvoicePrintData {
  invoiceNo: string
  status: string
  createdAt: string
  issuedAt: string | null
  dueDate: string | null
  subtotal: Money
  discountType: string
  discountValue: Money
  discountAmount: Money
  taxableAmount: Money
  taxRate: Money
  taxAmount: Money
  totalAmount: Money
  paidAmount: Money
  balanceAmount: Money
  notes: string | null
  termsAndConditions: string | null
  appointment: {
    appointmentNo: string
    startsAt: string
    doctor: Person | null
  } | null
  clinic: {
    taxRegistrationNo: string | null
    nationalTaxNo: string | null
    taxLabel: string | null
  } | null
  patient: Person & {
    patientId: string
    phone: string
    email: string | null
    address: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    guarantor: (Person & { patientId: string; phone: string | null }) | null
  }
  items: {
    id: string
    description: string
    quantity: number
    unitPrice: Money
    amount: Money
    taxable: boolean
    inventoryItem: { sku: string } | null
    treatment: {
      treatmentNo: string
      toothNumbers: string | null
      doctor: Person | null
    } | null
  }[]
  payments: {
    id: string
    paymentNo: string
    amount: Money
    paymentMethod: string
    paymentDate: string
    status: string
    refunds?: { id: string; refundNo: string; amount: Money; refundedAt: string }[]
  }[]
}

const STAMPS: Record<string, string> = {
  DRAFT: 'Draft',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_PAID: 'Partly paid',
  OVERDUE: 'Overdue',
}

const methodLabel = (method: string) =>
  paymentMethodConfig[method as keyof typeof paymentMethodConfig]?.label ?? method

const fullName = (person: Person) => `${person.firstName} ${person.lastName}`.trim()

export function InvoicePrint({ invoice }: { invoice: InvoicePrintData }) {
  const taxRate = Number(invoice.taxRate)
  const taxLabel = invoice.clinic?.taxLabel || 'Tax'
  const discount = Number(invoice.discountAmount)
  const discountPercent =
    invoice.discountType === 'PERCENTAGE' ? Number(invoice.discountValue) : null
  const invoiceDate = invoice.issuedAt ?? invoice.createdAt
  const { payer, forPatient } = billTo(invoice.patient)
  const address = [
    invoice.patient.address,
    invoice.patient.city,
    invoice.patient.state,
    invoice.patient.postalCode,
  ]
    .filter(Boolean)
    .join(', ')

  // Payments that stand, then their refunds as negative rows, so the rows add
  // up to "Paid" (which is net of refunds).
  const paymentRows = invoice.payments
    .filter((p) => ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status))
    .flatMap((payment) => [
      {
        key: payment.id,
        no: payment.paymentNo,
        date: payment.paymentDate,
        method: methodLabel(payment.paymentMethod),
        amount: Number(payment.amount),
      },
      ...(payment.refunds ?? []).map((refund) => ({
        key: refund.id,
        no: `${refund.refundNo} (refund)`,
        date: refund.refundedAt,
        method: '',
        amount: -Number(refund.amount),
      })),
    ])

  return (
    <>
      <PrintHeading
        title={taxRate > 0 ? 'Tax invoice' : 'Invoice'}
        meta={[
          <strong key="no">{invoice.invoiceNo}</strong>,
          `Date: ${displayDate(invoiceDate)}`,
          invoice.dueDate ? `Due: ${displayDate(invoice.dueDate)}` : null,
          taxRate > 0 && invoice.clinic?.taxRegistrationNo
            ? `STRN: ${invoice.clinic.taxRegistrationNo}`
            : null,
          taxRate > 0 && invoice.clinic?.nationalTaxNo
            ? `NTN: ${invoice.clinic.nationalTaxNo}`
            : null,
        ]}
        stamp={STAMPS[invoice.status] ?? null}
      />

      <PrintColumns>
        <PrintSection title="Bill to" keepTogether>
          <div className="pd-strong">{fullName(payer)}</div>
          {forPatient ? (
            <div>
              for {fullName(invoice.patient)} ({invoice.patient.patientId})
            </div>
          ) : (
            <div>Patient ID: {invoice.patient.patientId}</div>
          )}
          {invoice.patient.guarantor ? (
            invoice.patient.guarantor.phone && (
              <div>{formatPhone(invoice.patient.guarantor.phone)}</div>
            )
          ) : (
            <>
              <div>{formatPhone(invoice.patient.phone)}</div>
              {invoice.patient.email && <div>{invoice.patient.email}</div>}
              {address && <div>{address}</div>}
            </>
          )}
        </PrintSection>
        {invoice.appointment && (
          <PrintSection title="Visit" keepTogether>
            <PrintFields
              fields={[
                ['Appointment', invoice.appointment.appointmentNo],
                ['Date', displayDateTime(invoice.appointment.startsAt)],
                [
                  'Dentist',
                  invoice.appointment.doctor ? `Dr. ${fullName(invoice.appointment.doctor)}` : null,
                ],
              ]}
            />
          </PrintSection>
        )}
      </PrintColumns>

      <PrintTable
        rows={invoice.items}
        rowKey={(item) => item.id}
        columns={[
          { header: '#', cell: (_item, index) => index + 1, width: '7mm' },
          {
            header: 'Description',
            cell: (item) => (
              <>
                {item.description}
                {taxRate > 0 && item.taxable && <span className="pd-muted"> (taxable)</span>}
                {item.treatment && (
                  <span className="pd-detail">
                    {item.treatment.treatmentNo}
                    {item.treatment.toothNumbers ? ` · Tooth ${item.treatment.toothNumbers}` : ''}
                    {item.treatment.doctor ? ` · Dr. ${fullName(item.treatment.doctor)}` : ''}
                  </span>
                )}
                {item.inventoryItem && (
                  <span className="pd-detail">SKU {item.inventoryItem.sku}</span>
                )}
              </>
            ),
          },
          { header: 'Qty', cell: (item) => item.quantity, numeric: true, width: '14mm' },
          {
            header: 'Unit price',
            cell: (item) => formatCurrency(item.unitPrice),
            numeric: true,
            width: '28mm',
          },
          {
            header: 'Amount',
            cell: (item) => formatCurrency(item.amount),
            numeric: true,
            width: '30mm',
          },
        ]}
      />

      <PrintTotals
        rows={[
          { label: 'Subtotal', value: formatCurrency(invoice.subtotal) },
          ...(discount > 0
            ? [
                {
                  label: `Discount${discountPercent !== null ? ` (${discountPercent}%)` : ''}`,
                  value: `-${formatCurrency(discount)}`,
                },
              ]
            : []),
          ...(taxRate > 0
            ? [
                { label: 'Taxable value', value: formatCurrency(invoice.taxableAmount) },
                { label: `${taxLabel} (${taxRate}%)`, value: formatCurrency(invoice.taxAmount) },
              ]
            : []),
          { label: 'Total', value: formatCurrency(invoice.totalAmount), emphasis: 'total' },
          { label: 'Paid', value: formatCurrency(invoice.paidAmount) },
          { label: 'Balance due', value: formatCurrency(invoice.balanceAmount), emphasis: 'due' },
        ]}
      />

      <PrintNote title="Amount in words">{numberToWords(Number(invoice.totalAmount))}</PrintNote>

      {paymentRows.length > 0 && (
        <PrintSection title="Payments">
          <PrintTable
            rows={paymentRows}
            rowKey={(row) => row.key}
            columns={[
              { header: 'Payment', cell: (row) => row.no },
              { header: 'Date', cell: (row) => displayDate(row.date), width: '30mm' },
              { header: 'Method', cell: (row) => row.method, width: '32mm' },
              {
                header: 'Amount',
                cell: (row) =>
                  row.amount < 0 ? `-${formatCurrency(-row.amount)}` : formatCurrency(row.amount),
                numeric: true,
                width: '30mm',
              },
            ]}
          />
        </PrintSection>
      )}

      <PrintNote title="Notes">{invoice.notes}</PrintNote>
      <PrintNote title="Terms and conditions">{invoice.termsAndConditions}</PrintNote>

      <PrintSignatures signatures={[{ label: 'Received by' }, { label: 'Authorised signature' }]} />
      <PrintedOn />
    </>
  )
}

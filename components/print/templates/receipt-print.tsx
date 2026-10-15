/**
 * The printed payment receipt. Takes the payment the receipt page already
 * loaded and prints it; nothing here works out or changes what was paid.
 *
 * No clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts).
 *
 * Refunds against the payment are printed when there are any, with what the
 * clinic kept, so a receipt for money partly handed back does not read as
 * the full amount retained.
 */
import { formatCurrency, paymentMethodConfig } from '@/lib/billing-utils'
import { displayDate } from '@/lib/dates'
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

export interface ReceiptPrintData {
  paymentNo: string
  amount: Money
  paymentMethod: string
  paymentDate: string
  transactionId: string | null
  status: string
  notes: string | null
  refunds: {
    id: string
    refundNo: string
    amount: Money
    reason: string
    refundedAt: string
  }[]
  invoice: {
    invoiceNo: string
    totalAmount: Money
    paidAmount: Money
    balanceAmount: Money
    patient: {
      patientId: string
      firstName: string
      lastName: string
      phone: string | null
    } | null
  }
}

const methodLabel = (method: string) =>
  paymentMethodConfig[method as keyof typeof paymentMethodConfig]?.label ?? method

/** Only states that change what the receipt means get a stamp. */
const STAMPS: Record<string, string> = {
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
  PENDING: 'Pending',
  FAILED: 'Failed',
}

export function ReceiptPrint({ payment }: { payment: ReceiptPrintData }) {
  const patient = payment.invoice.patient
  const amount = Number(payment.amount)
  const refunded = payment.refunds.reduce((sum, r) => sum + Number(r.amount), 0)

  return (
    <>
      <PrintHeading
        title="Payment receipt"
        meta={[
          <strong key="no">{payment.paymentNo}</strong>,
          `Date: ${displayDate(payment.paymentDate)}`,
        ]}
        stamp={STAMPS[payment.status] ?? null}
      />

      <PrintColumns>
        <PrintSection title="Received from" keepTogether>
          <div className="pd-strong">
            {patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown patient'}
          </div>
          {patient && <div>Patient ID: {patient.patientId}</div>}
          {patient?.phone && <div>{formatPhone(patient.phone)}</div>}
        </PrintSection>
        <PrintSection title="Payment" keepTogether>
          <PrintFields
            fields={[
              [
                'Amount',
                <span key="amount" className="pd-strong">
                  {formatCurrency(amount)}
                </span>,
              ],
              ['Paid by', methodLabel(payment.paymentMethod)],
              ['Reference', payment.transactionId],
              ['Against invoice', payment.invoice.invoiceNo],
            ]}
          />
        </PrintSection>
      </PrintColumns>

      {refunded > 0 && (
        <PrintSection title="Refunded against this payment" keepTogether>
          <PrintTable
            rows={payment.refunds}
            rowKey={(refund) => refund.id}
            columns={[
              { header: 'Refund', cell: (refund) => refund.refundNo, width: '34mm' },
              { header: 'Date', cell: (refund) => displayDate(refund.refundedAt), width: '28mm' },
              { header: 'Reason', cell: (refund) => refund.reason },
              {
                header: 'Amount',
                cell: (refund) => `−${formatCurrency(Number(refund.amount))}`,
                numeric: true,
                width: '30mm',
              },
            ]}
          />
        </PrintSection>
      )}

      {/* One block, so a receipt fits a small sheet: what the clinic kept of
          this payment, then where the invoice stands after it. */}
      <PrintTotals
        rows={[
          ...(refunded > 0
            ? [
                { label: 'Amount received', value: formatCurrency(amount) },
                { label: 'Refunded', value: `−${formatCurrency(refunded)}` },
                {
                  label: 'Net retained',
                  value: formatCurrency(amount - refunded),
                  emphasis: 'due' as const,
                },
              ]
            : []),
          {
            label: `Invoice ${payment.invoice.invoiceNo} total`,
            value: formatCurrency(Number(payment.invoice.totalAmount)),
          },
          { label: 'Paid to date', value: formatCurrency(Number(payment.invoice.paidAmount)) },
          {
            label: 'Balance due',
            value: formatCurrency(Number(payment.invoice.balanceAmount)),
            emphasis: 'total',
          },
        ]}
      />

      <PrintNote title="Notes">{payment.notes}</PrintNote>

      <p className="pd-note pd-muted pd-small">
        This receipt acknowledges the amount shown above. Any balance stated remains payable.
      </p>

      <PrintSignatures signatures={[{ label: 'Received by' }]} />
      <PrintedOn />
    </>
  )
}

import type { InvoiceStatus, Prisma, PrismaClient } from '@prisma/client'
import { BILLED_ON_LIVE_INVOICE } from '@/lib/invoice-settlement'

/** Works against the client or a transaction — both are used by callers. */
type Db = PrismaClient | Prisma.TransactionClient

export interface LiveInvoice {
  id: string
  invoiceNo: string
  status: InvoiceStatus
}

/**
 * The invoice that still bills this treatment, or null.
 *
 * "Still bills" is `BILLED_ON_LIVE_INVOICE` — any invoice not cancelled — the
 * same rule the unbilled list and the invoice routes use, so a treatment this
 * calls billed is one the invoice routes would refuse to bill again. A
 * treatment can be on one live invoice at most; the invoice routes see to it.
 */
export async function liveInvoiceFor(db: Db, treatmentId: string): Promise<LiveInvoice | null> {
  const line = await db.invoiceItem.findFirst({
    where: { treatmentId, ...BILLED_ON_LIVE_INVOICE },
    select: { invoice: { select: { id: true, invoiceNo: true, status: true } } },
  })
  return line?.invoice ?? null
}

/**
 * Why a billed treatment cannot be cancelled or re-priced (review 4.1).
 *
 * Once a treatment is on an invoice, the invoice is what the patient was
 * charged. Cancelling the treatment left them charged for work the record says
 * never happened; changing its cost left the treatment and the invoice
 * disagreeing, and the procedure revenue report reading the new figure. The
 * invoice is changed first, and the treatment follows.
 */
export function billedTreatmentRefusal(
  treatmentNo: string,
  invoice: LiveInvoice,
  change: 'cancel' | 'cost'
): string {
  const act = change === 'cancel' ? 'cancelling this treatment' : 'changing its cost'
  return `${treatmentNo} is billed on ${invoice.invoiceNo}. Cancel or edit ${invoice.invoiceNo} first, before ${act}.`
}

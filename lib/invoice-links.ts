/**
 * The ways into billing from the rest of the clinic, in one place.
 *
 * Client-safe: no database. Every "Create invoice" button — the patient's
 * Billing tab, a treatment, an appointment at check-out — builds its address
 * here, so the New Invoice page's query contract is written down once rather
 * than spelled out by hand on five screens that would drift apart.
 */

/**
 * `/billing/invoices/new` with what is already known.
 *
 * - `patientId` picks the patient.
 * - `appointmentId` links the invoice to that visit (and picks its patient).
 * - `treatmentIds` pre-ticks those unbilled treatments.
 *
 * Each is optional; whatever is missing is chosen on the page.
 */
export function newInvoiceHref(args: {
  patientId?: string | null
  appointmentId?: string | null
  treatmentIds?: string[]
}): string {
  const query = new URLSearchParams()
  if (args.patientId) query.set('patientId', args.patientId)
  if (args.appointmentId) query.set('appointmentId', args.appointmentId)
  if (args.treatmentIds && args.treatmentIds.length > 0) {
    query.set('treatmentIds', args.treatmentIds.join(','))
  }
  const qs = query.toString()
  return qs ? `/billing/invoices/new?${qs}` : '/billing/invoices/new'
}

interface NamedPatient {
  firstName: string
  lastName: string
  patientId?: string | null
}

/**
 * Who an invoice is addressed to (review 4.7).
 *
 * A child's invoice is raised against the child — the treatment and the
 * ledger are theirs — but it is the parent who pays. With a guarantor set, the
 * bill is addressed to them, naming whom it is for: "Bill to: Sana Malik (for
 * Ali Malik)". Without one, the patient pays for themselves and `forPatient`
 * is null.
 */
export function billTo(patient: NamedPatient & { guarantor?: NamedPatient | null }): {
  payer: NamedPatient
  forPatient: NamedPatient | null
  line: string
} {
  const name = (p: NamedPatient) => `${p.firstName} ${p.lastName}`
  if (patient.guarantor) {
    return {
      payer: patient.guarantor,
      forPatient: patient,
      line: `Bill to: ${name(patient.guarantor)} (for ${name(patient)})`,
    }
  }
  return { payer: patient, forPatient: null, line: `Bill to: ${name(patient)}` }
}

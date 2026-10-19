'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { FormSection, FormActions } from '@/components/ui/form-section'
import { BackLink, useTrail } from '@/components/ui/trail'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CalendarDays, FileText, Save, Send } from 'lucide-react'
import { PatientPicker } from '@/components/patients/patient-picker'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  formatCurrency,
  formatDate,
  calculateInvoiceTotals,
  paymentTermsOptions,
} from '@/lib/billing-utils'
import { InvoiceLinesEditor } from '@/components/billing/invoice-lines-editor'
import {
  UnbilledTreatmentList,
  treatmentLine,
  type UnbilledTreatment,
} from '@/components/billing/unbilled-treatment-list'
import {
  lineProblem,
  linesForRequest,
  linesForTotals,
  priceShortfall,
  type FormLine,
} from '@/lib/invoice-form'
import { round2 } from '@/lib/till'

interface Patient {
  id: string
  patientId: string
  firstName: string
  lastName: string
  phone: string
  email: string | null
}

/** The visit an invoice is being raised for, as unbilled-treatments describes it. */
interface Visit {
  id: string
  appointmentNo: string
  scheduledDate: string
  scheduledTime: string
  doctor: string | null
}

/**
 * New invoice.
 *
 * Opened bare from Billing, or from elsewhere in the clinic with what is
 * already known (lib/invoice-links.ts builds the address):
 *
 *   /billing/invoices/new?patientId=X&appointmentId=Y&treatmentIds=a,b
 *
 * `appointmentId` picks that visit's patient and links the invoice to it;
 * `treatmentIds` puts those unbilled treatments on the invoice. Each is
 * optional.
 */
export default function NewInvoicePage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const searchParams = useSearchParams()
  const preSelectedPatientId = searchParams.get('patientId')
  const preSelectedAppointmentId = searchParams.get('appointmentId')
  const preTickedTreatmentIds = useMemo(
    () => (searchParams.get('treatmentIds') || '').split(',').filter(Boolean),
    [searchParams]
  )
  const { toast } = useToast()
  // Named for the breadcrumb, and for the back arrow on a phone.
  const trail = useTrail('New invoice')

  const [submitting, setSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // Patient selection
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)

  // The visit this invoice is for, when it was opened from one.
  const [visit, setVisit] = useState<Visit | null>(null)

  // Unbilled treatments
  const [unbilledTreatments, setUnbilledTreatments] = useState<UnbilledTreatment[]>([])
  const [loadingTreatments, setLoadingTreatments] = useState(false)
  // The ?treatmentIds= are put on the invoice once, when the list first loads.
  const preTicked = useRef(false)

  // Invoice items
  const [items, setItems] = useState<FormLine[]>([])

  // Invoice settings
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED'>('FIXED')
  const [discountValue, setDiscountValue] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [paymentTermDays, setPaymentTermDays] = useState(0)
  const [notes, setNotes] = useState('')
  const [termsAndConditions, setTermsAndConditions] = useState(
    '1. Payment is due within the specified payment terms.\n2. Please bring this invoice for reference during your next visit.'
  )

  // The clinic's tax rate, so this preview matches what the server will
  // charge, and the discount-approval threshold, so the reason is asked for
  // here rather than discovered from a refusal (invoice review 1.1).
  const [billing, setBilling] = useState({
    enabled: false,
    rate: 0,
    label: 'Sales Tax',
    discountApprovalThreshold: null as number | null,
  })

  useEffect(() => {
    fetch('/api/billing/tax-settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBilling((current) => ({ ...current, ...data })))
      .catch(() => {
        /* preview only; the server still applies the correct rate */
      })
  }, [])

  // Opened from a visit: the visit names the patient. Asked of the billing
  // route rather than the appointment one, which the accountant cannot read.
  useEffect(() => {
    if (!preSelectedAppointmentId) return
    let current = true
    ;(async () => {
      try {
        const response = await fetch(
          `/api/billing/unbilled-treatments?appointmentId=${encodeURIComponent(preSelectedAppointmentId)}`
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'That visit could not be loaded')
        if (!current) return
        if (data.appointment) setVisit(data.appointment)
        if (data.patient) {
          const { id, patientId, firstName, lastName, phone, email } = data.patient
          setSelectedPatient({ id, patientId, firstName, lastName, phone, email: email ?? null })
        }
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Could not open the visit',
          description: error instanceof Error ? error.message : 'Failed to load the visit',
        })
      }
    })()
    return () => {
      current = false
    }
  }, [preSelectedAppointmentId, toast])

  // Fetch unbilled treatments when patient is selected
  useEffect(() => {
    if (!selectedPatient) {
      setUnbilledTreatments([])
      return
    }
    let current = true
    ;(async () => {
      try {
        setLoadingTreatments(true)
        const response = await fetch(
          `/api/billing/unbilled-treatments?patientId=${encodeURIComponent(selectedPatient.id)}`
        )
        if (!response.ok) throw new Error('Failed to fetch unbilled treatments')
        const data = await response.json()
        if (!current) return
        const treatments: UnbilledTreatment[] = data.treatments ?? []
        setUnbilledTreatments(treatments)

        // The treatments the caller asked for, once — and only those still
        // unbilled, which is all this list holds.
        if (!preTicked.current && preTickedTreatmentIds.length > 0) {
          preTicked.current = true
          const wanted = treatments.filter((t) => preTickedTreatmentIds.includes(t.treatmentId))
          setItems((existing) => [
            ...existing,
            ...wanted
              .filter((t) => !existing.some((i) => i.treatmentId === t.treatmentId))
              .map(treatmentLine),
          ])
        }
      } catch (error) {
        console.error('Error fetching unbilled treatments:', error)
      } finally {
        if (current) setLoadingTreatments(false)
      }
    })()
    return () => {
      current = false
    }
  }, [selectedPatient, preTickedTreatmentIds])

  // The same arithmetic the server stores (lib/billing-utils.ts).
  const totals = useMemo(
    () =>
      calculateInvoiceTotals(
        linesForTotals(items),
        discountType,
        Number(discountValue) || 0,
        billing.rate
      ),
    [items, discountType, discountValue, billing.rate]
  )

  // Everything the patient is let off: the discount, and any treatment
  // charged below its own price. Over the threshold it needs a reason and
  // another approver's decision — never the approval of whoever raised it.
  const shortfall = priceShortfall(items)
  const concession = round2(totals.discountAmount + shortfall)
  const needsReason =
    billing.discountApprovalThreshold != null && concession > billing.discountApprovalThreshold

  /**
   * A patient chosen, or "Change" pressed. Either way the lines go: they were
   * the previous patient's treatments. The visit goes with a change too — it
   * was that patient's.
   */
  const choosePatient = (patient: Patient | null) => {
    setSelectedPatient(patient)
    if (!patient) setVisit(null)
    setItems([])
  }

  const addTreatmentToInvoice = (treatment: UnbilledTreatment) => {
    setItems((existing) => [...existing, treatmentLine(treatment)])
  }

  const handleSubmit = async (status: 'DRAFT' | 'PENDING') => {
    const invalid = (description: string) =>
      toast({ variant: 'destructive', title: 'Could not create the invoice', description })

    if (!selectedPatient) {
      invalid('Please select a patient')
      return
    }

    if (items.length === 0) {
      invalid('Please add at least one item to the invoice')
      return
    }

    setShowErrors(true)
    const firstProblem = items.map(lineProblem).find(Boolean)
    if (firstProblem) {
      invalid(`Check the lines: ${firstProblem.toLowerCase()}.`)
      return
    }
    if (needsReason && discountReason.trim().length < 3) {
      invalid(
        `A concession of ${formatCurrency(concession)} is above the ${formatCurrency(billing.discountApprovalThreshold)} approval threshold. Give a reason for it.`
      )
      return
    }

    try {
      setSubmitting(true)

      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          appointmentId: visit?.id ?? null,
          items: linesForRequest(items),
          discountType,
          discountValue: Number(discountValue) || 0,
          discountReason: discountReason.trim() || null,
          paymentTermDays,
          notes,
          termsAndConditions,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create invoice')
      }

      const invoice = await response.json()

      // Every invoice is created as a draft; the server does not take a status
      // from the form. Issuing is a second step, and the one where a discount
      // awaiting approval, or a product short on the shelf, is caught — in
      // which case the draft is kept and the toast says why it was not issued.
      if (status === 'PENDING') {
        const issued = await fetch(`/api/invoices/${invoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'PENDING' }),
        })
        if (!issued.ok) {
          const data = await issued.json().catch(() => ({}))
          toast({
            variant: 'destructive',
            title: `${invoice.invoiceNo} was saved as a draft, not issued`,
            description: data.error || 'The invoice could not be issued',
          })
        }
      }

      router.push(`/billing/invoices/${invoice.id}`)
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not create the invoice',
        description: error.message,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!selectedPatient && items.length > 0

  return (
    <div ref={formRef} className="space-y-6">
      <PageHeader
        title="New invoice"
        description="Create a new invoice for a patient"
        back={<BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />}
      />

      {/*
        The bill on the left, built top to bottom — who, what, the discount
        and terms — and on the right, pinned while the lines scroll, what it
        comes to, the way a checkout keeps its order summary in view.
      */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FormSection title="Patient" description="Search and select a patient">
            <div className="space-y-3">
              {/*
                The shared picker: opens onto the newest patients, searches the
                register from the second letter, and arrow keys work. A link
                that names a patient (?patientId=) hands it over; one that
                names a visit picks its patient instead.
              */}
              <PatientPicker<Patient>
                value={selectedPatient}
                onChange={choosePatient}
                initialPatientId={preSelectedAppointmentId ? null : preSelectedPatientId}
              />
              {visit && selectedPatient && (
                <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  For the visit on {formatDate(visit.scheduledDate)} at {visit.scheduledTime}
                  {visit.doctor ? ` with ${visit.doctor}` : ''} ({visit.appointmentNo})
                </p>
              )}
            </div>
          </FormSection>

          {/* Unbilled Treatments */}
          {selectedPatient && (
            <Card>
              <CardHeader>
                <CardTitle>Unbilled treatments</CardTitle>
                <CardDescription>Select treatments to add to the invoice</CardDescription>
              </CardHeader>
              <CardContent>
                <UnbilledTreatmentList
                  loading={loadingTreatments}
                  treatments={unbilledTreatments}
                  visitId={visit?.id ?? null}
                  isAdded={(id) => items.some((i) => i.treatmentId === id)}
                  onAdd={addTreatmentToInvoice}
                />
              </CardContent>
            </Card>
          )}

          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice items</CardTitle>
              <CardDescription>
                Treatments from above, products from the inventory, or a custom item
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.length === 0 && (
                <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8" />
                  <p className="font-medium text-foreground">No items added yet</p>
                  <p>Add treatments from above, a product, or a custom item</p>
                </div>
              )}
              <InvoiceLinesEditor lines={items} onChange={setItems} showErrors={showErrors} />
            </CardContent>
          </Card>

          <FormSection
            title="Discount and terms"
            description="Taken off the subtotal before tax, and when the bill falls due"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Discount */}
                <div className="space-y-2">
                  <Label htmlFor="discountValue">Discount</Label>
                  <div className="flex gap-2">
                    <Select
                      value={discountType}
                      onValueChange={(value: 'PERCENTAGE' | 'FIXED') => setDiscountType(value)}
                    >
                      <SelectTrigger className="w-[120px] shrink-0" aria-label="Discount type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FIXED">Rs Fixed</SelectItem>
                        <SelectItem value="PERCENTAGE">% Percent</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      id="discountValue"
                      type="number"
                      min="0"
                      step="0.01"
                      max={discountType === 'PERCENTAGE' ? 100 : undefined}
                      value={discountValue}
                      placeholder="0"
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>

                {/* Payment Terms */}
                <div className="space-y-2">
                  <Label htmlFor="paymentTerms">Payment terms</Label>
                  <Select
                    value={paymentTermDays.toString()}
                    onValueChange={(value) => setPaymentTermDays(parseInt(value))}
                  >
                    <SelectTrigger id="paymentTerms">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentTermsOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value.toString()}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {paymentTermDays === 0
                      ? 'Due on the day it is issued.'
                      : `Due ${paymentTermDays} days from today.`}
                  </p>
                </div>
              </div>

              {/* FR-013: the reason, asked for when it will be needed. */}
              {needsReason && (
                <div className="space-y-2">
                  <Label htmlFor="discountReason">Reason for the discount (required)</Label>
                  <Textarea
                    id="discountReason"
                    rows={2}
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    aria-invalid={showErrors && discountReason.trim().length < 3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(concession)} off
                    {shortfall > 0
                      ? ` (including ${formatCurrency(shortfall)} of treatments charged below their price)`
                      : ''}{' '}
                    is above the {formatCurrency(billing.discountApprovalThreshold)} threshold. A
                    manager or the administrator other than you approves it before the invoice can
                    be issued.
                  </p>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection title="Notes and terms" description="Printed on the invoice">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (visible on invoice)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional notes for the patient..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terms">Terms &amp; conditions</Label>
                <Textarea
                  id="terms"
                  value={termsAndConditions}
                  onChange={(e) => setTermsAndConditions(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          </FormSection>
        </div>

        {/* Summary, pinned while the form scrolls */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-6">
            <CardHeader className="pb-4">
              <CardTitle>Summary</CardTitle>
              <CardDescription>
                {selectedPatient
                  ? `${selectedPatient.firstName} ${selectedPatient.lastName} · ${items.length} ${
                      items.length === 1 ? 'item' : 'items'
                    }`
                  : 'No patient chosen yet'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Totals */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>
                      Discount
                      {discountType === 'PERCENTAGE' ? ` (${Number(discountValue) || 0}%)` : ''}
                    </span>
                    <span className="tabular-nums">-{formatCurrency(totals.discountAmount)}</span>
                  </div>
                )}
                {/* No tax line at all when the clinic is exempt — printing
                    "Sales Tax: Rs 0.00" on every invoice invites the question
                    of why it is there. */}
                {billing.rate > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Taxable value</span>
                      <span className="tabular-nums">{formatCurrency(totals.taxableAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {billing.label} ({billing.rate}%)
                      </span>
                      <span className="tabular-nums">{formatCurrency(totals.taxAmount)}</span>
                    </div>
                  </>
                )}
                <div className="mt-3 flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
                  <span className="font-semibold">Total</span>
                  <span className="text-2xl font-bold tracking-tight text-primary tabular-nums">
                    {formatCurrency(totals.totalAmount)}
                  </span>
                </div>
                <p className="pt-1 text-xs text-muted-foreground">
                  {paymentTermDays === 0
                    ? 'Due on the day it is issued.'
                    : `Due ${paymentTermDays} days from today.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Actions, pinned to the bottom while the form scrolls */}
      <FormActions>
        <Button type="button" variant="outline" asChild>
          <Link href={trail.back('/billing/invoices')}>Cancel</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => handleSubmit('DRAFT')}
          disabled={submitting || !canSubmit}
        >
          <Save className="h-4 w-4" />
          Save as draft
        </Button>
        <SubmitButton
          type="button"
          onClick={() => handleSubmit('PENDING')}
          busy={submitting}
          busyLabel="Creating…"
          icon={Send}
          disabled={!canSubmit}
        >
          Create &amp; issue invoice
        </SubmitButton>
      </FormActions>
    </div>
  )
}

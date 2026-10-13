'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useToast } from '@/hooks/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  User,
  Phone,
  Search,
  Calculator,
  CalendarDays,
  FileText,
  Loader2,
} from 'lucide-react'
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

  const [submitting, setSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // Patient selection
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const debouncedPatientSearch = useDebouncedValue(patientSearch)
  const [showPatientDropdown, setShowPatientDropdown] = useState(false)
  // Whether a request is out, so "no such patient" can be told apart from
  // "not answered yet". Without it the two look identical: nothing on screen.
  const [searchingPatients, setSearchingPatients] = useState(false)

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

  /**
   * Finding the patient this invoice is for.
   *
   * Three things were wrong with the previous version. It asked the server on
   * every keystroke, so typing a name sent a request per letter. Nothing
   * discarded a stale answer, so a slow reply for "Mu" could land after — and
   * overwrite — the reply for "Muhammad". And the term went into the URL
   * unencoded, so a name containing an ampersand silently truncated the search.
   */
  useEffect(() => {
    const term = debouncedPatientSearch.trim()

    if (term.length < 2) {
      setPatients([])
      setShowPatientDropdown(false)
      return
    }

    let current = true
    setShowPatientDropdown(true)
    setSearchingPatients(true)
    ;(async () => {
      try {
        const response = await fetch(`/api/patients?search=${encodeURIComponent(term)}&limit=10`)
        if (!current) return
        if (!response.ok) throw new Error('Failed to fetch patients')
        const data = await response.json()
        if (!current) return
        setPatients(data.patients ?? [])
      } catch (error) {
        console.error('Error fetching patients:', error)
        if (current) setPatients([])
      } finally {
        if (current) setSearchingPatients(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debouncedPatientSearch])

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

  // Fetch pre-selected patient if provided (and no visit names one)
  useEffect(() => {
    if (!preSelectedPatientId || preSelectedAppointmentId) return
    const fetchPatient = async () => {
      try {
        // By id, not through search: search matches a name, a phone or the
        // PAT number, never the database id, so this found nobody.
        const response = await fetch(`/api/patients/${encodeURIComponent(preSelectedPatientId)}`)
        if (!response.ok) throw new Error('Failed to fetch patient')
        const data = await response.json()
        if (data.patient) {
          const { id, patientId, firstName, lastName, phone, email } = data.patient
          setSelectedPatient({ id, patientId, firstName, lastName, phone, email: email ?? null })
        }
      } catch (error) {
        console.error('Error fetching patient:', error)
      }
    }
    fetchPatient()
  }, [preSelectedPatientId, preSelectedAppointmentId])

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
  // charged below its own price. Over the threshold it needs a reason and,
  // unless the person raising it may approve discounts, a manager's approval.
  const shortfall = priceShortfall(items)
  const concession = round2(totals.discountAmount + shortfall)
  const needsReason =
    billing.discountApprovalThreshold != null && concession > billing.discountApprovalThreshold

  const selectPatient = (patient: Patient) => {
    setSelectedPatient(patient)
    setPatientSearch('')
    setShowPatientDropdown(false)
    setItems([]) // Clear items when patient changes
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

  return (
    <div ref={formRef} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/billing/invoices">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">New Invoice</h1>
          <p className="text-muted-foreground">Create a new invoice for a patient</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Patient Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Patient Details</CardTitle>
              <CardDescription>Search and select a patient</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedPatient ? (
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200 dark:bg-green-950/30 dark:border-green-800/60">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40">
                      <User className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <div className="font-medium">
                        {selectedPatient.firstName} {selectedPatient.lastName}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{selectedPatient.patientId}</span>
                        <span>•</span>
                        <Phone className="h-3 w-3" />
                        {selectedPatient.phone}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedPatient(null)
                      // The visit was this patient's; it does not follow a change.
                      setVisit(null)
                      setItems([])
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, ID, or phone..."
                    data-form-guard="ignore"
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    className="pl-9"
                  />
                  {showPatientDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                      {/*
                        Real buttons, not clickable divs. A cashier types a name
                        and then had to reach for the mouse, because this list
                        could not be reached with Tab or chosen with Enter.
                      */}
                      {searchingPatients ? (
                        <p className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Searching…
                        </p>
                      ) : patients.length === 0 ? (
                        <p className="px-4 py-2 text-sm text-muted-foreground">
                          No patients found for &ldquo;{debouncedPatientSearch.trim()}&rdquo;
                        </p>
                      ) : (
                        patients.map((patient) => (
                          <button
                            key={patient.id}
                            type="button"
                            className="block w-full px-4 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none"
                            onClick={() => selectPatient(patient)}
                          >
                            <span className="block font-medium">
                              {patient.firstName} {patient.lastName}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {patient.patientId} • {patient.phone}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              {visit && selectedPatient && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  For the visit on {formatDate(visit.scheduledDate)} at {visit.scheduledTime}
                  {visit.doctor ? ` with ${visit.doctor}` : ''} ({visit.appointmentNo})
                </p>
              )}
            </CardContent>
          </Card>

          {/* Unbilled Treatments */}
          {selectedPatient && (
            <Card>
              <CardHeader>
                <CardTitle>Unbilled Treatments</CardTitle>
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
              <CardTitle>Invoice Items</CardTitle>
              <CardDescription>
                Treatments from above, products from the inventory, or a custom item
              </CardDescription>
            </CardHeader>
            <CardContent>
              {items.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2" />
                  <p>No items added yet</p>
                  <p className="text-sm">Add treatments from above, a product, or a custom item</p>
                </div>
              )}
              <InvoiceLinesEditor lines={items} onChange={setItems} showErrors={showErrors} />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Additional Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Notes (visible on invoice)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional notes for the patient..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Terms & Conditions</Label>
                <Textarea
                  value={termsAndConditions}
                  onChange={(e) => setTermsAndConditions(e.target.value)}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Invoice Summary */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Invoice Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Discount */}
              <div className="space-y-2">
                <Label htmlFor="discountValue">Discount</Label>
                <div className="flex gap-2">
                  <Select
                    value={discountType}
                    onValueChange={(value: 'PERCENTAGE' | 'FIXED') => setDiscountType(value)}
                  >
                    <SelectTrigger className="w-[100px]" aria-label="Discount type">
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
                    manager approves it before the invoice can be issued, unless you may approve
                    discounts yourself.
                  </p>
                </div>
              )}

              {/* Payment Terms */}
              <div className="space-y-2">
                <Label>Payment Terms</Label>
                <Select
                  value={paymentTermDays.toString()}
                  onValueChange={(value) => setPaymentTermDays(parseInt(value))}
                >
                  <SelectTrigger>
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

              {/* Totals */}
              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>
                      Discount
                      {discountType === 'PERCENTAGE' ? ` (${Number(discountValue) || 0}%)` : ''}
                    </span>
                    <span>-{formatCurrency(totals.discountAmount)}</span>
                  </div>
                )}
                {/* No tax line at all when the clinic is exempt — printing
                    "Sales Tax: Rs 0.00" on every invoice invites the question
                    of why it is there. */}
                {billing.rate > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Taxable value</span>
                      <span>{formatCurrency(totals.taxableAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>
                        {billing.label} ({billing.rate}%)
                      </span>
                      <span>{formatCurrency(totals.taxAmount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Total</span>
                  <span className="text-primary">{formatCurrency(totals.totalAmount)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4">
                <Button
                  className="w-full"
                  onClick={() => handleSubmit('PENDING')}
                  disabled={submitting || !selectedPatient || items.length === 0}
                >
                  {submitting ? 'Creating...' : 'Create & issue invoice'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSubmit('DRAFT')}
                  disabled={submitting || !selectedPatient || items.length === 0}
                >
                  Save as Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { InvoiceLinesEditor } from '@/components/billing/invoice-lines-editor'
import {
  UnbilledTreatmentList,
  treatmentLine,
  type UnbilledTreatment,
} from '@/components/billing/unbilled-treatment-list'
import { calculateInvoiceTotals, formatCurrency } from '@/lib/billing-utils'
import {
  lineKey,
  lineProblem,
  linesForRequest,
  linesForTotals,
  priceShortfall,
  type FormLine,
} from '@/lib/invoice-form'
import { displayDate, isoDay } from '@/lib/dates'
import { statusLabel } from '@/lib/status'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { round2 } from '@/lib/till'
import { AlertCircle, Lock, Save, Send } from 'lucide-react'

/**
 * Edit an invoice.
 *
 * A draft can be changed in full: lines (custom, the patient's unbilled
 * treatments, and products), discount and reason, due date, notes and terms.
 *
 * An issued invoice is a document the patient has been given. Its lines and
 * discount are fixed — the API now refuses them too (invoice review 6.2) —
 * and what can still change is what does not alter the amount: the notes, the
 * terms, and the due date (not before the day it was issued). To change what
 * is owed: a payment, a refund, or cancel it and raise a new one.
 *
 * A paid, refunded or cancelled invoice is closed.
 */

const DISCOUNT_TYPES = [
  { value: 'FIXED', label: 'Fixed amount' },
  { value: 'PERCENTAGE', label: 'Percentage' },
]

/** Statuses an invoice is issued and still open in. */
const ISSUED_OPEN = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE']

interface SavedLine {
  description: string
  quantity: number
  unitPrice: number
  amount: number
  taxable: boolean
}

/** A typed percentage from 0 to 100, or null. */
function parsePercent(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) && value <= 100 ? value : null
}

export default function EditInvoicePage() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const { toast } = useToast()

  // Which button is sending: a plain save, or save and issue.
  const [saving, setSaving] = useState<'save' | 'issue' | null>(null)
  // Warn before a half-filled form is thrown away by a stray click; not while
  // a successful save is navigating away. The ref sits on the wrapper at the
  // bottom, which is there from the first render, not on the form, which only
  // appears once the invoice has loaded.
  const formRef = useFormGuard(saving !== null)

  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed' | 'missing'>('loading')
  const [invoiceNo, setInvoiceNo] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [items, setItems] = useState<FormLine[]>([])
  const [savedLines, setSavedLines] = useState<SavedLine[]>([])
  const [savedTotals, setSavedTotals] = useState({
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    taxRate: 0,
  })
  const [discountType, setDiscountType] = useState('FIXED')
  // The text in the field, not a number: a blank, a typo and "1,500" must not
  // all quietly become zero (lib/money-input.ts).
  const [discountValue, setDiscountValue] = useState('0')
  const [discountReason, setDiscountReason] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [issueDay, setIssueDay] = useState('')
  const [notes, setNotes] = useState('')
  const [termsAndConditions, setTermsAndConditions] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  // A draft is priced at the clinic's rate today, the rate it will be issued
  // at — so this preview is the bill that goes out (lib/invoice-issue.ts).
  const [billing, setBilling] = useState({
    rate: 0,
    label: 'Sales Tax',
    discountApprovalThreshold: null as number | null,
  })

  const [unbilled, setUnbilled] = useState<UnbilledTreatment[]>([])
  const [loadingUnbilled, setLoadingUnbilled] = useState(false)

  const trail = useTrail(invoiceNo)

  useEffect(() => {
    fetch('/api/billing/tax-settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBilling((current) => ({ ...current, ...data })))
      .catch(() => {
        /* preview only; the server applies the correct rate */
      })
  }, [])

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`)
      // A dropped connection offers a retry; an invoice that is not there,
      // a way back.
      if (res.status === 404) {
        setLoadState('missing')
        return
      }
      const data = await readJson<any>(res)
      const invoice = data.invoice ?? data

      setInvoiceNo(invoice.invoiceNo ?? null)
      setStatus(invoice.status ?? '')
      setPatient(
        invoice.patient
          ? {
              id: invoice.patient.id,
              name: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
            }
          : null
      )
      setItems(
        (invoice.items ?? []).map((item: any): FormLine => ({
          key: lineKey(),
          treatmentId: item.treatmentId ?? null,
          inventoryItemId: item.inventoryItemId ?? null,
          description: item.description ?? '',
          quantity: String(item.quantity ?? 1),
          unitPrice: String(Number(item.unitPrice ?? 0)),
          // Kept from the saved line. It was dropped here, so saving an
          // edit made every line taxable and taxed what the clinic had
          // marked exempt.
          taxable: item.taxable !== false,
          listPrice: item.treatment?.cost != null ? Number(item.treatment.cost) : null,
          reference: item.treatment?.treatmentNo ?? item.inventoryItem?.sku ?? null,
          unit: item.inventoryItem?.unit ?? null,
        }))
      )
      setSavedLines(
        (invoice.items ?? []).map((item: any) => ({
          description: item.description ?? '',
          quantity: Number(item.quantity ?? 1),
          unitPrice: Number(item.unitPrice ?? 0),
          amount: Number(item.amount ?? 0),
          taxable: item.taxable !== false,
        }))
      )
      setSavedTotals({
        subtotal: Number(invoice.subtotal ?? 0),
        discount: Number(invoice.discountAmount ?? 0),
        tax: Number(invoice.taxAmount ?? 0),
        total: Number(invoice.totalAmount ?? 0),
        taxRate: Number(invoice.taxRate ?? 0),
      })
      setDiscountType(invoice.discountType ?? 'FIXED')
      setDiscountValue(String(Number(invoice.discountValue ?? 0)))
      setDiscountReason(invoice.discountReason ?? '')
      // The day as the browser sees it; slicing the ISO string gave the
      // previous day for an instant stored in the early hours.
      setDueDate(invoice.dueDate ? isoDay(invoice.dueDate) : '')
      setIssueDay(isoDay(invoice.issuedAt ?? invoice.createdAt))
      setNotes(invoice.notes ?? '')
      setTermsAndConditions(invoice.termsAndConditions ?? '')
      setLoadState('ok')
    } catch (err) {
      console.error('Error loading invoice:', err)
      setLoadState('failed')
    }
  }, [invoiceId])

  useEffect(() => {
    // Fetching on mount and on change is what this effect is for; the state it
    // sets is the answer arriving.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // The patient's unbilled treatments, to add to a draft as New Invoice does.
  useEffect(() => {
    if (status !== 'DRAFT' || !patient) return
    let current = true
    ;(async () => {
      try {
        setLoadingUnbilled(true)
        const res = await fetch(
          `/api/billing/unbilled-treatments?patientId=${encodeURIComponent(patient.id)}`
        )
        const data = res.ok ? await res.json() : { treatments: [] }
        if (current) setUnbilled(data.treatments ?? [])
      } catch {
        if (current) setUnbilled([])
      } finally {
        if (current) setLoadingUnbilled(false)
      }
    })()
    return () => {
      current = false
    }
  }, [status, patient])

  const isDraft = status === 'DRAFT'

  // A blank discount is no discount; anything else typed has to read as an
  // amount (or a percentage), and is flagged under the field if it does not,
  // rather than silently read as nought.
  const discountNumber =
    discountValue.trim() === ''
      ? 0
      : discountType === 'PERCENTAGE'
        ? parsePercent(discountValue)
        : parseMoney(discountValue)

  // The server's own arithmetic (lib/billing-utils.ts), so the preview is
  // the invoice.
  const totals = useMemo(
    () =>
      calculateInvoiceTotals(
        linesForTotals(items),
        discountType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED',
        discountNumber ?? 0,
        billing.rate
      ),
    [items, discountType, discountNumber, billing.rate]
  )

  const shortfall = priceShortfall(items)
  const concession = round2(totals.discountAmount + shortfall)
  const needsReason =
    billing.discountApprovalThreshold != null && concession > billing.discountApprovalThreshold

  // What is wrong with each field, worked out on every render so a message
  // goes as soon as it is fixed.
  const fieldErrors = {
    discountValue:
      isDraft && discountNumber === null
        ? discountType === 'PERCENTAGE'
          ? 'Enter a percentage from 0 to 100.'
          : 'Enter the discount as an amount, such as 500.'
        : undefined,
    discountReason:
      isDraft && needsReason && discountReason.trim().length < 3
        ? 'Say why the discount is given (at least 3 characters).'
        : undefined,
    dueDate:
      !isDraft && dueDate && issueDay && dueDate < issueDay
        ? `An invoice cannot fall due before ${displayDate(issueDay)}, the day it was issued.`
        : undefined,
  }

  /**
   * Saves the draft; with `issue`, also moves it to Pending in the same
   * request, so the lines saved are exactly the lines issued. For an issued
   * invoice only the notes, terms and due date are sent.
   */
  const save = async (issue: boolean) => {
    setShowErrors(true)
    if (isDraft) {
      if (items.length === 0) {
        toast(
          toastError(
            'save the invoice',
            'An invoice needs at least one line. Add a line, or cancel the invoice instead of emptying it.'
          )
        )
        return
      }
      const problem = items.map(lineProblem).find(Boolean)
      if (problem) {
        // Said under the line itself by the editor; this names it once.
        toast(toastError('save the invoice', `Check the lines: ${problem}.`))
        return
      }
    }
    const firstError = (['discountValue', 'discountReason', 'dueDate'] as const).find(
      (field) => fieldErrors[field]
    )
    if (firstError) {
      toast(toastError('save the invoice', 'Check the highlighted fields.'))
      const field = document.getElementById(firstError)
      field?.scrollIntoView({ block: 'center' })
      field?.focus()
      return
    }

    setSaving(issue ? 'issue' : 'save')
    try {
      const body = isDraft
        ? {
            items: linesForRequest(items),
            discountType,
            discountValue: discountNumber ?? 0,
            discountReason: discountReason.trim() || null,
            dueDate: dueDate || null,
            notes,
            termsAndConditions,
            ...(issue ? { status: 'PENDING' } : {}),
          }
        : { dueDate: dueDate || null, notes, termsAndConditions }

      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await readJson<{ status?: string }>(res)

      toast(
        toastSuccess(
          issue ? 'Invoice issued' : 'Invoice saved',
          issue
            ? data.status === 'PAID'
              ? `${invoiceNo ?? 'The invoice'} has been issued. It owes nothing, so it is marked paid.`
              : `${invoiceNo ?? 'The invoice'} has been issued and can now be paid.`
            : `${invoiceNo ?? 'The invoice'} has been updated.`
        )
      )
      router.push(`/billing/invoices/${invoiceId}`)
    } catch (err) {
      toast(toastError(issue ? 'issue the invoice' : 'save the invoice', err))
    } finally {
      setSaving(null)
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void save(false)
  }

  const back = <BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />

  let content: React.ReactNode
  if (loadState === 'loading') {
    content = <PageSkeleton variant="form" />
  } else if (loadState === 'failed') {
    content = (
      <div className="space-y-6 max-w-2xl">
        {back}
        <LoadFailed what="this invoice" onRetry={load} />
      </div>
    )
  } else if (loadState === 'missing') {
    content = (
      <div className="space-y-6 max-w-2xl">
        {back}
        <EmptyState
          icon={AlertCircle}
          title="Invoice not found"
          description="It may have been removed, or the link is wrong."
          actionLabel="Back to invoices"
          actionHref={trail.back('/billing/invoices')}
        />
      </div>
    )
  } else if (!isDraft && !ISSUED_OPEN.includes(status)) {
    content = (
      <div className="space-y-6 max-w-2xl">
        <PageHeader back={back} title={`Edit ${invoiceNo ?? 'invoice'}`} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{invoiceNo} is closed and cannot be edited</CardTitle>
            <CardDescription>
              This invoice is {statusLabel('invoice', status).toLowerCase()}. To change what is
              owed, issue a refund, or cancel this invoice and raise a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href={`/billing/invoices/${invoiceId}`}>Back to the invoice</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  } else {
    content = (
      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        <PageHeader
          back={back}
          title={`Edit ${invoiceNo ?? 'invoice'}`}
          description={
            patient && (
              <>
                for{' '}
                <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
                  {patient.name}
                </Link>
              </>
            )
          }
        />

        {isDraft ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lines</CardTitle>
              </CardHeader>
              <CardContent>
                <InvoiceLinesEditor
                  lines={items}
                  onChange={setItems}
                  showErrors={showErrors}
                  trailTo={trail.to}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Unbilled treatments</CardTitle>
                <CardDescription>
                  {patient?.name ?? 'The patient'}&rsquo;s treatments not yet on an invoice
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UnbilledTreatmentList
                  loading={loadingUnbilled}
                  treatments={unbilled}
                  visitId={null}
                  isAdded={(id) => items.some((i) => i.treatmentId === id)}
                  onAdd={(treatment) =>
                    setItems((current) => [...current, treatmentLine(treatment)])
                  }
                />
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Lines
              </CardTitle>
              <CardDescription>
                This invoice has been issued, so its lines and discount are fixed: the patient has
                been given it, and what it says has to stay said. The notes, terms and due date can
                still change. To change what is owed, record a payment, issue a refund, or cancel
                this invoice and raise a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedLines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        {line.description}
                        {savedTotals.taxRate > 0 && line.taxable && (
                          <span className="ml-2 text-xs text-muted-foreground">(taxable)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{line.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(line.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {isDraft ? 'Discount and tax' : 'Due date'}
              </CardTitle>
              {isDraft && (
                <CardDescription>
                  A discount — together with any treatment charged below its price — above the
                  clinic&rsquo;s threshold needs a reason and a manager&rsquo;s approval before the
                  invoice can be issued.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {isDraft && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Discount type" htmlFor="discountType">
                      <Select value={discountType} onValueChange={setDiscountType}>
                        <SelectTrigger id="discountType">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DISCOUNT_TYPES.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField
                      label="Discount"
                      htmlFor="discountValue"
                      error={fieldErrors.discountValue}
                    >
                      {(control) =>
                        // A fixed discount is money, so it reads and parses as
                        // money; a percentage stays a plain number up to 100.
                        discountType === 'PERCENTAGE' ? (
                          <Input
                            {...control}
                            type="number"
                            min="0"
                            max={100}
                            step="0.01"
                            value={discountValue}
                            onChange={(e) => setDiscountValue(e.target.value)}
                          />
                        ) : (
                          <MoneyInput
                            {...control}
                            value={discountValue}
                            onChange={(raw) => setDiscountValue(raw)}
                          />
                        )
                      }
                    </FormField>
                  </div>
                  <FormField
                    label="Reason for the discount"
                    htmlFor="discountReason"
                    required={needsReason}
                    error={showErrors ? fieldErrors.discountReason : undefined}
                    hint={
                      needsReason
                        ? `${formatCurrency(concession)} off${
                            shortfall > 0
                              ? ` (including ${formatCurrency(shortfall)} of treatments charged below their price)`
                              : ''
                          } is above the ${formatCurrency(billing.discountApprovalThreshold)} threshold.`
                        : undefined
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                      />
                    )}
                  </FormField>
                  {/* The rate is the clinic's today; the server does not take
                      one from the form. Said in words rather than shown as a
                      greyed-out box that looks editable. */}
                  <p className="text-sm text-muted-foreground">
                    {billing.rate > 0
                      ? `${billing.label} is charged at ${billing.rate}% on the taxable lines, the clinic's current rate. It is fixed when the invoice is issued.`
                      : 'No tax is charged on this invoice.'}
                  </p>
                </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Due date"
                  htmlFor="dueDate"
                  error={fieldErrors.dueDate}
                  hint={
                    isDraft
                      ? 'Leave blank for due on the day it is issued.'
                      : `Not before ${displayDate(issueDay)}, the day it was issued.`
                  }
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      min={isDraft ? undefined : issueDay}
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  )}
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Total</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {isDraft ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Discount
                      {discountType === 'PERCENTAGE' ? ` (${discountNumber ?? 0}%)` : ''}
                    </span>
                    <span>−{formatCurrency(totals.discountAmount)}</span>
                  </div>
                  {billing.rate > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Taxable value</span>
                        <span>{formatCurrency(totals.taxableAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {billing.label} ({billing.rate}%)
                        </span>
                        <span>{formatCurrency(totals.taxAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-t pt-2 font-medium">
                    <span>Total</span>
                    <span>{formatCurrency(totals.totalAmount)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(savedTotals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span>−{formatCurrency(savedTotals.discount)}</span>
                  </div>
                  {savedTotals.taxRate > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({savedTotals.taxRate}%)</span>
                      <span>{formatCurrency(savedTotals.tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2 font-medium">
                    <span>Total</span>
                    <span>{formatCurrency(savedTotals.total)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes and terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Notes (visible on invoice)" htmlFor="notes">
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </FormField>
            <FormField label="Terms and conditions" htmlFor="terms">
              <Textarea
                id="terms"
                rows={3}
                value={termsAndConditions}
                onChange={(e) => setTermsAndConditions(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <Link href={`/billing/invoices/${invoiceId}`}>Cancel</Link>
          </Button>
          <SubmitButton
            variant={isDraft ? 'outline' : 'default'}
            busy={saving === 'save'}
            disabled={saving !== null}
            icon={Save}
          >
            Save changes
          </SubmitButton>
          {isDraft && (
            <SubmitButton
              type="button"
              busy={saving === 'issue'}
              busyLabel="Issuing…"
              disabled={saving !== null}
              icon={Send}
              onClick={() => void save(true)}
            >
              Save &amp; issue
            </SubmitButton>
          )}
        </div>
      </form>
    )
  }

  // Rendered in every state, so the unsaved-changes guard is attached from
  // the first frame rather than only once the form has appeared.
  return <div ref={formRef}>{content}</div>
}

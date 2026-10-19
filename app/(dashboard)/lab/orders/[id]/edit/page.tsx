'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, FormSection } from '@/components/ui/form-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { FlaskConical, Save } from 'lucide-react'
import { isLabOrderEditable, normaliseWorkType, WORK_TYPES } from '@/lib/lab-orders'
import { LabTreatmentPicker } from '@/components/lab/treatment-picker'
import {
  focusFirstError,
  labOrderErrors,
  type LabOrderErrors,
} from '@/components/lab/lab-order-errors'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { parseMoney } from '@/lib/money-input'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * Correct the details of a lab case.
 *
 * Reached from the Edit action on the lab list, which pushed at an address with
 * no page behind it.
 *
 * The patient is not editable. A case belongs to the mouth it was taken from,
 * and re-pointing one at a different patient would silently move a crown, its
 * shade and its impression dates onto someone else's record — if the wrong
 * patient was chosen, the case should be cancelled and raised again.
 *
 * Status is not here either: it moves through its own endpoint, which stamps
 * the milestone dates and writes the audit entry.
 */

// `LabOrderPriority` has two values. Low and High were offered here and were
// a Prisma validation error on save.
const PRIORITIES = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
]

const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : '')

export default function EditLabOrderPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params.id as string
  const { toast } = useToast()
  // The Lab Technician edits cases but holds no clinical read, and the chart
  // behind the tooth picker is clinical. Without it the picker is a plain
  // tooth list rather than a request the server refuses (bug report 16 Oct,
  // finding 8).
  const canReadChart = useCan('clinical:read') === true

  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'missing' | 'closed'>('ok')
  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(saving)
  const [errors, setErrors] = useState<LabOrderErrors>({})
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  /**
   * The teeth as stored, and the teeth chosen on the chart. The stored text is
   * sent back untouched unless the chart is used, so a value written before
   * the chart existed ("46-47") is not rewritten by opening the form to fix a
   * date.
   */
  const [storedTeeth, setStoredTeeth] = useState('')
  const [teeth, setTeeth] = useState<number[]>([])
  const [teethTouched, setTeethTouched] = useState(false)
  const [form, setForm] = useState({
    patientId: '',
    labVendorId: '',
    workType: '',
    description: '',
    shadeGuide: '',
    orderDate: '',
    expectedDate: '',
    estimatedCost: '',
    actualCost: '',
    priority: 'NORMAL',
    notes: '',
    specialInstructions: '',
    treatmentId: '',
  })

  const trail = useTrail(orderNumber)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadState('ok')
    try {
      const [orderRes, vendorRes] = await Promise.all([
        fetch(`/api/lab-orders/${orderId}`),
        fetch('/api/lab-vendors?status=active&sort=name'),
      ])

      if (orderRes.status === 404) {
        setLoadState('missing')
        return
      }
      const orderData = await readJson<{ data?: Record<string, any> } & Record<string, any>>(
        orderRes
      )
      const order = orderData.data ?? orderData

      const vendorData = await vendorRes.json().catch(() => ({}))
      setVendors(vendorData.data ?? vendorData.labVendors ?? [])

      setOrderNumber(order.orderNumber ?? null)
      if (!isLabOrderEditable(order.status)) {
        setLoadState('closed')
        return
      }
      setPatient(
        order.patient
          ? { id: order.patient.id, name: `${order.patient.firstName} ${order.patient.lastName}` }
          : order.patientName
            ? { id: order.patientId, name: order.patientName }
            : { id: order.patientId, name: 'this patient' }
      )
      setStoredTeeth(order.toothNumbers ?? '')
      setTeeth(parseTeeth(order.toothNumbers))
      setTeethTouched(false)
      setForm({
        patientId: order.patientId ?? '',
        labVendorId: order.labVendorId ?? '',
        // Normalised, so a value stored in another spelling still
        // selects its option instead of leaving the field blank — and
        // being silently dropped on save.
        workType: normaliseWorkType(order.workType) ?? '',
        description: order.description ?? '',
        shadeGuide: order.shadeGuide ?? '',
        orderDate: day(order.orderDate),
        expectedDate: day(order.expectedDate),
        estimatedCost: order.estimatedCost == null ? '' : String(order.estimatedCost),
        actualCost: order.actualCost == null ? '' : String(order.actualCost),
        priority: order.priority ?? 'NORMAL',
        notes: order.notes ?? '',
        specialInstructions: order.specialInstructions ?? '',
        treatmentId: order.treatmentId ?? '',
      })
    } catch (err) {
      console.error('Error loading lab order:', err)
      setLoadState('failed')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    // Loading is shown while the fetch is out; that render is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const set = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    // The error under a field goes as soon as it is touched again.
    if (field in errors) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    // The same rules the API applies (finding 59), said under each field.
    const found = labOrderErrors(form)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      toast(toastError('save the lab order', 'Check the highlighted fields.'))
      focusFirstError(event.currentTarget as HTMLElement)
      return
    }

    setSaving(true)
    try {
      await readJson(
        await fetch(`/api/lab-orders/${orderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            toothNumbers: teethTouched ? (formatTeeth(teeth) ?? '') : storedTeeth,
            estimatedCost: parseMoney(form.estimatedCost),
            // Blank means the laboratory has not billed yet, which is not the
            // same as billing nothing.
            actualCost: form.actualCost.trim() === '' ? null : parseMoney(form.actualCost),
            expectedDate: form.expectedDate || null,
            // Blank is "no treatment", which clears a link made by mistake.
            treatmentId: form.treatmentId || null,
          }),
        })
      )

      toast(toastSuccess('Lab order saved', orderNumber ?? undefined))
      router.push(`/lab/orders/${orderId}`)
    } catch (err) {
      toast(toastError(`save lab order ${orderNumber ?? ''}`.trim(), err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSkeleton variant="form" />

  if (loadState === 'missing') {
    return (
      <EmptyState
        icon={FlaskConical}
        title="Lab order not found"
        description="It may have been removed, or the link is wrong."
        actionLabel="Back to lab orders"
        actionHref="/lab"
      />
    )
  }

  if (loadState === 'failed') return <LoadFailed what="this lab order" onRetry={load} />

  if (loadState === 'closed') {
    return (
      <EmptyState
        icon={FlaskConical}
        title={`${orderNumber ?? 'This case'} was cancelled`}
        description="A cancelled case cannot be changed. If the work is needed after all, raise a new lab order."
        actionLabel="Back to the case"
        actionHref={`/lab/orders/${orderId}`}
      />
    )
  }

  // A stored value the chart cannot show (free text from before the chart).
  const unreadableTeeth =
    !teethTouched &&
    storedTeeth.trim() !== '' &&
    formatTeeth(parseTeeth(storedTeeth)) !== storedTeeth.replace(/\s+/g, '')

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${orderNumber ?? 'lab order'}`}
        back={<BackLink trail={trail} fallback="/lab" fallbackLabel="Lab orders" />}
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

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        <FormSection
          title="The case"
          description="The patient cannot be changed here — cancel and raise a new case instead."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Lab vendor" required error={errors.labVendorId}>
              {(control) => (
                <Select value={form.labVendorId} onValueChange={(v) => set('labVendorId', v)}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Choose a lab vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Work type" required error={errors.workType}>
              {(control) => (
                <Select value={form.workType} onValueChange={(v) => set('workType', v)}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Choose a work type" />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_TYPES.map((w) => (
                      <SelectItem key={w.value} value={w.value}>
                        {w.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              label="Teeth"
              className="md:col-span-2"
              hint={
                unreadableTeeth
                  ? `Recorded as “${storedTeeth}”. Choosing teeth here replaces it.`
                  : undefined
              }
            >
              <ToothPicker
                selected={teeth}
                onChange={(next) => {
                  setTeeth(next)
                  setTeethTouched(true)
                }}
                patientId={canReadChart ? form.patientId || null : null}
              />
            </FormField>
            <FormField label="Shade">
              {(control) => (
                <Input
                  {...control}
                  value={form.shadeGuide}
                  onChange={(e) => set('shadeGuide', e.target.value)}
                  placeholder="e.g. A2"
                />
              )}
            </FormField>
            <FormField label="Priority">
              {(control) => (
                <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <div className="md:col-span-2">
              <LabTreatmentPicker
                patientId={form.patientId}
                value={form.treatmentId}
                onChange={(treatmentId) => set('treatmentId', treatmentId)}
              />
            </div>
            <FormField label="Description" className="md:col-span-2">
              {(control) => (
                <Input
                  {...control}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        <FormSection
          title="Dates and cost"
          description="When it went out, when it is due back, and what it costs"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Order date" required error={errors.orderDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={form.orderDate}
                  onChange={(e) => set('orderDate', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Expected back" error={errors.expectedDate}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  min={form.orderDate || undefined}
                  value={form.expectedDate}
                  onChange={(e) => set('expectedDate', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Estimated cost" required error={errors.estimatedCost}>
              {(control) => (
                <MoneyInput
                  {...control}
                  value={form.estimatedCost}
                  onChange={(raw) => set('estimatedCost', raw)}
                />
              )}
            </FormField>
            <FormField label="Actual cost" error={errors.actualCost}>
              {(control) => (
                <MoneyInput
                  {...control}
                  value={form.actualCost}
                  onChange={(raw) => set('actualCost', raw)}
                  placeholder="Once the laboratory has billed"
                />
              )}
            </FormField>
          </div>
        </FormSection>

        <FormSection
          title="Instructions and notes"
          description="What the laboratory reads, and what stays in the clinic"
        >
          <div className="space-y-4">
            <FormField label="Instructions to the laboratory">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={form.specialInstructions}
                  onChange={(e) => set('specialInstructions', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Internal notes">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        <FormActions>
          <Button type="button" variant="outline" asChild>
            <Link href={`/lab/orders/${orderId}`}>Cancel</Link>
          </Button>
          <SubmitButton busy={saving} icon={Save}>
            Save changes
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}

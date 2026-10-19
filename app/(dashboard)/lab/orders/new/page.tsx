'use client'

import { useState, useEffect } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { FormField } from '@/components/ui/form-field'
import { MoneyInput } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { WORK_TYPES } from '@/lib/lab-orders'
import { LabTreatmentPicker } from '@/components/lab/treatment-picker'
import {
  focusFirstError,
  labOrderErrors,
  type LabOrderErrors,
} from '@/components/lab/lab-order-errors'
import { Save } from 'lucide-react'
import { isoDay } from '@/lib/dates'
import { formatTeeth } from '@/lib/teeth'
import { parseMoney } from '@/lib/money-input'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

interface Patient extends PickedPatient {
  dateOfBirth?: string | null
}

interface LabVendor {
  id: string
  name: string
  phone: string
  contactPerson: string | null
  specializations: string | null
  avgTurnaround: number | null
}

export default function NewLabOrderPage() {
  const router = useRouter()
  const trail = useTrail('New lab order')
  const searchParams = useSearchParams()
  // A link that hands a patient over (`?patientId=`) — the picker fetches that
  // patient by id (lib/prefill.ts behaviour), not by searching a page of the register.
  const preselectedPatientId = searchParams.get('patientId')
  const { toast } = useToast()
  // The Lab Technician raises cases but holds no clinical read, and the chart
  // behind the tooth picker is clinical. Without it the picker is a plain
  // tooth list rather than a request the server refuses (bug report 16 Oct,
  // finding 8).
  const canReadChart = useCan('clinical:read') === true

  const [vendors, setVendors] = useState<LabVendor[]>([])
  const [submitting, setSubmitting] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(submitting)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [teeth, setTeeth] = useState<number[]>([])
  const [errors, setErrors] = useState<LabOrderErrors>({})

  const [form, setForm] = useState({
    labVendorId: '',
    workType: '',
    description: '',
    shadeGuide: '',
    orderDate: isoDay(new Date()),
    expectedDate: '',
    estimatedCost: '',
    notes: '',
    treatmentId: '',
  })

  const set = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // The error under a field goes as soon as it is touched again.
    if (field in errors) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const vendorsRes = await fetch('/api/lab-vendors?status=active&sort=name')
        if (vendorsRes.ok) {
          const data = await vendorsRes.json()
          setVendors(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching vendors:', error)
      }
    }
    fetchVendors()
  }, [])

  const choosePatient = (patient: Patient | null) => {
    setSelectedPatient(patient)
    // A treatment belongs to one patient; choosing another clears it.
    setForm((prev) => ({ ...prev, treatmentId: '' }))
    if (patient) setErrors((prev) => ({ ...prev, patientId: undefined }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // The same rules the API applies (finding 59), said under each field.
    const found = labOrderErrors(
      { ...form, patientId: selectedPatient?.id ?? '' },
      { requirePatient: true }
    )
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      toast(toastError('create the lab order', 'Check the highlighted fields.'))
      focusFirstError(e.currentTarget as HTMLElement)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        patientId: selectedPatient!.id,
        labVendorId: form.labVendorId,
        workType: form.workType,
        description: form.description || undefined,
        toothNumbers: formatTeeth(teeth) ?? undefined,
        shadeGuide: form.shadeGuide || undefined,
        orderDate: form.orderDate,
        expectedDate: form.expectedDate || undefined,
        estimatedCost: parseMoney(form.estimatedCost),
        notes: form.notes || undefined,
        treatmentId: form.treatmentId || undefined,
      }

      const result = await readJson<{ data: { orderNumber: string } }>(
        await fetch('/api/lab-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      )

      toast(toastSuccess('Lab order created', result.data?.orderNumber))
      router.push('/lab')
    } catch (error) {
      toast(toastError('create the lab order', error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New lab order"
        description="Create a new lab work order"
        back={<BackLink trail={trail} fallback="/lab" fallbackLabel="Lab orders" />}
      />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* Patient selection */}
        <FormSection title="Patient" description="Select the patient for this lab order">
          <FormField label="Patient" required error={errors.patientId}>
            {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
              <PatientPicker<Patient>
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={selectedPatient}
                onChange={choosePatient}
                initialPatientId={preselectedPatientId}
              />
            )}
          </FormField>
        </FormSection>

        {/* Lab order details */}
        <FormSection title="Order details" description="Specify the lab work details">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Lab vendor" required error={errors.labVendorId}>
                {(control) => (
                  <Select value={form.labVendorId} onValueChange={(v) => set('labVendorId', v)}>
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Select lab vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>
                          {vendor.name}
                          {vendor.avgTurnaround ? ` (${vendor.avgTurnaround}d avg)` : ''}
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
                      <SelectValue placeholder="Select work type" />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_TYPES.map((wt) => (
                        <SelectItem key={wt.value} value={wt.value}>
                          {wt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>

            <FormField
              label="Teeth"
              hint={
                selectedPatient || !canReadChart
                  ? undefined
                  : 'Choose the patient to see their chart.'
              }
            >
              <ToothPicker
                selected={teeth}
                onChange={setTeeth}
                patientId={canReadChart ? (selectedPatient?.id ?? null) : null}
                age={selectedPatient?.age ?? null}
                dateOfBirth={selectedPatient?.dateOfBirth ?? null}
              />
            </FormField>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Shade guide">
                {(control) => (
                  <Input
                    {...control}
                    value={form.shadeGuide}
                    onChange={(e) => set('shadeGuide', e.target.value)}
                    placeholder="e.g. A2, B1"
                  />
                )}
              </FormField>

              <LabTreatmentPicker
                patientId={selectedPatient?.id ?? ''}
                value={form.treatmentId}
                onChange={(treatmentId) => set('treatmentId', treatmentId)}
              />
            </div>

            <FormField label="Description">
              {(control) => (
                <Textarea
                  {...control}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Describe the lab work required…"
                  rows={3}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {/* Dates and cost */}
        <FormSection title="Schedule and cost" description="Set dates and estimated cost">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

            <FormField label="Expected delivery date" error={errors.expectedDate}>
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
                  placeholder="0.00"
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {/* Notes */}
        <FormSection title="Additional notes" description="Anything the laboratory should know">
          <Textarea
            aria-label="Additional notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Any special instructions or notes for the lab…"
            rows={3}
          />
        </FormSection>

        {/* Actions, pinned to the bottom while the form scrolls */}
        <FormActions>
          <Button type="button" variant="outline" asChild>
            <Link href={trail.back('/lab')}>Cancel</Link>
          </Button>
          <SubmitButton busy={submitting} busyLabel="Creating lab order…" icon={Save}>
            Create lab order
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}

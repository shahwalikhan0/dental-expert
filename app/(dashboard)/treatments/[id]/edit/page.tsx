'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { LoadFailed } from '@/components/ui/load-failed'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { SubmitButton } from '@/components/ui/submit-button'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { AlertCircle, AlertTriangle, Save } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { formatTeeth, parseTeeth } from '@/lib/teeth'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

/**
 * Edit a treatment record.
 *
 * The treatments list and the treatment header have both offered this since
 * they were written, and the address had no page behind it.
 *
 * Both of those only show the button on an unsigned, open treatment — but the
 * address can be typed, and the route enforces FR-007 regardless: changing the
 * clinical content of a signed note requires a clinician and a reason. That
 * case is handled here rather than left to surface as a bare error, because a
 * clinician who has spotted a mistake in a signed note needs to be told what
 * the system wants from them, not refused.
 */

const CLINICAL_FIELDS = new Set([
  'toothNumbers',
  'chiefComplaint',
  'diagnosis',
  'findings',
  'procedureNotes',
  'materialsUsed',
  'complications',
])

const EMPTY = {
  toothNumbers: '',
  chiefComplaint: '',
  diagnosis: '',
  findings: '',
  procedureNotes: '',
  materialsUsed: '',
  complications: '',
  followUpDate: '',
  cost: '',
}

/** Teeth compared as teeth, so "46, 47" and "47,46" are the same column. */
const sameTeeth = (a: string, b: string) =>
  (formatTeeth(parseTeeth(a)) ?? '') === (formatTeeth(parseTeeth(b)) ?? '')

/** The amendment reason the route accepts; it refuses anything shorter. */
const MIN_AMENDMENT_REASON = 10

export default function EditTreatmentPage() {
  const router = useRouter()
  const params = useParams()
  const treatmentId = params.id as string
  const { toast } = useToast()

  const [form, setForm] = useState(EMPTY)
  const [original, setOriginal] = useState(EMPTY)
  const [treatmentNo, setTreatmentNo] = useState<string | null>(null)
  const [patient, setPatient] = useState<{
    id: string
    name: string
    dateOfBirth: string | null
  } | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)
  // The invoice still billing this treatment, if any. Its cost is what that
  // invoice charged, so it is shown and not editable; the route refuses a
  // change either way.
  const [billedOn, setBilledOn] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [errors, setErrors] = useState<{ cost?: string; amendmentReason?: string }>({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(saving)

  const trail = useTrail(treatmentNo)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/treatments/${treatmentId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      const data = await readJson<Record<string, any>>(res)
      const t = data.treatment ?? data

      setTreatmentNo(t.treatmentNo ?? null)
      setSignedAt(t.signedAt ?? null)
      setBilledOn(t.billedOn ?? null)
      setPatient(
        t.patient
          ? {
              id: t.patient.id,
              name: `${t.patient.firstName} ${t.patient.lastName}`,
              dateOfBirth: t.patient.dateOfBirth ?? null,
            }
          : null
      )

      const values = {
        toothNumbers: t.toothNumbers ?? '',
        chiefComplaint: t.chiefComplaint ?? '',
        diagnosis: t.diagnosis ?? '',
        findings: t.findings ?? '',
        procedureNotes: t.procedureNotes ?? '',
        materialsUsed: t.materialsUsed ?? '',
        complications: t.complications ?? '',
        followUpDate: t.followUpDate ? String(t.followUpDate).slice(0, 10) : '',
        cost: t.cost == null ? '' : String(t.cost),
      }
      setForm(values)
      setOriginal(values)
    } catch (err) {
      console.error('Error loading treatment:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [treatmentId])

  useEffect(() => {
    load()
  }, [load])

  const set = (field: keyof typeof EMPTY, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  // Which clinical fields this edit would actually change. The same question the
  // route asks, asked here so the reason box appears before the save is refused.
  const amendedFields = Object.keys(form).filter((field) => {
    if (!CLINICAL_FIELDS.has(field)) return false
    if (field === 'toothNumbers') return !sameTeeth(form.toothNumbers, original.toothNumbers)
    return form[field as keyof typeof EMPTY] !== original[field as keyof typeof EMPTY]
  })
  const needsReason = Boolean(signedAt) && amendedFields.length > 0

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const cost = form.cost === '' ? null : parseMoney(form.cost)
    const found: typeof errors = {}
    if (!billedOn && form.cost !== '' && cost === null) {
      found.cost = 'Enter an amount, such as 1500 or 1500.50.'
    }
    if (needsReason && amendmentReason.trim().length < MIN_AMENDMENT_REASON) {
      found.amendmentReason = `Say what was wrong with the signed note, in at least ${MIN_AMENDMENT_REASON} characters.`
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast(toastError('save the treatment', 'Check the highlighted fields.'))
      const first = found.cost ? 'cost' : 'amendmentReason'
      document.getElementById(first)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById(first)?.focus()
      return
    }

    setSaving(true)
    try {
      await readJson(
        await fetch(`/api/treatments/${treatmentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            // The column as it was when the teeth are the same teeth, so a
            // tooth ticked and unticked again is not sent as an amendment.
            toothNumbers: sameTeeth(form.toothNumbers, original.toothNumbers)
              ? original.toothNumbers
              : form.toothNumbers,
            followUpDate: form.followUpDate || null,
            // Not sent at all while billed: there is nothing to change, and an
            // unchanged figure is all the field can hold.
            cost: cost === null || billedOn ? undefined : cost,
            ...(needsReason ? { amendmentReason: amendmentReason.trim() } : {}),
          }),
        })
      )

      toast(toastSuccess(`Treatment ${treatmentNo ?? ''} saved`.replace('  ', ' ')))
      router.push(`/treatments/${treatmentId}`)
    } catch (err) {
      toast(toastError(`save treatment ${treatmentNo ?? ''}`.trim(), err))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !treatmentNo) {
    return <PageSkeleton variant="form" />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Treatment not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to treatments"
        actionHref="/treatments"
      />
    )
  }

  if (failed) {
    return <LoadFailed what="this treatment" onRetry={load} />
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6 max-w-3xl" noValidate>
      <PageHeader
        back={
          <BackLink
            trail={trail}
            fallback={`/treatments/${treatmentId}`}
            fallbackLabel={treatmentNo ?? 'Treatment'}
          />
        }
        title={`Edit ${treatmentNo ?? 'treatment'}`}
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

      {signedAt && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              This note was signed on {displayDate(signedAt)}
            </CardTitle>
            <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
              The original stays on the record. Any change to the clinical content is marked as an
              amendment and needs a reason.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* The chart, not a free-text "e.g. 46": the same picker as New
          treatment, so the teeth are chosen the same way on both screens and a
          typed "99" can no longer reach the route. */}
      <ToothPicker
        patientId={patient?.id}
        dateOfBirth={patient?.dateOfBirth}
        selected={parseTeeth(form.toothNumbers)}
        onChange={(teeth) => set('toothNumbers', formatTeeth(teeth) ?? '')}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Chief complaint" htmlFor="chiefComplaint">
            <Input
              id="chiefComplaint"
              value={form.chiefComplaint}
              onChange={(e) => set('chiefComplaint', e.target.value)}
            />
          </FormField>

          <FormField label="Diagnosis" htmlFor="diagnosis">
            <Input
              id="diagnosis"
              value={form.diagnosis}
              onChange={(e) => set('diagnosis', e.target.value)}
            />
          </FormField>

          <FormField label="Findings" htmlFor="findings">
            <Textarea
              id="findings"
              rows={3}
              value={form.findings}
              onChange={(e) => set('findings', e.target.value)}
            />
          </FormField>

          <FormField label="Procedure notes" htmlFor="procedureNotes">
            <Textarea
              id="procedureNotes"
              rows={5}
              value={form.procedureNotes}
              onChange={(e) => set('procedureNotes', e.target.value)}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Materials used" htmlFor="materialsUsed">
              <Textarea
                id="materialsUsed"
                rows={2}
                value={form.materialsUsed}
                onChange={(e) => set('materialsUsed', e.target.value)}
              />
            </FormField>
            <FormField label="Complications" htmlFor="complications">
              <Textarea
                id="complications"
                rows={2}
                value={form.complications}
                onChange={(e) => set('complications', e.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-up and cost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Follow-up date" htmlFor="followUpDate">
            <Input
              id="followUpDate"
              type="date"
              value={form.followUpDate}
              onChange={(e) => set('followUpDate', e.target.value)}
            />
          </FormField>
          <FormField
            label="Cost"
            htmlFor="cost"
            error={errors.cost}
            hint={
              billedOn ? (
                <>
                  Billed on{' '}
                  <Link
                    href={trail.to(`/billing/invoices/${billedOn.id}`)}
                    className="font-medium hover:underline"
                  >
                    {billedOn.invoiceNo}
                  </Link>
                  . Cancel or edit that invoice first to change the cost.
                </>
              ) : undefined
            }
          >
            {(control) => (
              <MoneyInput
                {...control}
                value={form.cost}
                onChange={(raw) => set('cost', raw)}
                disabled={Boolean(billedOn)}
              />
            )}
          </FormField>
        </CardContent>
      </Card>

      {needsReason && (
        <Card className="border-amber-300 dark:border-amber-800/70">
          <CardHeader>
            <CardTitle className="text-base">Why is this being amended?</CardTitle>
            <CardDescription>
              Changing {amendedFields.join(', ')} on a signed note. This reason is kept with the
              record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              label="Reason for the amendment"
              htmlFor="amendmentReason"
              required
              error={errors.amendmentReason}
              hint={`At least ${MIN_AMENDMENT_REASON} characters.`}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={amendmentReason}
                  onChange={(e) => setAmendmentReason(e.target.value)}
                  placeholder="What was wrong with the note as signed?"
                />
              )}
            </FormField>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={`/treatments/${treatmentId}`}>Cancel</Link>
        </Button>
        <SubmitButton busy={saving} busyLabel="Saving…" icon={Save}>
          {needsReason ? 'Save amendment' : 'Save changes'}
        </SubmitButton>
      </div>
    </form>
  )
}

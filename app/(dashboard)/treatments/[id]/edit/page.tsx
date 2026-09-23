'use client'

import { useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { AlertTriangle, Loader2, Save } from 'lucide-react'

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

export default function EditTreatmentPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const treatmentId = params.id as string
  const { toast } = useToast()

  const [form, setForm] = useState(EMPTY)
  const [original, setOriginal] = useState(EMPTY)
  const [treatmentNo, setTreatmentNo] = useState<string | null>(null)
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(null)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(treatmentNo)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/treatments/${treatmentId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'That treatment could not be loaded')
        const t = data.treatment ?? data

        setTreatmentNo(t.treatmentNo ?? null)
        setSignedAt(t.signedAt ?? null)
        setPatient(
          t.patient
            ? { id: t.patient.id, name: `${t.patient.firstName} ${t.patient.lastName}` }
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
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the treatment',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [treatmentId, toast])

  const set = (field: keyof typeof EMPTY, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  // Which clinical fields this edit would actually change. The same question the
  // route asks, asked here so the reason box appears before the save is refused.
  const amendedFields = Object.keys(form).filter(
    (field) =>
      CLINICAL_FIELDS.has(field) &&
      form[field as keyof typeof EMPTY] !== original[field as keyof typeof EMPTY]
  )
  const needsReason = Boolean(signedAt) && amendedFields.length > 0

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (needsReason && amendmentReason.trim().length < 10) {
      toast({
        title: 'A reason is required',
        description: 'Say what was wrong with the signed note, in at least ten characters.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/treatments/${treatmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          followUpDate: form.followUpDate || null,
          cost: form.cost === '' ? undefined : Number(form.cost),
          ...(needsReason ? { amendmentReason: amendmentReason.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save the treatment')

      toast({ title: 'Saved', description: `${treatmentNo ?? 'The treatment'} has been updated.` })
      router.push(`/treatments/${treatmentId}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save the treatment',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <BackLink trail={trail} fallback="/treatments" fallbackLabel="Treatments" />

      <div>
        <h1 className="text-2xl font-bold">Edit {treatmentNo ?? 'treatment'}</h1>
        {patient && (
          <p className="text-muted-foreground">
            for{' '}
            <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
              {patient.name}
            </Link>
          </p>
        )}
      </div>

      {signedAt && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              This note was signed on {new Date(signedAt).toLocaleDateString('en-GB')}
            </CardTitle>
            <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
              The original stays on the record. Any change to the clinical content is marked as an
              amendment and needs a reason.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="toothNumbers">Tooth numbers</Label>
              <Input
                id="toothNumbers"
                value={form.toothNumbers}
                onChange={(e) => set('toothNumbers', e.target.value)}
                placeholder="e.g. 46"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chiefComplaint">Chief complaint</Label>
              <Input
                id="chiefComplaint"
                value={form.chiefComplaint}
                onChange={(e) => set('chiefComplaint', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="diagnosis">Diagnosis</Label>
            <Input
              id="diagnosis"
              value={form.diagnosis}
              onChange={(e) => set('diagnosis', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="findings">Findings</Label>
            <Textarea
              id="findings"
              rows={3}
              value={form.findings}
              onChange={(e) => set('findings', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="procedureNotes">Procedure notes</Label>
            <Textarea
              id="procedureNotes"
              rows={5}
              value={form.procedureNotes}
              onChange={(e) => set('procedureNotes', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="materialsUsed">Materials used</Label>
              <Textarea
                id="materialsUsed"
                rows={2}
                value={form.materialsUsed}
                onChange={(e) => set('materialsUsed', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complications">Complications</Label>
              <Textarea
                id="complications"
                rows={2}
                value={form.complications}
                onChange={(e) => set('complications', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-up and cost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="followUpDate">Follow-up date</Label>
            <Input
              id="followUpDate"
              type="date"
              value={form.followUpDate}
              onChange={(e) => set('followUpDate', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost">Cost</Label>
            <Input
              id="cost"
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => set('cost', e.target.value)}
            />
          </div>
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
            <Textarea
              rows={3}
              value={amendmentReason}
              onChange={(e) => setAmendmentReason(e.target.value)}
              placeholder="What was wrong with the note as signed?"
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={`/treatments/${treatmentId}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {needsReason ? 'Save amendment' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

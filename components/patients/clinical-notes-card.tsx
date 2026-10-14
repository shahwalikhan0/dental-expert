'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { displayDateTime } from '@/lib/dates'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { MIN_REASON_LENGTH } from '@/lib/clinical-notes'
import { Lock, MessageSquareText, NotebookPen, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The clinical record a procedure is not.
 *
 * A telephone call about post-operative pain, a consultation that ended in
 * "come back when the swelling is down", and — most important of the three —
 * treatment offered and refused. All of those used to go in
 * `Appointment.notes`, a scheduling field with no author, no signature and no
 * amendment trail, editable by anyone who could edit the booking.
 *
 * The rules on screen are the same as a treatment's, because they are the same
 * rules: once signed, a note is locked; a clinician may still correct it, with
 * a reason, and what it said before is kept; anybody else adds an addendum.
 */

const KINDS = [
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'PHONE_CALL', label: 'Telephone call' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'OBSERVATION', label: 'Observation' },
  { value: 'DECLINED_TREATMENT', label: 'Treatment declined' },
  { value: 'OTHER', label: 'Other' },
] as const

const KIND_LABELS: Record<string, string> = Object.fromEntries(
  KINDS.map((kind) => [kind.value, kind.label])
)

interface Amendment {
  id: string
  kind: 'ADDENDUM' | 'CORRECTION'
  body: string
  createdAt: string
  author: { id: string; name: string | null }
}

interface Note {
  id: string
  noteNo: string
  kind: string
  summary: string
  body: string
  toothNumbers: string | null
  createdAt: string
  signedAt: string | null
  amendedAt: string | null
  author: { id: string; name: string | null }
  signedBy: { id: string; name: string | null } | null
  appointment: { id: string; appointmentNo: string; startsAt: string } | null
  amendments: Amendment[]
}

export function ClinicalNotesCard({
  patientId,
  canWrite,
  canSign,
}: {
  patientId: string
  canWrite: boolean
  canSign: boolean
}) {
  const { toast } = useToast()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [addendumFor, setAddendumFor] = useState<Note | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/notes`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes(data.notes ?? [])
    } catch {
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const sign = async (note: Note) => {
    // Irreversible but destroys nothing: asked, in the default tone.
    const ok = await confirm({
      title: `Sign note ${note.noteNo}?`,
      description:
        'Signing locks it. Anything added afterwards is an addendum, dated and attributed.',
      confirmLabel: 'Sign note',
      tone: 'default',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/clinical-notes/${note.id}/sign`, { method: 'POST' })
      await readJson(res)
      toast(toastSuccess(`${note.noteNo} signed`, 'It is locked now.'))
      load()
    } catch (err) {
      toast(toastError(`sign ${note.noteNo}`, err))
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Clinical notes</CardTitle>
          <CardDescription>
            Calls, consultations and anything recorded without a procedure
          </CardDescription>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setComposing(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New note
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          [0, 1, 2].map((row) => <Skeleton key={row} className="h-24 w-full" />)
        ) : notes.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No clinical notes"
            description="A telephone call, a consultation with no procedure, or treatment the patient declined — anything that belongs on the record but is not a treatment."
            {...(canWrite
              ? { actionLabel: 'Write the first one', onAction: () => setComposing(true) }
              : {})}
          />
        ) : (
          notes.map((note) => (
            <NoteEntry
              key={note.id}
              note={note}
              canSign={canSign}
              onSign={sign}
              onAmend={setAddendumFor}
            />
          ))
        )}
      </CardContent>

      <ComposeDialog
        open={composing}
        onOpenChange={setComposing}
        patientId={patientId}
        onSaved={() => {
          setComposing(false)
          load()
        }}
      />

      <AddendumDialog
        note={addendumFor}
        onOpenChange={(open) => !open && setAddendumFor(null)}
        onSaved={() => {
          setAddendumFor(null)
          load()
        }}
      />
      {ConfirmDialogComponent}
    </Card>
  )
}

function NoteEntry({
  note,
  canSign,
  onSign,
  onAmend,
}: {
  note: Note
  canSign: boolean
  onSign: (note: Note) => void
  onAmend: (note: Note) => void
}) {
  const teeth = note.toothNumbers ? parseTeeth(note.toothNumbers) : []

  return (
    <article
      className={cn(
        'rounded-lg border p-4',
        // A signed note reads as settled. An unsigned one is a draft and
        // should look like one, because the difference decides whether
        // anybody may still change it.
        note.signedAt ? 'border-border/60 bg-foreground/[0.02]' : 'border-dashed'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABELS[note.kind] ?? note.kind}</Badge>
            <span className="text-sm font-medium">{note.summary}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {note.noteNo} · {note.author.name ?? 'Unknown'} · {displayDateTime(note.createdAt)}
            {note.appointment && ` · at ${note.appointment.appointmentNo}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {note.signedAt ? (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              Signed
            </Badge>
          ) : canSign ? (
            <Button size="sm" variant="outline" onClick={() => onSign(note)}>
              Sign
            </Button>
          ) : (
            <Badge variant="outline">Unsigned</Badge>
          )}

          {note.signedAt && canSign && (
            <Button size="sm" variant="ghost" onClick={() => onAmend(note)}>
              <MessageSquareText className="mr-2 h-4 w-4" />
              Addendum
            </Button>
          )}
        </div>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm">{note.body}</p>

      {teeth.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{describeTeethByQuadrant(teeth)}</p>
      )}

      {note.signedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Signed by {note.signedBy?.name ?? 'a clinician'} on {displayDateTime(note.signedAt)}
          {note.amendedAt && ` · amended ${displayDateTime(note.amendedAt)}`}
        </p>
      )}

      {note.amendments.length > 0 && (
        <ul className="mt-3 space-y-2 border-t pt-3">
          {note.amendments.map((amendment) => (
            <li key={amendment.id} className="text-sm">
              <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                {amendment.kind === 'ADDENDUM' ? 'Addendum' : 'Correction'}
              </span>
              <p className="whitespace-pre-wrap">{amendment.body}</p>
              <p className="text-xs text-muted-foreground">
                {amendment.author.name ?? 'Unknown'} · {displayDateTime(amendment.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function ComposeDialog({
  open,
  onOpenChange,
  patientId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [kind, setKind] = useState<string>('CONSULTATION')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [teeth, setTeeth] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setKind('CONSULTATION')
      setSummary('')
      setBody('')
      setTeeth('')
    }
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, summary, body, toothNumbers: teeth || null }),
      })
      const data = await readJson<{ noteNo: string }>(res)

      toast(toastSuccess(`${data.noteNo} saved`, 'It is a draft until it is signed.'))
      onSaved()
    } catch (err) {
      toast(toastError('save the note', err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New clinical note</DialogTitle>
          <DialogDescription>
            Saved unsigned, so it can still be edited. Signing it locks it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="note-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="note-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note-teeth">Teeth (optional)</Label>
              <Input
                id="note-teeth"
                value={teeth}
                onChange={(event) => setTeeth(event.target.value)}
                placeholder="e.g. 16, 26"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-summary">Summary</Label>
            <Input
              id="note-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="One line — this is what shows in the list"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-body">Note</Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              placeholder="What was said, what was found, what was advised."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            onClick={save}
            busy={saving}
            busyLabel="Saving…"
            disabled={summary.trim().length < 3 || body.trim().length < 3}
          >
            Save note
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddendumDialog({
  note,
  onOpenChange,
  onSaved,
}: {
  note: Note | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (note) setBody('')
  }, [note])

  const save = async () => {
    if (!note) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clinical-notes/${note.id}/addenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      await readJson(res)

      toast(toastSuccess('Addendum added', `Appended to ${note.noteNo}.`))
      onSaved()
    } catch (err) {
      toast(toastError(`add the addendum to ${note.noteNo}`, err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Addendum to {note?.noteNo}</DialogTitle>
          <DialogDescription>
            The note itself stays as it was signed. This is appended to it, attributed and dated,
            and cannot be edited afterwards.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={6}
          placeholder="What you want to add to the record."
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            type="button"
            onClick={save}
            busy={saving}
            busyLabel="Adding…"
            disabled={body.trim().length < MIN_REASON_LENGTH}
          >
            Add addendum
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

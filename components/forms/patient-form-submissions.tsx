'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FormRenderer, type FormField } from './form-renderer'
import { FileText, Eye, CheckCircle2, XCircle, Clock, Loader2, Plus, Printer } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'

interface FormSubmission {
  id: string
  templateId: string
  patientId: string | null
  appointmentId: string | null
  data: Record<string, unknown>
  signature: string | null
  signedAt: string | null
  status: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  template: {
    id: string
    name: string
    type: string
    fields?: FormField[]
  }
}

const statusConfig: Record<
  string,
  {
    icon: React.ReactNode
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  SUBMITTED: { icon: <Clock className="h-3 w-3" />, label: 'Pending Review', variant: 'secondary' },
  REVIEWED: { icon: <Eye className="h-3 w-3" />, label: 'Reviewed', variant: 'outline' },
  APPROVED: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Approved', variant: 'default' },
  REJECTED: { icon: <XCircle className="h-3 w-3" />, label: 'Rejected', variant: 'destructive' },
}

interface FillableTemplate {
  id: string
  name: string
  description: string | null
  type: string
  fields: FormField[]
}

interface PatientFormSubmissionsProps {
  patientId: string
}

/** The submission's print page (app/api/forms/[id]/pdf): Print → Save as PDF. */
const pdfHref = (submissionId: string) => `/api/forms/${submissionId}/pdf`

export function PatientFormSubmissions({ patientId }: PatientFormSubmissionsProps) {
  const { toast } = useToast()
  const [submissions, setSubmissions] = useState<FormSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [viewSubmission, setViewSubmission] = useState<FormSubmission | null>(null)
  const [reviewStatus, setReviewStatus] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [filling, setFilling] = useState(false)
  // Filling in a form and reviewing one are both `patients:write` on the
  // server (POST and PUT /api/forms). Everyone else reads (16 Oct, finding 23).
  const canWrite = useCan('patients:write') === true

  useEffect(() => {
    fetchSubmissions()
  }, [patientId])

  const fetchSubmissions = async () => {
    try {
      const res = await fetch(`/api/forms?patientId=${patientId}`)
      const data = await res.json()
      if (data.submissions) setSubmissions(data.submissions)
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load form submissions' })
    } finally {
      setLoading(false)
    }
  }

  const handleViewSubmission = async (submission: FormSubmission) => {
    // Fetch full submission with template fields
    try {
      const res = await fetch(`/api/forms/${submission.id}`)
      const data = await res.json()
      if (data.submission) {
        setViewSubmission(data.submission)
        setReviewStatus(data.submission.status)
        setReviewNotes(data.submission.reviewNotes || '')
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load submission details' })
    }
  }

  const handleReview = async () => {
    if (!viewSubmission || !reviewStatus) return
    setReviewing(true)
    try {
      const res = await fetch(`/api/forms/${viewSubmission.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: reviewStatus, reviewNotes }),
      })
      if (res.ok) {
        toast({ title: 'Review saved' })
        setViewSubmission(null)
        fetchSubmissions()
      } else {
        const err = await res.json()
        toast({ variant: 'destructive', title: err.error || 'Failed to save review' })
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save review' })
    } finally {
      setReviewing(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Form Submissions</CardTitle>
            <CardDescription>Medical history, consent and intake forms</CardDescription>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => setFilling(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Fill in form
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No form submissions for this patient</p>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((s) => {
                const sc = statusConfig[s.status] || statusConfig.SUBMITTED
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    {/* A button, so the row can be reached with Tab and opened
                      with Enter. It was a div, which neither could do. */}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 p-3 border rounded-lg text-left hover:bg-accent/50 focus:bg-accent focus:outline-none transition-colors"
                      onClick={() => handleViewSubmission(s)}
                    >
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium">{s.template.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {new Date(s.createdAt).toLocaleDateString('en-PK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {s.signedAt && ' (Signed)'}
                        </span>
                      </span>
                      <Badge variant={sc.variant} className="flex items-center gap-1">
                        {sc.icon}
                        {sc.label}
                      </Badge>
                    </button>
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={pdfHref(s.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Print ${s.template.name}`}
                        title="Print or save as PDF"
                      >
                        <Printer className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* View/Review Dialog */}
      <Dialog open={!!viewSubmission} onOpenChange={(open) => !open && setViewSubmission(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewSubmission?.template.name}</DialogTitle>
          </DialogHeader>

          {viewSubmission?.template.fields && (
            <div className="border-b pb-4 mb-4">
              <FormRenderer
                fields={viewSubmission.template.fields as FormField[]}
                onSubmit={() => {}}
                initialData={viewSubmission.data}
                initialSignature={viewSubmission.signature}
                readOnly
              />
            </div>
          )}

          {/* Review Section — only for those the PUT accepts it from. */}
          {canWrite ? (
            <div className="space-y-4">
              <h4 className="font-semibold">Review</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={reviewStatus} onValueChange={setReviewStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Set status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SUBMITTED">Pending</SelectItem>
                      <SelectItem value="REVIEWED">Reviewed</SelectItem>
                      <SelectItem value="APPROVED">Approved</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Review Notes</Label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2">
                {viewSubmission && (
                  <Button variant="outline" asChild>
                    <a href={pdfHref(viewSubmission.id)} target="_blank" rel="noopener noreferrer">
                      <Printer className="h-4 w-4 mr-2" />
                      Print / PDF
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewSubmission(null)}>
                  Close
                </Button>
                <Button onClick={handleReview} disabled={reviewing}>
                  {reviewing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Review
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Status: </span>
                {(statusConfig[viewSubmission?.status ?? ''] || statusConfig.SUBMITTED).label}
              </p>
              {viewSubmission?.reviewNotes && (
                <p className="whitespace-pre-wrap">
                  <span className="text-muted-foreground">Review notes: </span>
                  {viewSubmission.reviewNotes}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                {viewSubmission && (
                  <Button variant="outline" asChild>
                    <a href={pdfHref(viewSubmission.id)} target="_blank" rel="noopener noreferrer">
                      <Printer className="h-4 w-4 mr-2" />
                      Print / PDF
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={() => setViewSubmission(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mounted when opened, so each form starts from a fresh list and no answers. */}
      {canWrite && filling && (
        <FillFormDialog
          open={filling}
          onOpenChange={setFilling}
          patientId={patientId}
          onSaved={() => {
            setFilling(false)
            fetchSubmissions()
          }}
        />
      )}
    </>
  )
}

/**
 * Fill in a form for the patient: pick one of the clinic's active templates,
 * answer it with the same renderer that shows a submission back, and save it
 * through POST /api/forms. Submissions used to exist only through the API.
 */
function FillFormDialog({
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
  const [templates, setTemplates] = useState<FillableTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/forms/templates')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => {
        setTemplates([])
        toast({ variant: 'destructive', title: 'Failed to load forms' })
      })
  }, [toast])

  const template = templates?.find((t) => t.id === templateId)

  const submit = async (data: Record<string, unknown>, signature: string | null) => {
    if (!template) return
    setSaving(true)
    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, patientId, data, signature }),
      })
      if (res.ok) {
        toast({ title: `${template.name} saved` })
        onSaved()
      } else {
        const err = await res.json().catch(() => ({}))
        toast({ variant: 'destructive', title: err.error || 'Failed to save the form' })
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to save the form' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fill in form</DialogTitle>
          <DialogDescription>
            Answers are saved to this patient&apos;s record, pending review.
          </DialogDescription>
        </DialogHeader>

        {templates === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            The clinic has no active forms. They are set up under Settings → Forms.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Form</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a form..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {template?.description && (
                <p className="text-xs text-muted-foreground">{template.description}</p>
              )}
            </div>

            {template && (
              // Keyed on the template, so switching forms starts with empty
              // answers rather than carrying the last form's over.
              <FormRenderer
                key={template.id}
                fields={template.fields}
                onSubmit={submit}
                loading={saving}
                submitLabel="Save form"
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

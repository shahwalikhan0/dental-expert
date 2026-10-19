'use client'

import { useState, useEffect, use } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Trash2,
  GripVertical,
  Eye,
  Pencil,
  Save,
  ChevronUp,
  ChevronDown,
  FileQuestion,
  FileText,
  Inbox,
  ListChecks,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { PageHeader } from '@/components/ui/page-header'
import { ProfileHeader } from '@/components/ui/profile-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { FormActions } from '@/components/ui/form-section'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { BackLink, useTrail } from '@/components/ui/trail'
import { SubmitButton } from '@/components/ui/submit-button'
import { FormField as Field } from '@/components/ui/form-field'
import { IconTooltip } from '@/components/ui/icon-action'
import { toastError, toastInfo, toastSuccess } from '@/lib/toast-utils'
import { FormRenderer, type FormField } from '@/components/forms/form-renderer'

const FIELD_TYPES = [
  { value: 'text', label: 'Text input' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'signature', label: 'Signature' },
  { value: 'heading', label: 'Section heading' },
  { value: 'paragraph', label: 'Paragraph text' },
] as const

const FORM_TYPES = [
  { value: 'MEDICAL_HISTORY', label: 'Medical history' },
  { value: 'CONSENT', label: 'Consent form' },
  { value: 'INTAKE', label: 'Intake form' },
  { value: 'FEEDBACK', label: 'Feedback' },
  { value: 'CUSTOM', label: 'Custom' },
]

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export default function EditFormTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { toast } = useToast()
  const { id } = use(params)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string>()
  const [description, setDescription] = useState('')
  const [type, setType] = useState('CUSTOM')
  const [isActive, setIsActive] = useState(true)
  const [fields, setFields] = useState<FormField[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // What the first load came to, when it did not come to the template.
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'missing'>('ok')
  // This page's crumb is the template's name, once it is known.
  const trail = useTrail(loading ? null : name || null)
  // Edits to the template are work the guard asks about before leaving. The
  // ref sits on the wrapper drawn in every state, so it is there from the
  // first render, skeleton included.
  const formRef = useFormGuard(saving)
  const [showPreview, setShowPreview] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [submissionCount, setSubmissionCount] = useState(0)

  const fetchTemplate = async () => {
    try {
      const res = await fetch(`/api/settings/forms/${id}`)
      // A template that is not there is said as such, with a way back; any
      // other failure is a load that can be retried.
      if (res.status === 404) {
        setLoadState('missing')
        return
      }
      if (!res.ok) throw new Error('Failed to load template')
      const data = await res.json()
      if (data.template) {
        setLoadState('ok')
        setName(data.template.name)
        setDescription(data.template.description || '')
        setType(data.template.type)
        setIsActive(data.template.isActive)
        setFields(data.template.fields as FormField[])
        setSubmissionCount(data.template._count?.submissions || 0)
      } else {
        setLoadState('missing')
      }
    } catch {
      setLoadState('failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplate()
    // Once per template; `fetchTemplate` reads the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const addField = (fieldType: string) => {
    const newField: FormField = {
      id: generateId(),
      type: fieldType as FormField['type'],
      label:
        fieldType === 'heading'
          ? 'Section title'
          : fieldType === 'paragraph'
            ? 'Enter informational text here'
            : '',
      required: false,
      options: ['select', 'radio', 'checkbox'].includes(fieldType)
        ? ['Option 1', 'Option 2']
        : undefined,
    }
    setFields((prev) => [...prev, newField])
    setEditingField(newField.id)
  }

  const updateField = (fieldId: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)))
  }

  const removeField = (fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId))
    if (editingField === fieldId) setEditingField(null)
  }

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fields.length) return
    const newFields = [...fields]
    ;[newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]]
    setFields(newFields)
  }

  const addOption = (fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId)
    if (!field) return
    const opts = [...(field.options || []), `Option ${(field.options?.length || 0) + 1}`]
    updateField(fieldId, { options: opts })
  }

  const updateOption = (fieldId: string, optIndex: number, value: string) => {
    const field = fields.find((f) => f.id === fieldId)
    if (!field) return
    const opts = [...(field.options || [])]
    opts[optIndex] = value
    updateField(fieldId, { options: opts })
  }

  const removeOption = (fieldId: string, optIndex: number) => {
    const field = fields.find((f) => f.id === fieldId)
    if (!field || (field.options?.length || 0) <= 1) return
    const opts = (field.options || []).filter((_, i) => i !== optIndex)
    updateField(fieldId, { options: opts })
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError('Enter a name for the template.')
      toast(toastError('save the template', 'Check the highlighted fields.'))
      return
    }
    if (fields.length === 0) {
      toast(toastError('save the template', 'Add at least one field.'))
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/settings/forms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, type, fields, isActive }),
      })
      const data = await res.json()
      if (res.ok) {
        toast(toastSuccess('Template updated'))
        // Saved, and the page stays open: nothing left to lose.
        formRef.reset()
      } else {
        toast(toastError('save the template', data))
      }
    } catch (error) {
      toast(toastError('save the template', error))
    } finally {
      setSaving(false)
    }
  }

  const back = <BackLink trail={trail} fallback="/settings/forms" fallbackLabel="Form templates" />

  const preview = (
    <div className="space-y-6">
      <PageHeader
        title={<>Preview: {name}</>}
        description="This is how the form will appear to patients"
        actions={
          <Button variant="outline" onClick={() => setShowPreview(false)}>
            Back to editor
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>{name}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <FormRenderer
            fields={fields}
            onSubmit={() => toast(toastInfo('Preview mode — form not submitted'))}
            submitLabel="Submit (preview)"
          />
        </CardContent>
      </Card>
    </div>
  )

  const editor = (
    <div className="space-y-6">
      {/* The breadcrumb says where this came from on a desktop; on a phone
          the way back stays, as the bigger thing to tap. */}
      <div className="md:hidden">{back}</div>
      <ProfileHeader
        eyebrow={FORM_TYPES.find((t) => t.value === type)?.label ?? 'Form template'}
        name={name || 'Untitled template'}
        avatarIcon={FileText}
        badges={<StatusBadge kind="active" status={isActive} />}
        facts={[
          {
            icon: Inbox,
            label: `${submissionCount} submission${submissionCount !== 1 ? 's' : ''}`,
          },
          {
            icon: ListChecks,
            label: `${fields.length} field${fields.length !== 1 ? 's' : ''}`,
          },
        ]}
        actions={
          <Button
            variant="outline"
            onClick={() => setShowPreview(true)}
            disabled={fields.length === 0}
          >
            <Eye className="h-4 w-4" />
            Preview
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Form details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Template name" required error={nameError}>
                  {(control) => (
                    <Input
                      {...control}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value)
                        setNameError(undefined)
                      }}
                    />
                  )}
                </Field>
                <div className="space-y-2">
                  <Label htmlFor="form-type">Form type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="form-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORM_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              {/* Whether patients and the desk are offered this template. */}
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <div className="min-w-0">
                  <Label htmlFor="template-active">Active</Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isActive
                      ? 'Offered for new submissions.'
                      : 'Not offered for new submissions; the ones it already has are kept.'}
                  </p>
                </div>
                <Switch id="template-active" checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Form fields</CardTitle>
              <CardDescription>
                {fields.length} field{fields.length !== 1 ? 's' : ''}, in the order patients see
                them
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {fields.length === 0 && (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  No fields yet. Add fields from the panel on the right.
                </p>
              )}

              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className={`rounded-xl border px-4 py-3 transition-shadow ${editingField === field.id ? 'border-primary/40 ring-2 ring-primary' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Badge variant="outline" className="text-xs shrink-0">
                      {FIELD_TYPES.find((t) => t.value === field.type)?.label || field.type}
                    </Badge>
                    <span className="font-medium text-sm truncate flex-1">
                      {field.label || '(no label)'}
                    </span>
                    {field.required && (
                      <Badge variant="destructive" className="text-xs">
                        Required
                      </Badge>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <IconTooltip label="Move field up">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move field up"
                          className="h-7 w-7"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Move field down">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move field down"
                          className="h-7 w-7"
                          onClick={() => moveField(index, 1)}
                          disabled={index === fields.length - 1}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip
                        label={editingField === field.id ? 'Close field settings' : 'Edit field'}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={
                            editingField === field.id ? 'Close field settings' : 'Edit field'
                          }
                          className="h-7 w-7"
                          onClick={() =>
                            setEditingField(editingField === field.id ? null : field.id)
                          }
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Remove field">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove field"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeField(field.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </IconTooltip>
                    </div>
                  </div>

                  {editingField === field.id && (
                    <div className="mt-3 space-y-4 rounded-xl bg-muted/60 p-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Label</Label>
                          <Input
                            value={field.label}
                            onChange={(e) => updateField(field.id, { label: e.target.value })}
                          />
                        </div>
                        {!['heading', 'paragraph', 'signature', 'checkbox'].includes(
                          field.type
                        ) && (
                          <div className="space-y-1">
                            <Label className="text-xs">Placeholder</Label>
                            <Input
                              value={field.placeholder || ''}
                              onChange={(e) =>
                                updateField(field.id, { placeholder: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>

                      {field.options && (
                        <div className="space-y-2">
                          <Label className="text-xs">Options</Label>
                          {field.options.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <Input
                                value={opt}
                                onChange={(e) => updateOption(field.id, oi, e.target.value)}
                                className="flex-1"
                              />
                              <IconTooltip label="Remove option">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Remove option"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => removeOption(field.id, oi)}
                                  disabled={(field.options?.length || 0) <= 1}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </IconTooltip>
                            </div>
                          ))}
                          <Button variant="outline" size="sm" onClick={() => addOption(field.id)}>
                            <Plus className="h-3 w-3" /> Add option
                          </Button>
                        </div>
                      )}

                      {!['heading', 'paragraph'].includes(field.type) && (
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`required-${field.id}`}
                            checked={field.required || false}
                            onCheckedChange={(checked) =>
                              updateField(field.id, { required: checked })
                            }
                          />
                          <Label htmlFor={`required-${field.id}`} className="text-xs">
                            Required
                          </Label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader className="pb-4">
              <CardTitle>Add field</CardTitle>
              <CardDescription>Added to the end of the form</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">
                {FIELD_TYPES.map((ft) => (
                  <Button
                    key={ft.value}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => addField(ft.value)}
                  >
                    <Plus className="h-4 w-4" />
                    {ft.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <FormActions>
        <SubmitButton type="button" onClick={handleSave} busy={saving} icon={Save}>
          Save changes
        </SubmitButton>
      </FormActions>
    </div>
  )

  return (
    <div ref={formRef}>
      {loading ? (
        <PageSkeleton variant="form" />
      ) : loadState === 'missing' ? (
        <EmptyState
          icon={FileQuestion}
          title="Template not found"
          description="It may have been deleted, or the link is wrong."
          actionLabel="Back to form templates"
          actionHref="/settings/forms"
        />
      ) : loadState === 'failed' ? (
        <LoadFailed
          what="this template"
          onRetry={() => {
            setLoading(true)
            fetchTemplate()
          }}
        />
      ) : showPreview ? (
        preview
      ) : (
        editor
      )}
    </div>
  )
}

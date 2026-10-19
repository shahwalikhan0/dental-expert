'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useRouter } from 'next/navigation'
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
import { Plus, Trash2, GripVertical, Eye, Pencil, Save, ChevronUp, ChevronDown } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/ui/page-header'
import { FormActions } from '@/components/ui/form-section'
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

export default function NewFormTemplatePage() {
  const { toast } = useToast()
  const router = useRouter()
  const trail = useTrail('New form template')
  const [saving, setSaving] = useState(false)
  // Warn before a half-filled form is thrown away by a stray click — but not
  // during the navigation a successful save makes.
  const formRef = useFormGuard(saving)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string>()
  const [description, setDescription] = useState('')
  const [type, setType] = useState('CUSTOM')
  const [fields, setFields] = useState<FormField[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)

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

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
    if (editingField === id) setEditingField(null)
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
      toast(toastError('create the template', 'Check the highlighted fields.'))
      return
    }
    if (fields.length === 0) {
      toast(toastError('create the template', 'Add at least one field.'))
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, type, fields }),
      })
      const data = await res.json()
      if (res.ok) {
        toast(toastSuccess('Form template created'))
        router.push('/settings/forms')
      } else {
        toast(toastError('create the template', data))
      }
    } catch (error) {
      toast(toastError('create the template', error))
    } finally {
      setSaving(false)
    }
  }

  if (showPreview) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<>Preview: {name || 'Untitled'}</>}
          description="This is how the form will appear to patients"
          actions={
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Back to editor
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>{name || 'Untitled form'}</CardTitle>
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
  }

  return (
    <div ref={formRef} className="space-y-6">
      <PageHeader
        back={<BackLink trail={trail} fallback="/settings/forms" fallbackLabel="Form templates" />}
        title="New form template"
        description="Design a custom form for patients"
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
        {/* Left: Form Settings + Fields */}
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
                      placeholder="e.g. General Consent Form"
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
                  placeholder="Brief description of this form…"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Field List */}
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
                            placeholder="Field label"
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
                              placeholder="Placeholder text"
                            />
                          </div>
                        )}
                      </div>

                      {field.description !== undefined ||
                      ['heading', 'paragraph', 'checkbox', 'signature'].includes(
                        field.type
                      ) ? null : (
                        <div className="space-y-1">
                          <Label className="text-xs">Help text</Label>
                          <Input
                            value={field.description || ''}
                            onChange={(e) => updateField(field.id, { description: e.target.value })}
                            placeholder="Optional help text"
                          />
                        </div>
                      )}

                      {/* Options for select/radio/checkbox */}
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

        {/* Right: Add Field Panel */}
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
        <SubmitButton
          type="button"
          onClick={handleSave}
          busy={saving}
          busyLabel="Creating…"
          icon={Save}
        >
          Create template
        </SubmitButton>
      </FormActions>
    </div>
  )
}

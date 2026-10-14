'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadFailed } from '@/components/ui/load-failed'
import { Skeleton } from '@/components/ui/skeleton'
import { SubmitButton } from '@/components/ui/submit-button'
import { IconTooltip } from '@/components/ui/icon-action'
import { useToast } from '@/hooks/use-toast'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import { useCan } from '@/hooks/use-can'
import { humanise } from '@/lib/labels'
import { TEMPLATE_VARIABLES } from '@/lib/template-variables'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'

/**
 * The clinic's message templates: the wording automated reminders are sent in.
 *
 * This tab used to say "Template list will be displayed here" and send people
 * to Settings → Communications, which has no templates on it. The API could
 * create and edit them; nothing on screen could. It is a list and an editor
 * now, and what the server refuses — a name already in use, a placeholder no
 * message fills in (bug report 12 Oct, finding 62) — comes back as a toast in
 * the server's own words.
 */

interface Template {
  id: string
  name: string
  category: string
  channel: string
  subject: string | null
  content: string
  isActive: boolean
  isDefault: boolean
}

const CATEGORIES = [
  'APPOINTMENT',
  'PAYMENT',
  'BIRTHDAY',
  'FOLLOW_UP',
  'LAB_WORK',
  'PRESCRIPTION',
  'PROMOTIONAL',
  'GENERAL',
] as const

/** The channels a message is actually sent on. */
const CHANNELS = ['SMS', 'EMAIL'] as const

interface Draft {
  id: string | null
  name: string
  category: string
  channel: string
  subject: string
  content: string
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  category: 'APPOINTMENT',
  channel: 'SMS',
  subject: '',
  content: '',
}

/** The server's reason, or a fallback when it gave none. */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return body?.error || fallback
}

export function TemplatesTab() {
  const { toast } = useToast()
  const canWrite = useCan('communications:write')
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/communications/templates')
      if (!res.ok) throw new Error(await errorOf(res, 'Templates could not be loaded'))
      const body = await res.json()
      setTemplates(body.data ?? [])
    } catch (error) {
      console.error('Error fetching templates:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Put `{{key}}` at the cursor, so nobody has to type a placeholder by hand. */
  const insertVariable = (key: string) => {
    if (!draft) return
    const token = `{{${key}}}`
    const el = contentRef.current
    const start = el?.selectionStart ?? draft.content.length
    const end = el?.selectionEnd ?? draft.content.length
    const content = draft.content.slice(0, start) + token + draft.content.slice(end)
    setDraft({ ...draft, content })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const isEmail = draft.channel === 'EMAIL'
      const res = draft.id
        ? await fetch(`/api/communications/templates/${draft.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            // Channel and category are fixed once a template exists: the
            // automated messages find their template by that pair.
            body: JSON.stringify({
              name: draft.name,
              content: draft.content,
              ...(isEmail ? { subject: draft.subject } : {}),
            }),
          })
        : await fetch('/api/communications/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: draft.name,
              category: draft.category,
              channel: draft.channel,
              content: draft.content,
              ...(isEmail && draft.subject ? { subject: draft.subject } : {}),
            }),
          })

      if (!res.ok) throw new Error(await errorOf(res, 'The template could not be saved'))

      toast(toastSuccess(draft.id ? 'Template saved' : 'Template created', draft.name.trim()))
      setDraft(null)
      load()
    } catch (error) {
      toast(toastError(`save template “${draft.name.trim()}”`, error))
    } finally {
      setSaving(false)
    }
  }

  const setActive = async (template: Template, isActive: boolean) => {
    try {
      const res = await fetch(`/api/communications/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error(await errorOf(res, 'The template could not be updated'))
      setTemplates((list) => list.map((t) => (t.id === template.id ? { ...t, isActive } : t)))
    } catch (error) {
      toast(toastError(`${isActive ? 'turn on' : 'turn off'} template “${template.name}”`, error))
    }
  }

  const remove = async (template: Template) => {
    const ok = await confirm({
      title: `Delete template “${template.name}”?`,
      description: template.isDefault
        ? 'This is the template automated messages of this kind are sent with. Without it they are not sent.'
        : 'The template will be deleted. Messages already sent with it are kept.',
      confirmLabel: 'Delete template',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/communications/templates/${template.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await errorOf(res, 'The template could not be deleted'))
      setTemplates((list) => list.filter((t) => t.id !== template.id))
      toast(toastSuccess('Template deleted', template.name))
    } catch (error) {
      toast(toastError(`delete template “${template.name}”`, error))
    }
  }

  return (
    <Card>
      {ConfirmDialogComponent}
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Communication templates</CardTitle>
          <CardDescription>
            The wording automated reminders and messages are sent in
          </CardDescription>
        </div>
        {canWrite && (
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : failed ? (
          <LoadFailed what="the templates" onRetry={load} />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Templates are the wording automated reminders and messages are sent in."
            actionLabel={canWrite ? 'New template' : undefined}
            onAction={canWrite ? () => setDraft({ ...EMPTY_DRAFT }) : undefined}
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{template.name}</span>
                    <Badge variant="outline">
                      {template.channel === 'EMAIL' ? 'Email' : 'SMS'}
                    </Badge>
                    <Badge variant="secondary">{humanise(template.category)}</Badge>
                    {template.isDefault && <Badge>Default</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground break-words">
                    {template.content.replace(/<[^>]+>/g, ' ')}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={template.isActive}
                      onCheckedChange={(checked) => setActive(template, checked)}
                      aria-label={`${template.name} active`}
                    />
                    <IconTooltip label="Edit template">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${template.name}`}
                        onClick={() =>
                          setDraft({
                            id: template.id,
                            name: template.name,
                            category: template.category,
                            channel: template.channel,
                            subject: template.subject ?? '',
                            content: template.content,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </IconTooltip>
                    <IconTooltip label="Delete template">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${template.name}`}
                        onClick={() => remove(template)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </IconTooltip>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && !saving && setDraft(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>
              Placeholders are filled in for each patient when the message is sent.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template-name" className="label-required">
                  Name
                </Label>
                <Input
                  id="template-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Post-op care (SMS)"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="template-channel">Channel</Label>
                  <Select
                    value={draft.channel}
                    onValueChange={(channel) => setDraft({ ...draft, channel })}
                    disabled={draft.id !== null}
                  >
                    <SelectTrigger id="template-channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((channel) => (
                        <SelectItem key={channel} value={channel}>
                          {channel === 'EMAIL' ? 'Email' : 'SMS'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-category">Category</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(category) => setDraft({ ...draft, category })}
                    disabled={draft.id !== null}
                  >
                    <SelectTrigger id="template-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {humanise(category)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {draft.channel === 'EMAIL' && (
                <div className="space-y-2">
                  <Label htmlFor="template-subject">Subject</Label>
                  <Input
                    id="template-subject"
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="template-content" className="label-required">
                  Message
                </Label>
                <Textarea
                  id="template-content"
                  ref={contentRef}
                  rows={draft.channel === 'EMAIL' ? 10 : 5}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
                {draft.channel === 'SMS' && (
                  <p className="text-xs text-muted-foreground">{draft.content.length} characters</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Placeholders</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <Button
                      key={variable.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 font-mono text-xs"
                      title={`${variable.label}. ${variable.description} e.g. ${variable.example}`}
                      onClick={() => insertVariable(variable.key)}
                    >
                      {`{{${variable.key}}}`}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <SubmitButton
              type="button"
              onClick={save}
              busy={saving}
              disabled={!draft?.name.trim() || !draft?.content.trim()}
            >
              {draft?.id ? 'Save changes' : 'Create template'}
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

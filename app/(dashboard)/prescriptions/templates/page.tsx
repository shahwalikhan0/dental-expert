'use client'

/**
 * The prescriptions this clinic writes over and over.
 *
 * Retiring rather than deleting is the whole point of this screen: a
 * prescription issued last March still points at the template it came from,
 * and an audit of what was prescribed needs that pointer to resolve to a name.
 * So a retired template stays visible here, greyed, with a way back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Search, Pencil, Archive, RotateCcw, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { IconTooltip } from '@/components/ui/icon-action'

interface Template {
  id: string
  name: string
  description: string | null
  category: string | null
  diagnosis: string | null
  isActive: boolean
  items: Array<{ id: string; medicationName: string; dosage: string; frequency: string }>
  _count?: { prescriptions: number }
}

export default function PrescriptionTemplatesPage() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)

  // Discards an answer that is no longer the one we asked for, so a slow
  // response to an old search cannot overwrite a fast one to the current.
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    try {
      const params = new URLSearchParams({ includeInactive: 'true' })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/prescription-templates?${params}`)
      const data = await res.json()
      if (requestId !== latestRequest.current) return
      if (!res.ok) throw new Error(data.error || 'Failed to load templates')
      setTemplates(Array.isArray(data.data) ? data.data : [])
    } catch (err: any) {
      if (requestId !== latestRequest.current) return
      toast({ variant: 'destructive', title: 'Error', description: err.message })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [debouncedSearch, toast])

  useEffect(() => {
    load()
  }, [load])

  const setActive = async (template: Template, isActive: boolean) => {
    if (!isActive) {
      const proceed = await confirm({
        title: `Retire “${template.name}”?`,
        description:
          'It disappears from the prescribing screen. Prescriptions already issued from it are unchanged and still name it.',
        confirmLabel: 'Retire template',
      })
      if (!proceed) return
    }

    try {
      const res = await fetch(`/api/prescription-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast({ title: isActive ? 'Template restored' : 'Template retired' })
      load()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Prescription templates</h1>
          <p className="text-muted-foreground">
            Shared with everyone at this clinic. Using one copies its medicines onto the
            prescription.
          </p>
        </div>
        <div className="page-actions">
          <Button asChild>
            <Link href="/prescriptions/templates/new">
              <Plus className="mr-2 h-4 w-4" />
              New template
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, category or medicine"
              className="pl-9"
              aria-label="Search templates"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-center justify-center gap-2 py-16">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading templates…
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="text-muted-foreground/50 mx-auto h-10 w-10" />
            <p className="mt-4 font-medium">
              {debouncedSearch ? 'No templates match that' : 'No templates yet'}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {debouncedSearch
                ? 'Try a medicine name, or the category you filed it under.'
                : 'Save the prescription you write most often and it will be one click from now on.'}
            </p>
            {!debouncedSearch && (
              <Button asChild className="mt-4">
                <Link href="/prescriptions/templates/new">Create the first one</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className={template.isActive ? undefined : 'opacity-70'}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {template.name}
                      {template.category && <Badge variant="secondary">{template.category}</Badge>}
                      {!template.isActive && <Badge variant="outline">Retired</Badge>}
                    </CardTitle>
                    {template.description && (
                      <CardDescription>{template.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconTooltip label="Edit this template">
                      <Button variant="ghost" size="icon" aria-label="Edit this template" asChild>
                        <Link href={`/prescriptions/templates/${template.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                    </IconTooltip>
                    {template.isActive ? (
                      <IconTooltip label="Retire this template">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Retire this template"
                          onClick={() => setActive(template, false)}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                    ) : (
                      <IconTooltip label="Put this template back">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Put this template back"
                          onClick={() => setActive(template, true)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {template.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{item.medicationName}</span>
                      <span className="text-muted-foreground text-xs">
                        {[item.dosage, item.frequency].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {ConfirmDialogComponent}
    </div>
  )
}

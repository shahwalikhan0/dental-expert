'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2 } from 'lucide-react'

/**
 * Recare types — the kinds of recurring visit a practice runs, and how often
 * each comes round.
 *
 * Configuration rather than constants because the interval is clinical policy:
 * six months for a routine scale and polish is a convention, three months for a
 * patient under periodontal care is a decision, and neither is ours to make.
 */

interface RecareType {
  id: string
  name: string
  intervalMonths: number
  description: string | null
  isActive: boolean
  isDefault: boolean
  sortOrder: number
  _count: { recares: number }
}

export default function RecareTypesPage() {
  const trail = useTrail('Recare types')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [types, setTypes] = useState<RecareType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ name: '', intervalMonths: '6', description: '' })

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/recare/types?includeInactive=true')
      if (!res.ok) throw new Error('Recare types could not be loaded')
      const data = await res.json()
      setTypes(data.types ?? [])
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load recare types',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/recare/types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          intervalMonths: Number(draft.intervalMonths),
          description: draft.description || null,
          sortOrder: types.length,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That recare type could not be added')

      toast({ title: 'Added', description: `${draft.name} every ${draft.intervalMonths} months.` })
      setDraft({ name: '', intervalMonths: '6', description: '' })
      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'That recare type could not be added',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const patch = async (type: RecareType, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/recare/types/${type.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That change could not be saved')
      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'That change could not be saved',
        variant: 'destructive',
      })
    }
  }

  const remove = async (type: RecareType) => {
    const inUse = type._count.recares > 0
    const ok = await confirm({
      title: `${inUse ? 'Deactivate' : 'Delete'} ${type.name}?`,
      description: inUse
        ? `${type._count.recares} patient${type._count.recares === 1 ? ' is' : 's are'} on this recare, so it will be deactivated rather than deleted. Their dates are kept.`
        : 'Nobody is on this recare, so it will be deleted.',
      confirmLabel: inUse ? 'Deactivate' : 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/recare/types/${type.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That recare type could not be removed')
      toast({ title: 'Done', description: data.message })
      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'That recare type could not be removed',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {ConfirmDialogComponent}
      <BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />

      <div>
        <h1 className="text-2xl font-bold">Recare types</h1>
        <p className="text-muted-foreground">
          What a patient is recalled for, and how often. The default is what a newly registered
          patient is put on.
        </p>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Every</TableHead>
                <TableHead>Patients</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : types.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No recare types. Add one below and patients will start appearing on the recall
                    list.
                  </TableCell>
                </TableRow>
              ) : (
                types.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell>
                      <div className="font-medium">{type.name}</div>
                      {type.description && (
                        <div className="text-xs text-muted-foreground">{type.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="120"
                          defaultValue={type.intervalMonths}
                          onBlur={(e) => {
                            const months = Number(e.target.value)
                            if (months !== type.intervalMonths) {
                              patch(type, { intervalMonths: months })
                            }
                          }}
                          className="h-8 w-20"
                          aria-label={`Interval in months for ${type.name}`}
                        />
                        <span className="text-sm text-muted-foreground">months</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{type._count.recares}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={type.isDefault}
                        onCheckedChange={(checked) => patch(type, { isDefault: checked })}
                        aria-label={`Make ${type.name} the default`}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={type.isActive}
                        onCheckedChange={(checked) => patch(type, { isActive: checked })}
                        aria-label={`${type.name} is active`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        onClick={() => remove(type)}
                        aria-label={`Remove ${type.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <form onSubmit={add}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a recare type</CardTitle>
            <CardDescription>
              The interval is measured from the visit, not from when it fell due.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Scale and polish"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interval">Every (months) *</Label>
                <Input
                  id="interval"
                  type="number"
                  min="1"
                  max="120"
                  value={draft.intervalMonths}
                  onChange={(e) => setDraft({ ...draft, intervalMonths: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !draft.name.trim()}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

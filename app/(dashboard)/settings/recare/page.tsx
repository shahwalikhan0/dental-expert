'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Card, CardContent } from '@/components/ui/card'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GridActionsCell, GridActionsHead, GridBody } from '@/components/ui/data-grid'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import {
  RecareProcedurePicker,
  type PickerProcedure,
} from '@/components/settings/recare-procedure-picker'
import { CalendarClock, ListChecks, Plus, Trash2 } from 'lucide-react'

/**
 * Recare types — the kinds of recurring visit a practice runs, and how often
 * each comes round.
 *
 * Configuration rather than constants because the interval is clinical policy:
 * six months for a routine scale and polish is a convention, three months for a
 * patient under periodontal care is a decision, and neither is ours to make.
 *
 * Each type also says which procedures are its visit: completing a treatment
 * with one of them moves the patient's recall on (bug report 12 Oct, finding
 * 46). Before, that link was guessed from names, and a clinic whose names did
 * not fit lost the automation without being told.
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
  procedures: PickerProcedure[]
}

/** How many linked procedures to name in the table before "and n more". */
const SHOWN_PROCEDURES = 3

/** Who the picker is open for: an existing type, or the add form's draft. */
type Picking = { kind: 'type'; type: RecareType } | { kind: 'draft' } | null

type DraftErrors = Partial<Record<'name' | 'intervalMonths', string>>

export default function RecareTypesPage() {
  const trail = useTrail('Recare types')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [types, setTypes] = useState<RecareType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ name: '', intervalMonths: '6', description: '' })
  const [draftProcedures, setDraftProcedures] = useState<PickerProcedure[]>([])
  const [catalogue, setCatalogue] = useState<PickerProcedure[]>([])
  const [picking, setPicking] = useState<Picking>(null)
  const [savingLinks, setSavingLinks] = useState(false)
  // The list could not be fetched — said in the grid, with a retry.
  const [failed, setFailed] = useState(false)
  const [errors, setErrors] = useState<DraftErrors>({})
  // Typing into the new-type form is work the guard asks about before leaving.
  const formGuard = useFormGuard(saving)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/recare/types?includeInactive=true')
      if (!res.ok) throw new Error('Recare types could not be loaded')
      const data = await res.json()
      setTypes(data.types ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // The clinic's active procedures, for the picker. A failure here leaves the
  // picker empty with a note rather than blocking the rest of the screen.
  const loadCatalogue = useCallback(async () => {
    try {
      const res = await fetch('/api/procedures?all=true&isActive=true')
      if (!res.ok) throw new Error('The procedure catalogue could not be loaded')
      const data = await res.json()
      setCatalogue(
        (data.procedures ?? []).map((procedure: PickerProcedure) => ({
          id: procedure.id,
          name: procedure.name,
          code: procedure.code,
          category: procedure.category,
          isActive: procedure.isActive,
        }))
      )
    } catch (err) {
      toast(toastError('load the procedure catalogue', err))
    }
  }, [toast])

  useEffect(() => {
    load()
    loadCatalogue()
  }, [load, loadCatalogue])

  const add = async (event: React.FormEvent) => {
    event.preventDefault()

    const months = Number(draft.intervalMonths)
    const found: DraftErrors = {}
    if (!draft.name.trim()) found.name = 'Enter a name.'
    if (
      draft.intervalMonths.trim() === '' ||
      !Number.isInteger(months) ||
      months < 1 ||
      months > 120
    )
      found.intervalMonths = 'Enter a whole number of months, 1 to 120.'
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast(toastError('create the recare type', 'Check the highlighted fields.'))
      return
    }

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
          procedureIds: draftProcedures.map((procedure) => procedure.id),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That recare type could not be added')

      toast(
        toastSuccess('Recare type added', `${draft.name} every ${draft.intervalMonths} months.`)
      )
      setDraft({ name: '', intervalMonths: '6', description: '' })
      setDraftProcedures([])
      // The draft is saved and the form is empty again: nothing left to lose.
      formGuard.reset()
      await load()
    } catch (err) {
      toast(toastError('create the recare type', err))
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
      toast(toastError(`save the change to ${type.name}`, err))
    }
  }

  const saveLinks = async (procedureIds: string[]) => {
    if (!picking) return
    if (picking.kind === 'draft') {
      const byId = new Map(catalogue.map((procedure) => [procedure.id, procedure]))
      setDraftProcedures(
        procedureIds.map((id) => byId.get(id)).filter((p): p is PickerProcedure => Boolean(p))
      )
      setPicking(null)
      return
    }

    const type = picking.type
    setSavingLinks(true)
    try {
      const res = await fetch(`/api/recare/types/${type.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedureIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The procedures could not be saved')
      toast(
        toastSuccess(
          'Procedures saved',
          procedureIds.length === 0
            ? `No procedure moves ${type.name} now. Mark as done still does.`
            : `${procedureIds.length} procedure${procedureIds.length === 1 ? '' : 's'} now move${procedureIds.length === 1 ? 's' : ''} ${type.name} on.`
        )
      )
      setPicking(null)
      await load()
    } catch (err) {
      toast(toastError(`save the procedures for ${type.name}`, err))
    } finally {
      setSavingLinks(false)
    }
  }

  const remove = async (type: RecareType) => {
    const inUse = type._count.recares > 0
    const verb = inUse ? 'Deactivate' : 'Delete'
    const ok = await confirm({
      title: `${verb} recare type “${type.name}”?`,
      description: inUse
        ? `${type._count.recares} patient${type._count.recares === 1 ? ' is' : 's are'} on this recare, so it will be deactivated rather than deleted. Their dates are kept.`
        : 'Nobody is on this recare, so it will be deleted.',
      confirmLabel: `${verb} recare type`,
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/recare/types/${type.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That recare type could not be removed')
      toast(toastSuccess(inUse ? 'Recare type deactivated' : 'Recare type deleted', data.message))
      await load()
    } catch (err) {
      toast(toastError(`${verb.toLowerCase()} recare type “${type.name}”`, err))
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {ConfirmDialogComponent}
      <RecareProcedurePicker
        open={picking !== null}
        onOpenChange={(open) => !open && !savingLinks && setPicking(null)}
        recallName={
          picking?.kind === 'type' ? picking.type.name : draft.name.trim() || 'this recall'
        }
        catalogue={catalogue}
        linked={picking?.kind === 'type' ? picking.type.procedures : draftProcedures}
        saving={savingLinks}
        onSave={saveLinks}
      />
      <PageHeader
        back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
        title="Recare types"
        description="What a patient is recalled for, and how often. The default is what a newly registered patient is put on. Completing a treatment with one of a recall’s procedures moves that patient’s recall on by itself."
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Moved on by</TableHead>
                <TableHead>Every</TableHead>
                <TableHead>Patients</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Active</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              skeletonRows={3}
              failed={failed}
              onRetry={() => {
                setFailed(false)
                setLoading(true)
                load()
              }}
              empty={types.length === 0}
              emptyIcon={CalendarClock}
              emptyTitle="No recare types"
              emptyDescription="Add one below and patients will start appearing on the recall list."
            >
              {types.map((type) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <div className="font-medium">{type.name}</div>
                    {type.description && (
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        {type.procedures.length === 0 ? (
                          <span className="text-xs text-amber-700 dark:text-amber-400">
                            No procedure — only Mark as done moves it
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {type.procedures.slice(0, SHOWN_PROCEDURES).map((procedure) => (
                              <Badge
                                key={procedure.id}
                                variant="outline"
                                className="font-normal"
                                title={procedure.code}
                              >
                                {procedure.name}
                                {!procedure.isActive && ' (inactive)'}
                              </Badge>
                            ))}
                            {type.procedures.length > SHOWN_PROCEDURES && (
                              <span className="text-xs text-muted-foreground self-center">
                                and {type.procedures.length - SHOWN_PROCEDURES} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <IconTooltip label={`Choose the procedures for ${type.name}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => setPicking({ kind: 'type', type })}
                          aria-label={`Choose the procedures for ${type.name}`}
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                    </div>
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
                  {/* GridActionsCell carries the `row-actions` class. */}
                  <GridActionsCell>
                    <IconTooltip label={`Remove ${type.name}`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600 dark:text-red-400"
                        onClick={() => remove(type)}
                        aria-label={`Remove ${type.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </IconTooltip>
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>
        </CardContent>
      </Card>

      <form ref={formGuard} onSubmit={add} noValidate>
        <FormSection
          title="New recare type"
          description="The interval is measured from the visit, not from when it fell due."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
              <FormField label="Name" required error={errors.name}>
                {(control) => (
                  <Input
                    {...control}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Scale and polish"
                  />
                )}
              </FormField>
              <FormField label="Every (months)" required error={errors.intervalMonths}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min="1"
                    max="120"
                    value={draft.intervalMonths}
                    onChange={(e) => setDraft({ ...draft, intervalMonths: e.target.value })}
                  />
                )}
              </FormField>
            </div>
            <FormField label="Description" htmlFor="description">
              <Input
                id="description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Optional"
              />
            </FormField>
            <div className="space-y-2">
              <Label>Moved on by</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setPicking({ kind: 'draft' })}
                >
                  <ListChecks className="h-4 w-4" />
                  Choose procedures
                </Button>
                <p className="text-sm text-muted-foreground sm:pt-2">
                  {draftProcedures.length === 0
                    ? 'None yet — completing a treatment will not move this recall until you choose some.'
                    : draftProcedures.map((procedure) => procedure.name).join(', ')}
                </p>
              </div>
            </div>
            {/* Adds one row to the table above, so the button sits with
                these fields rather than in a sticky bar for the page. */}
            <div className="flex justify-end border-t pt-4">
              <SubmitButton busy={saving} busyLabel="Creating…" icon={Plus}>
                Create recare type
              </SubmitButton>
            </div>
          </div>
        </FormSection>
      </form>
    </div>
  )
}

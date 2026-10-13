'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { procedureCategoryConfig } from '@/lib/treatment-utils'
import { Loader2, Search } from 'lucide-react'

/**
 * Choose the procedures that count as the visit for a recall type — the ones
 * whose completion moves the patient's recall on, as Mark as done would (bug
 * report 12 Oct, finding 46).
 *
 * Offers the clinic's active procedures, grouped by category. A procedure
 * that was linked and has since been deactivated is still listed, ticked, so
 * it can be taken off; it cannot be newly ticked (the API refuses it too).
 */

export interface PickerProcedure {
  id: string
  name: string
  code: string
  category: string
  isActive: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recallName: string
  /** The clinic's active procedures. */
  catalogue: PickerProcedure[]
  /** Linked now — may include inactive ones the catalogue no longer offers. */
  linked: PickerProcedure[]
  saving?: boolean
  onSave: (procedureIds: string[]) => void
}

export function RecareProcedurePicker(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-4">
        {/* Mounted only while open, so each opening starts from what is
            linked now rather than from the last, unsaved, set of ticks. */}
        {props.open && <PickerBody {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({ onOpenChange, recallName, catalogue, linked, saving, onSave }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(linked.map((procedure) => procedure.id))
  )
  const [search, setSearch] = useState('')
  const wasLinked = useMemo(() => new Set(linked.map((procedure) => procedure.id)), [linked])

  // The catalogue, plus anything linked that it no longer offers.
  const groups = useMemo(() => {
    const byId = new Map(catalogue.map((procedure) => [procedure.id, procedure]))
    for (const procedure of linked) if (!byId.has(procedure.id)) byId.set(procedure.id, procedure)

    const term = search.trim().toLowerCase()
    const shown = Array.from(byId.values()).filter(
      (procedure) =>
        !term ||
        procedure.name.toLowerCase().includes(term) ||
        procedure.code.toLowerCase().includes(term)
    )

    const grouped = new Map<string, PickerProcedure[]>()
    for (const procedure of shown) {
      const list = grouped.get(procedure.category) ?? []
      list.push(procedure)
      grouped.set(procedure.category, list)
    }
    return Array.from(grouped.entries())
      .map(([category, procedures]) => ({
        category,
        label: procedureCategoryConfig[category]?.label ?? category,
        procedures: procedures.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [catalogue, linked, search])

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Procedures for {recallName}</DialogTitle>
        <DialogDescription>
          Completing a treatment with any of these moves the patient&apos;s {recallName} recall on,
          as Mark as done would. A procedure that is not ticked leaves it where it is.
        </DialogDescription>
      </DialogHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search procedures"
          className="pl-9"
          aria-label="Search procedures"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto -mx-2 px-2 space-y-4">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {catalogue.length === 0 && linked.length === 0
              ? 'There are no active procedures in the catalogue yet. Add them under Settings → Procedures.'
              : 'No procedure matches that search.'}
          </p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.category} className="space-y-1">
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </legend>
              {group.procedures.map((procedure) => {
                const checked = selected.has(procedure.id)
                const inputId = `recare-procedure-${procedure.id}`
                return (
                  <div
                    key={procedure.id}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={inputId}
                      checked={checked}
                      // An inactive procedure can be taken off, not put on.
                      disabled={!procedure.isActive && !wasLinked.has(procedure.id)}
                      onCheckedChange={(value) => toggle(procedure.id, value === true)}
                      className="mt-0.5"
                    />
                    <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer text-sm">
                      <span className="break-words">{procedure.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{procedure.code}</span>
                      {!procedure.isActive && (
                        <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                          inactive
                        </span>
                      )}
                    </label>
                  </div>
                )
              })}
            </fieldset>
          ))
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => onSave(Array.from(selected))} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </DialogFooter>
    </>
  )
}

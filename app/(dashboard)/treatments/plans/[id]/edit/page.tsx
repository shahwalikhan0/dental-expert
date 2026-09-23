'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from 'lucide-react'

/**
 * Edit a treatment plan.
 *
 * The plans list and the plan header both linked here; the page did not exist.
 *
 * Two things this screen is careful about, because the update route replaces
 * the plan's items wholesale:
 *
 *  - A step that has been started or completed cannot be removed. The route
 *    deletes every item and writes the list back, so dropping a line here
 *    would take its progress with it.
 *  - Every line carries a price. The route settles a blank one to the
 *    procedure's list price and adds that to the plan total, so a line left at
 *    zero on this screen would be quoted at list price on the next.
 */

interface Procedure {
  id: string
  code: string
  name: string
  category: string
  basePrice: string | number
}

interface PlanItem {
  id?: string
  procedureId: string
  procedureName: string
  procedureCode: string
  toothNumbers: string
  estimatedCost: number
  notes: string
  status: string
}

const LOCKED = new Set(['IN_PROGRESS', 'COMPLETED'])

export default function EditTreatmentPlanPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const planId = params.id as string
  const { toast } = useToast()

  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [planNumber, setPlanNumber] = useState<string | null>(null)
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState('')
  const [expectedEndDate, setExpectedEndDate] = useState('')
  const [items, setItems] = useState<PlanItem[]>([])
  const [storedTotal, setStoredTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [pickProcedure, setPickProcedure] = useState('')
  const [pickTeeth, setPickTeeth] = useState('')
  const [pickCost, setPickCost] = useState('')

  const trail = useTrail(planNumber)

  useEffect(() => {
    const load = async () => {
      try {
        const [planRes, procRes] = await Promise.all([
          fetch(`/api/treatment-plans/${planId}`),
          fetch('/api/procedures?all=true&isActive=true'),
        ])

        const planData = await planRes.json()
        if (!planRes.ok) throw new Error(planData.error || 'That plan could not be loaded')
        const plan = planData.treatmentPlan ?? planData

        const procData = await procRes.json().catch(() => ({}))
        setProcedures(procData.procedures ?? procData.data ?? [])

        setPlanNumber(plan.planNumber ?? null)
        setPatient(
          plan.patient
            ? { id: plan.patient.id, name: `${plan.patient.firstName} ${plan.patient.lastName}` }
            : null
        )
        setStoredTotal(Number(plan.estimatedCost ?? 0))
        setTitle(plan.title ?? '')
        setNotes(plan.notes ?? '')
        setStartDate(plan.startDate ? String(plan.startDate).slice(0, 10) : '')
        setExpectedEndDate(plan.expectedEndDate ? String(plan.expectedEndDate).slice(0, 10) : '')
        setItems(
          (plan.items ?? []).map((item: any) => ({
            id: item.id,
            procedureId: item.procedureId,
            procedureName: item.procedure?.name ?? 'Procedure',
            procedureCode: item.procedure?.code ?? '',
            toothNumbers: item.toothNumbers ?? '',
            estimatedCost: Number(item.estimatedCost ?? 0),
            notes: item.notes ?? '',
            status: item.status ?? 'PENDING',
          }))
        )
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the plan',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [planId, toast])

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.estimatedCost || 0), 0),
    [items]
  )

  const addItem = () => {
    const procedure = procedures.find((p) => p.id === pickProcedure)
    if (!procedure) {
      toast({
        title: 'Choose a procedure',
        description: 'Pick what is being added to the plan.',
        variant: 'destructive',
      })
      return
    }

    setItems([
      ...items,
      {
        procedureId: procedure.id,
        procedureName: procedure.name,
        procedureCode: procedure.code,
        toothNumbers: pickTeeth,
        estimatedCost: pickCost === '' ? Number(procedure.basePrice) : Number(pickCost),
        notes: '',
        status: 'PENDING',
      },
    ])
    setPickProcedure('')
    setPickTeeth('')
    setPickCost('')
  }

  const move = (index: number, by: number) => {
    const next = [...items]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
  }

  const remove = (index: number) => {
    const item = items[index]
    if (LOCKED.has(item.status)) {
      toast({
        title: 'That step has already started',
        description: `${item.procedureName} is ${item.status.toLowerCase().replace('_', ' ')}. Cancel it on the plan instead of removing it here.`,
        variant: 'destructive',
      })
      return
    }
    setItems(items.filter((_, i) => i !== index))
  }

  const setCost = (index: number, value: string) => {
    const next = [...items]
    next[index] = { ...next[index], estimatedCost: value === '' ? 0 : Number(value) }
    setItems(next)
  }

  const setTeeth = (index: number, value: string) => {
    const next = [...items]
    next[index] = { ...next[index], toothNumbers: value }
    setItems(next)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!title.trim()) {
      toast({
        title: 'A title is required',
        description: 'The patient sees this name on their estimate.',
        variant: 'destructive',
      })
      return
    }
    if (items.length === 0) {
      toast({
        title: 'A plan needs at least one step',
        description: 'Add a procedure, or cancel the plan instead of emptying it.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/treatment-plans/${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          notes,
          startDate: startDate || null,
          expectedEndDate: expectedEndDate || null,
          items: items.map((item, index) => ({
            procedureId: item.procedureId,
            toothNumbers: item.toothNumbers || null,
            priority: index + 1,
            estimatedCost: item.estimatedCost,
            notes: item.notes || null,
            status: item.status,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save the plan')

      toast({ title: 'Saved', description: `${planNumber ?? 'The plan'} has been updated.` })
      router.push(`/treatments/plans/${planId}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save the plan',
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
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <BackLink trail={trail} fallback="/treatments/plans" fallbackLabel="Treatment Plans" />

      <div>
        <h1 className="text-2xl font-bold">Edit {planNumber ?? 'treatment plan'}</h1>
        {patient && (
          <p className="text-muted-foreground">
            for{' '}
            <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
              {patient.name}
            </Link>
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedEndDate">Expected completion</Label>
              <Input
                id="expectedEndDate"
                type="date"
                value={expectedEndDate}
                onChange={(e) => setExpectedEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps</CardTitle>
          <CardDescription>
            In the order they will be carried out. The total below is what the patient is quoted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Procedure</TableHead>
                <TableHead>Teeth</TableHead>
                <TableHead className="w-36 text-right">Cost</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id ?? `${item.procedureId}-${index}`}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium">{item.procedureName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.procedureCode}
                      {LOCKED.has(item.status)
                        ? ` · ${item.status.toLowerCase().replace('_', ' ')}`
                        : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={item.toothNumbers}
                      onChange={(e) => setTeeth(index, e.target.value)}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.estimatedCost}
                      onChange={(e) => setCost(index, e.target.value)}
                      className="h-8 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconTooltip label="Move this item up">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => move(index, -1)}
                          aria-label="Move this item up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Move this item down">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => move(index, 1)}
                          aria-label="Move this item down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Remove this item">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 dark:text-red-400"
                          onClick={() => remove(index)}
                          aria-label="Remove this item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </IconTooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No steps yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex justify-end text-sm font-medium">
            Total estimate: {formatCurrency(total)}
          </div>

          {/* Plans raised before the create route settled each line's price
              carry a total that its own lines do not add up to: the header took
              the procedure's list price where none was given, while the line
              was written as zero. Saying so here is the only way the figure
              gets corrected — quietly saving would replace the quoted total
              with zero, and quietly keeping it would leave the estimate
              disagreeing with itself for good. */}
          {Math.abs(storedTotal - total) > 0.005 && (
            <p className="text-sm text-amber-700 dark:text-amber-400 text-right">
              This plan is stored with a total of {formatCurrency(storedTotal)}, which its steps do
              not add up to. Put the price against each step; saving will set the total to{' '}
              {formatCurrency(total)}.
            </p>
          )}

          <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end border-t pt-4">
            <div className="space-y-2">
              <Label>Add a procedure</Label>
              <Select value={pickProcedure} onValueChange={setPickProcedure}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a procedure" />
                </SelectTrigger>
                <SelectContent>
                  {procedures.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pickTeeth">Teeth</Label>
              <Input
                id="pickTeeth"
                value={pickTeeth}
                onChange={(e) => setPickTeeth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pickCost">Cost</Label>
              <Input
                id="pickCost"
                type="number"
                min="0"
                step="0.01"
                value={pickCost}
                onChange={(e) => setPickCost(e.target.value)}
                placeholder="List price"
              />
            </div>
            <Button type="button" variant="outline" onClick={addItem}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={`/treatments/plans/${planId}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save changes
        </Button>
      </div>
    </form>
  )
}

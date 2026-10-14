'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { LoadFailed } from '@/components/ui/load-failed'
import { MoneyInput, isInvalidMoney, parseMoney } from '@/components/ui/money-input'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { ProcedurePicker } from '@/components/catalogue/procedure-picker'
import { ToothPicker } from '@/components/dental-chart/tooth-picker'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/i18n/format'
import { BLANK } from '@/lib/dates'
import { describeTeethByQuadrant, formatTeeth, parseTeeth } from '@/lib/teeth'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Trash2 } from 'lucide-react'

/**
 * Edit a treatment plan.
 *
 * The plans list and the plan header both linked here; the page did not exist.
 *
 * Each line goes back with its `id`, and the update route matches it to the
 * stored item rather than deleting and rewriting the list. That keeps a
 * step's link to the treatment carrying it out, its progress and its phase.
 *
 *  - A step that has been started or completed cannot be removed here, and
 *    the route refuses it too. It goes by cancelling its treatment.
 *  - Every line carries a price, and zero is a price: the route settles only a
 *    blank one to the procedure's list price.
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
  phase: number
  procedureId: string
  procedureName: string
  procedureCode: string
  /** The stored form, `11,12,13`, or '' for none. */
  toothNumbers: string
  /** The text in the price field; read with parseMoney. */
  estimatedCost: string
  notes: string
  status: string
}

interface Patient {
  id: string
  name: string
  dateOfBirth: string | null
}

type Errors = {
  title?: string
  procedure?: string
  pickCost?: string
  /** Per line, by position. */
  cost?: Record<number, string>
}

const LOCKED = new Set(['IN_PROGRESS', 'COMPLETED'])

const BAD_PRICE = 'Enter an amount like 1500 or 1500.50.'

export default function EditTreatmentPlanPage() {
  const router = useRouter()
  const params = useParams()
  const planId = params.id as string
  const { toast } = useToast()

  const [planNumber, setPlanNumber] = useState<string | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState('')
  const [expectedEndDate, setExpectedEndDate] = useState('')
  const [items, setItems] = useState<PlanItem[]>([])
  const [storedTotal, setStoredTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'missing'>('ok')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard(saving)

  // The line being added
  const [pickProcedure, setPickProcedure] = useState<Procedure | null>(null)
  const [pickTeeth, setPickTeeth] = useState<number[]>([])
  const [pickCost, setPickCost] = useState('')

  // The line whose teeth are being chosen, by position.
  const [teethFor, setTeethFor] = useState<number | null>(null)

  const trail = useTrail(planNumber)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadState('ok')
    try {
      const planRes = await fetch(`/api/treatment-plans/${planId}`)
      if (planRes.status === 404) {
        setLoadState('missing')
        return
      }
      const planData = await readJson<any>(planRes)
      const plan = planData.treatmentPlan ?? planData

      setPlanNumber(plan.planNumber ?? null)
      setPatient(
        plan.patient
          ? {
              id: plan.patient.id,
              name: `${plan.patient.firstName} ${plan.patient.lastName}`,
              dateOfBirth: plan.patient.dateOfBirth ?? null,
            }
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
          phase: item.phase ?? 1,
          procedureId: item.procedureId,
          procedureName: item.procedure?.name ?? 'Procedure',
          procedureCode: item.procedure?.code ?? '',
          toothNumbers: item.toothNumbers ?? '',
          estimatedCost: String(Number(item.estimatedCost ?? 0)),
          notes: item.notes ?? '',
          status: item.status ?? 'PENDING',
        }))
      )
    } catch (err) {
      console.error('Error loading treatment plan:', err)
      setLoadState('failed')
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    // Loading is the effect's job: it fetches and stores what comes back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // What the patient is quoted: each line as it reads now, a line still being
  // typed counting for nothing until it is an amount.
  const total = items.reduce((sum, item) => sum + (parseMoney(item.estimatedCost) ?? 0), 0)

  const addItem = () => {
    if (!pickProcedure) {
      setErrors((current) => ({ ...current, procedure: 'Choose a procedure to add.' }))
      return
    }
    if (isInvalidMoney(pickCost)) {
      setErrors((current) => ({
        ...current,
        pickCost: `${BAD_PRICE} Leave it blank for the list price.`,
      }))
      return
    }

    // A blank price is the procedure's list price; zero is zero.
    const cost = parseMoney(pickCost) ?? Number(pickProcedure.basePrice)
    setItems([
      ...items,
      {
        // Added to the last phase, which is where a step added afterwards
        // usually belongs; the plan page shows it there.
        phase: items.length ? Math.max(...items.map((item) => item.phase)) : 1,
        procedureId: pickProcedure.id,
        procedureName: pickProcedure.name,
        procedureCode: pickProcedure.code,
        toothNumbers: formatTeeth(pickTeeth) ?? '',
        estimatedCost: String(cost),
        notes: '',
        status: 'PENDING',
      },
    ])
    setErrors((current) => ({ ...current, procedure: undefined, pickCost: undefined }))
    setPickProcedure(null)
    setPickTeeth([])
    setPickCost('')
  }

  // Line errors are by position, so a move or a removal starts them afresh.
  const move = (index: number, by: number) => {
    const next = [...items]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
    setErrors((current) => ({ ...current, cost: undefined }))
  }

  const remove = (index: number) => {
    const item = items[index]
    if (LOCKED.has(item.status)) {
      toast(
        toastError(
          `remove ${item.procedureName}`,
          'That step has already started. Cancel it on the plan instead of removing it here.'
        )
      )
      return
    }
    setItems(items.filter((_, i) => i !== index))
    setErrors((current) => ({ ...current, cost: undefined }))
  }

  const updateItem = (index: number, change: Partial<PlanItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)))
  }

  const setCost = (index: number, raw: string) => {
    updateItem(index, { estimatedCost: raw })
    setErrors((current) => {
      if (!current.cost?.[index]) return current
      const cost = { ...current.cost }
      delete cost[index]
      return { ...current, cost }
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const found: Errors = {}
    if (!title.trim()) found.title = 'Give the plan a title. The patient sees it on the estimate.'
    if (items.length === 0) {
      found.procedure = 'A plan needs at least one step. Add a procedure, or cancel the plan.'
    }
    const cost: Record<number, string> = {}
    items.forEach((item, index) => {
      if (parseMoney(item.estimatedCost) === null) {
        cost[index] = item.estimatedCost.trim() ? BAD_PRICE : 'Enter a price, 0 for no charge.'
      }
    })
    if (Object.keys(cost).length) found.cost = cost
    setErrors(found)

    const firstId = found.title
      ? 'title'
      : found.cost
        ? `cost-${Object.keys(found.cost)[0]}`
        : found.procedure
          ? 'procedure'
          : null
    if (firstId) {
      toast(toastError('save the treatment plan', 'Check the highlighted fields.'))
      const field = document.getElementById(firstId)
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field?.focus({ preventScroll: true })
      return
    }

    setSaving(true)
    try {
      await readJson(
        await fetch(`/api/treatment-plans/${planId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            notes,
            startDate: startDate || null,
            expectedEndDate: expectedEndDate || null,
            items: items.map((item, index) => ({
              id: item.id,
              phase: item.phase,
              procedureId: item.procedureId,
              toothNumbers: item.toothNumbers || null,
              priority: index + 1,
              estimatedCost: parseMoney(item.estimatedCost),
              notes: item.notes || null,
              status: item.status,
            })),
          }),
        })
      )

      toast(toastSuccess('Treatment plan saved', planNumber ?? undefined))
      router.push(`/treatments/plans/${planId}`)
    } catch (err) {
      toast(toastError(`save ${planNumber ?? 'the treatment plan'}`, err))
      setSaving(false)
    }
  }

  if (loading) {
    return <PageSkeleton variant="form" />
  }

  if (loadState === 'missing') {
    return (
      <EmptyState
        icon={FileText}
        title="Treatment plan not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to treatment plans"
        actionHref="/treatments/plans"
      />
    )
  }

  if (loadState === 'failed') {
    return <LoadFailed what="this treatment plan" onRetry={load} />
  }

  const teethItem = teethFor !== null ? items[teethFor] : null

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6 max-w-4xl">
      <PageHeader
        title={`Edit ${planNumber ?? 'treatment plan'}`}
        description={
          patient && (
            <>
              for{' '}
              <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
                {patient.name}
              </Link>
            </>
          )
        }
        back={
          <BackLink
            trail={trail}
            fallback={`/treatments/plans/${planId}`}
            fallbackLabel={planNumber ?? 'Treatment plan'}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Title" htmlFor="title" required error={errors.title}>
            {(control) => (
              <Input
                {...control}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (errors.title) setErrors((current) => ({ ...current, title: undefined }))
                }}
              />
            )}
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Start date" htmlFor="startDate">
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="Expected completion" htmlFor="expectedEndDate">
              <Input
                id="expectedEndDate"
                type="date"
                value={expectedEndDate}
                onChange={(e) => setExpectedEndDate(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
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
                <TableHead className="w-40 text-right">Cost</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const teeth = describeTeethByQuadrant(parseTeeth(item.toothNumbers))
                const costError = errors.cost?.[index]
                return (
                  <TableRow key={item.id ?? `${item.procedureId}-${index}`}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <p className="font-medium">{item.procedureName}</p>
                      <p className="text-xs text-muted-foreground">{item.procedureCode}</p>
                      {LOCKED.has(item.status) && (
                        <StatusBadge
                          kind="treatmentPlanItem"
                          status={item.status}
                          className="mt-1"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-sm">{teeth || BLANK}</span>
                        <IconTooltip label={`Choose teeth for ${item.procedureName}`}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setTeethFor(index)}
                            aria-label={`Choose teeth for ${item.procedureName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </IconTooltip>
                      </div>
                    </TableCell>
                    <TableCell>
                      <MoneyInput
                        id={`cost-${index}`}
                        aria-label={`Cost of ${item.procedureName}`}
                        aria-invalid={costError ? true : undefined}
                        aria-describedby={costError ? `cost-${index}-error` : undefined}
                        value={item.estimatedCost}
                        onChange={(raw) => setCost(index, raw)}
                        className="h-8"
                      />
                      {costError && (
                        <p id={`cost-${index}-error`} className="mt-1 text-xs text-destructive">
                          {costError}
                        </p>
                      )}
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
                            className="h-8 w-8 text-destructive"
                            onClick={() => remove(index)}
                            aria-label="Remove this item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </IconTooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
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

          {/* The step being added */}
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
              <FormField label="Add a procedure" htmlFor="procedure" error={errors.procedure}>
                {(control) => (
                  <ProcedurePicker<Procedure>
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    aria-invalid={control['aria-invalid']}
                    value={pickProcedure?.id ?? null}
                    selectedLabel={pickProcedure?.name}
                    onSelect={(procedure) => {
                      setPickProcedure(procedure)
                      setErrors((current) => ({ ...current, procedure: undefined }))
                    }}
                    onClear={() => setPickProcedure(null)}
                  />
                )}
              </FormField>
              <FormField
                label="Cost"
                htmlFor="pickCost"
                error={errors.pickCost}
                hint={
                  pickProcedure
                    ? `Blank for the list price, ${formatCurrency(pickProcedure.basePrice)}.`
                    : 'Blank for the list price.'
                }
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    value={pickCost}
                    onChange={(raw) => {
                      setPickCost(raw)
                      setErrors((current) => ({ ...current, pickCost: undefined }))
                    }}
                    placeholder="List price"
                  />
                )}
              </FormField>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium" id="pickTeethLabel">
                Teeth
              </p>
              <div role="group" aria-labelledby="pickTeethLabel">
                <ToothPicker
                  selected={pickTeeth}
                  onChange={setPickTeeth}
                  patientId={patient?.id}
                  dateOfBirth={patient?.dateOfBirth}
                />
              </div>
            </div>
            <Button type="button" variant="outline" onClick={addItem} disabled={!pickProcedure}>
              <Plus className="h-4 w-4 mr-2" />
              Add procedure
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={`/treatments/plans/${planId}`}>Cancel</Link>
        </Button>
        <SubmitButton busy={saving}>Save changes</SubmitButton>
      </div>

      {/* The teeth of a step already on the plan */}
      <Dialog open={teethItem !== null} onOpenChange={(open) => !open && setTeethFor(null)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Teeth for {teethItem?.procedureName}</DialogTitle>
            <DialogDescription>
              Click a tooth to add or remove it. Leave it empty for a procedure on the whole mouth.
            </DialogDescription>
          </DialogHeader>
          {teethItem && teethFor !== null && (
            <ToothPicker
              selected={parseTeeth(teethItem.toothNumbers)}
              onChange={(teeth) => updateItem(teethFor, { toothNumbers: formatTeeth(teeth) ?? '' })}
              patientId={patient?.id}
              dateOfBirth={patient?.dateOfBirth}
            />
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setTeethFor(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}

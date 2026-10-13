'use client'

/**
 * A patient's mouth, as charted.
 *
 * Draws the same arch as the picker on the treatment and prescription forms —
 * `ToothArch` owns the geometry — so a tooth is in the same place, at the same
 * width, with the same colour for the same finding, wherever you meet it. This
 * screen used to draw its own: two straight rows of thirty-two identical
 * rectangles on a pink gradient, with its own private list of conditions and
 * its own private list of tooth names, both of which had drifted from the ones
 * every other screen used.
 *
 * Clicking a tooth opens its findings rather than selecting it, which is the
 * only real difference from the picker.
 *
 * A switch above the arch moves between the permanent dentition and a child's
 * primary one (51–85). Only permanent teeth could be charted before, so tooth
 * 75 on an eleven-year-old had nowhere to go (bug report 12 Oct, finding 55).
 * A mixed dentition is charted on both: each tooth keeps its own number.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import {
  ALL_PRIMARY_TEETH,
  ALL_TEETH,
  isPrimaryTooth,
  quadrantOf,
  QUADRANTS,
  type Dentition,
} from '@/lib/teeth'
import { primaryToothNames, toothConditionConfig, toothNames } from '@/lib/treatment-utils'
import { ToothArch, ToothButton } from '@/components/dental-chart/tooth-arch'

interface DentalChartEntry {
  id: string
  toothNumber: number
  toothNotation: string
  condition: string
  severity: string
  mesial: boolean
  distal: boolean
  occlusal: boolean
  buccal: boolean
  lingual: boolean
  notes?: string
  diagnosedDate: string
  resolvedDate?: string
  recordedBy?: { id: string; name: string } | null
}

interface DentalChartProps {
  patientId: string
}

/**
 * The conditions a finding can have, in the order the dropdown offers them.
 *
 * Derived from `toothConditionConfig`, which is itself keyed by the
 * `ToothCondition` enum, so this list cannot drift from what the database will
 * accept — which is exactly what the hand-written copy that used to live here
 * had done.
 */
const TOOTH_CONDITIONS = Object.entries(toothConditionConfig).map(([value, config]) => ({
  value,
  label: config.label,
  fillColor: config.fillColor,
}))

const SEVERITY_LEVELS = [
  { value: 'MILD', label: 'Mild' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'SEVERE', label: 'Severe' },
]

/** Conditions that mean the tooth is no longer in the mouth. */
const ABSENT = new Set(['MISSING', 'EXTRACTION'])

function conditionLabel(condition: string): string {
  return toothConditionConfig[condition]?.label ?? condition
}

/** The name of a tooth, with the quadrant spelled out rather than implied. */
function toothLabel(tooth: number): string {
  return toothNames[tooth] ?? primaryToothNames[tooth] ?? 'Tooth'
}

const DENTITIONS: { value: Dentition; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'primary', label: 'Primary' },
]

export function DentalChart({ patientId }: DentalChartProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [chartData, setChartData] = useState<Record<number, DentalChartEntry[]>>({})
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Which teeth are drawn. `null` until somebody chooses, so the first load can
  // open a child's chart on the primary teeth it has findings on.
  const [chosenDentition, setChosenDentition] = useState<Dentition | null>(null)

  // Form state for new entry
  const [formCondition, setFormCondition] = useState('CARIES')
  const [formSeverity, setFormSeverity] = useState('MILD')
  const [formNotes, setFormNotes] = useState('')
  const [formSurfaces, setFormSurfaces] = useState({
    mesial: false,
    distal: false,
    occlusal: false,
    buccal: false,
    lingual: false,
  })

  const fetchChartData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dental-chart?patientId=${patientId}&isActive=true`)
      if (!response.ok) throw new Error('Failed to fetch dental chart')

      const data = await response.json()
      setChartData(data.chartData || {})
    } catch (error) {
      console.error('Error fetching dental chart:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load dental chart',
      })
    } finally {
      setLoading(false)
    }
  }, [patientId, toast])

  useEffect(() => {
    fetchChartData()
  }, [fetchChartData])

  /**
   * One current finding per tooth.
   *
   * The counts below used to be taken over every entry flattened together, so
   * a tooth carrying two unresolved entries counted twice. A mouth has
   * thirty-two teeth and each is in one state; this is that state.
   */
  const current = useMemo(() => {
    const map: Record<number, DentalChartEntry> = {}
    for (const tooth of [...ALL_TEETH, ...ALL_PRIMARY_TEETH]) {
      const active = (chartData[tooth] ?? []).find((entry) => !entry.resolvedDate)
      if (active) map[tooth] = active
    }
    return map
  }, [chartData])

  /**
   * The dentition on screen: the one chosen, or — before any choice — primary
   * when every current finding is on a primary tooth, which is a child's
   * chart; otherwise permanent.
   */
  const dentition: Dentition = useMemo(() => {
    if (chosenDentition) return chosenDentition
    const charted = Object.keys(current).map(Number)
    return charted.length > 0 && charted.every(isPrimaryTooth) ? 'primary' : 'permanent'
  }, [chosenDentition, current])
  const shownTeeth = dentition === 'primary' ? ALL_PRIMARY_TEETH : ALL_TEETH

  const counts = useMemo(() => {
    const teeth = shownTeeth.map((tooth) => current[tooth]).filter(Boolean)
    const absent = teeth.filter((entry) => ABSENT.has(entry.condition)).length
    return {
      present: shownTeeth.length - absent,
      caries: teeth.filter((entry) => entry.condition === 'CARIES').length,
      filled: teeth.filter((entry) => entry.condition === 'FILLED').length,
      absent,
    }
  }, [current, shownTeeth])

  /** Only the conditions this mouth actually has — a key, not a catalogue. */
  const presentConditions = useMemo(() => {
    const seen = new Set<string>()
    for (const tooth of shownTeeth) {
      const condition = current[tooth]?.condition
      if (condition && condition !== 'HEALTHY') seen.add(condition)
    }
    return [...seen]
  }, [current, shownTeeth])

  /** What is charted, by quadrant, under the arch. */
  const byQuadrant = useMemo(
    () =>
      QUADRANTS.map((quadrant) => ({
        ...quadrant,
        // Both dentitions, so a finding on a tooth not drawn just now is still
        // listed — and a click on it opens it.
        teeth: [...ALL_TEETH, ...ALL_PRIMARY_TEETH].filter(
          (tooth) =>
            quadrantOf(tooth) === quadrant.key &&
            current[tooth] &&
            current[tooth].condition !== 'HEALTHY'
        ),
      })).filter((quadrant) => quadrant.teeth.length > 0),
    [current]
  )

  const handleToothClick = (toothNumber: number) => {
    setSelectedTooth(toothNumber)
    const activeEntry = current[toothNumber]

    if (activeEntry) {
      setFormCondition(activeEntry.condition)
      setFormSeverity(activeEntry.severity)
      setFormNotes(activeEntry.notes || '')
      setFormSurfaces({
        mesial: activeEntry.mesial,
        distal: activeEntry.distal,
        occlusal: activeEntry.occlusal,
        buccal: activeEntry.buccal,
        lingual: activeEntry.lingual,
      })
    } else {
      setFormCondition('CARIES')
      setFormSeverity('MILD')
      setFormNotes('')
      setFormSurfaces({
        mesial: false,
        distal: false,
        occlusal: false,
        buccal: false,
        lingual: false,
      })
    }

    setDialogOpen(true)
  }

  const handleSaveEntry = async () => {
    if (!selectedTooth) return

    try {
      setSaving(true)

      const response = await fetch('/api/dental-chart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          patientId,
          toothNumber: selectedTooth,
          condition: formCondition,
          severity: formSeverity,
          notes: formNotes || undefined,
          ...formSurfaces,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save entry')
      }

      toast({
        title: 'Success',
        description: `Tooth ${selectedTooth} updated successfully`,
      })

      setDialogOpen(false)
      fetchChartData()
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save entry',
      })
    } finally {
      setSaving(false)
    }
  }

  const renderTooth = (tooth: number, arch: 'upper' | 'lower') => {
    const finding = current[tooth]
    const config = finding ? toothConditionConfig[finding.condition] : undefined
    const surfaces =
      finding &&
      (finding.mesial || finding.distal || finding.occlusal || finding.buccal || finding.lingual)

    return (
      <Tooltip key={tooth}>
        <TooltipTrigger asChild>
          <ToothButton
            tooth={tooth}
            arch={arch}
            absent={ABSENT.has(finding?.condition ?? '')}
            aria-label={`Tooth ${tooth}, ${toothLabel(tooth)}${
              config ? `, ${config.label}` : ', no finding recorded'
            }`}
            onClick={() => handleToothClick(tooth)}
            conditionColor={config && finding?.condition !== 'HEALTHY' ? config.fillColor : null}
          >
            {/* A finding that names surfaces has more to it than its colour. */}
            {surfaces && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-card"
              />
            )}
          </ToothButton>
        </TooltipTrigger>
        <TooltipContent side={arch === 'upper' ? 'top' : 'bottom'}>
          <p className="font-medium">
            {tooth} · {toothLabel(tooth)}
          </p>
          {config ? (
            <p className="text-xs">
              {config.label}
              {finding?.severity && finding.severity !== 'MILD'
                ? ` · ${finding.severity.toLowerCase()}`
                : ''}
            </p>
          ) : (
            <p className="text-xs opacity-80">No finding recorded</p>
          )}
          {finding?.notes && (
            <p className="mt-1 max-w-[16rem] text-xs opacity-80">{finding.notes}</p>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dental Chart</CardTitle>
        <CardDescription>
          Click a tooth to view or update its condition. Numbered in FDI notation, drawn as you face
          the patient — so the upper right quadrant is on the left.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={200}>
          <div className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div
              role="radiogroup"
              aria-label="Dentition"
              className="mb-3 flex w-fit gap-1 rounded-lg bg-foreground/[0.05] p-0.5"
            >
              {DENTITIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={dentition === option.value}
                  onClick={() => setChosenDentition(option.value)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    dentition === option.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <ToothArch tooth={renderTooth} dentition={dentition} />

            {/* A key, only for what this mouth has */}
            {presentConditions.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-3">
                {presentConditions.map((condition) => {
                  const config = toothConditionConfig[condition]
                  if (!config) return null
                  return (
                    <span key={condition} className="flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: config.fillColor }}
                      />
                      <span className="text-muted-foreground">{config.label}</span>
                    </span>
                  )
                })}
              </div>
            )}

            {/*
              What is charted, by quadrant. The arch says where; this says what,
              without asking the reader to hover thirty-two teeth to find out.
            */}
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              {byQuadrant.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing charted yet. Click a tooth to record a finding.
                </p>
              ) : (
                byQuadrant.map((quadrant) => (
                  <div key={quadrant.key} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
                      {quadrant.label}
                    </span>
                    {quadrant.teeth.map((tooth) => {
                      const config = toothConditionConfig[current[tooth].condition]
                      return (
                        <button
                          key={tooth}
                          type="button"
                          onClick={() => handleToothClick(tooth)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-xs font-medium transition-colors hover:bg-foreground/[0.1]"
                        >
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: config?.fillColor }}
                          />
                          {tooth}
                          <span className="text-muted-foreground">
                            {conditionLabel(current[tooth].condition)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </TooltipProvider>

        {/* Summary section */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {counts.present}
              </div>
              <div className="text-sm text-muted-foreground">Present Teeth</div>
            </CardContent>
          </Card>
          <Card className="bg-red-50 dark:bg-red-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {counts.caries}
              </div>
              <div className="text-sm text-muted-foreground">Caries</div>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 dark:bg-blue-950/20">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {counts.filled}
              </div>
              <div className="text-sm text-muted-foreground">Filled</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-muted-foreground">{counts.absent}</div>
              <div className="text-sm text-muted-foreground">Missing</div>
            </CardContent>
          </Card>
        </div>

        {/* Tooth Detail Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Tooth {selectedTooth} · {selectedTooth ? toothLabel(selectedTooth) : ''}
              </DialogTitle>
              <DialogDescription>View or update the condition of this tooth</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Condition */}
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={formCondition} onValueChange={setFormCondition}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOTH_CONDITIONS.map((condition) => (
                      <SelectItem key={condition.value} value={condition.value}>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: condition.fillColor }}
                          />
                          {condition.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={formSeverity} onValueChange={setFormSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((level) => (
                      <SelectItem key={level.value} value={level.value}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Surfaces affected */}
              <div className="space-y-2">
                <Label>Surfaces Affected</Label>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(formSurfaces).map(([surface, checked]) => (
                    <div key={surface} className="flex items-center gap-2">
                      <Checkbox
                        id={surface}
                        checked={checked}
                        onCheckedChange={(value) =>
                          setFormSurfaces((prev) => ({ ...prev, [surface]: !!value }))
                        }
                      />
                      <label htmlFor={surface} className="text-sm capitalize">
                        {surface}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Add any additional notes..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </div>

              {/* History */}
              {selectedTooth && chartData[selectedTooth]?.length > 0 && (
                <div className="space-y-2">
                  <Label>History</Label>
                  <div className="max-h-32 space-y-2 overflow-y-auto">
                    {chartData[selectedTooth].map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded p-2 text-sm ${entry.resolvedDate ? 'bg-muted' : 'bg-blue-50 dark:bg-blue-950/20'}`}
                      >
                        <div className="flex justify-between">
                          <Badge variant={entry.resolvedDate ? 'outline' : 'default'}>
                            {conditionLabel(entry.condition)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {displayDate(entry.diagnosedDate)}
                          </span>
                        </div>
                        {entry.notes && (
                          <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>
                        )}
                        {/* Findings charted before authorship was recorded have
                            nobody to name; say so rather than leaving a blank
                            that reads like the line was never there. */}
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          {entry.recordedBy
                            ? `Charted by ${entry.recordedBy.name}`
                            : 'Author not recorded'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEntry} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

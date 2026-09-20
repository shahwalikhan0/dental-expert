'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { PerioChart } from '@/components/clinical/perio-chart'
import { ALL_SITES, ALL_TEETH, summarise, type Measurement } from '@/lib/perio'
import type { PerioSite } from '@prisma/client'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { displayDate } from '@/lib/dates'

/**
 * Periodontal charting on the patient record.
 *
 * Two modes over one chart component: reading a past exam, and recording a new
 * one. Deliberately the same chart in both — a clinician comparing today with
 * six months ago should be looking at the same picture, not at a form and a
 * report.
 */

interface Exam {
  id: string
  examDate: string
  notes: string | null
  recordedBy: { id: string; name: string } | null
  measurements: Measurement[]
  toothFindings: { toothNumber: number; isMissing: boolean; isImplant: boolean }[]
  summary: {
    sitesProbed: number
    bleedingPercent: number
    plaquePercent: number
    deepSites: number
    worstPocket: number | null
    meanPocket: number | null
    teethCharted: number
  }
}

const longDate = (value: string) => displayDate(value)

function emptyChart(): Measurement[] {
  return ALL_TEETH.flatMap((toothNumber) =>
    ALL_SITES.map((site) => ({
      toothNumber,
      site,
      pocketDepth: null,
      recession: null,
      bleeding: false,
      suppuration: false,
      plaque: false,
    }))
  )
}

export function PerioPanel({ patientId }: { patientId: string }) {
  const { toast } = useToast()

  const [exams, setExams] = useState<Exam[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Measurement[]>(emptyChart)
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/perio?patientId=${patientId}`)
      if (!res.ok) throw new Error('The periodontal charts could not be loaded')
      const data = await res.json()
      setExams(data.exams ?? [])
      setSelectedId((current) => current ?? data.exams?.[0]?.id ?? null)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load the charts',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [patientId, toast])

  useEffect(() => {
    load()
  }, [load])

  const update = (toothNumber: number, site: PerioSite, patch: Partial<Measurement>) => {
    setDraft((current) =>
      current.map((m) =>
        m.toothNumber === toothNumber && m.site === site ? { ...m, ...patch } : m
      )
    )
  }

  const save = async () => {
    // Only the sites that were actually probed are sent. A blank chart of 192
    // zeroes would read as a perfectly healthy mouth nobody measured.
    const measurements = draft.filter(
      (m) => m.pocketDepth != null || m.recession != null || m.bleeding || m.plaque || m.suppuration
    )

    if (measurements.length === 0) {
      toast({
        title: 'Nothing recorded',
        description: 'Enter at least one probing depth before saving.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/perio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, measurements, notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'The chart could not be saved')

      toast({
        title: 'Chart saved',
        description: `${data.exam.summary.sitesProbed} sites on ${data.exam.summary.teethCharted} teeth.`,
      })
      setRecording(false)
      setDraft(emptyChart())
      setNotes('')
      setSelectedId(data.exam.id)
      await load()
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'The chart could not be saved',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (recording) {
    const live = summarise(draft)

    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">New periodontal chart</CardTitle>
            <CardDescription>
              Type a probing depth into each site. Leave a site blank if it was not probed — blank
              is not the same as zero.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cancel"
            onClick={() => setRecording(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-5 text-sm">
            <span>
              <span className="text-muted-foreground">Sites probed</span>{' '}
              <span className="font-medium">{live.sitesProbed}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Deepest</span>{' '}
              <span className="font-medium">
                {live.worstPocket != null ? `${live.worstPocket}mm` : '—'}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">6mm and over</span>{' '}
              <span className="font-medium">{live.deepSites}</span>
            </span>
          </div>

          <PerioChart measurements={draft} onChange={update} />

          <div className="space-y-2">
            <Label htmlFor="perio-notes">Notes</Label>
            <Textarea
              id="perio-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the numbers do not say"
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setRecording(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save chart
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const selected = exams.find((exam) => exam.id === selectedId) ?? exams[0] ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Periodontal chart</h3>
          {exams.length > 0 && (
            <Select value={selected?.id ?? ''} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[220px]" aria-label="Choose an examination">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {exams.map((exam) => (
                  <SelectItem key={exam.id} value={exam.id}>
                    {longDate(exam.examDate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button onClick={() => setRecording(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Record a chart
        </Button>
      </div>

      {!selected ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No periodontal chart has been recorded for this patient.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{longDate(selected.examDate)}</CardTitle>
            <CardDescription>
              {selected.recordedBy
                ? `Charted by ${selected.recordedBy.name}`
                : 'Author not recorded'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 text-sm">
              {[
                { label: 'Sites probed', value: selected.summary.sitesProbed },
                {
                  label: 'Bleeding',
                  value: `${selected.summary.bleedingPercent}%`,
                },
                { label: '6mm and over', value: selected.summary.deepSites },
                {
                  label: 'Deepest',
                  value:
                    selected.summary.worstPocket != null
                      ? `${selected.summary.worstPocket}mm`
                      : '—',
                },
                {
                  label: 'Mean depth',
                  value:
                    selected.summary.meanPocket != null ? `${selected.summary.meanPocket}mm` : '—',
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-semibold">{stat.value}</p>
                </div>
              ))}
            </div>

            <PerioChart
              measurements={selected.measurements}
              toothFindings={selected.toothFindings}
            />

            {selected.notes && (
              <p className="text-sm text-muted-foreground border-t pt-3">{selected.notes}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

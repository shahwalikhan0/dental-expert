'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ClipboardList, Plus, Search, Eye, Trash2 } from 'lucide-react'
import { ExportMenu } from '@/components/ui/export-menu'
import { ActiveFilters } from '@/components/ui/active-filters'
import { fetchHandedPatient } from '@/lib/prefill'

interface Prescription {
  id: string
  prescriptionNo: string
  diagnosis: string | null
  createdAt: string
  validUntil: string | null
  patient: { id: string; patientId: string; firstName: string; lastName: string }
  doctor: { id: string; name: string }
  medications: {
    id: string
    medicationName: string
    dosage: string
    frequency: string
    duration: string
  }[]
}

interface HandedPatient {
  id: string
  firstName: string
  lastName: string
}

export default function PrescriptionsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Prescriptions')
  const router = useRouter()
  // Arriving from a patient or a treatment narrows the list to that patient.
  // The route has always accepted this filter; nothing passed it, so the only
  // way to see one patient's prescriptions was to search for their name.
  const searchParams = useSearchParams()
  const patientId = searchParams.get('patientId') ?? ''
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })

  /**
   * The name behind `?patientId=`, so the screen can say whose list this is.
   *
   * Read from the patient rather than from the first row: a patient with no
   * prescriptions yet is exactly when an unexplained empty list is most
   * misleading, and that is the case with no row to take a name from.
   */
  const [fetchedPatient, setFetchedPatient] = useState<HandedPatient | null>(null)

  useEffect(() => {
    if (!patientId) return
    const controller = new AbortController()
    fetchHandedPatient<HandedPatient>(patientId, controller.signal).then((patient) => {
      if (!controller.signal.aborted) setFetchedPatient(patient)
    })
    return () => controller.abort()
  }, [patientId])

  // Matched rather than cleared when the filter goes: clearing it in the
  // effect is a synchronous setState on a render, and a stale name is the one
  // thing worse here than no name.
  const handedPatient = fetchedPatient?.id === patientId ? fetchedPatient : null

  /** Drop the patient filter but keep the trail, so Back still works. */
  const clearPatient = () => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('patientId')
    const query = next.toString()
    router.replace(query ? `/prescriptions?${query}` : '/prescriptions', { scroll: false })
  }

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchPrescriptions = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (patientId) params.set('patientId', patientId)

      const res = await fetch(`/api/prescriptions?${params}`)
      const result = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      if (result.success) {
        setPrescriptions(result.data)
        setPagination((prev) => ({
          ...prev,
          total: result.pagination.total,
          pages: result.pagination.pages,
        }))
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load prescriptions' })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [debouncedSearch, patientId, pagination.page, pagination.limit])

  useEffect(() => {
    fetchPrescriptions()
  }, [fetchPrescriptions])

  const handleDelete = async (rx: Prescription) => {
    const ok = await confirm({
      title: 'Delete Prescription',
      description: `Delete prescription ${rx.prescriptionNo}?`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/prescriptions/${rx.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Deleted', description: `Prescription ${rx.prescriptionNo} removed` })
      fetchPrescriptions()
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete prescription',
      })
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* `page-header`/`page-actions` rather than a hand-rolled flex row: this
          page kept its own `flex items-center justify-between`, which does not
          stack on a phone, so the title and the export/new buttons fought over
          one line. The shared classes are what every other list header uses. */}
      <div className="page-header mb-6">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Prescriptions
          </h1>
          <p className="text-muted-foreground">Create and manage patient prescriptions</p>
        </div>
        <div className="page-actions">
          <ExportMenu
            filename="prescriptions"
            getData={() =>
              prescriptions.map((rx) => ({
                'Rx #': rx.prescriptionNo,
                Patient: `${rx.patient.firstName} ${rx.patient.lastName}`,
                'Patient ID': rx.patient.patientId,
                Doctor: rx.doctor.name,
                Diagnosis: rx.diagnosis || '',
                Medications: rx.medications
                  .map((m) => `${m.medicationName} ${m.dosage} ${m.frequency} ${m.duration}`)
                  .join('; '),
                Date: new Date(rx.createdAt).toLocaleDateString('en-PK', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
                'Valid Until': rx.validUntil
                  ? new Date(rx.validUntil).toLocaleDateString('en-PK', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '',
              }))
            }
          />
          {/*
            Carry the patient onward when the list is already scoped to one.
            Writing a prescription for the patient whose list you are reading
            should not start by searching for them again.
          */}
          <Button
            onClick={() =>
              router.push(
                trail.to(
                  patientId ? `/prescriptions/new?patientId=${patientId}` : '/prescriptions/new'
                )
              )
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            New Prescription
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by prescription #, patient name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPagination((p) => ({ ...p, page: 1 }))
              }}
              className="pl-9"
            />
          </div>

          <ActiveFilters
            className="mt-4"
            noun="prescriptions"
            onClearAll={() => {
              setSearch('')
              setPagination((p) => ({ ...p, page: 1 }))
              if (patientId) clearPatient()
            }}
            filters={[
              {
                label: 'Patient',
                value: patientId
                  ? handedPatient
                    ? `${handedPatient.firstName} ${handedPatient.lastName}`
                    : 'Selected patient'
                  : null,
                onClear: clearPatient,
              },
              {
                label: 'Search',
                value: search,
                onClear: () => {
                  setSearch('')
                  setPagination((p) => ({ ...p, page: 1 }))
                },
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Rx #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Diagnosis</TableHead>
                <TableHead>Medications</TableHead>
                <TableHead>Date</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              empty={prescriptions.length === 0}
              emptyIcon={ClipboardList}
              emptyTitle="No prescriptions found"
              emptyDescription="Nothing has been prescribed under these filters."
            >
              {prescriptions.map((rx) => (
                <ClickableRow
                  key={rx.id}
                  href={trail.to(`/prescriptions/${rx.id}`)}
                  label={`Open prescription ${rx.prescriptionNo}`}
                >
                  <TableCell className="font-mono text-sm">{rx.prescriptionNo}</TableCell>
                  <TableCell className="font-medium">
                    {rx.patient.firstName} {rx.patient.lastName}
                    <br />
                    <span className="text-xs text-muted-foreground">{rx.patient.patientId}</span>
                  </TableCell>
                  <TableCell>{rx.doctor.name}</TableCell>
                  <TableCell className="text-sm">{rx.diagnosis || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rx.medications.slice(0, 3).map((m) => (
                        <Badge key={m.id} variant="outline" className="text-xs">
                          {m.medicationName}
                        </Badge>
                      ))}
                      {rx.medications.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{rx.medications.length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(rx.createdAt).toLocaleDateString('en-PK', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <GridActionsCell>
                    <div className="flex gap-1">
                      <IconTooltip label="Open this prescription">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Open this prescription"
                          className="h-8 w-8"
                          onClick={() => router.push(`/prescriptions/${rx.id}`)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label="Delete this prescription">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete this prescription"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(rx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                    </div>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="prescriptions"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}

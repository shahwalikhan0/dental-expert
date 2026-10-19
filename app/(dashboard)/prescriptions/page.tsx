'use client'

import { useState, useEffect, useRef } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useListParams } from '@/hooks/use-list-params'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ClipboardList, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { ExportMenu } from '@/components/ui/export-menu'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { StatusBadge } from '@/components/ui/status-badge'
import { fetchHandedPatient } from '@/lib/prefill'
import { prescriberName } from '@/lib/prescribing'
import { prescriptionStatus } from '@/lib/status'
import { BLANK, displayDate } from '@/lib/dates'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { useCan } from '@/hooks/use-can'

interface Prescription {
  id: string
  prescriptionNo: string
  diagnosis: string | null
  createdAt: string
  validUntil: string | null
  patient: { id: string; patientId: string; firstName: string; lastName: string }
  /** The staff record, as the API returns it. There is no `name` column; the
      page read one, so the Doctor column and the export were blank. */
  doctor: { id: string; firstName: string; lastName: string } | null
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
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // Prescribing takes `clinical:sign`: dentists, the clinic manager and the
  // administrator (bug report 12 Oct, finding 36). Hidden rather
  // than offered to a form that can only end in a refusal; `null` while the
  // session loads, so it does not flash on and off.
  const canPrescribe = useCan('clinical:sign') === true
  // Deleting is `clinical:delete` on the server (the administrator alone);
  // not offered without it.
  const canDelete = useCan('clinical:delete') === true
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, page and the patient filter, kept in the address bar.
   *
   * Arriving from a patient or a treatment narrows the list to that patient
   * (`?patientId=`). The route has always accepted this filter; it is a filter
   * like any other here, so clearing the filters clears it too.
   */
  const list = useListParams({ defaults: { patientId: '' } })
  const patientId = list.filters.patientId
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams().toString()

  // The clinic's calendar day, for whether a prescription is still valid.
  const today = localDay(new Date(), DEFAULT_TIMEZONE)

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

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchPrescriptions = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const result = await readJson<{
        data: Prescription[]
        pagination?: { total: number }
      }>(await fetch(`/api/prescriptions?${query}`))
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setPrescriptions(result.data ?? [])
      setTotal(result.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching prescriptions:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchPrescriptions()
    // The query string is the whole question; `fetchPrescriptions` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleDelete = async (rx: Prescription) => {
    const ok = await confirm({
      title: `Delete prescription ${rx.prescriptionNo}?`,
      description: 'It is removed from the patient’s record. This cannot be undone.',
      confirmLabel: 'Delete prescription',
    })
    if (!ok) return
    try {
      await readJson(await fetch(`/api/prescriptions/${rx.id}`, { method: 'DELETE' }))
      toast(toastSuccess(`Prescription ${rx.prescriptionNo} deleted`))
      fetchPrescriptions()
    } catch (error) {
      toast(toastError(`delete prescription ${rx.prescriptionNo}`, error))
    }
  }

  // Carry the patient onward when the list is already scoped to one. Writing a
  // prescription for the patient whose list you are reading should not start
  // by searching for them again.
  const newHref = trail.to(
    patientId ? `/prescriptions/new?patientId=${patientId}` : '/prescriptions/new'
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Prescriptions"
        description="Create and manage patient prescriptions"
        actions={
          <>
            <ExportMenu
              filename="prescriptions"
              getData={() =>
                prescriptions.map((rx) => ({
                  'Rx #': rx.prescriptionNo,
                  Patient: `${rx.patient.firstName} ${rx.patient.lastName}`,
                  'Patient ID': rx.patient.patientId,
                  Doctor: prescriberName(rx.doctor),
                  Diagnosis: rx.diagnosis || '',
                  Medications: rx.medications
                    .map((m) => `${m.medicationName} ${m.dosage} ${m.frequency} ${m.duration}`)
                    .join('; '),
                  Date: displayDate(rx.createdAt),
                  'Valid until': rx.validUntil ? displayDate(rx.validUntil) : '',
                }))
              }
            />
            {canPrescribe && (
              <Button asChild>
                <Link href={newHref}>
                  <Plus className="h-4 w-4" />
                  New prescription
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search prescriptions"
            placeholder="Search by prescription number, patient name or ID…"
          />
        }
        active={{
          noun: 'prescriptions',
          onClearAll: list.clear,
          filters: [
            {
              label: 'Patient',
              value: patientId
                ? handedPatient
                  ? `${handedPatient.firstName} ${handedPatient.lastName}`
                  : 'Selected patient'
                : null,
              onClear: () => list.setFilter('patientId', ''),
            },
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
          ],
        }}
      />

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
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchPrescriptions}
              empty={prescriptions.length === 0}
              emptyIcon={ClipboardList}
              emptyTitle="No prescriptions found"
              emptyDescription={
                list.isFiltered
                  ? 'Nothing has been prescribed under these filters.'
                  : 'No prescription has been written yet.'
              }
              emptyActionLabel={
                list.isFiltered
                  ? 'Clear the filters'
                  : canPrescribe
                    ? 'New prescription'
                    : undefined
              }
              emptyActionHref={list.isFiltered || !canPrescribe ? undefined : newHref}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {prescriptions.map((rx) => (
                <ClickableRow
                  key={rx.id}
                  href={trail.to(`/prescriptions/${rx.id}`)}
                  label={`Open prescription ${rx.prescriptionNo}`}
                >
                  <TableCell className="font-mono text-sm">{rx.prescriptionNo}</TableCell>
                  <TableCell>
                    <span className="block font-medium">
                      {rx.patient.firstName} {rx.patient.lastName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {rx.patient.patientId}
                    </span>
                  </TableCell>
                  <TableCell>{prescriberName(rx.doctor) || BLANK}</TableCell>
                  <TableCell className="text-sm">{rx.diagnosis || BLANK}</TableCell>
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
                    {displayDate(rx.createdAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      kind="prescription"
                      status={prescriptionStatus(rx.validUntil, today)}
                    />
                  </TableCell>
                  <GridActionsCell>
                    {/* No "View details": the row itself opens the prescription.
                        The menu holds only Delete, so without it there is none. */}
                    {canDelete && (
                      <DropdownMenu>
                        <IconTooltip label="More actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </IconTooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(rx)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete prescription
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="prescriptions"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}

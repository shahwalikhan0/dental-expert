'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { Label } from '@/components/ui/label'
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
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useListParams } from '@/hooks/use-list-params'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { FormField } from '@/components/ui/form-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { SubmitButton } from '@/components/ui/submit-button'
import { PatientPicker, type PickedPatient } from '@/components/patients/patient-picker'
import { Clock, Plus, Trash2, Bell, CheckCircle2, CalendarPlus } from 'lucide-react'
import { displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { statusLabel, statusOptions } from '@/lib/status'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { useCan } from '@/hooks/use-can'
import { useTrail } from '@/components/ui/trail'

interface WaitlistEntry {
  id: string
  patientId: string
  doctorId: string | null
  preferredDays: string[] | null
  preferredTime: string | null
  procedureId: string | null
  notes: string | null
  status: string
  notifiedAt: string | null
  bookedAt: string | null
  createdAt: string
  patient: {
    id: string
    patientId: string
    name: string
    phone: string
  } | null
  doctor: {
    id: string
    name: string
  } | null
}

interface Summary {
  active: number
  notified: number
  booked: number
}

interface Doctor {
  id: string
  firstName: string
  lastName: string
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const TIME_SLOTS = [
  { value: 'MORNING', label: 'Morning (before 12 pm)' },
  { value: 'AFTERNOON', label: 'Afternoon (12–5 pm)' },
  { value: 'EVENING', label: 'Evening (after 5 pm)' },
]
const TIME_LABEL: Record<string, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
}

/**
 * The statuses somebody filters by. Expired entries are not offered, as before.
 * "Still waiting" — on the list or offered a slot — is the default: an offered
 * patient has not been booked, and used to drop out of sight the moment the
 * slot was offered.
 */
const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Still waiting' },
  ...statusOptions('waitlist', ['ACTIVE', 'NOTIFIED', 'BOOKED', 'CANCELLED']),
]

/** Entries that can still be booked or removed. */
const isOpen = (status: string) => status === 'ACTIVE' || status === 'NOTIFIED'

export default function WaitlistPage() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const trail = useTrail('Waitlist')
  const canWrite = useCan('appointments:write') === true
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary>({ active: 0, notified: 0, booked: 0 })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  /**
   * Search, status and page in the address bar. The list opens on who is
   * still waiting; "All statuses" asks for every entry.
   */
  const list = useListParams({ defaults: { status: 'OPEN' } })
  const query = (() => {
    const params = list.apiParams()
    // `apiParams` leaves out a filter at its default, but the route reads no
    // status as "every status" — so the default is sent, and "all" is not.
    if (list.filters.status === 'all') params.delete('status')
    else params.set('status', list.filters.status)
    return params.toString()
  })()

  // Form state
  const [selectedPatient, setSelectedPatient] = useState<PickedPatient | null>(null)
  const [patientError, setPatientError] = useState<string | undefined>()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [notes, setNotes] = useState('')

  /** The newest request wins; an older answer arriving late is dropped. */
  const latestRequest = useRef(0)

  const fetchWaitlist = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const data = await readJson<{
        entries: WaitlistEntry[]
        total: number
        summary: Summary
      }>(await fetch(`/api/appointments/waitlist?${query}`))
      if (requestId !== latestRequest.current) return
      setEntries(data.entries)
      setTotal(data.total ?? data.entries.length)
      setSummary(data.summary)
    } catch (error) {
      console.error('Error fetching waitlist:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchWaitlist()
    // The query string is the whole question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Load doctors on mount. `/api/staff/doctors`, as every other booking screen
  // uses: the staff list needs `staff:read`, which the front desk — the people
  // who run the waitlist — does not hold, so the picker came back empty.
  useEffect(() => {
    fetch('/api/staff/doctors')
      .then((r) => r.json())
      .then((data) => setDoctors(data.doctors || []))
      .catch(() => {})
  }, [])

  const handleAdd = async () => {
    if (!selectedPatient) {
      setPatientError('Select a patient')
      toast(toastError('add to the waitlist', 'Check the highlighted fields.'))
      return
    }

    try {
      setAdding(true)
      await readJson(
        await fetch('/api/appointments/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId: selectedPatient.id,
            doctorId: selectedDoctor && selectedDoctor !== 'any' ? selectedDoctor : null,
            preferredDays: selectedDays.length > 0 ? selectedDays : null,
            preferredTime: selectedTime && selectedTime !== 'any' ? selectedTime : null,
            notes: notes || null,
          }),
        })
      )

      toast(toastSuccess('Added to the waitlist'))
      setDialogOpen(false)
      resetForm()
      fetchWaitlist()
    } catch (err) {
      toast(toastError('add to the waitlist', err))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (entry: WaitlistEntry) => {
    const name = entry.patient?.name ?? 'this patient'
    const ok = await confirm({
      title: `Remove ${name} from the waitlist?`,
      description: 'They will no longer be offered slots that come free.',
      confirmLabel: 'Remove from waitlist',
    })
    if (!ok) return
    try {
      await readJson(await fetch(`/api/appointments/waitlist?id=${entry.id}`, { method: 'DELETE' }))
      toast(toastSuccess('Removed from the waitlist'))
      fetchWaitlist()
    } catch (err) {
      toast(toastError(`remove ${name} from the waitlist`, err))
    }
  }

  const resetForm = () => {
    setSelectedPatient(null)
    setPatientError(undefined)
    setSelectedDoctor('')
    setSelectedDays([])
    setSelectedTime('')
    setNotes('')
  }

  const toggleDay = (day: string) => {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Manage patients waiting for appointment slots"
        actions={
          canWrite ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add to waitlist
            </Button>
          ) : undefined
        }
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Add to waitlist</DialogTitle>
            <DialogDescription>
              Add a patient to the waitlist for the next available slot
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <FormField label="Patient" required htmlFor="waitlist-patient" error={patientError}>
              {(control) => (
                <PatientPicker
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  aria-invalid={control['aria-invalid']}
                  value={selectedPatient}
                  onChange={(patient) => {
                    setSelectedPatient(patient)
                    if (patient) setPatientError(undefined)
                  }}
                />
              )}
            </FormField>

            {/* Doctor Preference */}
            <div className="space-y-2">
              <Label htmlFor="waitlist-doctor">Preferred doctor (optional)</Label>
              <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                <SelectTrigger id="waitlist-doctor">
                  <SelectValue placeholder="Any doctor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any doctor</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      Dr. {d.firstName} {d.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preferred Days */}
            <div className="space-y-2" role="group" aria-labelledby="waitlist-days-label">
              <p id="waitlist-days-label" className="text-sm font-medium">
                Preferred days (optional)
              </p>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((day) => (
                  <Button
                    key={day}
                    type="button"
                    variant={selectedDays.includes(day) ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7"
                    aria-pressed={selectedDays.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {day.charAt(0) + day.slice(1, 3).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Preferred Time */}
            <div className="space-y-2">
              <Label htmlFor="waitlist-time">Preferred time (optional)</Label>
              <Select value={selectedTime} onValueChange={setSelectedTime}>
                <SelectTrigger id="waitlist-time">
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any time</SelectItem>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot.value} value={slot.value}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="waitlist-notes">Notes (optional)</Label>
              <Textarea
                id="waitlist-notes"
                placeholder="Any additional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              type="button"
              onClick={handleAdd}
              busy={adding}
              busyLabel="Adding…"
              disabled={!selectedPatient}
            >
              Add to waitlist
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Waiting', value: summary.active, icon: Clock },
          { label: 'Notified', value: summary.notified, icon: Bell },
          { label: 'Booked', value: summary.booked, icon: CheckCircle2 },
        ].map((tile) => (
          <div
            key={tile.label}
            className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{tile.value}</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <tile.icon className="h-5 w-5" />
            </span>
          </div>
        ))}
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search the waitlist"
            placeholder="Search by name, ID or phone…"
          />
        }
        filters={
          <FilterSelect
            label="Status"
            plural="statuses"
            value={list.filters.status}
            onValueChange={(status) => list.setFilter('status', status)}
            options={STATUS_OPTIONS}
          />
        }
        active={{
          noun: 'waiting patients',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              // The default is "Still waiting", so only another choice is a filter.
              label: 'Status',
              value:
                list.filters.status === 'OPEN'
                  ? null
                  : list.filters.status === 'all'
                    ? 'All statuses'
                    : statusLabel('waitlist', list.filters.status),
              onClear: () => list.setFilter('status', 'OPEN'),
            },
          ],
        }}
      />

      {/* Waitlist Table */}
      <Card>
        <CardHeader>
          <CardTitle>Waitlist entries</CardTitle>
          <CardDescription>
            When an appointment is cancelled, the first patients whose preferences match are sent a
            text offering the slot and marked Notified. Book them from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor preference</TableHead>
                <TableHead>Preferred days</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={fetchWaitlist}
              empty={entries.length === 0}
              emptyIcon={Clock}
              emptyTitle="No waitlist entries"
              emptyDescription={
                list.isFiltered
                  ? 'Nobody on the waitlist matches these filters.'
                  : 'Add a patient here and they are offered a slot matching their preferences when one comes free.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'Add to waitlist' : undefined
              }
              onEmptyAction={
                list.isFiltered ? list.clear : canWrite ? () => setDialogOpen(true) : undefined
              }
            >
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div>
                      <p className="font-semibold">{entry.patient?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {[entry.patient?.patientId, formatPhone(entry.patient?.phone)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{entry.doctor?.name || 'Any'}</TableCell>
                  <TableCell>
                    {entry.preferredDays && entry.preferredDays.length > 0
                      ? entry.preferredDays
                          .map((d) => d.charAt(0) + d.slice(1, 3).toLowerCase())
                          .join(', ')
                      : 'Any'}
                  </TableCell>
                  <TableCell>
                    {entry.preferredTime
                      ? (TIME_LABEL[entry.preferredTime] ?? entry.preferredTime)
                      : 'Any'}
                  </TableCell>
                  <TableCell>
                    {/* When the slot was offered or taken, said under the status
                        it explains rather than among the row's buttons. */}
                    <div className="space-y-1">
                      <StatusBadge kind="waitlist" status={entry.status} />
                      {entry.notifiedAt && (
                        <span className="block text-xs text-muted-foreground">
                          Notified {displayDate(entry.notifiedAt)}
                        </span>
                      )}
                      {entry.bookedAt && (
                        <span className="block text-xs text-green-600 dark:text-green-400">
                          Booked {displayDate(entry.bookedAt)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{displayDate(entry.createdAt)}</TableCell>
                  <GridActionsCell>
                    {canWrite && isOpen(entry.status) && entry.patient && (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={trail.to(
                            `/appointments/new?${new URLSearchParams({
                              patientId: entry.patient.id,
                              waitlistId: entry.id,
                              ...(entry.doctor ? { doctorId: entry.doctor.id } : {}),
                            })}`
                          )}
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          Book
                        </Link>
                      </Button>
                    )}
                    {canWrite && isOpen(entry.status) && (
                      <IconTooltip label="Remove from the waitlist">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove from the waitlist"
                          onClick={() => handleRemove(entry)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </IconTooltip>
                    )}
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="waiting patients"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}

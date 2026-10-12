'use client'

import { useState, useEffect, useCallback } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { Input } from '@/components/ui/input'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { Clock, Plus, Trash2, Users, Bell, CheckCircle2, Loader2, Search } from 'lucide-react'
import { format } from 'date-fns'
import { displayDate } from '@/lib/dates'

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

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const TIME_SLOTS = [
  { value: 'MORNING', label: 'Morning (Before 12 PM)' },
  { value: 'AFTERNOON', label: 'Afternoon (12-5 PM)' },
  { value: 'EVENING', label: 'Evening (After 5 PM)' },
]

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  NOTIFIED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
  BOOKED: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  CANCELLED: 'bg-muted text-foreground',
  EXPIRED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
}

export default function WaitlistPage() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  // The route hands back the whole waiting list, so the paging is done here.
  const paged = usePagedRows(entries)
  const [summary, setSummary] = useState<Summary>({ active: 0, notified: 0, booked: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  // Form state
  const [patientSearch, setPatientSearch] = useState('')
  const debouncedPatientSearch = useDebouncedValue(patientSearch)
  const [patientResults, setPatientResults] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [searchingPatients, setSearchingPatients] = useState(false)
  const [doctors, setDoctors] = useState<any[]>([])
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [notes, setNotes] = useState('')

  const fetchWaitlist = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)

      const response = await fetch(`/api/appointments/waitlist?${params}`)
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setEntries(data.entries)
      setSummary(data.summary)
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load waitlist' })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, toast])

  useEffect(() => {
    fetchWaitlist()
  }, [fetchWaitlist])

  // Load doctors on mount. `/api/staff/doctors`, as every other booking screen
  // uses: the staff list needs `staff:read`, which the front desk — the people
  // who run the waitlist — does not hold, so the picker came back empty.
  useEffect(() => {
    fetch('/api/staff/doctors')
      .then((r) => r.json())
      .then((data) => setDoctors(data.doctors || []))
      .catch(() => {})
  }, [])

  /**
   * Patient search.
   *
   * The wait was a `setTimeout` of its own here; it is `useDebouncedValue` now,
   * which every other search box in the application uses. Clearing the timer on
   * cleanup covered a request that had not been sent yet but not one already in
   * flight, so a slow answer for a shorter term could still land last — hence
   * the `current` guard.
   */
  useEffect(() => {
    const term = debouncedPatientSearch.trim()
    if (term.length < 2) {
      setPatientResults([])
      return
    }

    let current = true
    setSearchingPatients(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(term)}&limit=5`)
        const data = await res.json()
        if (!current) return
        setPatientResults(data.patients || [])
      } catch {
        if (current) setPatientResults([])
      } finally {
        if (current) setSearchingPatients(false)
      }
    })()

    return () => {
      current = false
    }
  }, [debouncedPatientSearch])

  const handleAdd = async () => {
    if (!selectedPatient) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a patient' })
      return
    }

    try {
      setAdding(true)
      const response = await fetch('/api/appointments/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          doctorId: selectedDoctor || null,
          preferredDays: selectedDays.length > 0 ? selectedDays : null,
          preferredTime: selectedTime || null,
          notes: notes || null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to add')
      }

      toast({ title: 'Added to waitlist' })
      setDialogOpen(false)
      resetForm()
      fetchWaitlist()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message })
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (id: string) => {
    const ok = await confirm({
      title: 'Remove from waitlist?',
      description: 'Remove this patient from the waitlist?',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const response = await fetch(`/api/appointments/waitlist?id=${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to remove')
      toast({ title: 'Removed from waitlist' })
      fetchWaitlist()
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to remove' })
    }
  }

  const resetForm = () => {
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Waitlist</h1>
          <p className="text-muted-foreground">Manage patients waiting for appointment slots</p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add to Waitlist
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add to Waitlist</DialogTitle>
              <DialogDescription>
                Add a patient to the waitlist for the next available slot
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Patient Search */}
              <div className="space-y-2">
                <Label>Patient *</Label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-muted p-2 rounded">
                    <span className="text-sm font-medium">
                      {selectedPatient.firstName} {selectedPatient.lastName} (
                      {selectedPatient.patientId})
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedPatient(null)}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search patient by name or ID..."
                      className="pl-9"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                    />
                    {searchingPatients && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                    )}
                    {/*
                      A search that matched nothing used to render nothing at
                      all, which on a box with a spinner in it reads as "still
                      looking" — so the answer "there is no such patient" was
                      indistinguishable from no answer yet.
                    */}
                    {debouncedPatientSearch.trim().length >= 2 && !searchingPatients && (
                      <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {patientResults.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">
                            No patients found for &ldquo;{debouncedPatientSearch.trim()}&rdquo;
                          </p>
                        ) : (
                          patientResults.map((p: any) => (
                            <button
                              key={p.id}
                              className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                              onClick={() => {
                                setSelectedPatient(p)
                                setPatientSearch('')
                                setPatientResults([])
                              }}
                            >
                              {p.firstName} {p.lastName} ({p.patientId})
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Doctor Preference */}
              <div className="space-y-2">
                <Label>Preferred Doctor (optional)</Label>
                <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any doctor</SelectItem>
                    {doctors.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        Dr. {d.firstName} {d.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Preferred Days */}
              <div className="space-y-2">
                <Label>Preferred Days (optional)</Label>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((day) => (
                    <Button
                      key={day}
                      type="button"
                      variant={selectedDays.includes(day) ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => toggleDay(day)}
                    >
                      {day.slice(0, 3)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Preferred Time */}
              <div className="space-y-2">
                <Label>Preferred Time (optional)</Label>
                <Select value={selectedTime} onValueChange={setSelectedTime}>
                  <SelectTrigger>
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
                <Label>Notes (optional)</Label>
                <Textarea
                  placeholder="Any additional notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={adding || !selectedPatient}>
                {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add to Waitlist
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.active}</p>
                <p className="text-sm text-muted-foreground">Waiting</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-50 dark:bg-yellow-950/30">
                <Bell className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.notified}</p>
                <p className="text-sm text-muted-foreground">Notified</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/30">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.booked}</p>
                <p className="text-sm text-muted-foreground">Booked</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['ACTIVE', 'NOTIFIED', 'BOOKED', 'CANCELLED'].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {/* Waitlist Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Users className="h-5 w-5 inline mr-2" />
            Waitlist Entries
          </CardTitle>
          <CardDescription>
            Patients are automatically notified when matching slots open up
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor Preference</TableHead>
                <TableHead>Preferred Days</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              empty={entries.length === 0}
              emptyIcon={Clock}
              emptyTitle="No waitlist entries"
              emptyDescription="Add a patient here and they are told as soon as a slot matching their preferences opens up."
            >
              {paged.rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{entry.patient?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.patient?.patientId} | {entry.patient?.phone}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{entry.doctor?.name || 'Any'}</TableCell>
                  <TableCell>
                    {entry.preferredDays && (entry.preferredDays as string[]).length > 0
                      ? (entry.preferredDays as string[]).map((d) => d.slice(0, 3)).join(', ')
                      : 'Any'}
                  </TableCell>
                  <TableCell>{entry.preferredTime || 'Any'}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[entry.status] || ''}>{entry.status}</Badge>
                  </TableCell>
                  <TableCell>{displayDate(entry.createdAt)}</TableCell>
                  <GridActionsCell>
                    {entry.status === 'ACTIVE' && (
                      <IconTooltip label="Remove from the waitlist">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove from the waitlist"
                          onClick={() => handleRemove(entry.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </IconTooltip>
                    )}
                    {entry.notifiedAt && (
                      <span className="text-xs text-muted-foreground block">
                        Notified {displayDate(entry.notifiedAt)}
                      </span>
                    )}
                    {entry.bookedAt && (
                      <span className="text-xs text-green-600 block dark:text-green-400">
                        Booked {displayDate(entry.bookedAt)}
                      </span>
                    )}
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="waiting patients"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}

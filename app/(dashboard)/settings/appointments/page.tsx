'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { IconTooltip } from '@/components/ui/icon-action'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { BackLink, useTrail } from '@/components/ui/trail'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { displayDate } from '@/lib/dates'
import { DEFAULT_APPOINTMENT_SETTINGS } from '@/lib/appointment-settings'
import { Plus, Save, Trash2 } from 'lucide-react'

/**
 * What the form shows for a setting the clinic has never saved: the server's
 * own defaults, the ones the book is already running on. The page kept a set
 * of its own — a 10-minute buffer and a lunch hour the server does not have —
 * so saving the page unchanged turned both on (bug report 16 Oct, finding 20).
 * No lunch break and no booking limit are empty fields.
 */
const FORM_DEFAULTS = Object.fromEntries(
  Object.entries(DEFAULT_APPOINTMENT_SETTINGS).map(([key, value]) => [key, value?.toString() ?? ''])
) as Record<keyof typeof DEFAULT_APPOINTMENT_SETTINGS, string>

interface Holiday {
  id: string
  name: string
  date: string
}

export default function AppointmentSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Appointment settings')
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useFormGuard(saving)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '' })
  const [holidayErrors, setHolidayErrors] = useState<{ name?: string; date?: string }>({})
  const [addingHoliday, setAddingHoliday] = useState(false)

  // FR-004: `doubleBookingPolicy` BLOCK refuses a clashing booking, WARN
  // records it and flags it.
  const [settings, setSettings] = useState(FORM_DEFAULTS)

  // The settings are what the page edits, so the page waits for them: shown
  // before they arrive, the defaults could be saved over the clinic's own.
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const result = await readJson<{ success?: boolean; data?: { key: string; value: string }[] }>(
        await fetch('/api/settings?category=appointments')
      )

      if (result.success && result.data) {
        const settingsMap: Record<string, string> = {}
        result.data.forEach((s) => {
          const key = s.key.replace('appointments.', '')
          settingsMap[key] = s.value
        })

        setSettings((prev) => ({ ...prev, ...settingsMap }))
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchHolidays = useCallback(async () => {
    try {
      const currentYear = new Date().getFullYear()
      const response = await fetch(`/api/settings/holidays?year=${currentYear}`)
      const result = await response.json()

      if (result.success) {
        setHolidays(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch holidays:', error)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings()
    fetchHolidays()
  }, [fetchSettings, fetchHolidays])

  const handleSaveSettings = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setSaving(true)
    try {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key: `appointments.${key}`,
        value: value.toString(),
        category: 'appointments',
      }))

      await readJson(
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: settingsArray }),
        })
      )

      // The page stays put after a save, so the guard is told the work is safe.
      formRef.reset()
      toast(toastSuccess('Appointment settings saved'))
    } catch (error) {
      toast(toastError('save the appointment settings', error))
    } finally {
      setSaving(false)
    }
  }

  const handleAddHoliday = async () => {
    const found: { name?: string; date?: string } = {}
    if (!newHoliday.name.trim()) found.name = 'Enter the holiday’s name.'
    if (!newHoliday.date) found.date = 'Choose the date.'
    setHolidayErrors(found)
    if (found.name || found.date) {
      toast(toastError('add the holiday', 'Check the highlighted fields.'))
      document.getElementById(found.name ? 'holiday-name' : 'holiday-date')?.focus()
      return
    }

    setAddingHoliday(true)
    try {
      // The server says why: a date already taken by another holiday names it.
      await readJson(
        await fetch('/api/settings/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newHoliday.name,
            // The date input's own `YYYY-MM-DD`: a holiday is a calendar day,
            // and turning it into an instant here could move it a day.
            date: newHoliday.date,
          }),
        })
      )

      toast(toastSuccess('Holiday added', `${newHoliday.name} on ${displayDate(newHoliday.date)}`))
      setNewHoliday({ name: '', date: '' })
      fetchHolidays()
    } catch (error) {
      toast(toastError(`add holiday “${newHoliday.name}”`, error))
    } finally {
      setAddingHoliday(false)
    }
  }

  const handleDeleteHoliday = async (holiday: Holiday) => {
    const ok = await confirm({
      title: `Delete holiday “${holiday.name}”?`,
      description: `Appointments can be booked on ${displayDate(holiday.date)} again. Appointments already booked are not affected.`,
      confirmLabel: 'Delete holiday',
    })
    if (!ok) return

    try {
      await readJson(
        await fetch(`/api/settings/holidays?id=${holiday.id}`, {
          method: 'DELETE',
        })
      )

      toast(toastSuccess('Holiday deleted'))
      fetchHolidays()
    } catch (error) {
      toast(toastError(`delete holiday “${holiday.name}”`, error))
    }
  }

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Appointment settings"
      description="Configure appointment scheduling and timing"
    />
  )

  if (loading) {
    return <PageSkeleton variant="form" />
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {header}
        <LoadFailed what="the appointment settings" onRetry={fetchSettings} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {header}

      <form ref={formRef} className="space-y-6" onSubmit={handleSaveSettings} noValidate>
        {/* Slot Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Time slot configuration</CardTitle>
            <CardDescription>
              How often the appointment book offers a time, and how long to leave clear afterwards
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Offer a slot every (minutes)"
                htmlFor="slotDuration"
                hint="The spacing of the times offered, not the length of an appointment — the desk still chooses that per booking. At 15, the book offers 09:00, 09:15, 09:30."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={5}
                    max={120}
                    value={settings.slotDuration}
                    onChange={(e) => setSettings({ ...settings, slotDuration: e.target.value })}
                  />
                )}
              </FormField>

              <FormField
                label="Leave clear afterwards (minutes)"
                htmlFor="bufferTime"
                hint="Turning the chair round and writing the note. No time is offered inside this gap after an appointment."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={0}
                    max={60}
                    value={settings.bufferTime}
                    onChange={(e) => setSettings({ ...settings, bufferTime: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/*
          Opening hours are not here.

          This card used to offer one clinic-wide start and end time, which
          duplicated `Hospital.workingHours` — the per-weekday schedule on
          Settings → Clinic that every slot query actually reads. Two screens
          setting one thing is how a clinic ends up with a book that disagrees
          with its own front door, so the flat pair was removed rather than
          wired into a second source of truth. The lunch break stays, because
          nothing else offers one.
        */}
        <Card>
          <CardHeader>
            <CardTitle>Lunch break</CardTitle>
            <CardDescription>
              No appointment is offered during this. Opening hours are set per weekday at{' '}
              <Link href="/settings/clinic" className="underline hover:text-foreground">
                Settings → Clinic
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Lunch break start" htmlFor="lunchBreakStart">
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={settings.lunchBreakStart}
                    onChange={(e) => setSettings({ ...settings, lunchBreakStart: e.target.value })}
                  />
                )}
              </FormField>

              <FormField label="Lunch break end" htmlFor="lunchBreakEnd">
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={settings.lunchBreakEnd}
                    onChange={(e) => setSettings({ ...settings, lunchBreakEnd: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Booking Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Booking settings</CardTitle>
            <CardDescription>Configure booking restrictions and reminders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Maximum advance booking (days)"
                htmlFor="maxAdvanceBookingDays"
                hint="How far in advance appointments can be booked. Leave empty for no limit."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={settings.maxAdvanceBookingDays}
                    onChange={(e) =>
                      setSettings({ ...settings, maxAdvanceBookingDays: e.target.value })
                    }
                  />
                )}
              </FormField>

              <FormField
                label="Reminder time (hours before)"
                htmlFor="reminderHoursBefore"
                hint="When to send appointment reminders"
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={settings.reminderHoursBefore}
                    onChange={(e) =>
                      setSettings({ ...settings, reminderHoursBefore: e.target.value })
                    }
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Double-booking policy — FR-004 "beyond configured rules" */}
        <Card>
          <CardHeader>
            <CardTitle>Double booking</CardTitle>
            <CardDescription>
              What happens when a booking overlaps one the dentist already has
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="doubleBookingPolicy">When a clash is detected</Label>
            <Select
              value={settings.doubleBookingPolicy}
              onValueChange={(value) => setSettings({ ...settings, doubleBookingPolicy: value })}
            >
              <SelectTrigger id="doubleBookingPolicy" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOCK">Prevent the booking</SelectItem>
                <SelectItem value="WARN">Allow it, but warn the user</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-2">
              Patients booking through the website or portal are always prevented, whichever option
              is selected here.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <SubmitButton busy={saving} busyLabel="Saving…" icon={Save} size="lg">
            Save changes
          </SubmitButton>
        </div>
      </form>

      {/*
        Holidays are saved one at a time, as they are added or deleted, so they
        sit outside the form: their fields are not part of "Save changes" and
        typing one is not unsaved work on the settings above.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Holiday calendar</CardTitle>
          <CardDescription>Manage clinic holidays and closures</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border rounded-lg p-4 bg-muted/50">
            <h4 className="font-semibold mb-3">Add a holiday</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
              <FormField label="Name" htmlFor="holiday-name" required error={holidayErrors.name}>
                {(control) => (
                  <Input
                    {...control}
                    placeholder="Eid ul-Fitr"
                    value={newHoliday.name}
                    onChange={(e) => {
                      setNewHoliday({ ...newHoliday, name: e.target.value })
                      if (holidayErrors.name)
                        setHolidayErrors({ ...holidayErrors, name: undefined })
                    }}
                  />
                )}
              </FormField>
              <FormField label="Date" htmlFor="holiday-date" required error={holidayErrors.date}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={newHoliday.date}
                    onChange={(e) => {
                      setNewHoliday({ ...newHoliday, date: e.target.value })
                      if (holidayErrors.date)
                        setHolidayErrors({ ...holidayErrors, date: undefined })
                    }}
                  />
                )}
              </FormField>
              <div className="md:pt-8">
                {/* An add-row button inside the card, not the page's create
                    action, so it says what it adds rather than "New holiday". */}
                <SubmitButton
                  type="button"
                  busy={addingHoliday}
                  busyLabel="Adding…"
                  icon={Plus}
                  onClick={handleAddHoliday}
                  className="w-full"
                >
                  Add holiday
                </SubmitButton>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold">Upcoming holidays</h4>
            {holidays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No holidays configured</p>
            ) : (
              <div className="space-y-2">
                {holidays.map((holiday) => (
                  <div
                    key={holiday.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{holiday.name}</p>
                      <p className="text-sm text-muted-foreground">{displayDate(holiday.date)}</p>
                    </div>
                    <IconTooltip label="Delete holiday">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete holiday “${holiday.name}”`}
                        onClick={() => handleDeleteHoliday(holiday)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </IconTooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Calendar, Clock, Plus, Trash2, Save, Armchair } from 'lucide-react'
import { format } from 'date-fns'

export default function AppointmentSettingsPage() {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [holidays, setHolidays] = useState<any[]>([])
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '' })
  const [chairs, setChairs] = useState<any[]>([])
  const [newChair, setNewChair] = useState({ name: '', room: '' })

  const [settings, setSettings] = useState({
    slotDuration: '30',
    bufferTime: '10',
    startTime: '09:00',
    endTime: '20:00',
    lunchBreakStart: '13:00',
    lunchBreakEnd: '14:00',
    maxAdvanceBookingDays: '30',
    reminderHoursBefore: '24',
    // FR-004: BLOCK refuses a clashing booking, WARN records it and flags it.
    doubleBookingPolicy: 'BLOCK',
  })

  useEffect(() => {
    fetchSettings()
    fetchHolidays()
    fetchChairs()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings?category=appointments')
      const result = await response.json()

      if (result.success && result.data) {
        const settingsMap: any = {}
        result.data.forEach((s: any) => {
          const key = s.key.replace('appointments.', '')
          settingsMap[key] = s.value
        })

        setSettings((prev) => ({ ...prev, ...settingsMap }))
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  const fetchHolidays = async () => {
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
  }

  const fetchChairs = async () => {
    try {
      const response = await fetch('/api/chairs?includeInactive=true')
      const result = await response.json()
      if (result.success) setChairs(result.data)
    } catch (error) {
      console.error('Failed to fetch chairs:', error)
    }
  }

  const handleAddChair = async () => {
    if (!newChair.name.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a chair name',
        variant: 'destructive',
      })
      return
    }

    try {
      const response = await fetch('/api/chairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newChair.name.trim(),
          room: newChair.room.trim() || null,
          sortOrder: chairs.length,
        }),
      })
      const result = await response.json()

      if (!response.ok) throw new Error(result.error || 'Failed to add chair')

      toast({ title: 'Success', description: `${newChair.name} added` })
      setNewChair({ name: '', room: '' })
      fetchChairs()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    }
  }

  const handleToggleChair = async (id: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/chairs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!response.ok) throw new Error('Failed to update chair')
      fetchChairs()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    }
  }

  const handleDeleteChair = async (id: string) => {
    try {
      const response = await fetch(`/api/chairs/${id}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to delete chair')

      // A chair with appointments against it is retired, not removed.
      toast({
        title: result.deactivated ? 'Taken out of service' : 'Deleted',
        description: result.message || 'Chair removed',
      })
      fetchChairs()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key: `appointments.${key}`,
        value: value.toString(),
        category: 'appointments',
      }))

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsArray }),
      })

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Appointment settings saved successfully',
        })
      } else {
        throw new Error('Failed to save settings')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleAddHoliday = async () => {
    if (!newHoliday.name || !newHoliday.date) {
      toast({
        title: 'Error',
        description: 'Please enter holiday name and date',
        variant: 'destructive',
      })
      return
    }

    try {
      const response = await fetch('/api/settings/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newHoliday.name,
          date: new Date(newHoliday.date).toISOString(),
        }),
      })

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Holiday added successfully',
        })
        setNewHoliday({ name: '', date: '' })
        fetchHolidays()
      } else {
        throw new Error('Failed to add holiday')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const handleDeleteHoliday = async (id: string) => {
    try {
      const response = await fetch(`/api/settings/holidays?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Holiday deleted successfully',
        })
        fetchHolidays()
      } else {
        throw new Error('Failed to delete holiday')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Calendar className="w-8 h-8" />
          Appointment Settings
        </h1>
        <p className="text-muted-foreground">Configure appointment scheduling and timing</p>
      </div>

      <div className="space-y-6">
        {/* Slot Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Time Slot Configuration</CardTitle>
            <CardDescription>Set default appointment duration and buffer time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="slotDuration">Default Slot Duration (minutes)</Label>
                <Input
                  id="slotDuration"
                  type="number"
                  value={settings.slotDuration}
                  onChange={(e) => setSettings({ ...settings, slotDuration: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="bufferTime">Buffer Time Between Appointments (minutes)</Label>
                <Input
                  id="bufferTime"
                  type="number"
                  value={settings.bufferTime}
                  onChange={(e) => setSettings({ ...settings, bufferTime: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Working Hours */}
        <Card>
          <CardHeader>
            <CardTitle>Working Hours</CardTitle>
            <CardDescription>Set clinic operating hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startTime">Clinic Start Time</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={settings.startTime}
                  onChange={(e) => setSettings({ ...settings, startTime: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="endTime">Clinic End Time</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={settings.endTime}
                  onChange={(e) => setSettings({ ...settings, endTime: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="lunchBreakStart">Lunch Break Start</Label>
                <Input
                  id="lunchBreakStart"
                  type="time"
                  value={settings.lunchBreakStart}
                  onChange={(e) => setSettings({ ...settings, lunchBreakStart: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="lunchBreakEnd">Lunch Break End</Label>
                <Input
                  id="lunchBreakEnd"
                  type="time"
                  value={settings.lunchBreakEnd}
                  onChange={(e) => setSettings({ ...settings, lunchBreakEnd: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Booking Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Booking Settings</CardTitle>
            <CardDescription>Configure booking restrictions and reminders</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="maxAdvanceBookingDays">Maximum Advance Booking (days)</Label>
                <Input
                  id="maxAdvanceBookingDays"
                  type="number"
                  value={settings.maxAdvanceBookingDays}
                  onChange={(e) =>
                    setSettings({ ...settings, maxAdvanceBookingDays: e.target.value })
                  }
                />
                <p className="text-sm text-muted-foreground mt-1">
                  How far in advance patients can book appointments
                </p>
              </div>

              <div>
                <Label htmlFor="reminderHoursBefore">Reminder Time (hours before)</Label>
                <Input
                  id="reminderHoursBefore"
                  type="number"
                  value={settings.reminderHoursBefore}
                  onChange={(e) =>
                    setSettings({ ...settings, reminderHoursBefore: e.target.value })
                  }
                />
                <p className="text-sm text-muted-foreground mt-1">
                  When to send appointment reminders
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chairs / Operatories — FR-025 master data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Armchair className="w-5 h-5" />
              Chairs &amp; Operatories
            </CardTitle>
            <CardDescription>
              The chairs patients can be booked into. Two appointments cannot occupy the same chair
              at the same time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Chair name (e.g. Chair 1, Operatory A)"
                value={newChair.name}
                onChange={(e) => setNewChair({ ...newChair, name: e.target.value })}
              />
              <Input
                placeholder="Room (optional)"
                value={newChair.room}
                onChange={(e) => setNewChair({ ...newChair, room: e.target.value })}
              />
              <Button onClick={handleAddChair}>
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>

            {chairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No chairs configured yet. Until one is added, appointments cannot be assigned a
                chair.
              </p>
            ) : (
              <div className="space-y-2">
                {chairs.map((chair) => (
                  <div
                    key={chair.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{chair.name}</p>
                      {chair.room && <p className="text-sm text-muted-foreground">{chair.room}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={chair.isActive}
                          onCheckedChange={(checked) => handleToggleChair(chair.id, checked)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {chair.isActive ? 'In service' : 'Out of service'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteChair(chair.id)}
                        aria-label={`Remove ${chair.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Double-booking policy — FR-004 "beyond configured rules" */}
        <Card>
          <CardHeader>
            <CardTitle>Double Booking</CardTitle>
            <CardDescription>
              What happens when a booking overlaps one the doctor or chair already has
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

        {/* Holidays */}
        <Card>
          <CardHeader>
            <CardTitle>Holiday Calendar</CardTitle>
            <CardDescription>Manage clinic holidays and closures</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Holiday Form */}
            <div className="border rounded-lg p-4 bg-muted/50">
              <h4 className="font-semibold mb-3">Add New Holiday</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <Input
                    placeholder="Holiday name"
                    value={newHoliday.name}
                    onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  />
                </div>
                <div>
                  <Input
                    type="date"
                    value={newHoliday.date}
                    onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  />
                </div>
                <div>
                  <Button onClick={handleAddHoliday} className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Holiday
                  </Button>
                </div>
              </div>
            </div>

            {/* Holidays List */}
            <div className="space-y-2">
              <h4 className="font-semibold">Upcoming Holidays</h4>
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
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(holiday.date), 'dd MMM yyyy')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteHoliday(holiday.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSaveSettings} disabled={saving} size="lg">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Appointment Settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { displayDate } from '@/lib/dates'

/**
 * Booking an appointment, as a patient sees it.
 *
 * One scrolling page rather than a wizard. A wizard hides how much is left and
 * loses everything on a back button, and this is a form somebody fills in on a
 * phone, one-handed, possibly in pain.
 *
 * It deliberately shares nothing with the staff appointment form. That form is
 * for somebody who books twenty a day and wants density; this is for somebody
 * who will use it once and wants to be sure they have not made a mistake.
 */

export interface Dentist {
  id: string
  name: string
  specialization: string | null
}

export interface BookingWindow {
  first: string
  last: string
  minimumNoticeHours: number
}

interface Slot {
  time: string
  available: boolean
}

interface Confirmation {
  reference: string
  date: string
  time: string
  doctor: string
}

/** `14:30` as `2:30 pm`, without pulling in a date library for four lines. */
function clockLabel(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`
}

export function BookingForm({
  slug,
  dentists,
  window: bookingWindow,
  clinicPhone,
}: {
  slug: string
  dentists: Dentist[]
  window: BookingWindow
  clinicPhone: string | null
}) {
  // One dentist means no choice to make, so it is made.
  const [doctorId, setDoctorId] = useState(dentists.length === 1 ? dentists[0].id : '')
  const [date, setDate] = useState(bookingWindow.first)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsState, setSlotsState] = useState<'idle' | 'loading' | 'closed' | 'ready'>('idle')
  const [closedReason, setClosedReason] = useState<string | null>(null)
  const [time, setTime] = useState('')

  /**
   * The clinic's next free day, asked for only when the chosen one is empty.
   *
   * `'looking'` while the request is out, `'none'` when the scan found nothing
   * inside the booking window, and `null` when there is no question to answer.
   */
  const [nextAvailable, setNextAvailable] = useState<
    { date: string; time: string } | 'looking' | 'none' | null
  >(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmation | null>(null)

  const loadSlots = useCallback(async () => {
    if (!doctorId || !date) return

    setSlotsState('loading')
    setTime('')
    setClosedReason(null)
    setNextAvailable(null)

    try {
      const response = await fetch(
        `/api/public/${slug}/slots?doctorId=${encodeURIComponent(doctorId)}&date=${date}`
      )
      const data = await response.json()

      if (!response.ok) {
        setSlots([])
        setSlotsState('closed')
        setClosedReason(data.error || 'Those times could not be loaded.')
        return
      }

      if (data.available === false) {
        setSlots([])
        setSlotsState('closed')
        setClosedReason(data.reason || 'The clinic is closed on this day.')
        return
      }

      setSlots(Array.isArray(data.slots) ? data.slots : [])
      setSlotsState('ready')
    } catch {
      setSlots([])
      setSlotsState('closed')
      setClosedReason('Those times could not be loaded. Please try again.')
    }
  }, [slug, doctorId, date])

  useEffect(() => {
    void loadSlots()
  }, [loadSlots])

  /**
   * When the chosen day turns out to be empty, ask where the next one is.
   *
   * Only then — the common case is a day with times on it, and that answer
   * costs nothing extra.
   */
  const dayIsEmpty =
    slotsState === 'closed' || (slotsState === 'ready' && !slots.some((slot) => slot.available))

  useEffect(() => {
    if (!doctorId || !date || !dayIsEmpty) return

    let current = true
    setNextAvailable('looking')
    ;(async () => {
      try {
        const response = await fetch(
          `/api/public/${slug}/next-available?doctorId=${encodeURIComponent(doctorId)}&from=${date}`
        )
        if (!current) return
        const data = await response.json()
        if (!current) return
        setNextAvailable(data?.nextAvailable ?? 'none')
      } catch {
        // No suggestion is a smaller failure than a wrong one; the day's own
        // message still stands on its own.
        if (current) setNextAvailable(null)
      }
    })()

    return () => {
      current = false
    }
  }, [slug, doctorId, date, dayIsEmpty])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const response = await fetch(`/api/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, doctorId, date, time, reason }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'That booking could not be made.')
        // The slot may have gone while the form was being filled in, which is
        // the most likely reason to be here, so the times are reloaded.
        void loadSlots()
        return
      }

      setConfirmed(data.appointment)
    } catch {
      setError('That booking could not be made. Please try again, or telephone the clinic.')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <div className="bg-background rounded-lg border p-6 shadow-sm" role="status">
        <h2 className="text-xl font-semibold">Your appointment is booked</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          We have sent these details to your phone. The clinic will telephone you to confirm.
        </p>

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4 border-b pb-3">
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="font-mono font-medium">{confirmed.reference}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b pb-3">
            <dt className="text-muted-foreground">When</dt>
            <dd className="font-medium">
              {displayDate(confirmed.date)} at {clockLabel(confirmed.time)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">With</dt>
            <dd className="font-medium">{confirmed.doctor}</dd>
          </div>
        </dl>

        {clinicPhone && (
          <p className="text-muted-foreground mt-6 text-sm">
            To change or cancel it, telephone{' '}
            <a className="text-foreground underline" href={`tel:${clinicPhone}`}>
              {clinicPhone}
            </a>
            .
          </p>
        )}
      </div>
    )
  }

  const available = slots.filter((slot) => slot.available)

  return (
    <form onSubmit={submit} className="bg-background space-y-8 rounded-lg border p-6 shadow-sm">
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">1. Who would you like to see?</legend>

        {dentists.length === 1 ? (
          <p className="text-muted-foreground text-sm">{dentists[0].name}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {dentists.map((dentist) => (
              <label
                key={dentist.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                  doctorId === dentist.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <input
                  type="radio"
                  name="doctorId"
                  value={dentist.id}
                  checked={doctorId === dentist.id}
                  onChange={() => setDoctorId(dentist.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{dentist.name}</span>
                  {dentist.specialization && (
                    <span className="text-muted-foreground block text-xs">
                      {dentist.specialization}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">2. Which day?</legend>
        <Label htmlFor="date" className="sr-only">
          Date
        </Label>
        <Input
          id="date"
          type="date"
          value={date}
          min={bookingWindow.first}
          max={bookingWindow.last}
          onChange={(e) => setDate(e.target.value)}
          className="max-w-xs"
          required
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">3. What time?</legend>

        {!doctorId && (
          <p className="text-muted-foreground text-sm">Choose a dentist to see their times.</p>
        )}

        {doctorId && slotsState === 'loading' && (
          <p className="text-muted-foreground text-sm">Loading times…</p>
        )}

        {/*
          A day with nothing on it used to end in "please try another", which
          on a phone means picking forward one day at a time until something
          appears. For a busy dentist that is a dozen taps, and the answer was
          knowable in one. The clinic is asked for its next free day instead.
        */}
        {doctorId && (slotsState === 'closed' || (slotsState === 'ready' && !available.length)) && (
          <div className="space-y-2 text-sm">
            <p>{slotsState === 'closed' ? closedReason : 'Nothing free on this day.'}</p>

            {nextAvailable === 'looking' && (
              <p className="text-muted-foreground">Looking for the next free day…</p>
            )}

            {nextAvailable && nextAvailable !== 'looking' && nextAvailable !== 'none' && (
              <button
                type="button"
                className="rounded-md border border-primary px-3 py-2 text-left font-medium text-primary hover:bg-primary/5"
                onClick={() => setDate(nextAvailable.date)}
              >
                Next free: {displayDate(nextAvailable.date)} from {clockLabel(nextAvailable.time)} —
                show these times
              </button>
            )}

            {nextAvailable === 'none' && (
              <p className="text-muted-foreground">
                Nothing free in the next few weeks.
                {clinicPhone ? ' Please telephone the clinic.' : ''}
              </p>
            )}

            {clinicPhone && (
              <p className="text-muted-foreground">
                If it is urgent, telephone{' '}
                <a className="text-foreground underline" href={`tel:${clinicPhone}`}>
                  {clinicPhone}
                </a>
                .
              </p>
            )}
          </div>
        )}

        {doctorId && slotsState === 'ready' && available.length > 0 && (
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            role="radiogroup"
            aria-label="Available times"
          >
            {available.map((slot) => (
              <button
                key={slot.time}
                type="button"
                role="radio"
                aria-checked={time === slot.time}
                onClick={() => setTime(slot.time)}
                className={`rounded-md border px-2 py-2 text-sm ${
                  time === slot.time
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {clockLabel(slot.time)}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">4. About you</legend>

        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            aria-describedby="phone-hint"
            required
          />
          <p id="phone-hint" className="text-muted-foreground text-xs">
            The clinic uses this to confirm your appointment.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason">What is the problem? (optional)</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <Button type="submit" className="w-full" disabled={submitting || !doctorId || !time}>
          {submitting ? 'Booking…' : 'Book this appointment'}
        </Button>
        {!time && doctorId && (
          <p className="text-muted-foreground text-center text-xs">Choose a time to continue.</p>
        )}
      </div>
    </form>
  )
}

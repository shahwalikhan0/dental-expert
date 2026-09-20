/**
 * The rules a patient books under.
 *
 * This is the one write in the application that nobody is signed in for, so
 * everything here is about what a stranger on a public page may do — which is
 * not the same as what a receptionist may do with fewer permissions.
 */
import { describe, it, expect, vi } from 'vitest'

import { DEFAULT_BOOKING, WINDOW_MESSAGES, bookableDays, windowRefusal } from '@/lib/booking/rules'
import { phoneKey, resolveSubject, subjectColumns } from '@/lib/booking/subject'

const now = new Date('2026-09-20T09:00:00Z')

describe('the booking window', () => {
  it('accepts a slot comfortably ahead', () => {
    expect(windowRefusal(new Date('2026-09-22T09:00:00Z'), DEFAULT_BOOKING, now)).toBeNull()
  })

  it('refuses a slot sooner than the notice period', () => {
    // Somebody booking a slot forty minutes from now is a person who will not
    // arrive in time and a dentist who has not been told.
    expect(windowRefusal(new Date('2026-09-20T09:40:00Z'), DEFAULT_BOOKING, now)).toBe('too_soon')
  })

  it('refuses a slot past the horizon', () => {
    // A public page with no horizon is a page where somebody books for 2031.
    expect(windowRefusal(new Date('2027-09-20T09:00:00Z'), DEFAULT_BOOKING, now)).toBe('too_far')
  })

  it('tells the two refusals apart in what it says', () => {
    // "Too soon, please telephone us" is an invitation to ring. "Not that far
    // ahead" is not, and offering the phone number there would be noise.
    expect(WINDOW_MESSAGES.too_soon(DEFAULT_BOOKING)).toMatch(/telephone/i)
    expect(WINDOW_MESSAGES.too_far(DEFAULT_BOOKING)).not.toMatch(/telephone/i)
  })

  it('offers a date range that starts after the notice period', () => {
    const isoDay = (at: Date) => at.toISOString().slice(0, 10)
    const days = bookableDays({ ...DEFAULT_BOOKING, minimumNoticeHours: 24 }, isoDay, now)

    expect(days.first).toBe('2026-09-21')
    expect(days.last).toBe('2026-11-19')
  })
})

describe('who the booking is for', () => {
  it('reads a number typed any of the ways people type it', () => {
    // A clinic's register holds all three spellings, because people typed them
    // in over years.
    expect(phoneKey('+92 300 1234567')).toBe('001234567')
    expect(phoneKey('0300-1234567')).toBe('001234567')
    expect(phoneKey('03001234567')).toBe('001234567')
  })

  function tx(patients: { id: string }[]) {
    return {
      patient: { findMany: vi.fn().mockResolvedValue(patients) },
      visitor: { create: vi.fn().mockResolvedValue({ id: 'vis-1' }) },
    } as never
  }

  it('attaches a known number to that patient', async () => {
    const subject = await resolveSubject(tx([{ id: 'pat-1' }]), {
      hospitalId: 'h1',
      name: 'Rabia Anwar',
      phone: '0300 1234308',
    })

    expect(subject).toMatchObject({ patientId: 'pat-1', isKnownPatient: true })
  })

  it('makes a visitor of an unknown number rather than refusing', async () => {
    // It used to answer "No patient account found with this phone number",
    // which refused the one person a clinic most wants to hear from and turned
    // a public endpoint into an oracle for who is a patient here.
    const client = tx([])
    const subject = await resolveSubject(client, {
      hospitalId: 'h1',
      name: 'Hamza Sheikh',
      phone: '0321 9998877',
    })

    expect(subject).toMatchObject({ visitorId: 'vis-1', isKnownPatient: false })
  })

  it('says on the visitor that it came from the website', async () => {
    // The walk-ins screen shows these beside visitors the desk created at the
    // counter, and they need different handling: nobody has met this one.
    const client = tx([])
    await resolveSubject(client, { hospitalId: 'h1', name: 'Hamza', phone: '03219998877' })

    expect(
      (client as never as { visitor: { create: ReturnType<typeof vi.fn> } }).visitor.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: expect.stringContaining('Booked online') }),
      })
    )
  })

  it('makes a visitor when a number matches two people', async () => {
    // A number shared by two family members matches neither. Guessing which
    // relative is coming in is worse than letting the desk ask.
    const subject = await resolveSubject(tx([{ id: 'pat-1' }, { id: 'pat-2' }]), {
      hospitalId: 'h1',
      name: 'Shared Number',
      phone: '03001234308',
    })

    expect(subject.isKnownPatient).toBe(false)
  })

  it('does not try to match a number too short to be one', async () => {
    const client = tx([])
    await resolveSubject(client, { hospitalId: 'h1', name: 'Short', phone: '12345' })

    expect(
      (client as never as { patient: { findMany: ReturnType<typeof vi.fn> } }).patient.findMany
    ).not.toHaveBeenCalled()
  })

  it('produces exactly one of the two columns', async () => {
    // The appointment belongs to a patient or a visitor and to exactly one of
    // them — there is a CHECK constraint saying so.
    const known = subjectColumns({ patientId: 'pat-1', isKnownPatient: true })
    expect(known).toEqual({ patientId: 'pat-1', visitorId: null })

    const unknown = subjectColumns({ visitorId: 'vis-1', isKnownPatient: false })
    expect(unknown).toEqual({ patientId: null, visitorId: 'vis-1' })
  })
})

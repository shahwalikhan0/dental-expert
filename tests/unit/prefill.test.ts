/**
 * Reading the record a screen was handed.
 *
 * The bug this exists to stop is not an exception — it is a form field that
 * stays empty. `/api/patients/:id` answers `{ success, patient }`, the booking
 * form read `.id` off that envelope, got `undefined`, and asked the
 * receptionist to search for the patient they had just clicked. Nothing threw,
 * nothing was logged, and the link looked like it worked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchHandedRecord, fetchHandedPatient } from '@/lib/prefill'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

function answers(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body })
}

describe('fetchHandedRecord', () => {
  it('unwraps the envelope the detail routes answer with', async () => {
    answers({ success: true, patient: { id: 'p1', firstName: 'Ayesha' } })
    const patient = await fetchHandedPatient<{ id: string; firstName: string }>('p1')
    expect(patient).toEqual({ id: 'p1', firstName: 'Ayesha' })
  })

  it('accepts a route that answers with the record and no wrapper', async () => {
    answers({ id: 'p1', firstName: 'Ayesha' })
    const patient = await fetchHandedPatient<{ id: string; firstName: string }>('p1')
    expect(patient?.id).toBe('p1')
  })

  it('asks the endpoint for that one record, not for a page of them', async () => {
    answers({ patient: { id: 'p1' } })
    await fetchHandedPatient('p1')
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/p1', { signal: undefined })
  })

  it('gives back null for a record that is not there', async () => {
    answers({ error: 'Patient not found' }, false)
    expect(await fetchHandedPatient('nope')).toBeNull()
  })

  it('gives back null when the clinician may not see that record', async () => {
    answers({ error: 'Out of scope' }, false)
    expect(await fetchHandedPatient('p1')).toBeNull()
  })

  it('gives back null rather than throwing when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await fetchHandedPatient('p1')).toBeNull()
  })

  it('gives back null for an envelope with no record in it', async () => {
    answers({ success: true })
    expect(await fetchHandedPatient('p1')).toBeNull()
  })

  it('rejects a record with no id, which is an envelope read the wrong way', async () => {
    answers({ success: true, patient: { firstName: 'Ayesha' } })
    expect(await fetchHandedPatient('p1')).toBeNull()
  })

  it('reads whatever the route calls the record', async () => {
    answers({ success: true, procedure: { id: 'proc1', name: 'Scaling' } })
    const procedure = await fetchHandedRecord<{ id: string; name: string }>(
      '/api/procedures/proc1',
      'procedure'
    )
    expect(procedure?.name).toBe('Scaling')
  })

  it('passes an abort signal through, for a screen that unmounts mid-flight', async () => {
    answers({ patient: { id: 'p1' } })
    const controller = new AbortController()
    await fetchHandedPatient('p1', controller.signal)
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/p1', { signal: controller.signal })
  })
})

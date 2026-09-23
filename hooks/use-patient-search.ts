'use client'

/**
 * Finding a patient, on the server.
 *
 * Three forms picked a patient by fetching `/api/patients?limit=100` once and
 * filtering that array in the browser. Both halves of that are wrong at the
 * size a real register reaches:
 *
 *   - the register is not a hundred records. Patient 101 onwards was not in
 *     the array, so searching for them showed "No patients found" — which is
 *     worse than an empty list, because it is a confident wrong answer about
 *     somebody who is sitting in the waiting room;
 *   - matching happened one column at a time, so "John Smith" matched nothing:
 *     neither the forename nor the surname contains both words. The route
 *     knows how to read a full name.
 *
 * The four forms that already searched the server each wrote their own copy of
 * the debounce, the stale-response guard and the render states. This is that,
 * once.
 *
 * An empty box still shows a list rather than nothing, because these forms
 * open onto the picker and an empty panel reads as broken. With no term it
 * asks for the first page — newest first, which is usually who the clinic is
 * dealing with today.
 */
import { useEffect, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

/** Below this a term matches most of the register, so it is not a search. */
const MIN_TERM = 2

/** An answer, and the term it answers. */
interface Answer<T> {
  term: string
  rows: T[]
  failed: boolean
}

export interface PatientSearch<T> {
  /** What is in the box. */
  term: string
  setTerm: (term: string) => void
  /** The term actually asked about — what a "nothing found" message should quote. */
  searchedFor: string
  results: T[]
  /** No answer for the current term yet. Not the same as "no such patient". */
  searching: boolean
  /** The request itself failed. An empty list here would be a lie. */
  failed: boolean
  /** Whether the box holds a term long enough to be a search. */
  isSearch: boolean
}

export function usePatientSearch<T>(limit = 10): PatientSearch<T> {
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term)
  const [answer, setAnswer] = useState<Answer<T> | null>(null)

  const searchedFor = debounced.trim()
  const isSearch = searchedFor.length >= MIN_TERM

  /**
   * Derived, not stored. A `setSearching(true)` at the top of the effect is
   * a synchronous setState on a render; keeping the term beside its answer
   * says the same thing without one, and cannot get out of step with it.
   */
  const searching = answer?.term !== searchedFor

  useEffect(() => {
    // Not cancelled on unmount alone: responses are not guaranteed to arrive
    // in the order they were asked for, and without this a slow reply for "Mu"
    // can land after — and overwrite — the reply for "Muhammad".
    let current = true

    const query = isSearch
      ? `search=${encodeURIComponent(searchedFor)}&limit=${limit}`
      : `limit=${limit}`

    ;(async () => {
      try {
        const response = await fetch(`/api/patients?${query}`)
        if (!current) return
        if (!response.ok) throw new Error('search failed')
        const data = await response.json()
        if (!current) return
        setAnswer({ term: searchedFor, rows: data.patients ?? [], failed: false })
      } catch {
        // Recorded rather than swallowed. A search that could not run must not
        // render as "no patients found" — that is the same confident wrong
        // answer this hook exists to stop.
        if (current) setAnswer({ term: searchedFor, rows: [], failed: true })
      }
    })()

    return () => {
      current = false
    }
  }, [searchedFor, isSearch, limit])

  return {
    term,
    setTerm,
    searchedFor,
    results: searching ? [] : (answer?.rows ?? []),
    searching,
    failed: !searching && (answer?.failed ?? false),
    isSearch,
  }
}

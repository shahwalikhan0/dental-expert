'use client'

/**
 * Searching a register or a catalogue on the server, for a picker.
 *
 * Generalised from `usePatientSearch`, which already did this properly for
 * patients while the drug catalogue had three copy-pasted effects of its own
 * (prescriptions, prescription templates, inventory items) — each with the
 * debounce, none with a failed state, one showing "no medication of that name"
 * before anybody had typed. Every picker now behaves the same way:
 *
 *   - **preload**: an empty box asks for the first page (newest, recent or
 *     alphabetical — whatever the endpoint's default order is, or what
 *     `params` asks for), so a picker opens onto options rather than onto an
 *     empty panel that reads as broken;
 *   - a term is sent only from `MIN_TERM` (2) characters, after the standard
 *     300 ms debounce. One character matches most of a register, so it is not
 *     a search; until the second character the preloaded page stays up;
 *   - a stale answer never overwrites a newer one;
 *   - a failed request is `failed`, never an empty list — "no such patient" is
 *     a confident wrong answer about somebody standing at the desk;
 *   - `total` is read from the response when the route reports one, so the
 *     picker can say "Showing 10 of 240 — keep typing to narrow".
 *
 * The list routes answer in two shapes, and both are read:
 *
 *   { patients: [...], pagination: { total } }          /api/patients, /api/procedures
 *   { success, data: [...], pagination: { total } }     /api/medications, /api/inventory/*
 *   { products: [...] }                                 /api/billing/products (no total)
 *
 * The rows are taken from `data`, or else from the first array property; the
 * total from `pagination.total`, or a top-level `total`.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

/** Below this a term matches most of a register, so it is not a search. */
export const MIN_TERM = 2

/** How many rows a picker asks for. Enough to scan, few enough to read. */
export const PICKER_LIMIT = 10

export interface CatalogueSearchOptions<Row, Item = Row> {
  /** The list route, without a query: `/api/medications`. */
  endpoint: string
  /**
   * Fixed query parameters sent with every request: `{ active: 'true',
   * sort: 'name' }`. Values that are `undefined`, `null` or `''` are left out.
   * Compared by value, so an inline object literal does not refetch on every
   * render.
   */
  params?: Record<string, string | number | boolean | null | undefined>
  /** Turn a raw row into what the caller wants. Defaults to the row itself. */
  map?: (row: Row) => Item
  /** Rows per request. Default `PICKER_LIMIT` (10). */
  limit?: number
  /**
   * Load the first page while the box is empty. Default true. Turn off only
   * where listing anything unasked would be wrong (none today).
   */
  preload?: boolean
  /** The query parameter the route reads the term from. Default `search`. */
  searchParam?: string
  /** Do nothing at all — e.g. until the picker is first opened. Default true. */
  enabled?: boolean
}

export interface CatalogueSearch<Item> {
  /** What is in the box. */
  term: string
  setTerm: (term: string) => void
  /** The term actually asked about — what a "nothing found" message should quote. */
  searchedFor: string
  /** The rows for the current question: a search, or the preloaded first page. */
  results: Item[]
  /** How many rows match in all, when the route says; otherwise null. */
  total: number | null
  /** No answer for the current question yet. Not the same as "nothing matches". */
  searching: boolean
  /** The request itself failed. An empty list here would be a lie. */
  failed: boolean
  /** Whether the box holds a term long enough to be a search. */
  isSearch: boolean
  /** Whether `results` is the preloaded page rather than a search. */
  isPreload: boolean
  /** Ask again — after a failure, or after the caller added a record. */
  retry: () => void
}

/** An answer, and the question it answers. */
interface Answer<T> {
  key: string
  rows: T[]
  total: number | null
  failed: boolean
}

/**
 * The rows and the total from any list route's response body.
 * Exported for tests and for callers that fetch once themselves.
 */
export function readListResponse(body: unknown): { rows: unknown[]; total: number | null } {
  if (Array.isArray(body)) return { rows: body, total: body.length }
  if (!body || typeof body !== 'object') return { rows: [], total: null }
  const record = body as Record<string, unknown>

  let rows: unknown[] = []
  if (Array.isArray(record.data)) rows = record.data
  else {
    const firstArray = Object.values(record).find(Array.isArray)
    if (firstArray) rows = firstArray as unknown[]
  }

  const pagination = record.pagination as { total?: unknown } | undefined
  const rawTotal = pagination?.total ?? record.total
  const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) ? rawTotal : null
  return { rows, total }
}

/** The query string for one request. Exported for tests. */
export function catalogueQuery(
  params: CatalogueSearchOptions<unknown>['params'],
  term: string,
  limit: number,
  searchParam = 'search'
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  if (term) query.set(searchParam, term)
  query.set('limit', String(limit))
  return query.toString()
}

export function useCatalogueSearch<Row = unknown, Item = Row>({
  endpoint,
  params,
  map,
  limit = PICKER_LIMIT,
  preload = true,
  searchParam = 'search',
  enabled = true,
}: CatalogueSearchOptions<Row, Item>): CatalogueSearch<Item> {
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term)
  const [answer, setAnswer] = useState<Answer<Row> | null>(null)
  const [attempt, setAttempt] = useState(0)

  const searchedFor = debounced.trim()
  const isSearch = searchedFor.length >= MIN_TERM
  // One character is not a search: the preloaded page stays up rather than
  // the panel blanking while somebody is mid-word.
  const asked = isSearch ? searchedFor : ''
  const wanted = isSearch || preload

  // By value, so `params={{ active: 'true' }}` written inline is one question.
  const paramsKey = JSON.stringify(params ?? {})
  const query = useMemo(
    () => catalogueQuery(JSON.parse(paramsKey), asked, limit, searchParam),
    [paramsKey, asked, limit, searchParam]
  )
  const key = `${endpoint}?${query}#${attempt}`

  /**
   * Derived, not stored: the answer carries the question it answers, so
   * "searching" cannot get out of step with what is on screen.
   */
  const active = enabled && wanted
  const searching = active && answer?.key !== key

  useEffect(() => {
    if (!active) return
    // Responses are not guaranteed to arrive in the order they were asked
    // for; without this a slow reply for "Mu" lands after — and overwrites —
    // the reply for "Muhammad".
    let current = true
    ;(async () => {
      try {
        const response = await fetch(`${endpoint}?${query}`)
        if (!current) return
        if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`)
        const body = await response.json()
        if (!current) return
        const { rows, total } = readListResponse(body)
        setAnswer({ key, rows: rows as Row[], total, failed: false })
      } catch {
        // Recorded, not swallowed: a search that could not run must not render
        // as "nothing matches".
        if (current) setAnswer({ key, rows: [], total: null, failed: true })
      }
    })()
    return () => {
      current = false
    }
  }, [active, endpoint, query, key])

  const settled = active && !searching ? answer : null
  const results = useMemo(
    () => (settled ? (map ? settled.rows.map(map) : (settled.rows as unknown as Item[])) : []),
    // `map` is usually an inline arrow; the rows are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settled]
  )

  return {
    term,
    setTerm,
    searchedFor,
    results,
    total: settled?.total ?? null,
    searching,
    failed: settled?.failed ?? false,
    isSearch,
    isPreload: active && !isSearch,
    retry: () => setAttempt((n) => n + 1),
  }
}

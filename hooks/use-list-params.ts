'use client'

/**
 * A list screen's search, filters and page, kept in the address bar.
 *
 * No list in this application remembered anything. Search for a patient, open
 * them, press "Back to Patients" — and the search, the status filter and the
 * page were gone, because they lived in `useState` and the list had been
 * unmounted. The same went for refresh, and for sending a colleague "the
 * overdue invoices from last week": there was no address for that view.
 *
 * Keeping the state in the URL fixes all three at once, and lets this hook own
 * the bookkeeping every list screen repeated:
 *
 *   - the search box updates at once, and the URL (and so the fetch) 300 ms
 *     after the last keystroke — the standard debounce;
 *   - any change to the search or a filter goes back to page 1. Searching from
 *     page three used to ask for page three *of the results*, usually empty,
 *     so the screen said there was nothing to find;
 *   - a value at its default is left out of the URL, so a list with nothing
 *     applied has a clean address;
 *   - `router.replace`, not `push`: typing a name should not leave one history
 *     entry per pause, and Back should leave the list, not undo a filter.
 *     Other parameters on the URL (the trail, a `?patientId=`) are kept.
 *
 *   const list = useListParams({
 *     defaults: { status: 'all', from: '', to: '', overdue: false },
 *   })
 *   list.search / list.setSearch       the box
 *   list.query                         the settled term — send this
 *   list.filters.status / list.setFilter('status', 'PAID')
 *   list.page / list.setPage / list.pageSize / list.setPageSize
 *   list.clear()                       search and every filter back to default
 *   list.apiParams({ rename: { from: 'dateFrom' } })  for the fetch
 *
 * Filter values are typed from `defaults`: a string default gives a string, a
 * number a number, a boolean a boolean (written to the URL as `true`).
 *
 * **Suspense:** this reads `useSearchParams`. Every route under
 * `app/(dashboard)` is rendered per request — its layout reads the session —
 * so no Suspense boundary is needed there. A page anywhere that is statically
 * prerendered (the portal, the auth pages, `app/docs`) must render the
 * component using this hook inside `<Suspense>`, or `next build` fails with
 * "useSearchParams() should be wrapped in a suspense boundary".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import {
  applyListPatch,
  parseListParams,
  type FilterDefaults,
  type ListParamsConfig,
  type Widen,
} from '@/lib/list-params'

export {
  DEFAULT_PAGE_SIZE,
  applyListPatch,
  parseFilterValue,
  parseListParams,
  type FilterDefaults,
  type FilterValue,
  type ListParamsConfig,
  type ListState,
} from '@/lib/list-params'

export interface ListParams<F extends FilterDefaults> {
  /** What is in the search box, updated on every keystroke. */
  search: string
  setSearch: (value: string) => void
  /** The settled, trimmed search term — what the URL holds and the fetch sends. */
  query: string
  filters: F
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void
  /** Several filters at once (a date range), as one history entry and one fetch. */
  setFilters: (patch: Partial<F>) => void
  /** One-based. */
  page: number
  setPage: (page: number) => void
  pageSize: number
  /** Also goes back to page 1. */
  setPageSize: (size: number) => void
  /** Whether the search or any filter is away from its default. */
  isFiltered: boolean
  /** Search and every filter back to default, page 1. Page size is kept. */
  clear: () => void
  /**
   * The query for the list route: `page`, `limit`, the search (if any) and
   * every filter not at its default. `rename` maps a filter to the route's
   * own parameter name (`{ from: 'dateFrom' }`); `searchParam` likewise
   * (default `search`).
   */
  apiParams: (options?: {
    rename?: Partial<Record<keyof F, string>>
    searchParam?: string
  }) => URLSearchParams
}

export function useListParams<D extends FilterDefaults>(
  config: ListParamsConfig<D>
): ListParams<Widen<D>> {
  type F = Widen<D>
  // The same object; only its type is widened (see `Widen`).
  const widened = config as unknown as ListParamsConfig<F>
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlString = searchParams.toString()

  // The config is usually an inline literal; compare it by value.
  const configKey = JSON.stringify(config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableConfig = useMemo(() => widened, [configKey])

  const state = useMemo(
    () => parseListParams(new URLSearchParams(urlString), stableConfig),
    [urlString, stableConfig]
  )

  /**
   * The query string most recently written. Two setters called in one event
   * (a filter, then the page) would otherwise both start from the URL as it
   * was, and the second would undo the first: `router.replace` does not update
   * `useSearchParams` until the navigation lands.
   */
  const latest = useRef(urlString)
  useEffect(() => {
    latest.current = urlString
  }, [urlString])

  const write = useCallback(
    (patch: Parameters<typeof applyListPatch<F>>[1]) => {
      const next = applyListPatch(new URLSearchParams(latest.current), patch, stableConfig)
      const query = next.toString()
      if (query === latest.current) return
      latest.current = query
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, stableConfig]
  )

  // The box answers every keystroke; the URL only the settled term.
  const [box, setBox] = useState(state.search)
  const debounced = useDebouncedValue(box)

  // The URL changed under us — Back, a chip's clear, a link — so the box
  // follows it. Not when the URL is merely catching up with what we wrote: by
  // then the box may hold further keystrokes, which must not be overwritten.
  const [seenSearch, setSeenSearch] = useState(state.search)
  if (state.search !== seenSearch) {
    setSeenSearch(state.search)
    if (state.search !== debounced.trim()) setBox(state.search)
  }

  useEffect(() => {
    write({ search: debounced })
    // Only when the settled term changes. With the URL in the dependencies, a
    // Back navigation would fire this with the old term and write it straight
    // back over the URL being returned to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const isFiltered =
    state.search !== '' ||
    (Object.keys(stableConfig.defaults) as (keyof F)[]).some(
      (key) => state.filters[key] !== stableConfig.defaults[key]
    )

  return {
    search: box,
    setSearch: setBox,
    query: state.search,
    filters: state.filters,
    setFilter: (key, value) => write({ filters: { [key]: value } as unknown as Partial<F> }),
    setFilters: (patch) => write({ filters: patch }),
    page: state.page,
    setPage: (page) => write({ page }),
    pageSize: state.pageSize,
    setPageSize: (pageSize) => write({ pageSize }),
    isFiltered,
    clear: () => {
      setBox('')
      write({ search: '', filters: stableConfig.defaults, page: 1 })
    },
    apiParams: ({ rename, searchParam = 'search' } = {}) => {
      const params = new URLSearchParams({
        page: String(state.page),
        limit: String(state.pageSize),
      })
      if (state.search) params.set(searchParam, state.search)
      for (const key of Object.keys(stableConfig.defaults) as (keyof F & string)[]) {
        const value = state.filters[key]
        if (value === stableConfig.defaults[key] || value === '') continue
        params.set(rename?.[key] ?? key, String(value))
      }
      return params
    },
  }
}

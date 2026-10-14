/**
 * The pure half of `useListParams` (hooks/use-list-params.ts): reading a list
 * screen's search, filters and page out of a query string, and writing a
 * change back into one. Kept free of React and Next so it can be tested on its
 * own and reused on the server.
 */

/** Rows per page on every list unless a screen has a reason to differ. */
export const DEFAULT_PAGE_SIZE = 20

/** What the rows-per-page picker offers. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export type FilterValue = string | number | boolean
export type FilterDefaults = Record<string, FilterValue>

/**
 * The defaults with their literal types widened — `{ overdue: false }` is a
 * boolean filter, not one that can only ever be false.
 */
export type Widen<F extends FilterDefaults> = {
  [K in keyof F]: F[K] extends boolean
    ? boolean
    : F[K] extends number
      ? number
      : F[K] extends string
        ? string
        : F[K]
}

export interface ListParamsConfig<F extends FilterDefaults> {
  /** Each filter's key in the URL, and its value when not applied. */
  defaults: F
  /** Rows per page when the URL does not say. Default `DEFAULT_PAGE_SIZE` (20). */
  pageSize?: number
  /** The URL key for the search box. Default `search`. */
  searchKey?: string
}

/** What the URL currently says, parsed against the defaults. */
export interface ListState<F extends FilterDefaults> {
  search: string
  filters: F
  page: number
  pageSize: number
}

const RESERVED = ['page', 'pageSize']

/** One value from the URL, typed like its default. Exported for tests. */
export function parseFilterValue<V extends FilterValue>(raw: string | null, fallback: V): V {
  if (raw === null) return fallback
  if (typeof fallback === 'boolean') return (raw === 'true' || raw === '1') as V
  if (typeof fallback === 'number') {
    const value = Number(raw)
    return (raw.trim() !== '' && Number.isFinite(value) ? value : fallback) as V
  }
  return raw as V
}

function positiveInt(raw: string | null, fallback: number): number {
  const value = raw === null ? NaN : Number(raw)
  return Number.isInteger(value) && value >= 1 ? value : fallback
}

/** Read a list's state out of a query string. Pure; exported for tests. */
export function parseListParams<F extends FilterDefaults>(
  params: URLSearchParams,
  config: ListParamsConfig<F>
): ListState<F> {
  const searchKey = config.searchKey ?? 'search'
  const filters = {} as F
  for (const key of Object.keys(config.defaults) as (keyof F & string)[]) {
    filters[key] = parseFilterValue(params.get(key), config.defaults[key])
  }
  return {
    search: params.get(searchKey) ?? '',
    filters,
    page: positiveInt(params.get('page'), 1),
    pageSize: positiveInt(params.get('pageSize'), config.pageSize ?? DEFAULT_PAGE_SIZE),
  }
}

/**
 * Write a change into a query string, leaving defaults out and every other
 * parameter alone. Pure; exported for tests.
 *
 * A change to the search or any filter puts the page back to 1 unless the
 * patch sets the page itself.
 */
export function applyListPatch<F extends FilterDefaults>(
  current: URLSearchParams,
  patch: { search?: string; filters?: Partial<F>; page?: number; pageSize?: number },
  config: ListParamsConfig<F>
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  const searchKey = config.searchKey ?? 'search'
  const defaultSize = config.pageSize ?? DEFAULT_PAGE_SIZE
  let narrowed = false

  if (patch.search !== undefined) {
    const term = patch.search.trim()
    if (term !== (current.get(searchKey) ?? '')) narrowed = true
    if (term) next.set(searchKey, term)
    else next.delete(searchKey)
  }

  for (const [key, value] of Object.entries(patch.filters ?? {})) {
    if (value === undefined || RESERVED.includes(key) || key === searchKey) continue
    const fallback = config.defaults[key]
    const before = parseFilterValue(current.get(key), fallback)
    if (before !== value) narrowed = true
    if (value === fallback) next.delete(key)
    else next.set(key, String(value))
  }

  if (patch.pageSize !== undefined) {
    if (patch.pageSize === defaultSize) next.delete('pageSize')
    else next.set('pageSize', String(patch.pageSize))
    narrowed = true
  }

  const page = patch.page ?? (narrowed ? 1 : undefined)
  if (page !== undefined) {
    if (page <= 1) next.delete('page')
    else next.set('page', String(page))
  }

  return next
}

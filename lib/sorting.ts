/**
 * Column sorting for the list APIs.
 *
 * Not one list in this application could be reordered by the person reading it.
 * Every route hardcoded its own `orderBy` — patients newest first, appointments
 * by time, invoices newest first — which is invisible with ten seeded rows and
 * the first complaint anybody makes with four thousand.
 *
 * Each route declares the columns it will sort by, as a map from the name the
 * client sends to the `orderBy` it means. An allowlist rather than passing the
 * parameter through: `orderBy` reaches Prisma, and a column name arriving from
 * a query string is not something to hand it unchecked.
 */

export type SortDirection = 'asc' | 'desc'

/** A column the client may ask for, and what it sorts by. */
export type SortMap = Record<string, (direction: SortDirection) => unknown>

export interface SortRequest {
  sort?: string | null
  direction?: string | null
}

export function parseDirection(value: string | null | undefined): SortDirection {
  return value === 'desc' ? 'desc' : 'asc'
}

/**
 * The `orderBy` for this request, or the screen's own default.
 *
 * An unknown column falls back rather than failing: a saved link from before a
 * column was renamed should still show the list, in some order, rather than a
 * 400 the person cannot act on.
 */
export function orderByFrom(request: SortRequest, columns: SortMap, fallback: unknown): unknown {
  const name = request.sort?.trim()
  if (!name) return fallback

  const column = columns[name]
  if (!column) return fallback

  return column(parseDirection(request.direction))
}

/** Read the two parameters off a URL, for routes that have the search params. */
export function sortFromParams(params: URLSearchParams): SortRequest {
  return { sort: params.get('sort'), direction: params.get('direction') }
}

/**
 * Where you came from, carried in the URL.
 *
 * A clinic's records are a web, not a tree. The same patient is reached from
 * the appointment book, from an invoice, from a lab case and from the search
 * box, and the useful thing to do next depends on which of those it was — the
 * receptionist who opened a patient from this morning's queue wants to get
 * back to the queue, not to the patient list.
 *
 * The screens could not express that. Every back arrow in the dashboard was a
 * hard-coded link to its own module's list page, so opening a patient from an
 * appointment and pressing back put you in the patient list, two modules from
 * where you were. The breadcrumb was derived from the path alone, so it said
 * "Patients › Details" no matter how you got there.
 *
 * The trail is the missing half: a short list of the pages walked through, kept
 * in a query parameter so it survives a reload, a shared link and a browser
 * restore, none of which `router.back()` survives.
 *
 * It is flat rather than nested. Each hop stores a bare path, and the URL for
 * hop *i* is that path plus the trail truncated to everything before it — so
 * the parameter grows with the number of hops rather than with the square of
 * it, and a crumb in the middle rebuilds the trail the reader already walked.
 */

export interface Hop {
  href: string
  label: string
}

export const TRAIL_PARAM = 'from'

/**
 * How many hops are kept. Four is deeper than any real path through the
 * application — list, record, related record, its related record — and past
 * that the oldest is dropped rather than letting a loop grow the URL without
 * limit.
 */
export const MAX_HOPS = 4

const MAX_HREF = 512
const MAX_LABEL = 60

/**
 * A trail arrives from the address bar, so it is input from outside and is
 * treated as such: a hop may only point inside this application. Without this
 * a crafted link could put "Back to your clinic" on the screen over a URL
 * belonging to somebody else.
 */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const trimmed = href.trim()
  if (!trimmed.startsWith('/')) return null
  // `//evil.example` is a protocol-relative URL, and `/\evil` is treated as one
  // by several browsers.
  if (/^\/[/\\]/.test(trimmed)) return null
  if (trimmed.length > MAX_HREF) return null
  return trimmed
}

function safeLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null
  const trimmed = label.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}…` : trimmed
}

/** Read a trail out of a query parameter. Anything unreadable is no trail. */
export function decodeTrail(value: string | null | undefined): Hop[] {
  if (!value) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const hops: Hop[] = []
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue
    const href = safeHref(entry[0])
    const label = safeLabel(entry[1])
    if (href && label) hops.push({ href, label })
  }
  return hops.slice(-MAX_HOPS)
}

/** Write a trail for a query parameter. Empty produces no parameter at all. */
export function encodeTrail(hops: Hop[]): string {
  const kept = hops.slice(-MAX_HOPS).map((hop) => [hop.href, hop.label])
  return kept.length === 0 ? '' : JSON.stringify(kept)
}

/**
 * Add a hop, unless it is where we already are.
 *
 * Re-entering a page already on the trail truncates back to it rather than
 * appending: walking patient → appointment → the same patient should read as
 * two hops, not grow one for every circuit.
 */
export function pushHop(trail: Hop[], hop: Hop | null | undefined): Hop[] {
  if (!hop) return trail.slice(-MAX_HOPS)

  const href = safeHref(hop.href)
  const label = safeLabel(hop.label)
  if (!href || !label) return trail.slice(-MAX_HOPS)

  const seen = trail.findIndex((existing) => bare(existing.href) === bare(href))
  if (seen !== -1) return trail.slice(0, seen)

  return [...trail, { href, label }].slice(-MAX_HOPS)
}

/** A path without its trail parameter, for comparing two hops. */
function bare(href: string): string {
  const [path, query] = href.split('?')
  if (!query) return path
  const params = new URLSearchParams(query)
  params.delete(TRAIL_PARAM)
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

/** `href` with a trail parameter attached, replacing any it already carries. */
export function hrefWithTrail(href: string, trail: Hop[]): string {
  const safe = safeHref(href)
  if (!safe) return href

  const [path, query] = safe.split('?')
  const params = new URLSearchParams(query ?? '')
  const encoded = encodeTrail(trail)

  if (encoded) params.set(TRAIL_PARAM, encoded)
  else params.delete(TRAIL_PARAM)

  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

/**
 * Where a crumb points: its own page, with the trail as it stood when the
 * reader was there.
 */
export function hopHref(trail: Hop[], index: number): string {
  return hrefWithTrail(trail[index].href, trail.slice(0, index))
}

/** Where the back arrow goes — the last hop, or the module's own list. */
export function backHref(trail: Hop[], fallback: string): string {
  if (trail.length === 0) return fallback
  return hopHref(trail, trail.length - 1)
}

/** What the back arrow says. */
export function backLabel(trail: Hop[], fallbackLabel: string): string {
  return trail.length === 0 ? fallbackLabel : trail[trail.length - 1].label
}

/**
 * Rate limiting for the doors anybody can knock on.
 *
 * There was none. The account lockout added in `ec64d53` limits guesses
 * against *one account*; somebody spraying one password across two hundred
 * addresses was not slowed at all, and nor was anybody hammering the public
 * booking page or the reset endpoint that sends email.
 *
 * ## What this is, and what it is not
 *
 * A fixed-window counter held **in the memory of one instance**. That is a real
 * limitation and it is stated here rather than buried: two instances behind a
 * load balancer each allow the full budget, and a restart forgets everything.
 * It is not the right answer for a large deployment — that is a shared store,
 * Redis or the platform's own edge limiter — and `docs/ROADMAP.md` says so.
 *
 * It is worth having anyway. The attacks it stops are the ones that are
 * actually attempted against a small clinic's server: a script trying a
 * thousand passwords, somebody filling a dentist's diary from a loop, a reset
 * endpoint used to post mail to a stranger. All of those come from one address
 * at a rate no person produces, and one instance's memory catches every one of
 * them.
 *
 * A fixed window rather than a sliding one on purpose: a sliding window needs
 * per-request timestamps, which is a list per client and a memory profile an
 * attacker chooses. A fixed window can let through up to twice the budget
 * across a boundary, which for these limits is of no consequence.
 */

interface Window {
  /** When the current window ends, as epoch milliseconds. */
  resetAt: number
  count: number
}

const windows = new Map<string, Window>()

/**
 * How many keys to hold before sweeping expired ones.
 *
 * The sweep is amortised onto whichever request crosses the threshold rather
 * than run on a timer, because a timer in a module that may be evaluated per
 * request is a leak of its own.
 */
const SWEEP_AT = 10_000

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

export interface RateLimitResult {
  ok: boolean
  /** Requests left in this window. */
  remaining: number
  /** Seconds until the window resets — what goes in `Retry-After`. */
  retryAfter: number
}

/**
 * Count one request against `key`, and say whether it is allowed.
 *
 * The key should identify the caller *and* the bucket: two different limits for
 * one address must not share a counter.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()

  if (windows.size > SWEEP_AT) sweep(now)

  const existing = windows.get(key)

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { resetAt: now + windowMs, count: 1 })
    return { ok: true, remaining: limit - 1, retryAfter: 0 }
  }

  existing.count++

  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  return { ok: true, remaining: limit - existing.count, retryAfter: 0 }
}

/**
 * Who is asking.
 *
 * `x-forwarded-for` is a list, left to right, of everything the request passed
 * through; the first entry is the client as the outermost proxy saw it. It is
 * trivially forgeable by a client talking to the application *directly*, which
 * is why the deployment puts Caddy in front (see `Caddyfile`) — behind a proxy
 * that sets it, the header is the best identity available at this layer.
 *
 * Falling back to a single shared bucket when there is no header is
 * deliberate: an unidentifiable caller should be limited, not exempt.
 */
export function callerKey(headers: Headers | undefined | null): string {
  // Defensive because this runs in middleware: throwing here would fail the
  // request itself, and an odd runtime that hands us no header bag should cost
  // a shared bucket rather than an outage.
  if (!headers || typeof headers.get !== 'function') return 'unidentified'

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unidentified'
}

export interface Bucket {
  /** A name, so two limits on one address do not share a counter. */
  name: string
  limit: number
  windowMs: number
}

const MINUTE = 60_000

/**
 * The limits, and why each is what it is.
 *
 * Every one of these is set well above what a person at a keyboard produces and
 * well below what a script does. The aim is to make the attack slow, not to
 * make the application feel careful.
 */
export const BUCKETS: { matches: (pathname: string) => boolean; bucket: Bucket }[] = [
  {
    // Signing in. Ten tries in five minutes is more than anybody needs and far
    // less than a dictionary. This is the spraying defence the per-account
    // lockout cannot be: the lockout counts against one account, this counts
    // against one source however many accounts it names.
    matches: (p) => p.startsWith('/api/auth/callback') || p.startsWith('/api/auth/signin'),
    bucket: { name: 'signin', limit: 10, windowMs: 5 * MINUTE },
  },
  {
    // The same lock, second door. `/api/public/login-clinics` needs the
    // password before it answers, so it is exactly as attackable as signing in
    // — its own comment says whatever guards /api/auth must guard this too.
    matches: (p) => p === '/api/public/login-clinics',
    bucket: { name: 'signin', limit: 10, windowMs: 5 * MINUTE },
  },
  {
    // Asking for a password reset sends an email to an address the caller
    // names. Unlimited, it is a way to post mail to a stranger, repeatedly.
    matches: (p) => p.startsWith('/api/public/password-reset'),
    bucket: { name: 'reset', limit: 5, windowMs: 15 * MINUTE },
  },
  {
    // Registering a clinic. Slow enough that nobody notices, fast enough that
    // a script cannot fill the tenants table overnight.
    matches: (p) => p === '/api/auth/register' || p === '/api/public/signup',
    bucket: { name: 'signup', limit: 5, windowMs: 60 * MINUTE },
  },
  {
    // Booking online. `booking.maxOpenPerPhone` already stops one number
    // filling a diary; this stops one machine trying a thousand numbers.
    matches: (p) => /^\/api\/public\/[^/]+\/book$/.test(p),
    bucket: { name: 'booking', limit: 15, windowMs: 60 * MINUTE },
  },
  {
    // Reading availability is cheap and a patient legitimately does it a lot —
    // every day they try is a request, and the next-available scan is another.
    // Generous, but not unbounded.
    matches: (p) => /^\/api\/public\/[^/]+\/(slots|next-available|doctors)$/.test(p),
    bucket: { name: 'availability', limit: 120, windowMs: MINUTE },
  },
]

/** The bucket guarding this path, if any. */
export function bucketFor(pathname: string): Bucket | null {
  return BUCKETS.find((entry) => entry.matches(pathname))?.bucket ?? null
}

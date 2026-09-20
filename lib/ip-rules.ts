/**
 * The allowed- and blocked-address lists on Settings → Security.
 *
 * A clinic that works from one building wants sign-in refused from anywhere
 * else, and that is a reasonable thing to want. The two fields collecting it
 * were free-text boxes whose contents nothing read.
 *
 * What this enforces, and where, is worth stating plainly because it is easy to
 * assume more: **the lists are checked when somebody signs in**, not on every
 * subsequent request. Checking per request would mean a database read in
 * middleware, which runs on the edge runtime where Prisma cannot go, and a
 * session already carries an eight-hour life of its own. So an address that is
 * blocked cannot obtain a session; one obtained before the block was added
 * lives out its term. The settings screen says so.
 *
 * The address itself comes from `x-forwarded-for`, which is set by whatever
 * proxy is in front. That makes these lists a control over *where staff sign in
 * from*, useful and worth having, and not a defence against somebody who can
 * forge headers. An application behind no proxy at all sees no address, and an
 * allow-list would then refuse everybody — so an unknown address is refused
 * only by the block list, never by the allow list.
 */

/** One entry: a bare address, or CIDR notation. */
export type IpRule = string

/**
 * Split a settings field into rules.
 *
 * Accepts newlines, commas and spaces between entries, because people paste
 * addresses from all three and a list that silently keeps `10.0.0.1,` as one
 * rule is a list that silently does nothing.
 */
export function parseIpRules(value: string | null | undefined): IpRule[] {
  if (!value) return []
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** IPv4 dotted quad to a 32-bit number, or null if it is not one. */
function ipv4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/**
 * Does this address satisfy this rule?
 *
 * Exact match for a bare address — including IPv6, compared as text, since an
 * address that arrives in a different but equivalent notation is a problem
 * worth failing closed on rather than guessing about. CIDR is IPv4 only, which
 * covers what a clinic's fixed line gives them.
 */
export function ipMatches(address: string, rule: IpRule): boolean {
  const slash = rule.indexOf('/')

  if (slash === -1) return address === rule

  const network = ipv4ToInt(rule.slice(0, slash))
  const bits = Number(rule.slice(slash + 1))
  const candidate = ipv4ToInt(address)

  if (network === null || candidate === null) return false
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false

  // A /0 matches everything, and `>>> 32` in JavaScript is `>>> 0` — the shift
  // count is taken modulo 32 — so it would match nothing instead. Handled
  // rather than left as a curiosity: `0.0.0.0/0` is exactly what somebody
  // types when they mean "anywhere".
  if (bits === 0) return true

  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (network & mask) >>> 0 === (candidate & mask) >>> 0
}

export interface IpDecision {
  allowed: boolean
  /** Which list refused, for the audit entry. Null when allowed. */
  reason: 'blocked' | 'not_allowed' | null
}

/**
 * Whether an address may sign in.
 *
 * The block list wins over the allow list. Somebody who adds an address to both
 * has contradicted themselves, and the safer reading of a contradiction is the
 * refusal.
 *
 * An empty allow list means "anywhere", not "nowhere". This is the difference
 * between a feature that is off and a feature that has locked the clinic out of
 * its own application, and the default for every clinic is an empty box.
 */
export function decideIp(
  address: string | null | undefined,
  rules: { allowed: IpRule[]; blocked: IpRule[] }
): IpDecision {
  if (address && rules.blocked.some((rule) => ipMatches(address, rule))) {
    return { allowed: false, reason: 'blocked' }
  }

  if (rules.allowed.length === 0) return { allowed: true, reason: null }

  // No address at all — no proxy in front, or a direct call — cannot be
  // matched against an allow list. Refusing here would lock out every clinic
  // running without a reverse proxy, including one testing on a laptop.
  if (!address) return { allowed: true, reason: null }

  return rules.allowed.some((rule) => ipMatches(address, rule))
    ? { allowed: true, reason: null }
    : { allowed: false, reason: 'not_allowed' }
}

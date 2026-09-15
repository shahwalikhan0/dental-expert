/**
 * Every staff API route must gate on a capability.
 *
 * This exists because of how the hole got there in the first place: nobody
 * decided that 66 route files should be callable by any signed-in user. They
 * were added one at a time, each one reasonable on its own, and the middleware
 * role map made it *look* covered — while never running for /api at all.
 *
 * A reviewer cannot hold 195 route files in their head. This test can.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { PERMISSIONS } from '@/lib/rbac'

const API_ROOT = join(process.cwd(), 'app', 'api')

/**
 * Routes that authenticate by some means other than a staff session, and so
 * have no role to check.
 *
 * Adding to this list is how the rule gets quietly broken, so each entry says
 * what actually guards it. Anything not covered by one of these mechanisms
 * belongs in the main list, not here.
 */
const NON_STAFF_ROUTES: Record<string, string> = {
  'public/signup': 'unauthenticated by design — creates the clinic and its first admin',
  'public/verify-email': 'single-use token in the URL',
  'public/invite/accept': 'single-use invitation token',
  // Slug-addressed and public by design: the booking pages patients use, plus
  // the clinic name/logo lookup behind the login page's optional ?clinic=.
  // Each is a lookup by a slug that is already public in the booking URL, and
  // none of them lists clinics — there is deliberately no endpoint that does.
  'public/[slug]': 'public, addressed by a slug that is already in the booking URL',
  // Answers nothing without the correct password, writes nothing, and signs
  // nobody in — it only names the clinics a verified password already opens.
  'public/login-clinics': 'requires the password it is asked about; read-only',
  // Platform administration is not a clinic capability and deliberately holds
  // no Permission: requirePlatformAdmin() re-reads User.isPlatformAdmin from
  // the database on every call, which is stricter than any capability here.
  platform: 'requirePlatformAdmin — a database check, not a session claim',
  cron: 'CRON_SECRET bearer token',
  'track/email/[id]': 'open-tracking pixel; no data returned',
  'auth/[...nextauth]': 'NextAuth itself',
  'auth/mobile-token': 'exchanges credentials for a token; it *is* the login',
  health: 'liveness probe, no data',
  ready: 'readiness probe, no data',
  onboarding: 'gated on isHospitalAdmin, which is stricter than any capability',
  'settings/profile': "a user's own profile",
  'settings/communications/test': 'sends a test message to the caller',
  'communications/triggers': 'CRON_SECRET bearer token',
}

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, acc)
    else if (entry === 'route.ts') acc.push(full)
  }
  return acc
}

function relative(file: string): string {
  return file.slice(API_ROOT.length + 1).replace(/\/route\.ts$/, '')
}

function exemption(rel: string): string | null {
  for (const prefix of Object.keys(NON_STAFF_ROUTES)) {
    if (rel === prefix || rel.startsWith(prefix + '/')) return NON_STAFF_ROUTES[prefix]
  }
  return null
}

const ALL = routeFiles(API_ROOT)
const STAFF_ROUTES = ALL.filter((f) => exemption(relative(f)) === null)

describe('API permission coverage', () => {
  it('finds the route files', () => {
    // A floor, not a target. It exists to catch the glob silently matching
    // nothing; it was 150 before the schema was scoped back to the
    // specification, which removed 34 tables and the routes behind them.
    expect(ALL.length).toBeGreaterThan(100)
    expect(STAFF_ROUTES.length).toBeGreaterThan(80)
  })

  it('gates every staff route on a capability', () => {
    const ungated = STAFF_ROUTES.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return !src.includes('requirePermission') && !src.includes('requireAllPermissions')
    }).map(relative)

    expect(ungated, 'these routes are callable by any signed-in staff member').toEqual([])
  })

  it('gates every exported handler, not just the first one in the file', () => {
    const offenders: string[] = []
    for (const f of STAFF_ROUTES) {
      const src = readFileSync(f, 'utf8')
      const handlers = [
        ...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g),
      ]
      const marks = handlers.map((m) => ({ at: m.index!, method: m[1] }))
      marks.forEach((mark, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].at : src.length
        const body = src.slice(mark.at, end)
        if (!/require(Permission|AllPermissions)\s*\(/.test(body)) {
          offenders.push(`${relative(f)} ${mark.method}`)
        }
      })
    }
    expect(offenders, 'these handlers have no capability check').toEqual([])
  })

  it('only ever asks for capabilities that exist', () => {
    const unknown: string[] = []
    for (const f of ALL) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/requirePermission\('([^']+)'\)/g)) {
        if (!(PERMISSIONS as readonly string[]).includes(m[1])) {
          unknown.push(`${relative(f)}: ${m[1]}`)
        }
      }
    }
    expect(unknown, 'a typo in a capability name silently denies everyone').toEqual([])
  })

  // An exemption for a route that no longer exists is a rule nobody is
  // enforcing, and the next person will assume the list is accurate.
  it('has no stale exemptions', () => {
    const existing = ALL.map(relative)
    const stale = Object.keys(NON_STAFF_ROUTES).filter(
      (prefix) => !existing.some((r) => r === prefix || r.startsWith(prefix + '/'))
    )
    expect(stale, 'exemptions for routes that no longer exist').toEqual([])
  })

  it('documents why each exemption is safe', () => {
    for (const [route, why] of Object.entries(NON_STAFF_ROUTES)) {
      expect(why.length, `${route} has no stated reason`).toBeGreaterThan(10)
    }
  })
})

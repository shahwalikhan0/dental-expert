/**
 * One patient cannot read another patient's record.
 *
 * This is the whole security model of the portal in one sentence, and it rests
 * on a convention rather than on a type: every read endpoint scopes its query
 * by the patient id that came out of the *session*, and none of them accepts a
 * patient id from the caller. A convention holds until somebody adds a route
 * that does not know about it — so it is checked here, against the source.
 *
 * A scanner rather than a request-level test on purpose. The failure this
 * guards against is a new file, and a test that exercises the five routes that
 * exist today would pass on the day a sixth is added wrongly.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const PORTAL_API = join(process.cwd(), 'app/api/portal')

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, acc)
    else if (entry === 'route.ts') acc.push(full)
  }
  return acc
}

const ROUTES = routeFiles(PORTAL_API).map((path) => ({
  name: path.slice(process.cwd().length + 1),
  source: readFileSync(path, 'utf8'),
}))

/** Signing in and out cannot require a session; everything else must. */
const UNAUTHENTICATED = [
  'app/api/portal/auth/login/route.ts',
  'app/api/portal/auth/logout/route.ts',
]

describe('portal API', () => {
  it('has routes to check', () => {
    expect(ROUTES.length).toBeGreaterThan(0)
  })

  it('guards every route that is not sign-in or sign-out', () => {
    const unguarded = ROUTES.filter(
      (route) =>
        !UNAUTHENTICATED.includes(route.name) && !route.source.includes('requirePortalPatient')
    ).map((route) => route.name)

    expect(unguarded).toEqual([])
  })

  /**
   * The rule that makes the guard worth having. `requirePortalPatient` returns
   * the signed-in patient's own id; a route that then reads an id out of the
   * URL or the body has thrown that away.
   */
  it('takes no patient id from the caller', () => {
    // Two ways one could arrive: a dynamic segment in the path, or a query
    // parameter. Neither exists, and neither should — there is exactly one
    // record a portal request may read, and the session already says which.
    const dynamic = ROUTES.filter((route) => route.name.includes('[')).map((route) => route.name)
    expect(dynamic).toEqual([])

    const fromRequest = ROUTES.filter((route) =>
      /\{\s*params\s*\}|searchParams\.get\(\s*['"]patient/i.test(route.source)
    ).map((route) => route.name)
    expect(fromRequest).toEqual([])
  })

  it('scopes every query by both the patient and the clinic', () => {
    const reads = ROUTES.filter((route) => !route.name.includes('/auth/'))

    for (const route of reads) {
      // Skip the one that answers "who am I", which reads the session itself
      // rather than the patient's records.
      if (route.name.endsWith('me/route.ts')) continue

      expect(route.source, `${route.name} must scope by patient`).toContain(
        'patientId: caller.patient.id'
      )
      expect(route.source, `${route.name} must scope by clinic`).toContain(
        'hospitalId: caller.patient.hospitalId'
      )
    }
  })

  /** Read-only. The only write in the portal is the patient's own password. */
  it('exports no write verbs outside the auth routes', () => {
    const writers = ROUTES.filter(
      (route) =>
        !route.name.includes('/auth/') &&
        /export async function (POST|PATCH|PUT|DELETE)\b/.test(route.source)
    ).map((route) => route.name)

    expect(writers).toEqual([])
  })
})

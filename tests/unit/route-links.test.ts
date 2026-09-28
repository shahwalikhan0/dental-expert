/**
 * Every link on a screen goes somewhere that exists.
 *
 * A link to a page that was never built, or to one that has since been removed,
 * looks exactly like a working one until somebody clicks it. The audit that
 * produced this file found sixteen: two quick actions on the billing screen
 * over a `PaymentPlan` model and an `/api/payment-plans` route that neither
 * exist, a tile on the settings screen for an integrations page nobody wrote,
 * five steps of the setup guide walking new staff through Google Calendar sync,
 * AI settings, devices and video consults — none of which are modules of this
 * application — and nine in the patient portal shell.
 *
 * The setup guide is the worst of them, because its whole job is to teach
 * somebody the system on their first day.
 *
 * The first version of this scanner only read href values written as plain
 * string literals, and reported itself green while seven more destinations were
 * broken: every `/edit` screen reached from a row menu or a detail header, and
 * the refund screen, all written as template literals or as `router.push`.
 * A test that checks the easy half of a rule is worse than no test, because it
 * is quoted as evidence. It now reads both forms, and navigation performed in
 * code as well as navigation written as a link.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { APP_ROUTES } from '@/lib/routes'

const ROOT = process.cwd()

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files(full, acc)
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) acc.push(full)
  }
  return acc
}

/** Every route the app router serves, with its dynamic segments intact. */
function routes(): string[] {
  const appDir = join(ROOT, 'app')
  const found: string[] = []

  const walk = (dir: string) => {
    const entries = readdirSync(dir)
    if (entries.includes('page.tsx')) {
      const rel = dir.slice(appDir.length).split('/').filter(Boolean)
      // `(dashboard)` and the like group files without appearing in the URL.
      const segments = rel.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      found.push('/' + segments.join('/'))
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
    }
  }

  walk(appDir)
  return found
}

const ROUTES = routes()

function resolves(href: string): boolean {
  const path = href.split('?')[0].split('#')[0]
  const want = path.split('/').filter(Boolean)

  return ROUTES.some((route) => {
    const have = route.split('/').filter(Boolean)
    if (have.length !== want.length) return false
    return have.every((segment, i) => segment.startsWith('[') || segment === want[i])
  })
}

/**
 * Nothing is exempt any more.
 *
 * `components/portal/portal-shell.tsx` used to be listed here: nine links to
 * pages nobody had written, in a component nothing imported. The portal is now
 * built — read-only, credentials issued at the desk — and its navigation was
 * cut to the pages that exist. The exemption going away is the point; a list of
 * files this test agrees not to check is a list of places the rule does not
 * hold.
 */
const SOURCES = files(join(ROOT, 'app'))
  .concat(files(join(ROOT, 'components')))
  .map((path) => ({ name: path.slice(ROOT.length + 1), source: readFileSync(path, 'utf8') }))

/**
 * Every internal destination a screen can send somebody to.
 *
 * Three forms, because all three are navigation and all three can point at
 * nothing: `href="/x"`, `href={`/x/${id}`}` and `router.push(`/x/${id}`)`.
 * An interpolated segment stands in for a dynamic one — `/patients/${id}/edit`
 * is asking for `/patients/[id]/edit`, and whether that page exists is exactly
 * the question.
 */
function destinations(source: string): { raw: string; how: string }[] {
  const found: { raw: string; how: string }[] = []

  const add = (value: string, how: string) => {
    if (!value.startsWith('/')) return
    // A destination whose first segment is itself interpolated is chosen at
    // runtime — `/${entityType}` can be any module — and there is nothing here
    // to check it against. Everything after a fixed first segment is checked,
    // with each interpolation standing in for one dynamic segment.
    if (/^\/\$\{/.test(value)) return
    found.push({ raw: value.replace(/\$\{[^}]*\}/g, 'X'), how })
  }

  for (const match of source.matchAll(/href[=:]\s*['"](\/[^'"]*)['"]/g)) add(match[1], 'href')
  for (const match of source.matchAll(/href[=:]\s*\{?`(\/[^`]*)`/g)) add(match[1], 'href')
  for (const match of source.matchAll(/router\.(?:push|replace)\(\s*['"`](\/[^'"`]*)['"`]/g))
    add(match[1], 'router.push')

  return found
}

describe('internal links', () => {
  it('all point at a page that exists', () => {
    const broken: string[] = []

    for (const file of SOURCES) {
      for (const { raw, how } of destinations(file.source)) {
        // API routes and Next's own internals are not pages.
        if (raw.startsWith('/api') || raw.startsWith('/_')) continue
        if (!resolves(raw)) broken.push(`${file.name} -> ${raw} (${how})`)
      }
    }

    expect(broken, 'a link that looks like it works until somebody clicks it').toEqual([])
  })

  it('the route list itself is not empty — this test would otherwise pass blind', () => {
    expect(ROUTES.length).toBeGreaterThan(40)
    expect(ROUTES).toContain('/patients/[id]')
  })

  // The breadcrumb needs this list at runtime to know which of its fallback
  // crumbs are places you can actually go. A stale copy would put the 404s back.
  it('lib/routes.ts lists exactly the routes on disk', () => {
    expect([...APP_ROUTES].sort()).toEqual([...ROUTES].sort())
  })
})

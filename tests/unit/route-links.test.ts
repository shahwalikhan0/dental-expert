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
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

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
 * The patient portal. Nine links to pages that do not exist, in a component
 * nothing imports — the portal is §16 Future Enhancements, and this is the
 * shell somebody started. Listed rather than deleted because whether the
 * scaffolding stays is a decision about the roadmap, not about this test.
 */
const UNBUILT = ['components/portal/portal-shell.tsx']

const SOURCES = files(join(ROOT, 'app'))
  .concat(files(join(ROOT, 'components')))
  .map((path) => ({ name: path.slice(ROOT.length + 1), source: readFileSync(path, 'utf8') }))
  .filter((file) => !UNBUILT.includes(file.name))

describe('internal links', () => {
  it('all point at a page that exists', () => {
    const broken: string[] = []

    for (const file of SOURCES) {
      for (const match of file.source.matchAll(/href[=:]\s*['"](\/[a-zA-Z0-9\-_/[\]().]*)['"]/g)) {
        const href = match[1]
        // API routes and Next's own internals are not pages.
        if (href.startsWith('/api') || href.startsWith('/_')) continue
        if (!resolves(href)) broken.push(`${file.name} -> ${href}`)
      }
    }

    expect(broken, 'a link that looks like it works until somebody clicks it').toEqual([])
  })

  it('the route list itself is not empty — this test would otherwise pass blind', () => {
    expect(ROUTES.length).toBeGreaterThan(40)
    expect(ROUTES).toContain('/patients/[id]')
  })

  it('the exemption list is not stale', () => {
    const names = new Set(
      files(join(ROOT, 'app'))
        .concat(files(join(ROOT, 'components')))
        .map((path) => path.slice(ROOT.length + 1))
    )
    expect(UNBUILT.filter((name) => !names.has(name))).toEqual([])
  })
})

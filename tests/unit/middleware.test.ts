// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock NextResponse
const mockRedirect = vi.fn()
const mockNext = vi.fn().mockReturnValue({ type: 'next' })

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (...args: any[]) => mockRedirect(...args),
    next: () => mockNext(),
  },
}))

// The middleware does: export default auth((req) => { ... })
// Our auth mock just returns the handler as-is, so `middleware` IS the handler
vi.mock('@/lib/auth', () => ({
  auth: (handler: Function) => handler,
}))

import middleware, { config } from '@/middleware'

function makeRequest(pathname: string, session?: any, ip = '203.0.113.1') {
  const url = new URL(`http://localhost:3000${pathname}`)
  return {
    nextUrl: url,
    auth: session,
    // A real request always has these. The rate limiter reads the caller from
    // them, and a stub without them stood in for something that cannot exist.
    // A distinct address per test keeps one test's budget out of another's.
    headers: new Headers({ 'x-forwarded-for': ip }),
  }
}

/** An address nothing else in this file will share a rate-limit bucket with. */
let addresses = 0
const freshIp = () => `198.51.100.${++addresses % 250}`

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedirect.mockImplementation((url) => ({ type: 'redirect', url }))
    mockNext.mockReturnValue({ type: 'next' })
  })

  // Public routes
  it('allows access to /login without auth', () => {
    middleware(makeRequest('/login', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to /signup without auth', () => {
    middleware(makeRequest('/signup', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to /forgot-password without auth', () => {
    middleware(makeRequest('/forgot-password', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to /pricing without auth', () => {
    middleware(makeRequest('/pricing', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to /verify-email without auth', () => {
    middleware(makeRequest('/verify-email', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to /invite/accept without auth', () => {
    middleware(makeRequest('/invite/accept', null))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows access to landing page / without auth', () => {
    middleware(makeRequest('/', null))
    expect(mockNext).toHaveBeenCalled()
  })

  // API routes pass through
  it('allows all API routes through', () => {
    middleware(makeRequest('/api/patients', null))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('allows /api/auth routes through', () => {
    middleware(makeRequest('/api/auth/signin', null, freshIp()))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows /api/public routes through', () => {
    middleware(makeRequest('/api/public/signup', null, freshIp()))
    expect(mockNext).toHaveBeenCalled()
  })

  // Logged-in user redirect from public pages
  it('redirects logged-in user from /login to /dashboard', () => {
    middleware(makeRequest('/login', { user: { role: 'ADMIN' } }))
    expect(mockRedirect).toHaveBeenCalled()
    const url = mockRedirect.mock.calls[0][0]
    expect(url.pathname).toBe('/dashboard')
  })

  it('redirects logged-in user from /signup to /dashboard', () => {
    middleware(makeRequest('/signup', { user: { role: 'ADMIN' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('redirects logged-in user from / to /dashboard', () => {
    middleware(makeRequest('/', { user: { role: 'ADMIN' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  // Unauthenticated redirect to login
  it('redirects unauthenticated user from /dashboard to /login', () => {
    middleware(makeRequest('/dashboard', null))
    expect(mockRedirect).toHaveBeenCalled()
    const url = mockRedirect.mock.calls[0][0]
    expect(url.pathname).toBe('/login')
  })

  it('includes callbackUrl when redirecting to login', () => {
    middleware(makeRequest('/patients', null))
    expect(mockRedirect).toHaveBeenCalled()
    const url = mockRedirect.mock.calls[0][0]
    expect(url.searchParams.get('callbackUrl')).toBe('/patients')
  })

  // Role-based access
  it('allows ADMIN to access /settings', () => {
    middleware(makeRequest('/settings', { user: { role: 'ADMIN' } }))
    expect(mockNext).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('redirects DOCTOR from /settings to /dashboard', () => {
    middleware(makeRequest('/settings', { user: { role: 'DOCTOR' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('allows DOCTOR to access /treatments', () => {
    middleware(makeRequest('/treatments', { user: { role: 'DOCTOR' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('redirects RECEPTIONIST from /treatments to /dashboard', () => {
    middleware(makeRequest('/treatments', { user: { role: 'RECEPTIONIST' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('allows RECEPTIONIST to access /billing', () => {
    middleware(makeRequest('/billing', { user: { role: 'RECEPTIONIST' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows ACCOUNTANT to access /billing', () => {
    middleware(makeRequest('/billing', { user: { role: 'ACCOUNTANT' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows LAB_TECH to access /lab', () => {
    middleware(makeRequest('/lab', { user: { role: 'LAB_TECH' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // Front desk coordinates collection and delivery of lab work (§5.8), so it
  // holds lab:read. Writing the case is still restricted.
  it('allows RECEPTIONIST to view /lab', () => {
    middleware(makeRequest('/lab', { user: { role: 'RECEPTIONIST' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('redirects INVENTORY_STAFF away from /lab', () => {
    middleware(makeRequest('/lab', { user: { role: 'INVENTORY_STAFF' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('allows ADMIN to access /staff', () => {
    middleware(makeRequest('/staff', { user: { role: 'ADMIN' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // A dentist can see the staff directory (staff:read) but not an individual
  // member's performance figures, which sit behind staff:hr.
  it('allows DOCTOR to view the /staff directory', () => {
    middleware(makeRequest('/staff', { user: { role: 'DOCTOR' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows ADMIN to access /inventory', () => {
    middleware(makeRequest('/inventory', { user: { role: 'ADMIN' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // A dentist checks stock before a procedure (inventory:read); only store
  // staff and assistants can move it.
  it('allows DOCTOR to view /inventory', () => {
    middleware(makeRequest('/inventory', { user: { role: 'DOCTOR' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('redirects ACCOUNTANT away from /inventory', () => {
    middleware(makeRequest('/inventory', { user: { role: 'ACCOUNTANT' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })

  it('allows ADMIN to access /communications', () => {
    middleware(makeRequest('/communications', { user: { role: 'ADMIN' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('allows RECEPTIONIST to access /communications', () => {
    middleware(makeRequest('/communications', { user: { role: 'RECEPTIONIST' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // Onboarding
  it('allows authenticated user to access /onboarding', () => {
    middleware(makeRequest('/onboarding', { user: { role: 'ADMIN' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // Dashboard access. The dashboard is clinic-wide operational and financial
  // KPIs (§9), so it needs reports:operational rather than merely being
  // signed in.
  it('allows roles with reports:operational into /dashboard', () => {
    const roles = ['ADMIN', 'CLINIC_MANAGER', 'DOCTOR', 'DENTAL_ASSISTANT', 'RECEPTIONIST']
    roles.forEach((role) => {
      vi.clearAllMocks()
      mockNext.mockReturnValue({ type: 'next' })
      middleware(makeRequest('/dashboard', { user: { role } }))
      expect(mockNext).toHaveBeenCalled()
    })
  })

  // INVENTORY_STAFF has no dashboard permission, so redirecting them to
  // /dashboard would bounce them between two forbidden pages. landingPageFor
  // sends them to /inventory instead.
  it('does not trap a role that cannot open the dashboard', () => {
    vi.clearAllMocks()
    middleware(makeRequest('/dashboard', { user: { role: 'INVENTORY_STAFF' } }))
    expect(mockRedirect).toHaveBeenCalled()
    vi.clearAllMocks()
    mockNext.mockReturnValue({ type: 'next' })
    middleware(makeRequest('/inventory', { user: { role: 'INVENTORY_STAFF' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // Reports access
  it('allows DOCTOR to access /reports', () => {
    middleware(makeRequest('/reports', { user: { role: 'DOCTOR' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  // Front desk runs the daily appointment, queue and no-show reports (§9), so
  // it holds reports:operational. Financial reporting is a separate capability.
  it('allows RECEPTIONIST into /reports', () => {
    middleware(makeRequest('/reports', { user: { role: 'RECEPTIONIST' } }))
    expect(mockNext).toHaveBeenCalled()
  })

  it('redirects RECEPTIONIST away from /billing/reports', () => {
    middleware(makeRequest('/billing/reports', { user: { role: 'RECEPTIONIST' } }))
    expect(mockRedirect).toHaveBeenCalled()
  })
})

describe('middleware config', () => {
  it('exports matcher config', () => {
    expect(config).toBeDefined()
    expect(config.matcher).toBeDefined()
    expect(Array.isArray(config.matcher)).toBe(true)
  })
})

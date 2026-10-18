import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { holderCan, isFormRoute, landingPageFor, permissionForRoute } from '@/lib/rbac'
import { bucketFor, callerKey, rateLimit } from '@/lib/rate-limit'

// Which capability each dashboard section needs now lives in lib/rbac.ts,
// alongside the API-side check, so the menu a user can see and the endpoints
// they can call cannot drift apart.
//
// This is navigation gating and nothing more. It never runs for /api/*, so it
// is not a security boundary — see the comment on the API short-circuit below.

// Public routes that don't require authentication.
//
// Everything under /portal is patient-facing and must not be gated by the staff
// session: patients hold their own cookie, issued by /api/portal/auth/login and
// checked server-side in app/portal/(secure)/layout.tsx. Gating it here would
// send patients to the staff sign-in page, which makes the portal unreachable.
//
// "Public" here means only "not gated by the staff session". The portal's own
// pages are gated by their own layout; this list is navigation routing, not a
// security boundary — see the note on the API short-circuit below.
//
// `/pay` used to be on this list alongside a comment describing an OTP flow and
// a layout file, neither of which existed. A route listed public and never
// built is a trap for whoever builds it: the first page created under it would
// have been born unauthenticated.
const publicRoutes = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/signup',
  '/pricing',
  '/verify-email',
  '/invite/accept',
  // The user guide. Linked from the sign-in and signup cards, so it has to
  // open for somebody who has no account yet.
  '/docs',
  '/portal',
  // The patient booking application. It is a separate application that happens
  // to be served from the same deployment — no staff session, no clinic
  // navigation, no shared layout. See app/(patient)/layout.tsx.
  '/book',
]

/**
 * Where somebody whose password must change is sent, and the one page they may
 * reach while it must.
 *
 * Also exempt from the capability check below: `/settings` requires
 * `settings:read`, which Inventory / Store and Lab Technician do not hold, and
 * a person who cannot open the page that changes their password cannot change
 * their password.
 */
const CHANGE_PASSWORD_PATH = '/settings/password'

/**
 * The signed-out pages whose forms carry a password.
 *
 * Their forms are `method="post"` (bug report 12 Oct, finding 3): a form
 * submitted before React has hydrated used to be a native GET, which put the
 * password in the URL — the address bar, the history, the access log. A native
 * POST keeps it in the body, and nothing on the server reads that body: these
 * are client pages, and every real submission goes to an API route with
 * `fetch`. So the POST is answered here with a 303 back to the page, which the
 * browser follows with a plain GET, and the person simply submits again once
 * the page is ready.
 */
const CREDENTIAL_PAGES = [
  '/login',
  '/signup',
  '/invite/accept',
  '/reset-password',
  '/forgot-password',
]

/** Query parameters that must never survive in a URL, from a GET submitted the old way. */
const CREDENTIAL_PARAMS = ['password', 'confirmPassword', 'newPassword', 'email', 'phone']

function isCredentialPage(pathname: string): boolean {
  return CREDENTIAL_PAGES.includes(pathname.replace(/\/+$/, '') || '/')
}

/** The same page, without anything a form might have put in its query string. */
function withoutCredentials(nextUrl: {
  pathname: string
  origin: string
  searchParams: URLSearchParams
}): URL {
  const clean = new URL(nextUrl.pathname, nextUrl.origin)
  nextUrl.searchParams.forEach((value, key) => {
    if (!CREDENTIAL_PARAMS.includes(key)) clean.searchParams.append(key, value)
  })
  return clean
}

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const isLoggedIn = !!session?.user
  const pathname = nextUrl.pathname

  // Public routes - allow access
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
  const isLandingPage = pathname === '/'
  const isApiRoute = pathname.startsWith('/api/')
  const isApiAuth = pathname.startsWith('/api/auth')
  const isPublicApi = pathname.startsWith('/api/public')

  /**
   * A native form submission to a sign-in page — see CREDENTIAL_PAGES. A POST
   * is sent back to the page as a GET; a GET that arrived with a password in
   * its query string, from a page built before the forms said `post`, is sent
   * to the same address without it, so it at least leaves the address bar.
   * Server actions identify themselves with `next-action` and are left alone,
   * although none of these pages uses one.
   */
  if (isCredentialPage(pathname)) {
    const method = (req.method ?? 'GET').toUpperCase()
    const isServerAction = !!req.headers?.get?.('next-action')
    if (method === 'POST' && !isServerAction) {
      return NextResponse.redirect(withoutCredentials(nextUrl), 303)
    }
    if (
      (method === 'GET' || method === 'HEAD') &&
      CREDENTIAL_PARAMS.some((param) => nextUrl.searchParams.has(param))
    ) {
      return NextResponse.redirect(withoutCredentials(nextUrl), 303)
    }
  }

  /**
   * Rate limiting, for the handful of endpoints anybody can reach.
   *
   * Here rather than in each route because it has to run before the handler
   * does any work — and because signing in is NextAuth's route, which is not
   * ours to edit. See lib/rate-limit.ts for the limits and for the honest
   * account of what an in-memory counter does and does not cover.
   *
   * Only unauthenticated paths are listed. A signed-in user hammering the
   * appointments list is a different problem with a different answer, and
   * throttling the desk mid-clinic is its own kind of outage.
   */
  const bucket = bucketFor(pathname)
  if (bucket) {
    const result = rateLimit(
      `${bucket.name}:${callerKey(req.headers)}`,
      bucket.limit,
      bucket.windowMs
    )
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a moment and try again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(result.retryAfter),
            'Cache-Control': 'no-store',
          },
        }
      )
    }
  }

  // API routes are let through so they can authenticate themselves — mobile
  // clients send a Bearer token, which NextAuth's cookie session knows nothing
  // about.
  //
  // The consequence is worth stating plainly: **middleware enforces nothing on
  // the API**. Every route under /api must call requirePermission() itself. A
  // role map here protects menus, not data. The limiter above is the one
  // exception, and it guards availability rather than authorisation.
  if (isApiRoute) {
    return NextResponse.next()
  }

  if (isPublicRoute || isLandingPage || isApiAuth || isPublicApi) {
    // If logged in and trying to access login/signup/landing, redirect to dashboard
    if (isLoggedIn && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
      return NextResponse.redirect(new URL('/dashboard', nextUrl))
    }
    return NextResponse.next()
  }

  // Protected routes - require authentication
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Onboarding redirect: if hospital hasn't completed onboarding, force them there
  // (Skip if already on onboarding page or API routes)
  if (pathname.startsWith('/onboarding') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  /**
   * An expired password, or one an administrator set, stops everything else.
   *
   * The person is signed in — turning them away at sign-in would leave them
   * dependent on somebody else to get back in, and there is no self-service
   * reset — but they reach nothing until the password is changed. The flag is
   * on the token, so it is cleared by the change form calling `update()`;
   * see lib/auth.config.ts.
   *
   * This gates pages only. The API is unaffected on purpose: the change-password
   * request itself has to get through, and the pages are what the person is
   * actually being stopped from using.
   */
  if (session.user.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, nextUrl))
  }

  if (pathname === CHANGE_PASSWORD_PATH) return NextResponse.next()

  // Check capability-based access. A user may hold a second clinical role, so
  // the check is against the union — see RoleHolder in lib/rbac.
  const holder = { role: session.user.role, clinicalRole: session.user.clinicalRole }
  const required = permissionForRoute(pathname)

  if (required && !holderCan(holder, required)) {
    // A form they may not save — New Invoice for a dentist — goes back to the
    // record or list it was opened from, when they can read that, rather than
    // all the way home.
    const parent = isFormRoute(pathname) ? pathname.replace(/\/[^/]+\/?$/, '') : pathname
    if (parent !== pathname) {
      const readNeeds = permissionForRoute(parent)
      if (readNeeds && holderCan(holder, readNeeds)) {
        return NextResponse.redirect(new URL(parent, nextUrl))
      }
    }

    // Send them somewhere they can actually use. Redirecting everyone to
    // /dashboard would trap INVENTORY_STAFF in a loop, since they have no
    // dashboard permission either.
    const fallback = landingPageFor(holder)
    if (pathname === fallback) return NextResponse.next()
    return NextResponse.redirect(new URL(fallback, nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api/health and api/ready — the liveness and readiness probes.
     *
     * The probes are excluded here rather than allowed through the handler so
     * that they never invoke auth() at all. An orchestrator polls these every
     * few seconds for the life of the container; making each poll decode a
     * session is wasted work, and it couples the probe to the auth layer, so
     * a fault in auth would take the health check down with it — exactly when
     * an accurate health signal matters most.
     */
    '/((?!_next/static|_next/image|favicon.ico|public|api/health|api/ready).*)',
  ],
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

/**
 * Where a page sends somebody whose session has ended under them.
 *
 * Middleware runs on the edge and cannot read the database, so it still sees a
 * deactivated person's cookie as a good one; the server, which re-reads the
 * account (lib/account-standing.ts), does not. Sending them to /login from a
 * page would loop — middleware sends a signed-in visitor of /login back to the
 * dashboard — so they come here instead, where the cookie is cleared, and then
 * go to the sign-in page told why.
 *
 * Only an ended session is cleared. A session that still stands is sent back to
 * the dashboard untouched, so a link to this address cannot sign anybody out.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (session?.user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const response = NextResponse.redirect(new URL('/login?ended=1', request.url))
  for (const cookie of request.cookies.getAll()) {
    // The session token, and its chunks when it is too big for one cookie.
    if (!cookie.name.includes('authjs.session-token')) continue
    response.cookies.set(cookie.name, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: cookie.name.startsWith('__Secure-'),
    })
  }
  return response
}

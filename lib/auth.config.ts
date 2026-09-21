import type { NextAuthConfig } from 'next-auth'

export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const pathname = nextUrl.pathname

      // Public routes that don't require auth
      const publicRoutes = [
        '/login',
        '/forgot-password',
        '/reset-password',
        '/signup',
        '/pricing',
        '/verify-email',
        '/invite/accept',
        // The patient-facing booking application. Nobody signs in to it — see
        // app/(patient)/layout.tsx.
        '/book',
      ]

      const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
      const isLandingPage = pathname === '/'

      if (isPublicRoute || isLandingPage) {
        // If logged in and trying to access login/signup, redirect to dashboard
        if (isLoggedIn && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
          return Response.redirect(new URL('/dashboard', nextUrl))
        }
        return true
      }

      // All other routes require authentication
      if (!isLoggedIn) return false

      return true
    },
    /**
     * The token, and the session timeout the clinic asked for.
     *
     * `user` is present only on the request that signs someone in, so that is
     * where the timeout and the sign-in moment are stamped on. Every later
     * request re-runs this callback with the stored token and compares the two.
     *
     * Enforced here rather than through NextAuth's own `session.maxAge`,
     * because that is one number for the whole deployment and this is a
     * per-clinic setting. `maxAge` stays as the outer bound — no session may
     * outlive it whatever a clinic configures.
     */
    jwt({ token, user, trigger, session }) {
      /**
       * Clearing the must-change-password flag after the password was changed.
       *
       * The flag lives on the token, so changing a password does not by itself
       * update it — the person would be redirected back to the change form for
       * the rest of the session, by a token asserting something that stopped
       * being true. The page calls `update()` on success and this clears it.
       *
       * Taking the client's word for it is sound here because the flag gates a
       * redirect and nothing else: it confers no capability and withholds none,
       * so a session that clears it early has skipped a prompt, not a control.
       */
      if (trigger === 'update' && (session as { mustChangePassword?: boolean } | undefined)) {
        const requested = (session as { mustChangePassword?: boolean }).mustChangePassword
        if (requested === false) token.mustChangePassword = false
      }

      if (user) {
        token.id = user.id
        token.role = user.role
        token.clinicalRole = user.clinicalRole
        token.staffId = user.staffId
        token.hospitalId = user.hospitalId
        token.isHospitalAdmin = user.isHospitalAdmin
        token.isPlatformAdmin = user.isPlatformAdmin
        token.sessionTimeoutMinutes = user.sessionTimeoutMinutes
        token.mustChangePassword = user.mustChangePassword
        token.signedInAt = Date.now()
      }

      const timeout = token.sessionTimeoutMinutes as number | undefined
      const signedInAt = token.signedInAt as number | undefined
      if (timeout && signedInAt && Date.now() - signedInAt > timeout * 60_000) {
        // Returning null clears the session. The person is sent to the sign-in
        // page by the ordinary unauthenticated path, which is what a timeout
        // should look like from the outside.
        return null
      }

      return token
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.clinicalRole = token.clinicalRole as string | undefined
        session.user.staffId = token.staffId as string | undefined
        session.user.hospitalId = token.hospitalId as string
        session.user.isHospitalAdmin = token.isHospitalAdmin as boolean
        session.user.isPlatformAdmin = token.isPlatformAdmin as boolean | undefined
        session.user.mustChangePassword = token.mustChangePassword as boolean | undefined
      }
      return session
    },
  },
  providers: [],
}

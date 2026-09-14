import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authConfig } from './auth.config'
import { z } from 'zod'
import { requestContext } from './audit'
import { resolveLogin } from './login'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  /**
   * Which clinic to sign in to, when the address alone does not say.
   *
   * Empty on the ordinary path. It is filled from `?clinic=<slug>` on the
   * sign-in page, and from the clinic picker that appears when one address and
   * password open accounts at more than one clinic.
   */
  clinic: z.string().optional(),
})

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const validated = loginSchema.safeParse(credentials)

        if (!validated.success) return null

        const { email, password, clinic } = validated.data

        /**
         * Who this is, and at which clinic, is worked out in lib/login.ts —
         * shared with the clinic-picker endpoint so the two can never disagree
         * about which account a password opens.
         *
         * Every outcome other than `ok` is null here. NextAuth's Credentials
         * provider has no way to return a reason without also deciding how it
         * is rendered, and an authorisation decision should not be in the
         * business of writing user-facing copy; the sign-in page asks
         * /api/public/login-clinics when it needs to tell the two apart.
         */
        const outcome = await resolveLogin({
          email,
          password,
          clinicSlug: clinic || null,
          context: requestContext(request?.headers as Headers | undefined),
        })

        if (outcome.status !== 'ok') return null

        return outcome.identity
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
})

// Helper function to get current user
export async function getCurrentUser() {
  const session = await auth()
  return session?.user
}

// Helper function to check if user has required role.
//
// Prefer `can(role, permission)` from lib/rbac. This remains for the few places
// that genuinely care about identity rather than capability.
export function hasRole(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.includes(userRole)
}

// `roleHierarchy` and `hasMinimumRole` used to live here, ranking the five
// roles 1-5 so that a check could ask for "DOCTOR or above".
//
// They are gone because the premise does not hold. Roles are not a ladder: an
// Inventory/Store user is not a weaker Front Desk user, and a Cashier is not a
// junior Dentist — specification §4 gives each one a different set, and the
// sets overlap rather than nest. "ACCOUNTANT >= RECEPTIONIST" would have
// granted a cashier the clinical access the spec explicitly withholds.
//
// Nothing in the application used them; only tests did. Ask for the capability
// you need instead: `can(role, 'billing:refund')`.

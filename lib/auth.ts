import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'
import { prisma } from './prisma'
import { z } from 'zod'
import { AUDIT_ACTIONS, recordAudit, requestContext } from './audit'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const validated = loginSchema.safeParse(credentials)

        if (!validated.success) return null

        const { email, password } = validated.data
        const context = requestContext(request?.headers as Headers | undefined)

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            staff: true,
            hospital: true,
          },
        })

        /**
         * Spec §10 wants login recorded. Failures are recorded too — a
         * deactivated account being tried, or a run of wrong passwords, is
         * exactly what an audit trail is for.
         *
         * An unknown email is deliberately *not* recorded: `AuditLog` hangs off
         * a clinic, and an address that matches no user belongs to no clinic.
         * Writing those somewhere would also mean an unauthenticated caller
         * could fill the table at will.
         */
        if (!user) return null

        if (!user.isActive) {
          await recordAudit({
            hospitalId: user.hospitalId,
            userId: user.id,
            action: AUDIT_ACTIONS.LOGIN_FAILED_USER_INACTIVE,
            entityType: 'User',
            entityId: user.id,
            ...context,
          })
          return null
        }

        if (!user.hospital || !user.hospital.isActive) {
          await recordAudit({
            hospitalId: user.hospitalId,
            userId: user.id,
            action: AUDIT_ACTIONS.LOGIN_FAILED_CLINIC_INACTIVE,
            entityType: 'User',
            entityId: user.id,
            ...context,
          })
          return null
        }

        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) {
          await recordAudit({
            hospitalId: user.hospitalId,
            userId: user.id,
            action: AUDIT_ACTIONS.LOGIN_FAILED_PASSWORD,
            entityType: 'User',
            entityId: user.id,
            ...context,
          })
          return null
        }

        await recordAudit({
          hospitalId: user.hospitalId,
          userId: user.id,
          action: AUDIT_ACTIONS.LOGIN_SUCCESS,
          entityType: 'User',
          entityId: user.id,
          // The role is worth having on the entry: reading the trail later,
          // "who could do what at the time" is the question being asked.
          newValues: { role: user.role, clinicalRole: user.clinicalRole },
          ...context,
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clinicalRole: user.clinicalRole ?? undefined,
          staffId: user.staff?.id,
          hospitalId: user.hospitalId,
          isHospitalAdmin: user.isHospitalAdmin,
        }
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

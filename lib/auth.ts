import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'
import { prisma } from './prisma'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const validated = loginSchema.safeParse(credentials)

        if (!validated.success) return null

        const { email, password } = validated.data

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            staff: true,
            hospital: true,
          },
        })

        if (!user || !user.isActive) return null

        // Check if the user's hospital is active
        if (!user.hospital || !user.hospital.isActive) return null

        const passwordMatch = await bcrypt.compare(password, user.password)
        if (!passwordMatch) return null

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

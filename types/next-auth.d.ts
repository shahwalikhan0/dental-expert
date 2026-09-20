import 'next-auth'

declare module 'next-auth' {
  interface User {
    id: string
    email: string
    name: string
    role: string
    /** Optional second role; capabilities are the union. See lib/rbac.ts. */
    clinicalRole?: string
    staffId?: string
    hospitalId: string
    isHospitalAdmin: boolean
    /**
     * Staff of the platform, not of a clinic. Orthogonal to `role`, which says
     * what someone may do *inside* the clinic they belong to.
     */
    isPlatformAdmin?: boolean
    image?: string | null
    /**
     * The clinic's session timeout, stamped onto the token at sign-in so that
     * enforcing it costs no database read. See lib/security-settings.ts.
     */
    sessionTimeoutMinutes?: number
    /** Password expired, or set by an administrator. Forces the change form. */
    mustChangePassword?: boolean
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: string
      clinicalRole?: string
      staffId?: string
      hospitalId: string
      isHospitalAdmin: boolean
      isPlatformAdmin?: boolean
      mustChangePassword?: boolean
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: string
    clinicalRole?: string
    staffId?: string
    hospitalId: string
    isHospitalAdmin: boolean
    isPlatformAdmin?: boolean
    /** Minutes this session may last, from the clinic's security settings. */
    sessionTimeoutMinutes?: number
    /** When the session began, in epoch milliseconds. */
    signedInAt?: number
    mustChangePassword?: boolean
  }
}

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
  }
}

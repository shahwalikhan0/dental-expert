// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'

// Mock NextAuth and dependencies so the module loads without DB
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
  })),
}))
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({})),
}))
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/auth.config', () => ({
  authConfig: { providers: [], callbacks: {} },
}))

import { hasRole } from '@/lib/auth'
import { ALL_ROLES } from '@/lib/rbac'

describe('hasRole', () => {
  it('returns true when role is in allowed list', () => {
    expect(hasRole('ADMIN', ['ADMIN', 'DOCTOR'])).toBe(true)
  })

  it('returns false when role is not in allowed list', () => {
    expect(hasRole('LAB_TECH', ['ADMIN', 'DOCTOR'])).toBe(false)
  })

  it('returns true for single matching role', () => {
    expect(hasRole('DOCTOR', ['DOCTOR'])).toBe(true)
  })

  it('returns false for empty allowed list', () => {
    expect(hasRole('ADMIN', [])).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasRole('admin', ['ADMIN'])).toBe(false)
  })

  it('works for all defined roles', () => {
    const allRoles = [...ALL_ROLES]
    allRoles.forEach((role) => {
      expect(hasRole(role, allRoles)).toBe(true)
    })
  })
})

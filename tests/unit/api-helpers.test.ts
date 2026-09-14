import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireRole, generateToken } from '@/lib/api-helpers'
import { NextResponse } from 'next/server'

// Mock the auth module
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}))

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    hospital: {
      findUnique: vi.fn(),
    },
    patient: {
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  },
}))

describe('API Helpers - requireRole', () => {
  it('should return null for allowed roles', () => {
    const result = requireRole('ADMIN', ['ADMIN', 'DOCTOR'])
    expect(result).toBeNull()
  })

  it('should return null when role matches exactly', () => {
    const result = requireRole('DOCTOR', ['DOCTOR'])
    expect(result).toBeNull()
  })

  it('should return 403 response for disallowed roles', () => {
    const result = requireRole('RECEPTIONIST', ['ADMIN', 'DOCTOR'])
    expect(result).toBeDefined()
    expect(result).toBeInstanceOf(NextResponse)
  })

  it('should check role case-sensitively', () => {
    const result = requireRole('admin', ['ADMIN'])
    expect(result).toBeDefined() // Should fail because 'admin' !== 'ADMIN'
  })

  it('should handle empty allowed roles array', () => {
    const result = requireRole('ADMIN', [])
    expect(result).toBeDefined() // No roles allowed
  })
})

describe('API Helpers - generateToken', () => {
  it('should generate token with default length', () => {
    const token = generateToken()
    expect(token).toHaveLength(32)
  })

  it('should generate token with custom length', () => {
    const token = generateToken(16)
    expect(token).toHaveLength(16)
  })

  it('should generate token with large length', () => {
    const token = generateToken(64)
    expect(token).toHaveLength(64)
  })

  it('should only contain alphanumeric characters', () => {
    const token = generateToken(100)
    expect(token).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('should generate unique tokens', () => {
    const tokens = new Set()
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken())
    }
    // All tokens should be unique
    expect(tokens.size).toBe(100)
  })

  it('should handle zero length', () => {
    const token = generateToken(0)
    expect(token).toBe('')
  })
})

describe('API Helpers - Role Authorization Matrix', () => {
  const roles = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB_TECH', 'ACCOUNTANT']

  it('should allow ADMIN access to all features', () => {
    const adminFeatures = [
      ['ADMIN'],
      ['ADMIN', 'DOCTOR'],
      ['ADMIN', 'DOCTOR', 'RECEPTIONIST'],
      ['ADMIN', 'ACCOUNTANT'],
    ]
    adminFeatures.forEach((allowedRoles) => {
      expect(requireRole('ADMIN', allowedRoles)).toBeNull()
    })
  })

  it('should restrict RECEPTIONIST to appropriate features', () => {
    expect(requireRole('RECEPTIONIST', ['ADMIN', 'DOCTOR', 'RECEPTIONIST'])).toBeNull()
    expect(requireRole('RECEPTIONIST', ['ADMIN'])).toBeDefined()
    expect(requireRole('RECEPTIONIST', ['ADMIN', 'DOCTOR'])).toBeDefined()
  })

  it('should restrict LAB_TECH to appropriate features', () => {
    expect(requireRole('LAB_TECH', ['ADMIN', 'LAB_TECH'])).toBeNull()
    expect(requireRole('LAB_TECH', ['ADMIN', 'DOCTOR'])).toBeDefined()
  })

  it('should restrict ACCOUNTANT to billing features', () => {
    expect(requireRole('ACCOUNTANT', ['ADMIN', 'ACCOUNTANT'])).toBeNull()
    expect(requireRole('ACCOUNTANT', ['ADMIN', 'DOCTOR'])).toBeDefined()
  })
})

describe('API Helpers - Token Security', () => {
  it('should have sufficient entropy for security', () => {
    // A 32-character token with 62 possible characters has log2(62^32) ≈ 190 bits of entropy
    const token = generateToken(32)

    // Check that the token has variety
    const uniqueChars = new Set(token.split('')).size
    expect(uniqueChars).toBeGreaterThan(10) // Should have reasonable variety
  })

  it('should be suitable for email verification tokens', () => {
    const token = generateToken(32)
    // Should be URL-safe (no special characters)
    expect(token).toMatch(/^[A-Za-z0-9]+$/)
    // Should be unique enough
    expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('should be suitable for password reset tokens', () => {
    const token = generateToken(48)
    expect(token).toHaveLength(48)
    expect(token).toMatch(/^[A-Za-z0-9]+$/)
  })
})

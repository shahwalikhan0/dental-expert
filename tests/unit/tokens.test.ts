import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

import { prisma } from '@/lib/prisma'
import {
  formatToken,
  isTokenForToday,
  issueToken,
  nextToken,
  tokenDay,
  tokenPrefix,
  tokenSequence,
} from '@/lib/tokens'

/**
 * Queue tokens — DDMMYY then a three-digit sequence.
 *
 * The date lives inside the number on purpose: a token read across a waiting
 * room or written on a slip carries its own day, so yesterday's slip cannot be
 * mistaken for today's.
 */

const KARACHI = 'Asia/Karachi'

beforeEach(() => vi.clearAllMocks())

describe('token format', () => {
  it('builds the day prefix as DDMMYY', () => {
    expect(tokenPrefix('2026-09-20')).toBe('200926')
  })

  it('reads the day back out of a token', () => {
    expect(tokenDay('200926001')).toBe('2026-09-20')
    expect(tokenDay('011226047')).toBe('2026-12-01')
  })

  it('reads the sequence', () => {
    expect(tokenSequence('200926001')).toBe(1)
    expect(tokenSequence('200926047')).toBe(47)
  })

  it('refuses something that is not a token', () => {
    expect(tokenDay('hello')).toBeNull()
    expect(tokenSequence('20092')).toBeNull()
    expect(tokenDay('2009260001')).toBeNull()
  })

  it('counts up within the day', () => {
    expect(nextToken('200926', null)).toBe('200926001')
    expect(nextToken('200926', '200926001')).toBe('200926002')
    expect(nextToken('200926', '200926099')).toBe('200926100')
  })

  it('starts again at 001 on a new day', () => {
    // The prefix is the day, so yesterday's last number cannot carry over.
    expect(nextToken('210926', '200926087')).toBe('210926088')
  })

  it('shows the short form, because that is what gets called out', () => {
    expect(formatToken('200926001')).toBe('#1')
    expect(formatToken('200926047')).toBe('#47')
    expect(formatToken(null)).toBe('—')
    // Not a token: shown as it is rather than hidden.
    expect(formatToken('whatever')).toBe('whatever')
  })

  it('knows whether a token belongs to today', () => {
    expect(isTokenForToday('200926001', '2026-09-20')).toBe(true)
    expect(isTokenForToday('190926001', '2026-09-20')).toBe(false)
  })
})

describe('issueToken', () => {
  it('issues the first number of the clinic day', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as never)

    const token = await issueToken(prisma, 'h1', KARACHI, new Date('2026-09-20T06:00:00Z'))

    expect(token).toBe('200926001')
  })

  it('continues from the highest already issued', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      tokenNumber: '200926011',
    } as never)

    const token = await issueToken(prisma, 'h1', KARACHI, new Date('2026-09-20T06:00:00Z'))

    expect(token).toBe('200926012')
  })

  it('only looks at today, by prefix', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as never)

    await issueToken(prisma, 'h1', KARACHI, new Date('2026-09-20T06:00:00Z'))

    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hospitalId: 'h1', tokenNumber: { startsWith: '200926' } },
      })
    )
  })

  // The clinic's day, not the server's. On a UTC host a Karachi clinic's first
  // five hours belong to the previous calendar day, and a token issued at 00:30
  // would otherwise carry yesterday's date.
  it('uses the clinic day, not the host day', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as never)

    // 19:30 UTC is 00:30 on the 21st in Karachi.
    const token = await issueToken(prisma, 'h1', KARACHI, new Date('2026-09-20T19:30:00Z'))

    expect(token).toBe('210926001')
  })
})

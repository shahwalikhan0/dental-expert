/**
 * Rate limiting the doors anybody can knock on.
 *
 * The behaviour that matters is the boundary: the last allowed request, the
 * first refused one, and that a new window starts clean. The rest of the file
 * is about not confusing one caller with another.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { bucketFor, callerKey, rateLimit } from '@/lib/rate-limit'

afterEach(() => {
  vi.useRealTimers()
})

/** A key nothing else in this file will collide with. */
let n = 0
const freshKey = () => `test-${++n}-${Math.random()}`

describe('rateLimit', () => {
  it('allows up to the limit and refuses the one after', () => {
    const key = freshKey()
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000).ok).toBe(true)
    }
    expect(rateLimit(key, 5, 60_000).ok).toBe(false)
  })

  it('counts down what is left', () => {
    const key = freshKey()
    expect(rateLimit(key, 3, 60_000).remaining).toBe(2)
    expect(rateLimit(key, 3, 60_000).remaining).toBe(1)
    expect(rateLimit(key, 3, 60_000).remaining).toBe(0)
  })

  it('says how long to wait, and only when refusing', () => {
    const key = freshKey()
    expect(rateLimit(key, 1, 60_000).retryAfter).toBe(0)
    const refused = rateLimit(key, 1, 60_000)
    expect(refused.ok).toBe(false)
    expect(refused.retryAfter).toBeGreaterThan(0)
    expect(refused.retryAfter).toBeLessThanOrEqual(60)
  })

  it('starts again once the window has passed', () => {
    vi.useFakeTimers()
    const key = freshKey()

    expect(rateLimit(key, 2, 1000).ok).toBe(true)
    expect(rateLimit(key, 2, 1000).ok).toBe(true)
    expect(rateLimit(key, 2, 1000).ok).toBe(false)

    vi.advanceTimersByTime(1001)
    expect(rateLimit(key, 2, 1000).ok).toBe(true)
  })

  it('keeps callers apart', () => {
    const a = freshKey()
    const b = freshKey()
    expect(rateLimit(a, 1, 60_000).ok).toBe(true)
    expect(rateLimit(a, 1, 60_000).ok).toBe(false)
    // b has its own budget and is unaffected by a exhausting theirs.
    expect(rateLimit(b, 1, 60_000).ok).toBe(true)
  })
})

describe('callerKey', () => {
  it('takes the client from the front of x-forwarded-for', () => {
    // Left to right is client, then each proxy. The first entry is the client
    // as the outermost proxy saw it.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })
    expect(callerKey(headers)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(callerKey(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('limits an unidentifiable caller rather than exempting one', () => {
    // One shared bucket is the point: no header must not mean no limit.
    expect(callerKey(new Headers())).toBe('unidentified')
    expect(callerKey(new Headers({ 'x-forwarded-for': '  ' }))).toBe('unidentified')
  })
})

describe('bucketFor', () => {
  it('guards signing in, by both of its doors', () => {
    // `/api/public/login-clinics` needs the password before it answers, so it
    // is exactly as attackable as the sign-in route itself.
    expect(bucketFor('/api/auth/callback/credentials')?.name).toBe('signin')
    expect(bucketFor('/api/public/login-clinics')?.name).toBe('signin')
  })

  it('guards the endpoints that send mail or create tenants', () => {
    expect(bucketFor('/api/public/password-reset')?.name).toBe('reset')
    expect(bucketFor('/api/public/password-reset/confirm')?.name).toBe('reset')
    expect(bucketFor('/api/auth/register')?.name).toBe('signup')
  })

  it('guards public booking, and reads more generously than writes', () => {
    const book = bucketFor('/api/public/smile-dental/book')
    const slots = bucketFor('/api/public/smile-dental/slots')
    expect(book?.name).toBe('booking')
    expect(slots?.name).toBe('availability')
    expect(slots!.limit).toBeGreaterThan(book!.limit)
  })

  it('leaves the signed-in application alone', () => {
    // Throttling the desk mid-clinic is its own kind of outage, and a signed-in
    // user hammering a list is a different problem with a different answer.
    expect(bucketFor('/api/patients')).toBeNull()
    expect(bucketFor('/api/appointments')).toBeNull()
    expect(bucketFor('/dashboard')).toBeNull()
  })

  it('does not mistake a nested public path for a bookable one', () => {
    expect(bucketFor('/api/public/smile-dental/book/extra')).toBeNull()
  })
})

/**
 * Bug report 12 Oct, finding 30: a date of birth in 2030, `xyz` as a phone
 * number and `nope` as an email address were all registered.
 */
import { describe, it, expect } from 'vitest'
import {
  dateOfBirthProblem,
  isValidEmail,
  isValidPhone,
  patientContactProblem,
} from '@/lib/patient-validation'

const NOW = new Date('2026-10-12T09:00:00Z')

describe('isValidPhone', () => {
  it.each(['03001234567', '+92 300 1234567', '0300-1234567', '9876543210', '1234567'])(
    'accepts %s',
    (phone) => expect(isValidPhone(phone)).toBe(true)
  )

  it.each(['xyz', '123456', '+92 300 1234567 1234 5', '0300.1234567', '++923001234567', ''])(
    'refuses %s',
    (phone) => expect(isValidPhone(phone)).toBe(false)
  )
})

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => expect(isValidEmail('a.khan@clinic.pk')).toBe(true))
  it.each(['nope', 'a@b', 'a b@c.pk', '@clinic.pk'])('refuses %s', (email) =>
    expect(isValidEmail(email)).toBe(false)
  )
})

describe('dateOfBirthProblem', () => {
  it('refuses a date in the future', () => {
    expect(dateOfBirthProblem('2030-01-01', NOW)).toMatch(/future/)
  })

  it('accepts today, even where the calendar is ahead of UTC', () => {
    // 01:00 on the 13th in Karachi is still the 12th in UTC.
    expect(dateOfBirthProblem('2026-10-13', new Date('2026-10-12T20:00:00Z'))).toBeNull()
  })

  it('judges exactly against the caller’s own day when it is given', () => {
    expect(dateOfBirthProblem('2026-10-13', NOW, { today: '2026-10-12' })).toMatch(/future/)
    expect(dateOfBirthProblem('2026-10-12', NOW, { today: '2026-10-12' })).toBeNull()
  })

  it('refuses something that is not a date', () => {
    expect(dateOfBirthProblem('not a date', NOW)).toMatch(/not a valid date/)
  })

  it('accepts no date at all', () => {
    expect(dateOfBirthProblem(null, NOW)).toBeNull()
    expect(dateOfBirthProblem('', NOW)).toBeNull()
  })
})

describe('patientContactProblem', () => {
  it('passes a complete, valid set', () => {
    expect(
      patientContactProblem(
        {
          phone: '0300 1234567',
          alternatePhone: '',
          emergencyContactPhone: '+923001234567',
          email: 'a@b.pk',
          dateOfBirth: '1990-01-15',
        },
        NOW
      )
    ).toBeNull()
  })

  it('names the field that is wrong', () => {
    expect(patientContactProblem({ phone: 'xyz' }, NOW)).toMatch(/^Phone/)
    expect(patientContactProblem({ emergencyContactPhone: 'call mum' }, NOW)).toMatch(
      /^Emergency contact phone/
    )
    expect(patientContactProblem({ email: 'nope' }, NOW)).toMatch(/Email/)
    expect(patientContactProblem({ dateOfBirth: '2030-01-01' }, NOW)).toMatch(/future/)
  })
})

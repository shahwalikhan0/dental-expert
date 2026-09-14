/**
 * Whether a patient may be contacted.
 *
 * The bug these defaults exist to fix: `PatientCommunicationPreference` had
 * fifteen columns and sensible defaults on every one of them — and nothing in
 * the application ever created a row. So every patient had no preferences at
 * all, and the SMS service read
 *
 *     if (!preference?.smsEnabled) throw new Error('Patient has disabled SMS')
 *
 * which refused every patient-addressed SMS in the system. The column defaults
 * said `true`; the absent row said `undefined`; and `undefined` is not `true`.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  MESSAGE_KINDS,
  communicationPreferences,
  mayContact,
} from '@/lib/communication-preferences'

describe('communicationPreferences', () => {
  it('gives a patient who has said nothing the defaults', () => {
    expect(communicationPreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(communicationPreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
  })

  it('ignores a stored value that is not an object', () => {
    expect(communicationPreferences('yes')).toEqual(DEFAULT_PREFERENCES)
    expect(communicationPreferences(42)).toEqual(DEFAULT_PREFERENCES)
    expect(communicationPreferences([])).toEqual(DEFAULT_PREFERENCES)
  })

  /**
   * Merging rather than replacing. An unsubscribe link writes
   * `{ promotions: false }` and nothing else — if that replaced the whole
   * object, declining one marketing message would also switch off the
   * reminder for next week's appointment.
   */
  it('fills in the settings a stored preference does not mention', () => {
    const prefs = communicationPreferences({ promotions: false })

    expect(prefs.promotions).toBe(false)
    expect(prefs.appointmentReminders).toBe(true)
    expect(prefs.sms).toBe(true)
  })

  it('keeps an explicit false', () => {
    expect(communicationPreferences({ sms: false }).sms).toBe(false)
  })

  it('ignores a value of the wrong type rather than treating it as false', () => {
    expect(communicationPreferences({ sms: 'no' }).sms).toBe(true)
  })

  it('carries the preferred channel and the unsubscribe date through', () => {
    const prefs = communicationPreferences({
      preferredChannel: 'EMAIL',
      unsubscribedAt: '2026-01-05T00:00:00.000Z',
    })
    expect(prefs.preferredChannel).toBe('EMAIL')
    expect(prefs.unsubscribedAt).toBe('2026-01-05T00:00:00.000Z')
  })
})

describe('mayContact', () => {
  const prefs = (overrides = {}) => communicationPreferences(overrides)

  it('allows an appointment reminder by default', () => {
    expect(mayContact(prefs(), 'SMS', 'appointmentReminders')).toEqual({ allowed: true })
  })

  it('refuses a channel the patient has turned off', () => {
    const decision = mayContact(prefs({ sms: false }), 'SMS')
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('sms')
  })

  it('refuses one kind of message without refusing the rest', () => {
    expect(mayContact(prefs({ promotions: false }), 'SMS', 'promotions').allowed).toBe(false)
    expect(mayContact(prefs({ promotions: false }), 'SMS', 'appointmentReminders').allowed).toBe(
      true
    )
  })

  /**
   * A blanket refusal beats everything, including the reminders the patient's
   * own care depends on. If somebody has asked not to be contacted, that is
   * the answer — not "except for the important ones", which is what every
   * organisation that ignores a do-not-contact request tells itself.
   */
  it('refuses everything for a patient who asked not to be contacted', () => {
    const blanket = prefs({ doNotContact: true, sms: true, appointmentReminders: true })

    for (const kind of MESSAGE_KINDS) {
      expect(mayContact(blanket, 'SMS', kind).allowed, kind).toBe(false)
    }
    expect(mayContact(blanket, 'EMAIL').allowed).toBe(false)
  })

  it('says why, so the refusal can be recorded against the message', () => {
    const decision = mayContact(prefs({ doNotContact: true }), 'SMS')
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toMatch(/not to be contacted/)
  })

  /**
   * IN_APP is the notification tray inside the clinic's own software, not
   * something a patient consents to separately — there is no channel flag for
   * it and it must not be refused for want of one.
   */
  it('does not gate the in-app tray on a channel consent that does not exist', () => {
    expect(mayContact(prefs({ sms: false, email: false }), 'IN_APP').allowed).toBe(true)
  })

  it('refuses whatsapp until the patient opts in', () => {
    expect(mayContact(prefs(), 'WHATSAPP').allowed).toBe(false)
    expect(mayContact(prefs({ whatsapp: true }), 'WHATSAPP').allowed).toBe(true)
  })
})

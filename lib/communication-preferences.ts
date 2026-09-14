/**
 * How a patient wants to be contacted, and about what.
 *
 * This was a fifteen-column table with one row per patient — except that
 * nothing in the application ever created a row. Every patient therefore had no
 * preferences at all, and `SMSService.sendSMS` read
 *
 *     if (!preference?.smsEnabled) throw new Error('Patient has disabled SMS')
 *
 * so **every** patient-addressed SMS was refused, on the grounds of a
 * preference nobody had ever expressed. The column defaults said `true`; the
 * absent row said undefined; and undefined is not true.
 *
 * The fix is to put the defaults where they can actually apply. Preferences now
 * live in one JSON column on the patient, and a patient who has never said
 * anything gets `DEFAULT_PREFERENCES` — which is what the old column defaults
 * were trying to say.
 *
 * Opt-out rather than opt-in, deliberately, and only for the messages the
 * patient's own care depends on: an appointment reminder and a payment
 * reminder are part of the service they came for. Promotions default on because
 * that is what the previous schema said, and changing it silently would be a
 * business decision dressed up as a refactor — but see `doNotContact`, which
 * overrides everything.
 */
import type { CommunicationChannel } from '@prisma/client'

/** What a message is for. Each is separately refusable. */
export const MESSAGE_KINDS = [
  'appointmentReminders',
  'paymentReminders',
  'promotions',
  'birthdayWishes',
] as const

export type MessageKind = (typeof MESSAGE_KINDS)[number]

export interface CommunicationPreferences {
  /** Per-channel consent. */
  sms: boolean
  email: boolean
  whatsapp: boolean

  appointmentReminders: boolean
  paymentReminders: boolean
  promotions: boolean
  birthdayWishes: boolean

  /** Which channel to use when a message could go by more than one. */
  preferredChannel: CommunicationChannel

  /**
   * A blanket refusal. Overrides every other setting, including the
   * appointment reminders the patient's own care depends on — if somebody has
   * asked not to be contacted, that is the answer.
   */
  doNotContact: boolean

  /** ISO timestamp of when they unsubscribed, if they did. */
  unsubscribedAt: string | null
}

export const DEFAULT_PREFERENCES: CommunicationPreferences = {
  sms: true,
  email: true,
  whatsapp: false,
  appointmentReminders: true,
  paymentReminders: true,
  promotions: true,
  birthdayWishes: true,
  preferredChannel: 'SMS',
  doNotContact: false,
  unsubscribedAt: null,
}

/**
 * A patient's preferences, with defaults filled in.
 *
 * Merges rather than replaces, so a stored `{ promotions: false }` — which is
 * what an unsubscribe link writes — leaves every other setting at its default
 * instead of silently switching the rest off.
 */
export function communicationPreferences(
  stored: unknown | null | undefined
): CommunicationPreferences {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...DEFAULT_PREFERENCES }
  }

  const raw = stored as Record<string, unknown>
  const bool = (key: keyof CommunicationPreferences) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULT_PREFERENCES[key] as boolean)

  return {
    sms: bool('sms'),
    email: bool('email'),
    whatsapp: bool('whatsapp'),
    appointmentReminders: bool('appointmentReminders'),
    paymentReminders: bool('paymentReminders'),
    promotions: bool('promotions'),
    birthdayWishes: bool('birthdayWishes'),
    preferredChannel:
      typeof raw.preferredChannel === 'string'
        ? (raw.preferredChannel as CommunicationChannel)
        : DEFAULT_PREFERENCES.preferredChannel,
    doNotContact: bool('doNotContact'),
    unsubscribedAt: typeof raw.unsubscribedAt === 'string' ? raw.unsubscribedAt : null,
  }
}

const CHANNEL_CONSENT: Partial<Record<CommunicationChannel, keyof CommunicationPreferences>> = {
  SMS: 'sms',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
}

/**
 * Whether a message may be sent, and if not, why not.
 *
 * Returns the reason rather than a bare boolean because the caller has to put
 * it somewhere — a log line, or the `errorMessage` on the message row — and
 * "not sent" without a reason is the kind of thing somebody has to reproduce
 * by hand six months later.
 */
export function mayContact(
  preferences: CommunicationPreferences,
  channel: CommunicationChannel,
  kind?: MessageKind
): { allowed: true } | { allowed: false; reason: string } {
  if (preferences.doNotContact) {
    return { allowed: false, reason: 'Patient has asked not to be contacted' }
  }

  // IN_APP is not a channel a patient consents to separately: it is the
  // notification tray inside the clinic's own software.
  const consent = CHANNEL_CONSENT[channel]
  if (consent && !preferences[consent]) {
    return { allowed: false, reason: `Patient has turned off ${channel.toLowerCase()} messages` }
  }

  if (kind && !preferences[kind]) {
    return { allowed: false, reason: `Patient has turned off ${LABELS[kind]}` }
  }

  return { allowed: true }
}

const LABELS: Record<MessageKind, string> = {
  appointmentReminders: 'appointment reminders',
  paymentReminders: 'payment reminders',
  promotions: 'promotional messages',
  birthdayWishes: 'birthday messages',
}

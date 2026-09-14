/**
 * Sending an SMS.
 *
 * This shipped supporting four gateways: MSG91, TextLocal, Fast2SMS and Twilio.
 * The first three are Indian aggregators. None of them will deliver to a
 * Pakistani number — they require an Indian sender registered under TRAI's DLT
 * scheme, which a Pakistani clinic cannot obtain — so three of the four options
 * on the settings screen were three ways to have messages silently fail. They
 * are gone; Twilio, which delivers worldwide, is what remains.
 *
 * Adding a local aggregator is one method on this class plus a value in
 * `SMSGateway`. That is deliberately the whole extension point.
 */
import prisma from '@/lib/prisma'
import {
  communicationPreferences,
  mayContact,
  type MessageKind,
} from '@/lib/communication-preferences'
import {
  DEFAULT_SEND_WINDOW,
  SEND_WINDOW_END_KEY,
  SEND_WINDOW_START_KEY,
  describeSendWindow,
  isWithinSendWindow,
} from '@/lib/send-window'

export const SMS_GATEWAYS = ['TWILIO'] as const

export type SMSGateway = (typeof SMS_GATEWAYS)[number]

export interface SMSConfig {
  gateway: SMSGateway
  apiKey: string
  senderId: string
  route?: string
  authKey?: string
}

export interface SMSPayload {
  hospitalId?: string
  phone: string
  message: string
  patientId?: string
  templateId?: string
  scheduledFor?: Date
  /** What the message is for, so the patient can refuse this kind alone. */
  kind?: MessageKind
  /** The record this message is about — an appointment, an invoice. */
  relatedType?: string
  relatedId?: string
}

class SMSService {
  private config: SMSConfig | null = null

  async initialize() {
    // Load SMS configuration from settings
    const settings = await prisma.setting.findMany({
      where: {
        category: 'sms',
      },
    })

    if (settings.length === 0) {
      throw new Error('SMS gateway not configured')
    }

    this.config = {
      gateway: (settings.find((s) => s.key === 'sms.gateway')?.value || 'TWILIO') as SMSGateway,
      apiKey: settings.find((s) => s.key === 'sms.apiKey')?.value || '',
      senderId: settings.find((s) => s.key === 'sms.senderId')?.value || '',
      route: settings.find((s) => s.key === 'sms.route')?.value,
      authKey: settings.find((s) => s.key === 'sms.authKey')?.value,
    }

    if (!this.config.apiKey) {
      throw new Error('SMS API key not configured')
    }
  }

  async sendSMS(payload: SMSPayload): Promise<string> {
    // Validate phone number (Indian format)
    if (!this.isValidPakistanPhoneNumber(payload.phone)) {
      throw new Error('Invalid phone number format')
    }

    // Check the patient's preferences, with defaults for the patients who have
    // never expressed one — which is almost all of them. The previous version
    // read a table nothing ever wrote to, so `!preference?.smsEnabled` was true
    // for every patient in the database and every patient-addressed SMS was
    // refused on the strength of a preference nobody had given.
    if (payload.patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: payload.patientId },
        select: { communicationPrefs: true },
      })

      const decision = mayContact(
        communicationPreferences(patient?.communicationPrefs),
        'SMS',
        payload.kind
      )
      if (!decision.allowed) throw new Error(decision.reason)
    }

    // Not at an hour that would wake the patient up. The window is the
    // clinic's own, in the clinic's own timezone — it used to be 9am-9pm IST
    // hardcoded, which on a Pakistani clinic was half an hour out of step in
    // both directions.
    //
    // A message scheduled for later is not checked here: it is checked when it
    // is actually sent, which is the only time the question means anything.
    if (!payload.scheduledFor && payload.hospitalId) {
      const window = await this.sendWindowFor(payload.hospitalId)
      if (!isWithinSendWindow(window.timezone, window, new Date())) {
        throw new Error(
          `SMS can only be sent between ${describeSendWindow(window)} (${window.timezone})`
        )
      }
    }

    // Create SMS log entry
    const smsLog = await prisma.messageLog.create({
      data: {
        hospitalId: payload.hospitalId || '',
        channel: 'SMS',
        patientId: payload.patientId || null,
        recipient: payload.phone,
        body: payload.message,
        templateId: payload.templateId || null,
        relatedType: payload.relatedType ?? null,
        relatedId: payload.relatedId ?? null,
        scheduledFor: payload.scheduledFor,
        status: payload.scheduledFor ? 'PENDING' : 'QUEUED',
        provider: this.config?.gateway,
      },
    })

    // If scheduled for later, return
    if (payload.scheduledFor && payload.scheduledFor > new Date()) {
      return smsLog.id
    }

    // Send SMS immediately
    try {
      await this.initialize()
      const result = await this.sendViaGateway(payload)

      // Update SMS log
      await prisma.messageLog.update({
        where: { id: smsLog.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerRef: result.messageId,
          cost: result.cost,
        },
      })

      return smsLog.id
    } catch (error: any) {
      // Update SMS log with error
      await prisma.messageLog.update({
        where: { id: smsLog.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message,
        },
      })

      throw error
    }
  }

  async sendBulkSMS(payloads: SMSPayload[]): Promise<string[]> {
    const results = await Promise.allSettled(payloads.map((payload) => this.sendSMS(payload)))

    return results.map((result, index) => (result.status === 'fulfilled' ? result.value : ''))
  }

  private async sendViaGateway(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    if (!this.config) {
      await this.initialize()
    }

    switch (this.config?.gateway) {
      case 'TWILIO':
        return this.sendViaTwilio(payload)
      default:
        throw new Error(`Unsupported SMS gateway: ${this.config?.gateway}`)
    }
  }

  /**
   * The clinic's send window, and the timezone to read it in.
   *
   * Two settings and one column, in one query each. Falls back to the default
   * window and to Pakistan's timezone if the clinic row has somehow gone.
   */
  private async sendWindowFor(
    hospitalId: string
  ): Promise<{ start: string; end: string; timezone: string }> {
    const [hospital, settings] = await Promise.all([
      prisma.hospital.findUnique({ where: { id: hospitalId }, select: { timezone: true } }),
      prisma.setting.findMany({
        where: { hospitalId, key: { in: [SEND_WINDOW_START_KEY, SEND_WINDOW_END_KEY] } },
        select: { key: true, value: true },
      }),
    ])

    const value = (key: string) => settings.find((s) => s.key === key)?.value

    return {
      start: value(SEND_WINDOW_START_KEY) || DEFAULT_SEND_WINDOW.start,
      end: value(SEND_WINDOW_END_KEY) || DEFAULT_SEND_WINDOW.end,
      timezone: hospital?.timezone || 'Asia/Karachi',
    }
  }

  private async sendViaTwilio(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    // Twilio implementation
    const accountSid = this.config?.authKey
    const authToken = this.config?.apiKey
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

    const params = new URLSearchParams({
      To: '+92' + this.normalizePhoneNumber(payload.phone),
      From: this.config?.senderId || '',
      Body: payload.message,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: params,
    })

    const data = await response.json()

    if (data.error_code) {
      throw new Error(data.error_message || 'Failed to send SMS via Twilio')
    }

    return {
      messageId: data.sid || '',
    }
  }

  private isValidPakistanPhoneNumber(phone: string): boolean {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '')

    // Check if it's a valid 10-digit Pakistani mobile number (3XX XXXXXXX)
    return /^3\d{9}$/.test(cleaned)
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters and return 10-digit number
    return phone.replace(/\D/g, '').slice(-10)
  }

  async processTemplate(templateId: string, variables: Record<string, string>): Promise<string> {
    const template = await prisma.communicationTemplate.findUnique({
      where: { id: templateId },
    })

    if (!template || !template.isActive) {
      throw new Error('Template not found or inactive')
    }

    let content = template.content

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }

    return content
  }

  async getDeliveryStatus(smsLogId: string): Promise<string> {
    const smsLog = await prisma.messageLog.findUnique({
      where: { id: smsLogId },
    })

    if (!smsLog) {
      throw new Error('SMS log not found')
    }

    // In a real implementation, you would query the gateway API for delivery status
    return smsLog.status
  }

  async getSMSHistory(filters: {
    patientId?: string
    phone?: string
    status?: string
    from?: Date
    to?: Date
    limit?: number
  }) {
    const where: any = {}

    if (filters.patientId) where.patientId = filters.patientId
    if (filters.phone) where.recipient = { contains: filters.phone }
    if (filters.status) where.status = filters.status
    if (filters.from || filters.to) {
      where.createdAt = {}
      if (filters.from) where.createdAt.gte = filters.from
      if (filters.to) where.createdAt.lte = filters.to
    }

    return prisma.messageLog.findMany({
      where: { ...where, channel: 'SMS' },
      include: {
        template: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters.limit || 100,
    })
  }

  async checkBalance(): Promise<{ balance: number; currency: string }> {
    // This would query the SMS gateway for current balance
    // Implementation depends on gateway
    return {
      balance: 0,
      currency: 'PKR',
    }
  }
}

export const smsService = new SMSService()

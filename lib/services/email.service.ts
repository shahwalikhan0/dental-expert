// Email Service with SMTP Support
// Supports: Hostinger, Gmail SMTP, Custom SMTP

import prisma from '@/lib/prisma'
import { SendRefusal } from '@/lib/services/send-refusal'
import {
  communicationPreferences,
  mayContact,
  type MessageKind,
} from '@/lib/communication-preferences'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface EmailConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  from: {
    name: string
    email: string
  }
  replyTo?: string
}

export interface EmailPayload {
  /// Required: it decides whose SMTP account carries the message, whose address
  /// it appears to come from, and which clinic the log row belongs to.
  hospitalId: string
  to: string
  subject: string
  body: string
  patientId?: string
  templateId?: string
  attachments?: EmailAttachment[]
  scheduledFor?: Date
  /** What the message is for, so the patient can refuse this kind alone. */
  kind?: MessageKind
  /** The record this message is about — an appointment, an invoice. */
  relatedType?: string
  relatedId?: string
}

export interface EmailAttachment {
  filename: string
  path?: string
  content?: Buffer | string
  contentType?: string
}

class EmailService {
  /**
   * The clinic's own SMTP settings and a transporter for them.
   *
   * `hospitalId` is required, and that is the point. This used to read
   * `where: { category: 'email' }` with no clinic filter and cache both the
   * config and the transporter on the instance — and the service is a
   * module-level singleton, so on a multi-tenant install one clinic's mail went
   * out over whichever clinic's SMTP account loaded first, from their address,
   * with their reply-to.
   */
  async initialize(hospitalId: string): Promise<{ config: EmailConfig; transporter: Transporter }> {
    if (!hospitalId) {
      throw new Error('Email cannot be sent without a clinic')
    }

    const settings = await prisma.setting.findMany({
      where: { hospitalId, category: 'email' },
    })

    if (settings.length === 0) {
      throw new SendRefusal('Email not configured')
    }

    const config: EmailConfig = {
      host: settings.find((s) => s.key === 'email.smtp.host')?.value || '',
      port: parseInt(settings.find((s) => s.key === 'email.smtp.port')?.value || '587'),
      secure: settings.find((s) => s.key === 'email.smtp.secure')?.value === 'true',
      auth: {
        user: settings.find((s) => s.key === 'email.smtp.user')?.value || '',
        pass: settings.find((s) => s.key === 'email.smtp.password')?.value || '',
      },
      from: {
        name: settings.find((s) => s.key === 'email.from.name')?.value || 'Your Dental Clinic',
        email: settings.find((s) => s.key === 'email.from.email')?.value || '',
      },
      replyTo: settings.find((s) => s.key === 'email.replyTo')?.value,
    }

    if (!config.host || !config.auth.user || !config.auth.pass) {
      throw new SendRefusal('Email SMTP configuration incomplete')
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass,
      },
    })

    try {
      await transporter.verify()
    } catch {
      throw new SendRefusal('Failed to connect to SMTP server')
    }

    return { config, transporter }
  }

  async sendEmail(payload: EmailPayload): Promise<string> {
    // Validate email address
    if (!this.isValidEmail(payload.to)) {
      throw new SendRefusal('Invalid email address')
    }

    // Check patient preferences if patient is provided.
    //
    // Read through `communicationPreferences`, which supplies the defaults for
    // a patient who has never expressed one — which is almost all of them. The
    // previous version read a row that nothing ever created, so
    // `!preference?.emailEnabled` was true for every patient in the database
    // and no patient-addressed email was ever sent.
    if (payload.patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: payload.patientId },
        select: { communicationPrefs: true },
      })

      const decision = mayContact(
        communicationPreferences(patient?.communicationPrefs),
        'EMAIL',
        payload.kind
      )
      if (!decision.allowed) throw new SendRefusal(decision.reason)
    }

    const emailLog = await prisma.messageLog.create({
      data: {
        hospitalId: payload.hospitalId,
        channel: 'EMAIL',
        patientId: payload.patientId || null,
        recipient: payload.to,
        subject: payload.subject,
        body: payload.body,
        templateId: payload.templateId || null,
        relatedType: payload.relatedType ?? null,
        relatedId: payload.relatedId ?? null,
        scheduledFor: payload.scheduledFor,
        status: payload.scheduledFor ? 'PENDING' : 'QUEUED',
        metadata: payload.attachments
          ? {
              attachments: payload.attachments.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
              })),
            }
          : undefined,
      },
    })

    // Scheduled for later: it stays PENDING, and the dispatcher in
    // `lib/services/message-dispatch.ts` picks it up when it falls due.
    if (payload.scheduledFor && payload.scheduledFor > new Date()) {
      return emailLog.id
    }

    try {
      const { config, transporter } = await this.initialize(payload.hospitalId)

      const result = await transporter.sendMail({
        from: `"${config.from.name}" <${config.from.email}>`,
        to: payload.to,
        replyTo: config.replyTo || config.from.email,
        subject: payload.subject,
        html: payload.body,
        attachments: payload.attachments || [],
      })

      await prisma.messageLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          provider: config.host,
          providerRef: result.messageId,
        },
      })

      return emailLog.id
    } catch (error: any) {
      // Update email log with error
      await prisma.messageLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message,
        },
      })

      throw error
    }
  }

  /**
   * Hand one message to the SMTP server, without writing a log row.
   *
   * The counterpart to `smsService.deliver`, and for the same reason: the
   * dispatcher is draining a `MessageLog` row that already exists.
   */
  async deliver(
    to: string,
    subject: string,
    body: string,
    ctx: { config: EmailConfig; transporter: Transporter }
  ): Promise<{ messageId: string }> {
    if (!this.isValidEmail(to)) {
      throw new SendRefusal('Invalid email address')
    }

    const result = await ctx.transporter.sendMail({
      from: `"${ctx.config.from.name}" <${ctx.config.from.email}>`,
      to,
      replyTo: ctx.config.replyTo || ctx.config.from.email,
      subject,
      html: body,
    })

    return { messageId: result.messageId }
  }

  async sendBulkEmail(payloads: EmailPayload[]): Promise<string[]> {
    const results = await Promise.allSettled(payloads.map((payload) => this.sendEmail(payload)))

    return results.map((result, index) => (result.status === 'fulfilled' ? result.value : ''))
  }

  async sendWithTemplate(
    to: string,
    templateId: string,
    variables: Record<string, string>,
    attachments?: EmailAttachment[],
    patientId?: string,
    hospitalId?: string
  ): Promise<string> {
    const template = await prisma.communicationTemplate.findUnique({
      where: { id: templateId },
    })

    // A request on behalf of one clinic may only use that clinic's template.
    // The send goes out over the template's clinic's SMTP account, so without
    // this a template id from another clinic sent mail as that clinic.
    if (!template || !template.isActive || (hospitalId && template.hospitalId !== hospitalId)) {
      throw new SendRefusal('Template not found or inactive')
    }

    if (template.channel !== 'EMAIL') {
      throw new SendRefusal('Template is not for email channel')
    }

    let subject = template.subject || 'Notification from Your Dental Clinic'
    let body = template.content

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g')
      subject = subject.replace(regex, value)
      body = body.replace(regex, value)
    }

    return this.sendEmail({
      // The template's own clinic. A template is never shared between two.
      hospitalId: template.hospitalId,
      to,
      subject,
      body,
      patientId,
      templateId,
      attachments,
    })
  }

  async getEmailHistory(filters: {
    patientId?: string
    email?: string
    status?: string
    from?: Date
    to?: Date
    limit?: number
  }) {
    const where: any = {}

    if (filters.patientId) where.patientId = filters.patientId
    if (filters.email) where.recipient = { contains: filters.email }
    if (filters.status) where.status = filters.status
    if (filters.from || filters.to) {
      where.createdAt = {}
      if (filters.from) where.createdAt.gte = filters.from
      if (filters.to) where.createdAt.lte = filters.to
    }

    return prisma.messageLog.findMany({
      where: { ...where, channel: 'EMAIL' },
      include: {
        template: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters.limit || 100,
    })
  }

  private isValidEmail(email: string): boolean {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return regex.test(email)
  }

  async trackEmailOpen(emailLogId: string) {
    await prisma.messageLog.update({
      where: { id: emailLogId },
      data: {
        openedAt: new Date(),
      },
    })
  }

  async generateEmailHTML(content: string): Promise<string> {
    // Load email signature from settings
    const signatureSetting = await prisma.setting.findFirst({
      where: { key: 'email.signature' },
    })

    const signature = signatureSetting?.value || ''

    // Basic HTML template
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #0066cc;
      color: white;
      padding: 20px;
      text-align: center;
    }
    .content {
      padding: 20px;
      background-color: #f9f9f9;
    }
    .footer {
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #666;
      border-top: 1px solid #ddd;
    }
    .button {
      display: inline-block;
      padding: 10px 20px;
      background-color: #0066cc;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Your Dental Clinic</h2>
  </div>
  <div class="content">
    ${content}
  </div>
  <div class="footer">
    ${signature}
    <p>This is an automated email. Please do not reply to this email.</p>
  </div>
</body>
</html>
    `.trim()
  }
}

export const emailService = new EmailService()

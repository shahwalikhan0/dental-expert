import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({ messageId: 'msg-123' }),
    })),
  },
}))

// Mock prisma
vi.mock('@/lib/prisma', () => {
  const mock = {
    setting: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    messageLog: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    communicationTemplate: {
      findUnique: vi.fn(),
    },
  }
  return { default: mock, prisma: mock }
})

import prisma from '@/lib/prisma'

let emailServiceModule: any

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  emailServiceModule = await import('@/lib/services/email.service')
})

// ---------------------------------------------------------------------------
// Email Validation (via sendEmail)
// ---------------------------------------------------------------------------

describe('EmailService - Email Validation', () => {
  it('rejects invalid email address', async () => {
    const { emailService } = emailServiceModule

    await expect(
      emailService.sendEmail({ to: 'not-an-email', subject: 'Test', body: 'Hi' })
    ).rejects.toThrow('Invalid email address')
  })

  it('rejects email without domain', async () => {
    const { emailService } = emailServiceModule

    await expect(
      emailService.sendEmail({ to: 'user@', subject: 'Test', body: 'Hi' })
    ).rejects.toThrow('Invalid email address')
  })

  it('rejects email without @', async () => {
    const { emailService } = emailServiceModule

    await expect(
      emailService.sendEmail({ to: 'user.example.com', subject: 'Test', body: 'Hi' })
    ).rejects.toThrow('Invalid email address')
  })
})

// ---------------------------------------------------------------------------
// Patient Communication Preferences
// ---------------------------------------------------------------------------

describe('EmailService - Communication Preferences', () => {
  const prefs = (communicationPrefs: unknown) =>
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ communicationPrefs } as any)

  it('refuses a patient who has turned off email', async () => {
    const { emailService } = emailServiceModule
    prefs({ email: false })

    await expect(
      emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hi',
        patientId: 'pat-1',
      })
    ).rejects.toThrow('turned off email')
  })

  /**
   * The bug this replaced: nothing ever created a preference row, so
   * `!preference?.emailEnabled` was true for every patient and no
   * patient-addressed email was ever sent.
   */
  it('sends to a patient who has never expressed a preference', async () => {
    const { emailService } = emailServiceModule
    prefs(null)
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'email-1' } as any)
    vi.mocked(prisma.setting.findMany).mockResolvedValue([])

    // Fails at the SMTP configuration, which is not set — but the preference
    // check let it through, which is what this is about.
    await expect(
      emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Your appointment',
        body: 'Tomorrow at 10',
        patientId: 'pat-1',
      })
    ).rejects.toThrow()

    expect(prisma.messageLog.create).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Email Logging
// ---------------------------------------------------------------------------

describe('EmailService - Email Logging', () => {
  it('creates PENDING log for scheduled email', async () => {
    const { emailService } = emailServiceModule

    // Must always be in the future — a hardcoded literal turns this into a
    // time bomb that starts sending immediately once the date passes.
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'email-1' } as any)

    const result = await emailService.sendEmail({
      to: 'test@example.com',
      subject: 'Scheduled',
      body: 'Hello',
      scheduledFor: futureDate,
    })

    expect(result).toBe('email-1')
    expect(prisma.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          scheduledFor: futureDate,
        }),
      })
    )
  })

  it('creates QUEUED log for immediate email', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'email-1' } as any)
    vi.mocked(prisma.setting.findMany).mockResolvedValue([])

    try {
      await emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Now',
        body: 'Hello',
      })
    } catch (e) {
      // Expected to fail at SMTP config
    }

    expect(prisma.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'QUEUED',
          recipient: 'test@example.com',
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Email History
// ---------------------------------------------------------------------------

describe('EmailService - getEmailHistory', () => {
  it('queries with correct filters', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])

    await emailService.getEmailHistory({
      patientId: 'pat-1',
      status: 'SENT',
      limit: 50,
    })

    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 'pat-1',
          status: 'SENT',
        }),
        take: 50,
        orderBy: { createdAt: 'desc' },
      })
    )
  })

  it('defaults limit to 100', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])

    await emailService.getEmailHistory({})

    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
  })

  it('supports date range filters', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])
    const from = new Date('2026-01-01')
    const to = new Date('2026-01-31')

    await emailService.getEmailHistory({ from, to })

    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: from, lte: to },
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Track Email Open
// ---------------------------------------------------------------------------

describe('EmailService - trackEmailOpen', () => {
  it('updates email log with openedAt timestamp', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.messageLog.update).mockResolvedValue({} as any)

    await emailService.trackEmailOpen('email-1')

    expect(prisma.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { openedAt: expect.any(Date) },
    })
  })
})

// ---------------------------------------------------------------------------
// Generate Email HTML
// ---------------------------------------------------------------------------

describe('EmailService - generateEmailHTML', () => {
  it('wraps content in HTML template', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.setting.findFirst).mockResolvedValue(null)

    const html = await emailService.generateEmailHTML('<p>Hello World</p>')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<p>Hello World</p>')
    expect(html).toContain('Your Dental Clinic')
    expect(html).toContain('automated email')
  })

  it('includes email signature from settings', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.setting.findFirst).mockResolvedValue({
      value: '<p>Best regards, The Team</p>',
    } as any)

    const html = await emailService.generateEmailHTML('<p>Content</p>')

    expect(html).toContain('Best regards, The Team')
  })

  it('handles empty content', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.setting.findFirst).mockResolvedValue(null)

    const html = await emailService.generateEmailHTML('')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('class="content"')
  })
})

// ---------------------------------------------------------------------------
// Send With Template
// ---------------------------------------------------------------------------

describe('EmailService - sendWithTemplate', () => {
  it('throws for non-existent template', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue(null)

    await expect(
      emailService.sendWithTemplate('test@example.com', 'tpl-missing', {})
    ).rejects.toThrow('Template not found')
  })

  it('throws for inactive template', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue({
      id: 'tpl-1',
      isActive: false,
      channel: 'EMAIL',
      content: 'Test',
    } as any)

    await expect(emailService.sendWithTemplate('test@example.com', 'tpl-1', {})).rejects.toThrow(
      'Template not found'
    )
  })

  it('throws for non-email template', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue({
      id: 'tpl-1',
      isActive: true,
      channel: 'SMS',
      content: 'Test',
    } as any)

    await expect(emailService.sendWithTemplate('test@example.com', 'tpl-1', {})).rejects.toThrow(
      'not for email'
    )
  })

  it('replaces variables in subject and body', async () => {
    const { emailService } = emailServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue({
      id: 'tpl-1',
      isActive: true,
      channel: 'EMAIL',
      subject: 'Appointment for {{patientName}}',
      content: 'Dear {{patientName}}, your appointment is on {{appointmentDate}}',
    } as any)

    // Will create email log then fail at SMTP
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'email-1' } as any)
    vi.mocked(prisma.setting.findMany).mockResolvedValue([])

    try {
      await emailService.sendWithTemplate('test@example.com', 'tpl-1', {
        patientName: 'Rahul',
        appointmentDate: '25-Jan-2026',
      })
    } catch (e) {
      // Expected to fail at SMTP
    }

    // Verify template variables were replaced in the call to sendEmail → emailLog.create
    expect(prisma.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: 'Appointment for Rahul',
          body: 'Dear Rahul, your appointment is on 25-Jan-2026',
        }),
      })
    )
  })
})

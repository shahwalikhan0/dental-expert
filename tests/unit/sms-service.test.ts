import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before import
vi.mock('@/lib/prisma', () => {
  const mock = {
    setting: {
      findMany: vi.fn(),
    },
    messageLog: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    hospital: {
      findUnique: vi.fn(),
    },
    communicationTemplate: {
      findUnique: vi.fn(),
    },
  }
  return { default: mock, prisma: mock }
})

// We'll test the service's internal methods via a testing approach
// Since SMSService has private methods, we test them through the public interface

import prisma from '@/lib/prisma'

// Re-create the service for each test to reset state
let smsServiceModule: any

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())

  // Reset the module cache so we get a fresh SMSService instance each time
  vi.resetModules()
  smsServiceModule = await import('@/lib/services/sms.service')
})

// ---------------------------------------------------------------------------
// Phone number validation (tested via sendSMS)
// ---------------------------------------------------------------------------

describe('SMSService - Phone Validation', () => {
  it('rejects invalid phone numbers', async () => {
    const { smsService } = smsServiceModule

    // Set up minimal mocks - the send should fail at validation before DB calls
    await expect(smsService.sendSMS({ phone: '12345', message: 'test' })).rejects.toThrow(
      'Invalid phone number'
    )
  })

  it('rejects a subscriber number not starting with 3', async () => {
    const { smsService } = smsServiceModule

    await expect(smsService.sendSMS({ phone: '0123456789', message: 'test' })).rejects.toThrow(
      'Invalid phone number'
    )

    await expect(smsService.sendSMS({ phone: '5123456789', message: 'test' })).rejects.toThrow(
      'Invalid phone number'
    )
  })

  it('rejects phone with fewer than 10 digits', async () => {
    const { smsService } = smsServiceModule

    await expect(smsService.sendSMS({ phone: '30012', message: 'test' })).rejects.toThrow(
      'Invalid phone number'
    )
  })

  it('rejects phone with more than 10 digits', async () => {
    const { smsService } = smsServiceModule

    await expect(smsService.sendSMS({ phone: '30012345670', message: 'test' })).rejects.toThrow(
      'Invalid phone number'
    )
  })
})

// ---------------------------------------------------------------------------
// DND / Communication Preference checks
// ---------------------------------------------------------------------------

describe('SMSService - Communication Preferences', () => {
  const prefs = (communicationPrefs: unknown) =>
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ communicationPrefs } as any)

  it('refuses a patient who has asked not to be contacted', async () => {
    const { smsService } = smsServiceModule
    prefs({ doNotContact: true, sms: true })

    await expect(
      smsService.sendSMS({ phone: '3001234567', message: 'test', patientId: 'patient-1' })
    ).rejects.toThrow('asked not to be contacted')
  })

  it('refuses a patient who has turned off SMS', async () => {
    const { smsService } = smsServiceModule
    prefs({ sms: false })

    await expect(
      smsService.sendSMS({ phone: '3001234567', message: 'test', patientId: 'patient-1' })
    ).rejects.toThrow('turned off sms')
  })

  it('refuses one kind of message without refusing the rest', async () => {
    const { smsService } = smsServiceModule
    prefs({ promotions: false })

    await expect(
      smsService.sendSMS({
        phone: '3001234567',
        message: 'Half price whitening',
        patientId: 'patient-1',
        kind: 'promotions',
      })
    ).rejects.toThrow('promotional messages')
  })

  /**
   * The bug this replaced. No patient had a preference row — nothing in the
   * application ever created one — so `!preference?.smsEnabled` was true for
   * every patient in the database and every patient-addressed SMS was refused
   * on the strength of a preference nobody had ever given.
   */
  it('sends to a patient who has never expressed a preference', async () => {
    const { smsService } = smsServiceModule
    prefs(null)
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'sms-1' } as any)
    vi.mocked(prisma.setting.findMany).mockResolvedValue([])

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T06:30:00Z'))

    // Fails at the gateway, which is not configured — but it got that far,
    // which is the point: the preference check let it through.
    await expect(
      smsService.sendSMS({
        phone: '3001234567',
        message: 'Your appointment is tomorrow',
        patientId: 'patient-1',
        kind: 'appointmentReminders',
      })
    ).rejects.toThrow(/gateway|API key/i)

    expect(prisma.messageLog.create).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Time restrictions
// ---------------------------------------------------------------------------

describe('SMSService - the clinic’s send window', () => {
  /**
   * The window is the clinic's own, read in the clinic's own timezone. It used
   * to be 9am–9pm **IST**, computed by adding five and a half hours to UTC —
   * India's TRAI restriction, hardcoded. On a Pakistani clinic that is wrong in
   * both directions by half an hour, and Pakistan has no such rule to begin
   * with.
   */
  const clinicIn = (timezone: string, settings: { key: string; value: string }[] = []) => {
    vi.mocked(prisma.hospital.findUnique).mockResolvedValue({ timezone } as any)
    vi.mocked(prisma.setting.findMany).mockImplementation((async (args: any) =>
      args?.where?.key ? settings : []) as never)
  }

  it('refuses a message at three in the morning, Karachi time', async () => {
    const { smsService } = smsServiceModule
    clinicIn('Asia/Karachi')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T22:00:00Z')) // 03:00 in Karachi

    await expect(
      smsService.sendSMS({ hospitalId: 'h1', phone: '3001234567', message: 'test' })
    ).rejects.toThrow(/between 09:00–21:00/)

    vi.useRealTimers()
  })

  it('allows one at midday', async () => {
    const { smsService } = smsServiceModule
    clinicIn('Asia/Karachi')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T07:00:00Z')) // 12:00 in Karachi

    // Gets past the window and fails at the gateway, which is not configured.
    await expect(
      smsService.sendSMS({ hospitalId: 'h1', phone: '3001234567', message: 'test' })
    ).rejects.toThrow('SMS gateway not configured')

    vi.useRealTimers()
  })

  /**
   * The half hour the old code got wrong. 20:45 in Karachi is 21:15 in India,
   * which the IST check refused — and 09:15 in Karachi is 08:45 IST, which it
   * also refused.
   */
  it('judges the quarter-hours the IST offset used to get wrong', async () => {
    const { smsService } = smsServiceModule
    clinicIn('Asia/Karachi')

    vi.useFakeTimers()

    for (const utc of ['2026-02-19T15:45:00Z', '2026-02-19T04:15:00Z']) {
      vi.setSystemTime(new Date(utc))
      await expect(
        smsService.sendSMS({ hospitalId: 'h1', phone: '3001234567', message: 'test' }),
        utc
      ).rejects.toThrow('SMS gateway not configured')
    }

    vi.useRealTimers()
  })

  it('honours a window the clinic has moved', async () => {
    const { smsService } = smsServiceModule
    clinicIn('Asia/Karachi', [
      { key: 'sms.sendWindowStart', value: '08:00' },
      { key: 'sms.sendWindowEnd', value: '18:00' },
    ])

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T14:00:00Z')) // 19:00 in Karachi

    await expect(
      smsService.sendSMS({ hospitalId: 'h1', phone: '3001234567', message: 'test' })
    ).rejects.toThrow(/between 08:00–18:00/)

    vi.useRealTimers()
  })

  /**
   * A message queued for tomorrow morning is not refused tonight. The question
   * "is it an acceptable hour" only means anything at the moment of sending.
   */
  it('does not judge a scheduled message by the hour it was queued', async () => {
    const { smsService } = smsServiceModule
    clinicIn('Asia/Karachi')
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'sms-1' } as any)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T22:00:00Z')) // 03:00 in Karachi

    const id = await smsService.sendSMS({
      hospitalId: 'h1',
      phone: '3001234567',
      message: 'test',
      scheduledFor: new Date('2026-02-20T05:00:00Z'),
    })

    expect(id).toBe('sms-1')
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// SMS Logging
// ---------------------------------------------------------------------------

describe('SMSService - SMS Logging', () => {
  it('creates SMS log entry before sending (no patientId)', async () => {
    const { smsService } = smsServiceModule

    // Set time to allowed window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T06:30:00Z')) // 12 PM IST

    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'sms-1' } as any)
    vi.mocked(prisma.setting.findMany).mockResolvedValue([])

    try {
      await smsService.sendSMS({
        phone: '3001234567',
        message: 'Hello',
        hospitalId: 'hosp-1',
        // No patientId — skip DND/preference checks
      })
    } catch (e) {
      // Expected to fail at gateway init
    }

    expect(prisma.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'SMS',
          recipient: '3001234567',
          body: 'Hello',
          hospitalId: 'hosp-1',
          status: 'QUEUED',
        }),
      })
    )

    vi.useRealTimers()
  })

  it('creates PENDING status for scheduled SMS', async () => {
    const { smsService } = smsServiceModule

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-19T06:30:00Z'))

    const futureDate = new Date('2026-03-01T06:30:00Z')
    vi.mocked(prisma.messageLog.create).mockResolvedValue({ id: 'sms-1' } as any)

    const result = await smsService.sendSMS({
      phone: '3001234567',
      message: 'Scheduled',
      scheduledFor: futureDate,
    })

    expect(result).toBe('sms-1')
    expect(prisma.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          scheduledFor: futureDate,
        }),
      })
    )

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Template Processing
// ---------------------------------------------------------------------------

describe('SMSService - processTemplate', () => {
  it('replaces variables in template content', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue({
      id: 'tpl-1',
      content: 'Hello {{patientName}}, your appointment is on {{appointmentDate}}',
      isActive: true,
    } as any)

    const result = await smsService.processTemplate('tpl-1', {
      patientName: 'Rahul',
      appointmentDate: '25-Jan-2026',
    })

    expect(result).toBe('Hello Rahul, your appointment is on 25-Jan-2026')
  })

  it('throws for inactive template', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue({
      id: 'tpl-1',
      content: 'Test',
      isActive: false,
    } as any)

    await expect(smsService.processTemplate('tpl-1', {})).rejects.toThrow(
      'Template not found or inactive'
    )
  })

  it('throws for non-existent template', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.communicationTemplate.findUnique).mockResolvedValue(null)

    await expect(smsService.processTemplate('missing', {})).rejects.toThrow(
      'Template not found or inactive'
    )
  })
})

// ---------------------------------------------------------------------------
// Delivery Status
// ---------------------------------------------------------------------------

describe('SMSService - getDeliveryStatus', () => {
  it('returns status from SMS log', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue({
      id: 'sms-1',
      status: 'SENT',
    } as any)

    const status = await smsService.getDeliveryStatus('sms-1')
    expect(status).toBe('SENT')
  })

  it('throws for non-existent SMS log', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue(null)

    await expect(smsService.getDeliveryStatus('missing')).rejects.toThrow('SMS log not found')
  })
})

// ---------------------------------------------------------------------------
// SMS History
// ---------------------------------------------------------------------------

describe('SMSService - getSMSHistory', () => {
  it('queries with correct filters', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])

    await smsService.getSMSHistory({
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
    const { smsService } = smsServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])

    await smsService.getSMSHistory({})

    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      })
    )
  })

  it('supports date range filters', async () => {
    const { smsService } = smsServiceModule

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([])
    const from = new Date('2026-01-01')
    const to = new Date('2026-01-31')

    await smsService.getSMSHistory({ from, to })

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
// Check Balance
// ---------------------------------------------------------------------------

describe('SMSService - checkBalance', () => {
  it('returns balance with currency', async () => {
    const { smsService } = smsServiceModule
    const result = await smsService.checkBalance()
    expect(result).toHaveProperty('balance')
    expect(result).toHaveProperty('currency')
    expect(result.currency).toBe('PKR')
  })
})

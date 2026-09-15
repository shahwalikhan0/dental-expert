/**
 * The sender that was missing.
 *
 * `/api/cron/reminders` queued `MessageLog` rows at PENDING and said in its own
 * comment that "the sender picks them up". Nothing did. Every reminder the
 * hourly cron had ever queued was still PENDING.
 *
 * The cases that matter are the ones where not sending is the right answer: a
 * cancelled appointment, a patient who has opted out since, a clinic whose
 * quiet hours have started.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const mock = {
    messageLog: { findMany: vi.fn(), update: vi.fn() },
    patient: { findFirst: vi.fn() },
    appointment: { findFirst: vi.fn() },
    hospital: { findUnique: vi.fn() },
    setting: { findMany: vi.fn() },
    communicationTemplate: { findFirst: vi.fn() },
  }
  return { default: mock, prisma: mock }
})

vi.mock('@/lib/services/sms.service', () => ({
  smsService: {
    sendWindow: vi.fn(),
    initialize: vi.fn(),
    deliver: vi.fn(),
  },
}))

vi.mock('@/lib/services/email.service', () => ({
  emailService: {
    initialize: vi.fn(),
    deliver: vi.fn(),
  },
}))

import prisma from '@/lib/prisma'
import { smsService } from '@/lib/services/sms.service'
import { emailService } from '@/lib/services/email.service'
import { dispatchDueMessages } from '@/lib/services/message-dispatch'

const NOW = new Date('2026-09-15T10:00:00Z')

function queued(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    hospitalId: 'h1',
    channel: 'SMS',
    patientId: 'p1',
    recipient: '3001234567',
    subject: null,
    body: '',
    relatedType: 'Appointment',
    relatedId: 'a1',
    metadata: { kind: 'appointmentReminders' },
    templateId: null,
    ...overrides,
  }
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    appointmentNo: 'APT001',
    scheduledDate: new Date('2026-09-15T11:00:00Z'),
    scheduledTime: '16:00',
    status: 'CONFIRMED',
    patient: { firstName: 'Ayesha', lastName: 'Khan' },
    doctor: { firstName: 'Sana', lastName: 'Iqbal' },
    chair: { name: 'Chair 2' },
    hospital: { name: 'Demo Dental Clinic', phone: '4235000000' },
    ...overrides,
  }
}

const lastUpdate = () => vi.mocked(prisma.messageLog.update).mock.calls.at(-1)![0]!.data as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(smsService.sendWindow).mockResolvedValue({
    start: '09:00',
    end: '21:00',
    timezone: 'Asia/Karachi',
  } as never)
  vi.mocked(smsService.initialize).mockResolvedValue({
    gateway: 'TWILIO',
    apiKey: 'token',
    senderId: '+15005550006',
    authKey: 'AC1',
  } as never)
  vi.mocked(smsService.deliver).mockResolvedValue({ messageId: 'SM1', cost: 1.2 } as never)
  vi.mocked(emailService.initialize).mockResolvedValue({
    config: { host: 'smtp.example', from: { name: 'Clinic', email: 'c@example' } },
    transporter: {},
  } as never)
  vi.mocked(emailService.deliver).mockResolvedValue({ messageId: '<1@example>' } as never)
  vi.mocked(prisma.messageLog.update).mockResolvedValue({} as never)
  vi.mocked(prisma.patient.findFirst).mockResolvedValue({ communicationPrefs: null } as never)
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue(appointment() as never)
  vi.mocked(prisma.communicationTemplate.findFirst).mockResolvedValue({
    id: 'tpl1',
    content: 'Hi {{firstName}}, your appointment with {{doctorName}} is at {{appointmentTime}}.',
    subject: null,
    channel: 'SMS',
    category: 'APPOINTMENT',
    isActive: true,
    isDefault: true,
  } as never)
})

describe('nothing due', () => {
  it('does no work and loads no credentials', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([] as never)

    expect(await dispatchDueMessages(NOW)).toMatchObject({ due: 0, sent: 0 })
    expect(smsService.initialize).not.toHaveBeenCalled()
  })

  it('asks only for messages that have actually fallen due', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([] as never)

    await dispatchDueMessages(NOW)

    expect(vi.mocked(prisma.messageLog.findMany).mock.calls[0][0]!.where).toEqual({
      status: 'PENDING',
      scheduledFor: { lte: NOW },
    })
  })
})

describe('sending', () => {
  it('renders the wording from the template at send time', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ due: 1, sent: 1, failed: 0, cancelled: 0 })
    expect(smsService.deliver).toHaveBeenCalledWith(
      '3001234567',
      'Hi Ayesha, your appointment with Dr. Sana Iqbal is at 16:00.',
      expect.objectContaining({ gateway: 'TWILIO' })
    )
  })

  it('stores what was actually sent, not the empty body it was queued with', async () => {
    // The old AppointmentReminder table recorded that a reminder was scheduled
    // and nothing about what it said.
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)

    await dispatchDueMessages(NOW)

    expect(lastUpdate()).toMatchObject({
      status: 'SENT',
      body: 'Hi Ayesha, your appointment with Dr. Sana Iqbal is at 16:00.',
      provider: 'TWILIO',
      providerRef: 'SM1',
      cost: 1.2,
    })
    expect(lastUpdate().sentAt).toBeInstanceOf(Date)
  })

  it('sends a body somebody typed as written, without a template', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ body: 'Clinic closed tomorrow', relatedType: null, relatedId: null }),
    ] as never)

    await dispatchDueMessages(NOW)

    expect(smsService.deliver).toHaveBeenCalledWith(
      '3001234567',
      'Clinic closed tomorrow',
      expect.anything()
    )
    expect(prisma.communicationTemplate.findFirst).not.toHaveBeenCalled()
  })

  it('records the rendered subject as well as the body', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ channel: 'EMAIL', recipient: 'a@example.com' }),
    ] as never)
    vi.mocked(prisma.communicationTemplate.findFirst).mockResolvedValue({
      id: 'tpl2',
      content: '<p>Dear {{patientName}}</p>',
      subject: 'Your appointment on {{appointmentDate}}',
      channel: 'EMAIL',
      category: 'APPOINTMENT',
      isActive: true,
      isDefault: true,
    } as never)

    await dispatchDueMessages(NOW)

    expect(lastUpdate()).toMatchObject({
      subject: 'Your appointment on 15-Sep-2026',
      body: '<p>Dear Ayesha Khan</p>',
    })
  })

  it('sends email through the clinic own SMTP account', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ channel: 'EMAIL', recipient: 'a@example.com', subject: 'Reminder' }),
    ] as never)

    await dispatchDueMessages(NOW)

    expect(emailService.initialize).toHaveBeenCalledWith('h1')
    expect(smsService.initialize).not.toHaveBeenCalled()
  })

  it('loads one clinic credentials once, however many messages it has', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ id: 'm1' }),
      queued({ id: 'm2' }),
      queued({ id: 'm3' }),
    ] as never)

    const result = await dispatchDueMessages(NOW)

    expect(result.sent).toBe(3)
    expect(smsService.initialize).toHaveBeenCalledTimes(1)
  })

  it('sends each clinic messages with that clinic own credentials', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ id: 'm1', hospitalId: 'h1' }),
      queued({ id: 'm2', hospitalId: 'h2' }),
    ] as never)

    await dispatchDueMessages(NOW)

    expect(vi.mocked(smsService.initialize).mock.calls.map((c) => c[0])).toEqual(['h1', 'h2'])
  })
})

describe('not sending', () => {
  it('leaves a clinic outside its send window for the next run', async () => {
    // 22:00 in Karachi. Failing these would lose an evening of reminders
    // because the cron happened to run after nine.
    vi.mocked(smsService.sendWindow).mockResolvedValue({
      start: '09:00',
      end: '21:00',
      timezone: 'Asia/Karachi',
    } as never)
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued(),
      queued({ id: 'm2' }),
    ] as never)

    const result = await dispatchDueMessages(new Date('2026-09-15T17:00:00Z'))

    expect(result).toMatchObject({ due: 2, deferred: 2, sent: 0, failed: 0 })
    expect(smsService.deliver).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).not.toHaveBeenCalled()
  })

  it('cancels a reminder for an appointment that was cancelled', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(
      appointment({ status: 'CANCELLED' }) as never
    )

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ cancelled: 1, sent: 0 })
    expect(smsService.deliver).not.toHaveBeenCalled()
    expect(lastUpdate()).toMatchObject({ status: 'CANCELLED' })
    expect(lastUpdate().errorMessage).toContain('cancelled')
  })

  it('cancels a reminder for an appointment that has gone', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as never)

    expect(await dispatchDueMessages(NOW)).toMatchObject({ cancelled: 1 })
  })

  it('re-checks consent, so an opt-out after queueing is honoured', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      communicationPrefs: { doNotContact: true },
    } as never)

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ cancelled: 1, sent: 0 })
    expect(smsService.deliver).not.toHaveBeenCalled()
  })

  it('honours a refusal of this kind of message alone', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(prisma.patient.findFirst).mockResolvedValue({
      communicationPrefs: { appointmentReminders: false },
    } as never)

    expect(await dispatchDueMessages(NOW)).toMatchObject({ cancelled: 1 })
  })

  it('reads the patient within the clinic that queued the message', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)

    await dispatchDueMessages(NOW)

    expect(vi.mocked(prisma.patient.findFirst).mock.calls[0][0]!.where).toMatchObject({
      id: 'p1',
      hospitalId: 'h1',
    })
  })

  it('cancels when the clinic has no template to render the reminder from', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(prisma.communicationTemplate.findFirst).mockResolvedValue(null as never)

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ cancelled: 1 })
    expect(lastUpdate().errorMessage).toContain('template')
  })

  it('records why a send failed instead of losing it', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([queued()] as never)
    vi.mocked(smsService.deliver).mockRejectedValue(new Error('Twilio rejected the number'))

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ failed: 1, sent: 0 })
    expect(lastUpdate()).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Twilio rejected the number',
    })
  })

  it('fails one clinic unconfigured gateway without touching another clinic', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ id: 'm1', hospitalId: 'h1' }),
      queued({ id: 'm2', hospitalId: 'h2' }),
    ] as never)
    vi.mocked(smsService.initialize)
      .mockRejectedValueOnce(new Error('SMS gateway not configured'))
      .mockResolvedValueOnce({ gateway: 'TWILIO', apiKey: 'k', senderId: 's' } as never)

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ failed: 1, sent: 1 })
  })

  it('does not retry an unconfigured gateway once per message', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      queued({ id: 'm1' }),
      queued({ id: 'm2' }),
      queued({ id: 'm3' }),
    ] as never)
    vi.mocked(smsService.initialize).mockRejectedValue(new Error('SMS gateway not configured'))

    const result = await dispatchDueMessages(NOW)

    expect(result).toMatchObject({ failed: 3 })
    expect(smsService.initialize).toHaveBeenCalledTimes(1)
  })
})

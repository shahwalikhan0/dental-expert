import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

vi.mock('@/lib/prisma', () => ({ default: prisma }))

const mockSmsService = vi.hoisted(() => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}))
const mockEmailService = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  generateEmailHTML: vi.fn().mockResolvedValue('<html>email</html>'),
}))
const mockTemplateService = vi.hoisted(() => ({
  getDefaultTemplate: vi.fn(),
  replaceVariables: vi.fn().mockImplementation((content: string) => content),
}))

vi.mock('@/lib/services/sms.service', () => ({ smsService: mockSmsService }))
vi.mock('@/lib/services/email.service', () => ({ emailService: mockEmailService }))
vi.mock('@/lib/services/template.service', () => ({ templateService: mockTemplateService }))

const { communicationTriggersService } =
  await import('@/lib/services/communication-triggers.service')

describe('CommunicationTriggersService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Appointment reminders used to be tested here. They are not sent from this
  // service any more: `/api/cron/reminders` queues them and
  // `/api/cron/dispatch` sends them, which is one system rather than two
  // reminding the same patient about the same appointment. See
  // tests/unit/message-dispatch.test.ts.

  describe('sendBirthdayWishes', () => {
    it('sends birthday wishes to patients with birthday today', async () => {
      const today = new Date()
      const dob = new Date(1990, today.getMonth(), today.getDate())

      ;(prisma.patient.findMany as any).mockResolvedValue([
        {
          id: 'pat-1',
          hospitalId: 'h1',
          firstName: 'John',
          lastName: 'Doe',
          phone: '9876543210',
          dateOfBirth: dob,
          isActive: true,
        },
      ])

      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', phone: '123' })

      mockTemplateService.getDefaultTemplate.mockResolvedValue({
        id: 'tmpl-2',
        content: 'Happy Birthday!',
      })

      await communicationTriggersService.sendBirthdayWishes()

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9876543210', patientId: 'pat-1' })
      )
    })

    it('tags a birthday message so the sender can refuse it', async () => {
      const today = new Date()
      const dob = new Date(1990, today.getMonth(), today.getDate())

      ;(prisma.patient.findMany as any).mockResolvedValue([
        {
          id: 'pat-1',
          hospitalId: 'h1',
          firstName: 'John',
          lastName: 'Doe',
          phone: '9876543210',
          dateOfBirth: dob,
          isActive: true,
        },
      ])

      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', phone: '1' })
      mockTemplateService.getDefaultTemplate.mockResolvedValue({ id: 't', content: 'Happy day' })

      await communicationTriggersService.sendBirthdayWishes()

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'birthdayWishes' })
      )
    })

    it('skips patients whose birthday is not today', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dob = new Date(1990, tomorrow.getMonth(), tomorrow.getDate())

      ;(prisma.patient.findMany as any).mockResolvedValue([
        {
          id: 'pat-1',
          hospitalId: 'h1',
          firstName: 'John',
          lastName: 'Doe',
          phone: '9876543210',
          dateOfBirth: dob,
          isActive: true,
        },
      ])

      await communicationTriggersService.sendBirthdayWishes()
      expect(mockSmsService.sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('sendPaymentReminders', () => {
    it('sends reminders for overdue invoices', async () => {
      ;(prisma.invoice.findMany as any).mockResolvedValue([
        {
          id: 'inv-1',
          hospitalId: 'h1',
          patientId: 'pat-1',
          invoiceNo: 'INV-001',
          totalAmount: 5000,
          balanceAmount: 3000,
          dueDate: new Date('2026-02-15'),
          patient: { firstName: 'John', lastName: 'Doe', phone: '9876543210' },
        },
      ])

      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', phone: '123' })

      mockTemplateService.getDefaultTemplate.mockResolvedValue({
        id: 'tmpl-3',
        content: 'Payment due',
      })

      await communicationTriggersService.sendPaymentReminders()

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9876543210', patientId: 'pat-1' })
      )
    })

    it('tags a payment reminder so the sender can refuse it', async () => {
      ;(prisma.invoice.findMany as any).mockResolvedValue([
        {
          id: 'inv-1',
          hospitalId: 'h1',
          patientId: 'pat-1',
          invoiceNo: 'INV-001',
          totalAmount: 5000,
          balanceAmount: 3000,
          patient: { firstName: 'John', lastName: 'Doe', phone: '9876543210' },
        },
      ])

      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', phone: '1' })
      mockTemplateService.getDefaultTemplate.mockResolvedValue({ id: 't', content: 'Due' })

      await communicationTriggersService.sendPaymentReminders()

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'paymentReminders',
          relatedType: 'Invoice',
          relatedId: 'inv-1',
        })
      )
    })
  })

  describe('sendLabWorkReadyNotifications', () => {
    it('sends notification for ready lab orders', async () => {
      ;(prisma.labOrder.findMany as any).mockResolvedValue([
        {
          id: 'lab-1',
          hospitalId: 'h1',
          patientId: 'pat-1',
          orderNumber: 'LAB-001',
          workType: 'Crown',
          notes: '',
          patient: { firstName: 'John', lastName: 'Doe', phone: '9876543210' },
        },
      ])

      ;(prisma.hospital.findUnique as any).mockResolvedValue({ name: 'Test Clinic', phone: '123' })

      mockTemplateService.getDefaultTemplate.mockResolvedValue({
        id: 'tmpl-4',
        content: 'Your lab work is ready',
      })

      ;(prisma.labOrder.update as any).mockResolvedValue({})

      await communicationTriggersService.sendLabWorkReadyNotifications()

      expect(mockSmsService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9876543210', patientId: 'pat-1' })
      )
      expect(prisma.labOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: expect.stringContaining('Ready notification sent'),
          }),
        })
      )
    })
  })

  describe('runAllTriggers', () => {
    it('runs all trigger functions', async () => {
      // Mock all queries to return empty
      ;(prisma.appointment.findMany as any).mockResolvedValue([])
      ;(prisma.patient.findMany as any).mockResolvedValue([])
      ;(prisma.invoice.findMany as any).mockResolvedValue([])
      ;(prisma.labOrder.findMany as any).mockResolvedValue([])
      ;(prisma.hospital.findMany as any).mockResolvedValue([])

      await communicationTriggersService.runAllTriggers()

      expect(prisma.patient.findMany).toHaveBeenCalled()
      expect(prisma.invoice.findMany).toHaveBeenCalled()
      expect(prisma.labOrder.findMany).toHaveBeenCalled()

      // Not appointments: this job no longer sends appointment reminders, and
      // a second system sending them alongside the queue is the bug that was
      // fixed by taking them out.
      expect(prisma.appointment.findMany).not.toHaveBeenCalled()
    })
  })
})

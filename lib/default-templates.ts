/**
 * The message templates a clinic starts with.
 *
 * Nothing created these. `communicationTemplate.create` appears once in the
 * codebase, behind the template editor, so a clinic that signed up had no
 * templates at all — and every automated message is looked up by
 * `getDefaultTemplate(hospitalId, category, channel)`, which returned null. The
 * reminder machinery was complete and inert: it found the appointments, decided
 * who to remind, and then found nothing to say.
 *
 * Starter wording, not house style. A clinic is expected to edit these; they
 * exist so the feature works on the day it is switched on rather than after
 * somebody discovers they have to write four templates first.
 *
 * SMS is kept under 160 characters with the longest plausible substitutions, so
 * a reminder is one message and not three.
 */
import type { CommunicationChannel, TemplateCategory } from '@prisma/client'

export interface DefaultTemplate {
  name: string
  category: TemplateCategory
  channel: CommunicationChannel
  subject?: string
  content: string
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    name: 'Appointment reminder (SMS)',
    category: 'APPOINTMENT',
    channel: 'SMS',
    content:
      'Hi {{firstName}}, a reminder of your appointment at {{clinicName}} on {{appointmentDate}} at {{appointmentTime}} with {{doctorName}}. To reschedule call {{clinicPhone}}.',
  },
  {
    name: 'Appointment reminder (Email)',
    category: 'APPOINTMENT',
    channel: 'EMAIL',
    subject: 'Your appointment on {{appointmentDate}}',
    content:
      '<p>Dear {{patientName}},</p>' +
      '<p>This is a reminder of your appointment at <strong>{{clinicName}}</strong>:</p>' +
      '<ul><li>Date: {{appointmentDate}}</li><li>Time: {{appointmentTime}}</li>' +
      '<li>With: {{doctorName}}</li><li>Reference: {{appointmentNo}}</li></ul>' +
      '<p>If you need to reschedule, please call us on {{clinicPhone}}.</p>' +
      '<p>{{clinicName}}</p>',
  },
  {
    name: 'Payment reminder (SMS)',
    category: 'PAYMENT',
    channel: 'SMS',
    content:
      'Dear {{patientName}}, invoice {{invoiceNo}} of {{amount}} at {{clinicName}} is outstanding. Please call {{clinicPhone}} to settle it.',
  },
  {
    name: 'Lab work ready (SMS)',
    category: 'LAB_WORK',
    channel: 'SMS',
    content:
      'Dear {{patientName}}, your {{labWorkType}} has arrived at {{clinicName}}. Please call {{clinicPhone}} to book a fitting.',
  },
  {
    name: 'Birthday wishes (SMS)',
    category: 'BIRTHDAY',
    channel: 'SMS',
    content:
      'Happy birthday {{firstName}}! Best wishes from everyone at {{clinicName}}. {{clinicPhone}}',
  },
]

/** The rows to create for a new clinic. Every one is the default for its pair. */
export function defaultTemplatesFor(hospitalId: string) {
  return DEFAULT_TEMPLATES.map((template) => ({
    hospitalId,
    name: template.name,
    category: template.category,
    channel: template.channel,
    subject: template.subject ?? null,
    content: template.content,
    isDefault: true,
    isActive: true,
  }))
}

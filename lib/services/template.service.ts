// Communication Template Service

import prisma from '@/lib/prisma'
import type { CommunicationChannel, TemplateCategory } from '@prisma/client'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'
import {
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_KEYS,
  listPlaceholders,
  placeholdersIn,
  unknownPlaceholders,
  type TemplateVariable,
} from '@/lib/template-variables'

export type { TemplateVariable }

/** Channels whose messages are SMS-sized: the 500-character check applies. */
const SHORT_CHANNELS: readonly CommunicationChannel[] = ['SMS', 'WHATSAPP']

class TemplateService {
  /**
   * The variables a template may use: the ones a message is actually built
   * with. See lib/template-variables.ts.
   */
  getStandardVariables(): TemplateVariable[] {
    return [...TEMPLATE_VARIABLES]
  }

  /**
   * Another of this clinic's templates already called `name`, ignoring case.
   *
   * Names are how the list is read and how a template is picked, and two
   * "Post-op care (SMS)" were accepted (finding 62). Prescription templates
   * already refused this; communication templates now do too. The column has
   * no unique index, so this is the check — `exceptId` leaves out the
   * template being renamed.
   */
  async findByName(hospitalId: string, name: string, exceptId?: string) {
    return prisma.communicationTemplate.findFirst({
      where: {
        hospitalId,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    })
  }

  async createTemplate(data: {
    hospitalId: string
    name: string
    category: TemplateCategory
    channel: CommunicationChannel
    subject?: string
    content: string
    language?: string
    isDefault?: boolean
  }) {
    return prisma.communicationTemplate.create({
      data: {
        hospitalId: data.hospitalId,
        name: data.name,
        category: data.category,
        channel: data.channel,
        subject: data.subject,
        content: data.content,
        language: data.language || 'en',
        isDefault: data.isDefault || false,
        isActive: true,
      },
    })
  }

  async updateTemplate(
    id: string,
    data: {
      name?: string
      subject?: string
      content?: string
      language?: string
      isActive?: boolean
      isDefault?: boolean
    },
    hospitalId?: string
  ) {
    // If hospitalId provided, verify ownership first
    if (hospitalId) {
      const existing = await prisma.communicationTemplate.findFirst({
        where: { id, hospitalId },
      })
      if (!existing) {
        throw new Error('Template not found')
      }
    }
    return prisma.communicationTemplate.update({
      where: { id },
      data,
    })
  }

  async getTemplate(id: string, hospitalId?: string) {
    if (hospitalId) {
      return prisma.communicationTemplate.findFirst({
        where: { id, hospitalId },
      })
    }
    return prisma.communicationTemplate.findUnique({
      where: { id },
    })
  }

  async getTemplates(
    hospitalId: string,
    filters?: {
      category?: TemplateCategory
      channel?: CommunicationChannel
      language?: string
      isActive?: boolean
    }
  ) {
    return prisma.communicationTemplate.findMany({
      where: { hospitalId, ...filters },
      orderBy: {
        createdAt: 'desc',
      },
    })
  }

  async getDefaultTemplate(
    hospitalId: string,
    category: TemplateCategory,
    channel: CommunicationChannel
  ) {
    return prisma.communicationTemplate.findFirst({
      where: {
        hospitalId,
        category,
        channel,
        isDefault: true,
        isActive: true,
      },
    })
  }

  async deleteTemplate(id: string, hospitalId?: string) {
    // If hospitalId provided, verify ownership first
    if (hospitalId) {
      const existing = await prisma.communicationTemplate.findFirst({
        where: { id, hospitalId },
      })
      if (!existing) {
        throw new Error('Template not found')
      }
    }
    return prisma.communicationTemplate.delete({
      where: { id },
    })
  }

  replaceVariables(content: string, variables: Record<string, string>): string {
    let result = content

    for (const [key, value] of Object.entries(variables)) {
      // Replace {{variable}} format
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
      result = result.replace(regex, value || '')
    }

    return result
  }

  extractVariables(content: string): string[] {
    return placeholdersIn(content)
  }

  /**
   * Whether a template can be saved: every placeholder in its body and
   * subject is one a message fills in, and an SMS fits.
   *
   * The length check is for SMS and WhatsApp only. It used to apply to every
   * channel, so an email template of any substance was refused as "too long
   * for SMS".
   */
  validateTemplate(
    content: string,
    options: { channel?: CommunicationChannel; subject?: string | null } = {}
  ): {
    isValid: boolean
    errors: string[]
    unknownVariables: string[]
  } {
    const errors: string[] = []
    const unknownVariables = unknownPlaceholders(content, options.subject)

    if (unknownVariables.length > 0) {
      errors.push(
        `Unknown placeholder${unknownVariables.length === 1 ? '' : 's'} ` +
          `${listPlaceholders(unknownVariables)}. ` +
          `Use one of: ${listPlaceholders(TEMPLATE_VARIABLE_KEYS)}.`
      )
    }

    // Each placeholder counted at 20 characters, a fair guess at a filled-in
    // name or date.
    if (!options.channel || SHORT_CHANNELS.includes(options.channel)) {
      const estimated = content.replace(/{{[^}]+}}/g, 'X'.repeat(20))
      if (estimated.length > 500) {
        errors.push('Content may be too long for SMS (estimated > 500 characters)')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      unknownVariables,
    }
  }

  /**
   * Add the starter templates in lib/default-templates.ts that this clinic
   * does not have. A template with the same name is left alone — it is either
   * the starter or somebody's rewrite of it, and names are unique per clinic.
   *
   * This used to carry a list of its own, different from the one signup
   * seeds, using placeholders nothing fills in (`paidAmount`,
   * `nextVisitDate`, `prescriptionNo`).
   */
  async seedDefaultTemplates(hospitalId: string) {
    for (const template of DEFAULT_TEMPLATES) {
      const existing = await this.findByName(hospitalId, template.name)

      if (!existing) {
        await this.createTemplate({ hospitalId, ...template, isDefault: true })
      }
    }
  }
}

export const templateService = new TemplateService()

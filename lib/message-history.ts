import type { CommunicationChannel, MessageStatus, Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/**
 * What the clinic has sent, read back from the message log.
 *
 * One reader for the SMS and email history on the communications page and the
 * patient record's list of messages, so they agree on what a row is.
 *
 * Always scoped to the clinic. The SMS and email history readers this replaces
 * were handed the clinic's id and never put it in the query, so either history
 * would have listed every clinic's messages.
 */
export interface MessageHistoryFilters {
  hospitalId: string
  channel?: CommunicationChannel
  patientId?: string
  /** Part of the phone number or address it went to. */
  recipient?: string
  status?: string
  from?: Date
  to?: Date
  limit?: number
}

const MESSAGE_SELECT = {
  id: true,
  channel: true,
  patientId: true,
  recipient: true,
  subject: true,
  body: true,
  relatedType: true,
  relatedId: true,
  status: true,
  scheduledFor: true,
  sentAt: true,
  deliveredAt: true,
  failedAt: true,
  errorMessage: true,
  createdAt: true,
  template: { select: { id: true, name: true } },
} satisfies Prisma.MessageLogSelect

const STATUSES: readonly MessageStatus[] = [
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
]

/** A page is enough for a history; nobody reads a thousand messages on screen. */
const MAX_LIMIT = 200

export async function messageHistory(filters: MessageHistoryFilters) {
  const where: Prisma.MessageLogWhereInput = { hospitalId: filters.hospitalId }
  if (filters.channel) where.channel = filters.channel
  if (filters.patientId) where.patientId = filters.patientId
  if (filters.recipient) where.recipient = { contains: filters.recipient }
  if (filters.status && (STATUSES as readonly string[]).includes(filters.status)) {
    where.status = filters.status as MessageStatus
  }
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from && { gte: filters.from }),
      ...(filters.to && { lte: filters.to }),
    }
  }

  const limit =
    filters.limit && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.min(Math.floor(filters.limit), MAX_LIMIT)
      : 100

  const messages = await prisma.messageLog.findMany({
    where,
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // The log holds the patient's id but no relation to the patient, so the
  // names are read alongside — this clinic's patients only.
  const patientIds = [...new Set(messages.map((m) => m.patientId).filter(Boolean))] as string[]
  const patients = patientIds.length
    ? await prisma.patient.findMany({
        where: { id: { in: patientIds }, hospitalId: filters.hospitalId },
        select: { id: true, patientId: true, firstName: true, lastName: true },
      })
    : []
  const byId = new Map(patients.map((p) => [p.id, p]))

  return messages.map((message) => ({
    ...message,
    patient: message.patientId ? (byId.get(message.patientId) ?? null) : null,
  }))
}

export type MessageHistoryRow = Awaited<ReturnType<typeof messageHistory>>[number]

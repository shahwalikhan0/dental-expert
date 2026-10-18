'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadFailed } from '@/components/ui/load-failed'
import { StatusBadge } from '@/components/ui/status-badge'
import { displayDateTime } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson } from '@/lib/toast-utils'
import { MessageSquare } from 'lucide-react'

/** One row of the message log, as lib/message-history.ts sends it. */
interface Message {
  id: string
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'
  recipient: string
  subject: string | null
  body: string
  relatedType: string | null
  status: string
  scheduledFor: string | null
  sentAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  errorMessage: string | null
  createdAt: string
  patient: { id: string; patientId: string; firstName: string; lastName: string } | null
}

const CHANNEL_LABELS: Record<Message['channel'], string> = {
  SMS: 'SMS',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  IN_APP: 'In app',
}

/** What an automatic message was for, when its wording is written at send time. */
const RELATED_LABELS: Record<string, string> = {
  Appointment: 'Appointment reminder',
  Recare: 'Recall reminder',
  Waitlist: 'Waitlist offer',
}

/** The moment that matters for this row, and what to call it. */
function when(message: Message): string {
  if (message.deliveredAt) return `Delivered ${displayDateTime(message.deliveredAt)}`
  if (message.sentAt) return `Sent ${displayDateTime(message.sentAt)}`
  if (message.failedAt) return `Failed ${displayDateTime(message.failedAt)}`
  if (message.scheduledFor) return `Due ${displayDateTime(message.scheduledFor)}`
  return `Created ${displayDateTime(message.createdAt)}`
}

/**
 * Messages read back from the message log — the SMS and email history on the
 * communications page, and the list on a patient's record (bug report 16 Oct,
 * finding 18). Both were placeholders.
 *
 * `url` answers with `{ data }` (the SMS and email history routes) or
 * `{ messages }` (a patient's). Change `reloadKey` to read it again, after a
 * send for instance.
 */
export function MessageHistory({
  url,
  reloadKey = 0,
  showPatient = false,
  showChannel = false,
  emptyDescription,
}: {
  url: string
  reloadKey?: number
  /** Name the patient on each row — on the clinic-wide history. */
  showPatient?: boolean
  /** Say which channel each row went over — where channels are mixed. */
  showChannel?: boolean
  emptyDescription: string
}) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setFailed(false)
      try {
        const data = await readJson<{ data?: Message[]; messages?: Message[] }>(await fetch(url))
        if (!cancelled) setMessages(data.messages ?? data.data ?? [])
      } catch (err) {
        console.error('Error fetching messages:', err)
        if (!cancelled) setFailed(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [url, reloadKey, retry])

  if (failed) return <LoadFailed what="the messages" onRetry={() => setRetry((n) => n + 1)} />

  if (messages === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <EmptyState icon={MessageSquare} title="No messages yet" description={emptyDescription} />
    )
  }

  return (
    <ul className="divide-y">
      {messages.map((message) => {
        const to = message.channel === 'EMAIL' ? message.recipient : formatPhone(message.recipient)
        const body =
          message.body.trim() ||
          (message.relatedType && RELATED_LABELS[message.relatedType]) ||
          'No text recorded'
        return (
          <li key={message.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">
                {showPatient && message.patient
                  ? `${message.patient.firstName} ${message.patient.lastName} (${message.patient.patientId})`
                  : to}
              </span>
              {showPatient && message.patient && (
                <span className="text-muted-foreground">{to}</span>
              )}
              {showChannel && <Badge variant="outline">{CHANNEL_LABELS[message.channel]}</Badge>}
              <StatusBadge kind="message" status={message.status} className="ml-auto" />
            </div>
            {message.subject && <p className="text-sm font-medium">{message.subject}</p>}
            <p
              className={`text-sm line-clamp-2 ${message.body.trim() ? '' : 'text-muted-foreground italic'}`}
            >
              {body}
            </p>
            {message.status === 'FAILED' && message.errorMessage && (
              <p className="text-xs text-destructive">{message.errorMessage}</p>
            )}
            <p className="text-xs text-muted-foreground">{when(message)}</p>
          </li>
        )
      })}
    </ul>
  )
}

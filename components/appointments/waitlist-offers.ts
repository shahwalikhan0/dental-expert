/**
 * What the desk is told when cancelling an appointment offered its slot to the
 * waitlist.
 *
 * The cancellation's response says who was offered the slot and whether a text
 * went to them (lib/services/smart-scheduler.ts). Somebody who could not be
 * texted — no mobile number, or no consent to appointment messages — has to be
 * phoned, and this is the only moment the desk learns that. Both screens that
 * cancel build their toast here.
 */
import { formatPhone } from '@/lib/utils'

interface WaitlistOffer {
  name: string
  phone: string
  messaged: boolean
  reason?: string
}

interface CancelResponse {
  waitlistOffers?: {
    offers: WaitlistOffer[]
    slotDetails: { date: string; time: string; doctorName: string }
  }
}

export function waitlistOfferToast(
  response: unknown
): { title: string; description: string } | null {
  const result = (response as CancelResponse | null)?.waitlistOffers
  if (!result || result.offers.length === 0) return null

  const texted = result.offers.filter((offer) => offer.messaged)
  const toCall = result.offers.filter((offer) => !offer.messaged)

  const parts: string[] = []
  if (texted.length > 0) {
    parts.push(`Texted ${texted.map((offer) => offer.name).join(', ')}.`)
  }
  if (toCall.length > 0) {
    parts.push(
      `Please call ${toCall
        .map(
          (offer) =>
            `${offer.name}${offer.phone ? ` on ${formatPhone(offer.phone)}` : ''}` +
            (offer.reason ? ` (${offer.reason.toLowerCase()})` : '')
        )
        .join(', ')}.`
    )
  }

  const { date, time, doctorName } = result.slotDetails
  return {
    title: `The ${time} slot on ${date} with ${doctorName} was offered to the waitlist`,
    description: parts.join(' '),
  }
}

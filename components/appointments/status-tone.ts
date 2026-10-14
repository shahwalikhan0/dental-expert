/**
 * An appointment's status as a colour on the book, where a badge will not fit.
 *
 * The day book and the week view each kept a colour map of their own, and
 * neither agreed with the badge: SCHEDULED was slate on the book and blue on
 * the badge, CONFIRMED blue and indigo, IN_PROGRESS violet and purple. Both
 * now read the tone from lib/status.ts — the table `StatusBadge` draws from —
 * so a block, a dot and a badge for the same appointment are the same colour.
 */
import { statusLabel, statusTone, type StatusTone } from '@/lib/status'

/** A block on the day book: tinted fill, border and text, per tone. */
const TONE_BLOCK_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-muted border-border text-muted-foreground',
  info: 'bg-blue-500/20 border-blue-500/50 text-blue-900 dark:text-blue-100',
  progress: 'bg-amber-500/25 border-amber-500/60 text-amber-900 dark:text-amber-100',
  success: 'bg-green-500/20 border-green-500/50 text-green-900 dark:text-green-100',
  danger: 'bg-red-500/15 border-red-500/40 text-red-900 dark:text-red-100',
  purple: 'bg-purple-500/20 border-purple-500/50 text-purple-900 dark:text-purple-100',
}

/** A dot beside a time on the week view. */
const TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-blue-500',
  progress: 'bg-amber-500',
  success: 'bg-green-500',
  danger: 'bg-red-500',
  purple: 'bg-purple-500',
}

export function appointmentBlockClass(status: string): string {
  return TONE_BLOCK_CLASS[statusTone('appointment', status)]
}

export function appointmentDotClass(status: string): string {
  return TONE_DOT_CLASS[statusTone('appointment', status)]
}

/** "Checked in", "No-show" — the badge's own words, for a block's accessible name. */
export function appointmentStatusLabel(status: string): string {
  return statusLabel('appointment', status)
}

'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Vault } from 'lucide-react'
import { TILL_PATH } from '@/lib/till'
import { cn } from '@/lib/utils'

/**
 * "Open the till first", in place of a payment form the server would refuse.
 *
 * Finding 38: a payment taken with no till open belonged to no till and never
 * appeared in any closing. The routes now refuse it; this tells the person why
 * and where to go before they have typed the amount in, rather than after.
 */
export function NoTillNotice({
  what = 'payment',
  className,
}: {
  /** What is being held up: a payment taken, or cash paid out as a refund. */
  what?: 'payment' | 'cash-refund'
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800/60 dark:bg-amber-950/30',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Vault className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-2">
          <p className="font-medium text-amber-900 dark:text-amber-200">No till is open</p>
          <p className="text-amber-900/80 dark:text-amber-200/80">
            {what === 'payment'
              ? 'Every payment goes into an open till, so it is counted at the end-of-day closing. Open the till first, then come back to take the payment.'
              : 'Cash paid out comes from the drawer, so it has to go through an open till. Open the till first, or refund by another method.'}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={TILL_PATH}>Go to Billing → Till</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

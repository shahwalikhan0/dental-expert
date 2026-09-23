'use client'

/**
 * The counts the navigation shows beside an item.
 *
 * Only one so far: how many walk-ins are waiting on a decision. It is worth a
 * badge because the walk-in queue is the one screen whose contents are a
 * backlog — somebody was seen and has not yet been put on the register or
 * written off — and nothing else in the application would tell you that
 * backlog exists.
 *
 * Re-read on navigation rather than polled. The number changes when somebody
 * converts or discards a visitor, and the next thing they do is leave that
 * screen, so a route change is the signal. A timer would be a request a minute
 * for a number that is usually unchanged.
 */
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NavBadgeKey } from '@/config/nav'

export type NavBadges = Partial<Record<NavBadgeKey, number>>

export function useNavBadges(): NavBadges {
  const pathname = usePathname()
  const [badges, setBadges] = useState<NavBadges>({})

  useEffect(() => {
    let current = true
    ;(async () => {
      try {
        const response = await fetch('/api/visitors/count')
        // A role without `patients:read` gets a 403 here. That is not an
        // error to report: the item it would sit on is already filtered out
        // of this person's menu.
        if (!response.ok) return
        const data = await response.json()
        if (!current) return
        setBadges({ openVisitors: typeof data.open === 'number' ? data.open : 0 })
      } catch {
        // A menu is not the place to report that a count could not be read.
      }
    })()

    return () => {
      current = false
    }
  }, [pathname])

  return badges
}

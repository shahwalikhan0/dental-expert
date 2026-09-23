'use client'

/**
 * The count on a navigation row.
 *
 * Two kinds: a fixed `badge` string from the config, and a `badgeKey` whose
 * number is read while the menu is on screen. A live count of zero draws
 * nothing — a badge saying "0" advertises an empty queue, which is the one
 * state nobody needs telling about.
 */
import type { NavItem } from '@/config/nav'
import type { NavBadges } from '@/hooks/use-nav-badges'

export function NavBadge({ item, badges }: { item: NavItem; badges: NavBadges }) {
  const live = item.badgeKey ? badges[item.badgeKey] : undefined
  const label = live && live > 0 ? String(live) : item.badge

  if (!label) return null

  return (
    <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
      {label}
      {/* The number alone does not say what it counts. */}
      <span className="sr-only"> waiting</span>
    </span>
  )
}

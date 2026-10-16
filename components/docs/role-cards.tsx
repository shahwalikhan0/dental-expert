'use client'

import { getNavigationForRole } from '@/config/nav'
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_THEMES, roleThemeStyle } from '@/lib/rbac'
import { cn } from '@/lib/utils'

/**
 * One card per role, listing the menu that role is shown, washed in the
 * role's colour the way that role's sidebar and header are, so a reader can
 * tell from a screenshot whose screen it is.
 *
 * Built from the same menu the sidebar draws, so it cannot claim a role opens
 * a page the router would bounce. A client component only because
 * `config/nav` pulls in every menu icon, and the client bundle already carries
 * it for the sidebar; importing it into the server graph of /docs stalled the
 * dev compiler.
 */
export function RoleCards() {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {ALL_ROLES.map((role) => {
        const menu = getNavigationForRole(role).flatMap((section) =>
          section.items.map((item) => item.title)
        )
        return (
          <div
            key={role}
            className="role-tint glass glass-raised role-surface rounded-2xl p-5"
            style={roleThemeStyle(role)}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{ROLE_LABELS[role]}</h3>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                  ROLE_THEMES[role].badge
                )}
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--role))]" />
                {ROLE_THEMES[role].name}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}.</p>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Opens
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {menu.map((title) => (
                <span
                  key={title}
                  className="rounded-lg bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/80"
                >
                  {title}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

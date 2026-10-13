'use client'

import { getNavigationForRole } from '@/config/nav'
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/rbac'

/**
 * One card per role, listing the menu that role is shown.
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
          <div key={role} className="glass glass-raised rounded-2xl p-5">
            <h3 className="font-semibold">{ROLE_LABELS[role]}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}.</p>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
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

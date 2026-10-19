import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ProfileFact {
  icon?: React.ComponentType<{ className?: string }>
  label: React.ReactNode
}

export interface ProfileMenuItem {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onSelect: () => void
  /** Drawn in red: deactivate, delete. */
  destructive?: boolean
  /** Shown but not offered, when something else has to happen first. */
  disabled?: boolean
}

/**
 * The top of a record — a patient, a member of staff, a treatment, an
 * appointment — as a profile card. People get their initials in the circle;
 * a record that is not a person gets an icon (`avatarIcon`) instead.
 *
 * The person first, large, with an avatar and the handful of facts every visit
 * starts with (ID, age, phone) as a row of small chips under the name, and the
 * one or two things people do from here as buttons on the right. Everything
 * rarer goes in a "More" menu, so the header is not a wall of equal buttons
 * where "Deactivate" sits as loud as "Book appointment".
 */
export function ProfileHeader({
  name,
  eyebrow,
  initials,
  avatarIcon: AvatarIcon,
  image,
  badges,
  facts,
  actions,
  menu,
  className,
}: {
  name: string
  /** A small line above the name: the record's number, its kind. */
  eyebrow?: React.ReactNode
  initials?: string
  /** In place of initials, for a record that is not a person. */
  avatarIcon?: React.ComponentType<{ className?: string }>
  image?: string | null
  /** Status beside the name: inactive, merged. */
  badges?: React.ReactNode
  facts?: ProfileFact[]
  /** The main actions, primary last. */
  actions?: React.ReactNode
  /** Rarer actions, behind "More". */
  menu?: ProfileMenuItem[]
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-primary/10"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary ring-4 ring-primary/5"
          >
            {AvatarIcon ? <AvatarIcon className="h-7 w-7" /> : initials}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
            {badges}
          </div>
          {facts && facts.length > 0 && (
            <ul className="mt-2 flex flex-wrap items-center gap-2">
              {facts.map((fact, index) => {
                const Icon = fact.icon
                return (
                  <li
                    key={index}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
                    {fact.label}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {(actions || (menu && menu.length > 0)) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {menu && menu.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {menu.map((item) => {
                  const Icon = item.icon
                  return (
                    <DropdownMenuItem
                      key={item.label}
                      onSelect={item.onSelect}
                      disabled={item.disabled}
                      className={cn(
                        'gap-2',
                        item.destructive && 'text-destructive focus:text-destructive'
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      {item.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {actions}
        </div>
      )}
    </section>
  )
}

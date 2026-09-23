/**
 * The four kinds of surface this application draws.
 *
 * `app/globals.css` defines `.glass` for the surfaces whose markup we own
 * outright — the sidebar, the sign-in panel. Those selectors are deliberately
 * written twice so they beat any Tailwind utility on the element, which is
 * right there and wrong here: `Card` is used 87 times and nineteen of those
 * tint themselves on purpose, because an allergy warning and a stock alert are
 * meant to look like warnings. A surface class that overrode them would quietly
 * turn every warning in the application back into an ordinary card.
 *
 * So a shared primitive composes its surface out of ordinary utilities instead.
 * `cn()` merges through tailwind-merge, which knows `bg-card/70` and
 * `bg-red-50 dark:bg-red-950/30` are the same decision and keeps the caller's. The look is the
 * default; it is not an override.
 *
 * Every value here is a theme token, so the two themes are one implementation
 * and neither needs a `dark:` variant.
 */

/** An in-page surface: a card, a panel, a section of a form. */
export const GLASS_SURFACE =
  'border border-border/60 bg-card/70 backdrop-blur-xl backdrop-saturate-150'

/**
 * A surface that floats over content it knows nothing about: a menu, a dialog,
 * a toast. Less transparent than an in-page one, because whatever is behind it
 * is not its own background and must not compete with its text.
 */
export const GLASS_OVERLAY =
  'border border-border/60 bg-popover/90 backdrop-blur-2xl backdrop-saturate-150'

/**
 * A field. Drawn as a well in the surface rather than as a white box on it: an
 * opaque field on a translucent card reads as a hole punched through it.
 *
 * `bg-foreground/[0.04]` is the same instruction in both themes — a little of
 * the text colour over the surface — which is why there is no `dark:` here.
 */
export const GLASS_FIELD = 'border border-input/70 bg-foreground/[0.04] backdrop-blur-sm'

/**
 * The scrim behind a modal.
 *
 * A fixed dark slate rather than a theme token: `bg-foreground/40` would darken
 * the page in the light theme and *lighten* it in the dark one, which is the
 * opposite of what a scrim is for.
 */
export const GLASS_SCRIM = 'bg-slate-950/40 backdrop-blur-md'

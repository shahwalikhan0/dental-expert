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

/**
 * An in-page surface: a card, a panel, a section of a form.
 *
 * Solid, with a full-strength edge and a small shadow. It was translucent
 * (`bg-card/70` and a blur) over a near-white page, which left a card the
 * same colour as the ground under it: nothing on a screen was visibly
 * separate from anything else. The page is now grey and the card is opaque.
 * The names stay, so the eighty-odd call sites need no change.
 */
export const GLASS_SURFACE = 'border border-border bg-card shadow-sm'

/**
 * A surface that floats over content it knows nothing about: a menu, a dialog,
 * a toast. Less transparent than an in-page one, because whatever is behind it
 * is not its own background and must not compete with its text.
 */
export const GLASS_OVERLAY = 'border border-border bg-popover shadow-lg'

/**
 * A field: a white box with a clear edge, the one shape everybody reads as
 * "type here". It was a faint well in a translucent card, which on the grey
 * page looked like a smudge rather than a control. In the dark theme it sits a
 * shade below the card instead of level with it.
 */
export const GLASS_FIELD = 'border border-input bg-card shadow-sm dark:bg-background/60'

/**
 * The scrim behind a modal.
 *
 * A fixed dark slate rather than a theme token: `bg-foreground/40` would darken
 * the page in the light theme and *lighten* it in the dark one, which is the
 * opposite of what a scrim is for.
 */
export const GLASS_SCRIM = 'bg-slate-950/40 backdrop-blur-md'

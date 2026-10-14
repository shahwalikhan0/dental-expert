'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MIN_TERM, PICKER_LIMIT } from '@/hooks/use-catalogue-search'

export { MIN_TERM, PICKER_LIMIT }

export interface SearchOption<T = unknown> {
  id: string
  /** What the field shows once this option is chosen. */
  label: string
  /** Muted text beside the label — a generic name, a code, a price. */
  hint?: string
  /** A second line, for anything that does not fit on the first. */
  detail?: string
  /** The record behind the option, for `renderOption` and `onSelect`. */
  data?: T
}

/** Where an option is, for `renderOption`. */
export interface SearchOptionState {
  /** Highlighted by the keyboard or the pointer. */
  active: boolean
  /** The current value. */
  selected: boolean
}

export interface SearchSelectProps<T = unknown> {
  /** The chosen option's id, or null. */
  value: string | null
  /** Shown when the field is closed and something is chosen. */
  selectedLabel?: string | null
  options: SearchOption<T>[]
  onSelect: (option: SearchOption<T>) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  /**
   * Server mode. Called with every keystroke; the caller fetches (normally
   * through `useCatalogueSearch`) and passes back `options`, which are shown
   * as given and not filtered again here.
   */
  onSearchChange?: (term: string) => void
  /**
   * Server mode: the caller shows a first page while the box is empty (the
   * standard). When false, an empty or one-letter box shows the hint "Type at
   * least 2 characters…" instead of a list. Ignored in local mode. Default
   * false, which is how the field behaved before preload existed.
   */
  preload?: boolean
  /**
   * Called each time the list opens. The pickers use the first call to start
   * fetching, so a form with twenty rows of pickers does not send twenty
   * requests for lists nobody has opened.
   */
  onOpen?: () => void
  /** A request is out. Shows "Searching…" and a spinner in the field. */
  loading?: boolean
  /**
   * The search could not run. Shows "Couldn't search just now. Try again."
   * rather than an empty list, which would be a confident wrong answer.
   */
  failed?: boolean
  /** Offered as "Try again" under the failed message. */
  onRetry?: () => void
  /**
   * How many records match in all, when the server says. When it is more than
   * the options shown, a footer reads "Showing 10 of 240 — keep typing to
   * narrow".
   */
  total?: number | null
  /**
   * Plural noun for the records, lower case — "patients", "medications". Used
   * for the standard empty message `No patients match “ali”.`
   */
  noun?: string
  placeholder?: string
  /**
   * Overrides the standard empty message. Prefer `noun`, so every picker says
   * the same thing.
   */
  emptyMessage?: React.ReactNode
  /** Rendered under the empty message — normally a link to the catalogue. */
  emptyAction?: React.ReactNode
  /**
   * Draw an option yourself — two lines with an avatar, a stock figure. The
   * check mark for the chosen row is still drawn by the field. Defaults to
   * label, hint and detail.
   */
  renderOption?: (option: SearchOption<T>, state: SearchOptionState) => React.ReactNode
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * A select you can type into, where the answer is always one of the options.
 *
 * Built because two fields that ought to behave identically did not. The
 * medication field on a prescription was a text input with a suggestion list
 * hanging off it: picking a suggestion linked the row to the drug catalogue,
 * but typing a name and ignoring the list left `medicationId` null and the row
 * attached to nothing. The same prescription could therefore hold two rows that
 * looked alike and meant different things, and no screen showed which was
 * which. The template editor had no list at all, so every template line was
 * unlinked. A field that only sometimes records a reference is worse than one
 * that never does, because reports quietly under-count instead of visibly
 * failing.
 *
 * So: no free text. `onSelect` only ever fires with an option, and the input is
 * a search box, not the value. If what somebody needs is not in the catalogue,
 * the answer is to add it to the catalogue — which is what `emptyAction` is
 * for — rather than to type it here and leave no trace.
 *
 * Filtering is local over `options` by default. Pass `onSearchChange` when the
 * list comes from a server; the component then shows whatever it is given and
 * does not filter again. The standard server picker is `preload` plus
 * `useCatalogueSearch`: it opens onto a first page, asks the server from the
 * second character after a 300 ms pause, and says when there are more rows
 * than it shows. The entity pickers (PatientPicker, MedicationPicker,
 * ProcedurePicker, InventoryItemPicker, SupplierPicker) are this, wired up.
 *
 * Keyboard, following the WAI-ARIA combobox pattern: ↓/↑ open the list and
 * move through it, Enter chooses, Escape closes (and clears the term), Tab
 * closes and moves on. Home/End jump to the first/last option while the box
 * is empty; once something is typed they move the caret, as in any text field.
 */
export function SearchSelect<T = unknown>({
  value,
  selectedLabel,
  options,
  onSelect,
  onClear,
  onSearchChange,
  preload = false,
  onOpen,
  loading = false,
  failed = false,
  onRetry,
  total,
  noun,
  placeholder = 'Search…',
  emptyMessage,
  emptyAction,
  renderOption,
  disabled = false,
  autoFocus,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SearchSelectProps<T>) {
  const [open, setOpen] = React.useState(false)
  const [term, setTerm] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)

  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const serverMode = Boolean(onSearchChange)
  const trimmed = term.trim()
  // Server mode without a first page: below two characters there is nothing
  // to show, and saying so beats an empty panel.
  const needsMore = serverMode && !preload && trimmed.length < MIN_TERM

  // Local filtering only when the caller is not fetching. Filtering a list that
  // the server already narrowed would hide results whose match is in a field
  // the server searched and this component cannot see, such as a generic name.
  const shown = React.useMemo(() => {
    if (needsMore) return []
    if (serverMode) return options
    const needle = trimmed.toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ''} ${option.detail ?? ''}`.toLowerCase().includes(needle)
    )
  }, [options, trimmed, serverMode, needsMore])

  // Clamped where it is read rather than corrected in an effect. The list
  // shrinks as the user types, and an index left pointing past the end makes
  // Enter do nothing — which reads as a broken field rather than an empty one.
  // Doing it here means the very render that shortens the list already has a
  // valid index, instead of one render showing the broken state before an
  // effect fixes it.
  const active = activeIndex >= shown.length ? 0 : activeIndex
  const listed = open && !loading && !failed && shown.length > 0

  // Closing on outside click rather than on blur: blur fires before the click
  // on an option registers, so a blur-close would swallow every selection.
  // The popover reports outside presses; a press on the field itself is not
  // one (see onInteractOutside below).

  // Keep the highlighted row in view when the keyboard moves it past the
  // panel's edge; the panel scrolls, the page does not.
  React.useEffect(() => {
    if (!listed) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, listed])

  const openList = () => {
    if (open) return
    setOpen(true)
    onOpen?.()
  }

  const search = (next: string) => {
    setTerm(next)
    setActiveIndex(0)
    openList()
    onSearchChange?.(next)
  }

  const reset = () => {
    setTerm('')
    onSearchChange?.('')
  }

  const choose = (option: SearchOption<T>) => {
    onSelect(option)
    setOpen(false)
    reset()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!open) {
          openList()
          return
        }
        if (shown.length === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((active + step + shown.length) % shown.length)
        return
      }
      case 'Home':
      case 'End': {
        // Only while the box is empty: once there is text, these keys belong
        // to the caret.
        if (!listed || term) return
        event.preventDefault()
        setActiveIndex(event.key === 'Home' ? 0 : shown.length - 1)
        return
      }
      case 'Enter': {
        // Only swallowed when it is doing something. Left alone otherwise, so a
        // closed field does not block the form's own submit.
        if (listed && shown[active]) {
          event.preventDefault()
          choose(shown[active])
        }
        return
      }
      case 'Escape': {
        if (!open) return
        event.preventDefault()
        setOpen(false)
        reset()
        return
      }
      case 'Tab': {
        if (open) setOpen(false)
        return
      }
    }
  }

  const hasValue = Boolean(value)

  const standardEmpty = noun
    ? trimmed
      ? `No ${noun} match “${trimmed}”.`
      : `No ${noun} yet.`
    : 'No matches.'

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <div ref={rootRef} className={cn('relative', className)}>
        <PopoverPrimitive.Anchor asChild>
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border border-input/70 bg-foreground/[0.04] px-3',
              'backdrop-blur-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
              ariaInvalid && 'border-destructive',
              disabled && 'pointer-events-none opacity-60'
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}

            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-label={ariaLabel}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid || undefined}
              aria-activedescendant={listed && shown[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              // Typing a search is not editing the form: the unsaved-changes guard
              // (hooks/use-form-guard.ts) should not ask about a half-typed name.
              data-form-guard="ignore"
              autoFocus={autoFocus}
              disabled={disabled}
              // The chosen label is the placeholder, not the value. Putting it in
              // `value` would mean the user has to delete it before searching, and
              // deleting it would look like clearing the field when it is not.
              placeholder={hasValue ? (selectedLabel ?? placeholder) : placeholder}
              value={term}
              onChange={(event) => search(event.target.value)}
              onFocus={openList}
              onClick={openList}
              onKeyDown={onKeyDown}
              className={cn(
                'h-10 w-full bg-transparent py-2 text-sm outline-none',
                'placeholder:text-muted-foreground',
                // A chosen value reads as the field's content, so it is drawn like
                // content rather than like a prompt.
                hasValue && !term && 'placeholder:font-medium placeholder:text-foreground'
              )}
            />

            {hasValue && onClear && !disabled && (
              <button
                type="button"
                onClick={() => {
                  onClear()
                  reset()
                  inputRef.current?.focus()
                }}
                aria-label="Clear selection"
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <ChevronsUpDown
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
              onClick={() => inputRef.current?.focus()}
            />
          </div>
        </PopoverPrimitive.Anchor>

        {/* Portalled: every card is a glass surface (backdrop-blur), which makes
          it its own stacking context, so a list positioned inside one was
          painted under the next card down whatever its z-index. Radix's
          popover rather than a bare portal so it layers correctly inside a
          dialog, whose modal would otherwise swallow the clicks. */}
        {open && (
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              asChild
              align="start"
              sideOffset={4}
              // The input keeps focus: the options are reached with the arrow keys.
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (rootRef.current?.contains(event.target as Node)) event.preventDefault()
              }}
            >
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel}
                aria-busy={loading || undefined}
                style={{ width: 'var(--radix-popover-trigger-width)' }}
                className="z-50 max-h-72 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-lg backdrop-blur-xl"
              >
                {loading ? (
                  <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Searching…
                  </p>
                ) : failed ? (
                  <div className="space-y-1 px-3 py-2" role="alert">
                    <p className="text-sm text-muted-foreground">
                      Couldn&rsquo;t search just now. Try again.
                    </p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ) : needsMore ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Type at least {MIN_TERM} characters…
                  </p>
                ) : shown.length === 0 ? (
                  <div className="space-y-2 px-3 py-2">
                    <p className="text-sm text-muted-foreground">{emptyMessage ?? standardEmpty}</p>
                    {emptyAction}
                  </div>
                ) : (
                  <>
                    {shown.map((option, index) => {
                      const isActive = index === active
                      const isChosen = option.id === value
                      return (
                        <button
                          key={option.id}
                          id={`${listId}-${index}`}
                          data-index={index}
                          type="button"
                          role="option"
                          aria-selected={isChosen}
                          // Not a tab stop: the input keeps focus and the options are
                          // reached with the arrow keys, so Tab leaves the field.
                          tabIndex={-1}
                          // Click is fine here because the outside-click handler
                          // ignores anything inside this root.
                          onClick={() => choose(option)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors',
                            isActive && 'bg-accent text-accent-foreground'
                          )}
                        >
                          <Check
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              isChosen ? 'opacity-100' : 'opacity-0'
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            {renderOption ? (
                              renderOption(option, { active: isActive, selected: isChosen })
                            ) : (
                              <>
                                <span className="font-medium">{option.label}</span>
                                {option.hint && (
                                  <span className="ml-1.5 text-muted-foreground">
                                    {option.hint}
                                  </span>
                                )}
                                {option.detail && (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {option.detail}
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </button>
                      )
                    })}
                    {total != null && total > shown.length && (
                      <p className="border-t border-border/60 px-3 pb-1 pt-2 text-xs text-muted-foreground">
                        Showing {shown.length} of {total} — keep typing to narrow
                      </p>
                    )}
                  </>
                )}
              </div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </div>
    </PopoverPrimitive.Root>
  )
}

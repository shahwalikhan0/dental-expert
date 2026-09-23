'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchOption {
  id: string
  /** What the field shows once this option is chosen. */
  label: string
  /** Muted text beside the label — a generic name, a code, a price. */
  hint?: string
  /** A second line, for anything that does not fit on the first. */
  detail?: string
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
 * list comes from a server and the caller wants to fetch as the user types;
 * the component then shows whatever it is given and does not filter again.
 */
export function SearchSelect({
  value,
  selectedLabel,
  options,
  onSelect,
  onClear,
  onSearchChange,
  loading = false,
  placeholder = 'Search…',
  emptyMessage = 'No matches.',
  emptyAction,
  disabled = false,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string | null
  /** Shown when the field is closed and something is chosen. */
  selectedLabel?: string | null
  options: SearchOption[]
  onSelect: (option: SearchOption) => void
  /** Omit to make the field un-clearable once set. */
  onClear?: () => void
  onSearchChange?: (term: string) => void
  loading?: boolean
  placeholder?: string
  emptyMessage?: React.ReactNode
  /** Rendered under the empty message — normally a link to the catalogue. */
  emptyAction?: React.ReactNode
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [term, setTerm] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)

  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listId = React.useId()

  // Local filtering only when the caller is not fetching. Filtering a list that
  // the server already narrowed would hide results whose match is in a field
  // the server searched and this component cannot see, such as a generic name.
  const shown = React.useMemo(() => {
    if (onSearchChange) return options
    const needle = term.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ''} ${option.detail ?? ''}`.toLowerCase().includes(needle)
    )
  }, [options, term, onSearchChange])

  // Clamped where it is read rather than corrected in an effect. The list
  // shrinks as the user types, and an index left pointing past the end makes
  // Enter do nothing — which reads as a broken field rather than an empty one.
  // Doing it here means the very render that shortens the list already has a
  // valid index, instead of one render showing the broken state before an
  // effect fixes it.
  const active = activeIndex >= shown.length ? 0 : activeIndex

  // Closing on outside click rather than on blur: blur fires before the click
  // on an option registers, so a blur-close would swallow every selection.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const search = (next: string) => {
    setTerm(next)
    setActiveIndex(0)
    if (!open) setOpen(true)
    onSearchChange?.(next)
  }

  const choose = (option: SearchOption) => {
    onSelect(option)
    setTerm('')
    setOpen(false)
    onSearchChange?.('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (shown.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((active + step + shown.length) % shown.length)
      return
    }
    if (event.key === 'Enter') {
      // Only swallowed when it is doing something. Left alone otherwise, so a
      // closed field does not block the form's own submit.
      if (open && shown[active]) {
        event.preventDefault()
        choose(shown[active])
      }
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      setTerm('')
      onSearchChange?.('')
    }
  }

  const hasValue = Boolean(value)

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-input/70 bg-foreground/[0.04] px-3',
          'backdrop-blur-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
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
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-activedescendant={
            open && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          // The chosen label is the placeholder, not the value. Putting it in
          // `value` would mean the user has to delete it before searching, and
          // deleting it would look like clearing the field when it is not.
          placeholder={hasValue ? (selectedLabel ?? placeholder) : placeholder}
          value={term}
          onChange={(event) => search(event.target.value)}
          onFocus={() => setOpen(true)}
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
              setTerm('')
              onSearchChange?.('')
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

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-lg backdrop-blur-xl"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : shown.length === 0 ? (
            <div className="space-y-2 px-3 py-2">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              {emptyAction}
            </div>
          ) : (
            shown.map((option, index) => {
              const isActive = index === active
              const isChosen = option.id === value
              return (
                <button
                  key={option.id}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isChosen}
                  // Pointer-down rather than click would fire before focus
                  // moves; click is fine here because the outside-click handler
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
                    <span className="font-medium">{option.label}</span>
                    {option.hint && (
                      <span className="ml-1.5 text-muted-foreground">{option.hint}</span>
                    )}
                    {option.detail && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

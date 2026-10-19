'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  value: string
  /** Called with the new text — not the event — on every keystroke and on clear. */
  onChange: (value: string) => void
  /**
   * Required: a search box's placeholder is not its name, and disappears the
   * moment somebody types. "Search invoices", "Search patients".
   */
  'aria-label': string
  /**
   * What can be searched, ending in "…": "Search by name, ID or phone…".
   * Default "Search…".
   */
  placeholder?: string
}

/**
 * A list screen's search box: icon, text, and an inline X to clear it.
 *
 * Twenty-five list screens drew this by hand — an absolutely positioned icon
 * over an `Input` with `pl-9` — and none of them could be cleared except by
 * selecting the text, or by the "Clear all" under the filters. Escape now
 * clears it too, the way a browser's own search field does.
 *
 * Controlled, and not debounced here: pair it with `useListParams`, whose
 * `search`/`setSearch` are the box and whose `query` is the settled term.
 *
 *   <SearchInput
 *     value={list.search}
 *     onChange={list.setSearch}
 *     aria-label="Search invoices"
 *     placeholder="Search by invoice number, patient or phone…"
 *   />
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, placeholder = 'Search…', className, onKeyDown, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement)

    return (
      <div className={cn('relative flex-1', className)}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={innerRef}
          type="search"
          role="searchbox"
          autoComplete="off"
          // Not a form field: the unsaved-changes guard should not ask about it.
          data-form-guard="ignore"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.key === 'Escape' && value) {
              event.preventDefault()
              onChange('')
            }
          }}
          // A pill, like the search bar of any app people use daily, so it is
          // recognised before it is read. The browser's own clear control is
          // hidden; ours is drawn the same in every browser and is announced.
          className="h-11 rounded-full pl-10 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
          {...props}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              innerRef.current?.focus()
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }
)
SearchInput.displayName = 'SearchInput'

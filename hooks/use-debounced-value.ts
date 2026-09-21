'use client'

import { useEffect, useState } from 'react'

/**
 * A value that lags behind, so that typing does not become traffic.
 *
 * Every list screen in this application put its search box straight into the
 * dependency array of the effect that fetches the list. Typing "Muhammad" sent
 * eight requests, of which seven were thrown away — and not reliably thrown
 * away, because nothing guaranteed they came back in the order they were sent.
 * The one that answered last won, which is how a search for "Mu" could end up
 * showing the results for "Muh".
 *
 * Three hundred milliseconds is the usual figure: long enough to swallow a
 * touch-typist's keystrokes, short enough that nobody notices waiting.
 *
 * The delay applies to the *value*, not to the fetch. A page that also filters
 * by a dropdown should depend on this for the search box and on the dropdown
 * directly, so choosing a filter still feels immediate.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    // An empty box is not a search anybody is in the middle of typing — it is
    // a filter being cleared, and waiting a third of a second to show the full
    // list again reads as lag rather than as care.
    if (value === ('' as unknown as T)) {
      setSettled(value)
      return
    }

    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

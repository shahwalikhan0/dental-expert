'use client'

import { useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from './use-unsaved-changes'

/**
 * Notice that a form has been typed into, and guard the way out.
 *
 * Deliberately not built on per-field state. Every form on this application
 * holds its fields differently — some in one `formData` object, some in a
 * dozen `useState` calls — and a guard that needed wiring per field would have
 * been added to two screens and forgotten on the rest. This listens for the
 * `input` event instead, which every text box, textarea and native select
 * raises and which bubbles, so one listener on the form covers all of them.
 *
 * Attach the returned ref to the element that contains the fields:
 *
 *     const formRef = useFormGuard(saving)
 *     <form ref={formRef} onSubmit={...}>
 *
 * Pass `saving` so the prompt does not appear during the navigation that a
 * successful save performs — at that point the work is safe, and asking would
 * be asking about nothing.
 *
 * A Radix select or a switch does not raise `input`, so changing only a
 * dropdown is not counted as unsaved work. That is a known limit and the right
 * side to err on: what this exists to protect is typing, and a guard that
 * cried wolf over a touched dropdown would be dismissed out of hand.
 */
export function useFormGuard(saving = false) {
  const ref = useRef<HTMLElement | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      // A search box that only filters a picker is not unsaved work.
      if (target.getAttribute('data-form-guard') === 'ignore') return
      setDirty(true)
    }

    node.addEventListener('input', onInput)
    return () => node.removeEventListener('input', onInput)
  }, [])

  useUnsavedChanges(dirty && !saving)

  // The ref itself, not an object holding it. Reading `guard.ref` in the
  // middle of a render is what the React lint rules call accessing a ref
  // during render, and they are right to: it reads as a value being consulted
  // rather than a box being handed to the DOM.
  return ref as React.RefObject<never>
}

'use client'

import { useState } from 'react'
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
export interface FormGuardRef {
  (node: HTMLElement | null): void
  /** The work is safe — after a save that stays on the page — so stop asking. */
  reset: () => void
}

export function useFormGuard(saving = false): FormGuardRef {
  const [dirty, setDirty] = useState(false)

  // A callback ref rather than an object ref read in a mount-only effect. Most
  // edit pages render a skeleton first and the form only once the record has
  // loaded; an effect that ran on mount found no form, attached nothing, and
  // the guard silently never worked on those pages. A callback ref is told
  // about the form whenever it appears or is replaced.
  // Made once and kept: a new function each render would detach and
  // re-attach on every keystroke.
  const [guard] = useState<FormGuardRef>(() => {
    // How to stop listening to the element currently listened to.
    let detach: (() => void) | null = null

    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      // A search box that only filters a picker is not unsaved work.
      if (target.getAttribute('data-form-guard') === 'ignore') return
      // After the event, not during it. This listener is on the form, so it
      // runs before React's own one at the root, and the browser runs
      // microtasks between listeners: an update here re-rendered the page
      // first, put the old value back in the box, and React's onChange then
      // read that. The first keystroke on every guarded form was lost.
      setTimeout(() => setDirty(true), 0)
    }

    const attach = (node: HTMLElement | null) => {
      detach?.()
      detach = null
      if (!node) return
      node.addEventListener('input', onInput)
      detach = () => node.removeEventListener('input', onInput)
    }

    return Object.assign(attach, { reset: () => setDirty(false) })
  })

  useUnsavedChanges(dirty && !saving)

  return guard
}

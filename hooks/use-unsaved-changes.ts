'use client'

import { useEffect } from 'react'

/**
 * Ask before throwing away something half-typed.
 *
 * A dentist writing up a long treatment note who clicks "Patients" in the
 * sidebar used to lose it, silently and completely — nothing in this
 * application asked. That is the one kind of data loss a clinic notices
 * immediately and cannot recover from, because the record was never sent.
 *
 * Two routes out of a page, and they need different treatment:
 *
 * 1. **Leaving the site** — closing the tab, reloading, typing a new address.
 *    `beforeunload` is the only hook the browser gives us, and it deliberately
 *    ignores our wording: every browser shows its own text. Setting
 *    `returnValue` is what asks for the prompt at all.
 *
 * 2. **Moving inside the application** — a sidebar link, a breadcrumb, a card
 *    that navigates. The App Router has no navigation event we can cancel, so
 *    this catches the click on the way down, before Next.js sees it, and asks.
 *    A link the person confirms is re-dispatched as an ordinary navigation.
 *
 * What it does not catch is a `router.push()` fired from a button's own
 * handler. Those are the deliberate ways out of a form — Cancel, Save — and a
 * page that asked "are you sure?" when you pressed Cancel would be noise.
 *
 * Usage:
 *
 *     useUnsavedChanges(form.isDirty && !saving)
 */
export function useUnsavedChanges(
  hasUnsavedChanges: boolean,
  message = 'This page has changes that have not been saved. Leave anyway?'
) {
  useEffect(() => {
    if (!hasUnsavedChanges) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy, and still required by some browsers to raise the prompt.
      event.returnValue = ''
      return ''
    }

    const onClickCapture = (event: MouseEvent) => {
      // Anything but a plain left click is the browser's business, not ours:
      // a middle click or ctrl-click opens a new tab and leaves this one alone.
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      // A download, a new tab, or another origin — none of them unmount us.
      if (anchor.hasAttribute('download')) return
      if (anchor.target && anchor.target !== '_self') return
      if (/^(mailto:|tel:|https?:\/\/)/i.test(href)) {
        const url = new URL(href, window.location.href)
        if (url.origin !== window.location.origin) return
      }

      if (window.confirm(message)) return

      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    // Capture phase: Next.js binds its own handler on the link, and by the
    // time that runs it is already navigating.
    document.addEventListener('click', onClickCapture, true)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [hasUnsavedChanges, message])
}

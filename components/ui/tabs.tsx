'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * A tab strip that scrolls sideways rather than squeezing: a row of labels on
 * a hairline, with a bar under the selected one.
 *
 * It was a segmented control, a grey track with a lighter pill sliding along
 * it. Two shades of near-white, so which tab was open took a second look; an
 * underline in the brand colour under a dark label does not.
 *
 * A patient's record has eight tabs. They were laid out as an eight-column
 * grid across the full width, which on a phone gives eight columns of about
 * forty pixels — too narrow for a word, so the labels were hidden below `sm`
 * and the strip became eight unlabelled icons. Guessing which pictogram means
 * "Perio" is not navigation.
 *
 * Scrolling instead: the tabs keep their labels at every width and the strip
 * runs off the edge, which is a thing people already know how to operate.
 *
 * Two details this depends on:
 *
 *   - no `justify-center`. Centring an overflowing flex row puts the first
 *     item at a negative offset, and content scrolled past the start edge
 *     cannot be scrolled back to — tab one becomes unreachable. The strip is
 *     content-width when it fits, so there is nothing to centre anyway;
 *   - `shrink-0` on the triggers, below, so they overflow rather than
 *     compress. Without it flexbox does exactly what the grid did.
 *
 * The selected segment is one element that moves, rather than a background
 * applied to whichever trigger happens to be active — see the effect below for
 * how it is placed, and `.segmented` / `.segmented-thumb` in app/globals.css
 * for how it looks.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const thumbRef = React.useRef<HTMLSpanElement>(null)

  /**
   * Keep the thumb under the selected tab.
   *
   * Written straight to the node rather than held in state. Radix flips
   * `data-state` on the triggers without re-rendering this component — the
   * selected value lives in its own context, which `TabsList` does not read —
   * so a MutationObserver is what actually knows when the selection changed.
   * Going through `useState` would mean a render per keystroke of an arrow key
   * for a value React never needs; this is an effect synchronising a DOM node,
   * which is what effects are for.
   */
  React.useEffect(() => {
    const thumb = thumbRef.current
    // The strip itself, reached through the thumb rather than through a second
    // ref: the thumb is its first child, and merging a local ref with the one
    // the caller forwarded would mean writing to somebody else's ref object.
    const list = thumb?.parentElement
    if (!list || !thumb) return

    // The first placement is not a slide. Without this the thumb animates in
    // from the left edge on every page load, which reads as the strip
    // choosing a tab rather than showing the one you are on.
    let placed = false

    const place = () => {
      // `:scope >` rather than a subtree search: a screen with tabs inside a
      // tab would otherwise have the outer strip measure the inner strip's
      // selection and park its thumb somewhere impossible.
      const active = list.querySelector<HTMLElement>(':scope > [role="tab"][data-state="active"]')
      if (!active) {
        thumb.style.opacity = '0'
        return
      }
      thumb.style.transitionDuration = placed ? '' : '0ms'
      thumb.style.opacity = '1'
      thumb.style.width = `${active.offsetWidth}px`
      // `offsetLeft` is measured against the list, which is the thumb's
      // offset parent, so this stays correct while the strip is scrolled. The
      // bar sits on the bottom edge of the tab, over the strip's own rule.
      thumb.style.transform = `translate3d(${active.offsetLeft}px, ${
        active.offsetTop + active.offsetHeight - thumb.offsetHeight
      }px, 0)`
      placed = true
    }

    /*
     * What can move the thumb, and what watches for it.
     *
     * Two observers, both re-registered together whenever the set of tabs
     * changes, because a tab that arrives later needs watching too:
     *
     *   - `resize` on the strip and on every trigger. A tab's width changes
     *     without the strip's own box changing — a font finishes loading, a
     *     live count appears in a badge — and the thumb has to follow;
     *   - `mutate` on each trigger's `data-state`, which is how the selection
     *     announces itself. Radix flips it without re-rendering this component.
     *
     * Both are scoped to direct children. A screen with tabs inside a tab would
     * otherwise have the outer strip react to the inner strip's selection.
     */
    const resize = new ResizeObserver(place)
    const mutate = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) watch(list)
      place()
    })

    // Takes the strip rather than closing over it: a hoisted declaration is
    // what lets the observer above call it, and a hoisted declaration is also
    // where TypeScript stops believing the null check two lines up.
    function watch(strip: HTMLElement) {
      resize.disconnect()
      mutate.disconnect()

      resize.observe(strip)
      mutate.observe(strip, { childList: true })

      for (const tab of strip.querySelectorAll(':scope > [role="tab"]')) {
        resize.observe(tab)
        mutate.observe(tab, { attributes: true, attributeFilter: ['data-state'] })
      }
    }

    watch(list)

    place()

    return () => {
      resize.disconnect()
      mutate.disconnect()
    }
  }, [])

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'relative isolate flex w-full max-w-full items-end gap-1 overflow-x-auto border-b border-border text-muted-foreground',
        // A horizontal scrollbar inside a 40px pill is thicker than the thing
        // it is scrolling. The overflow still scrolls by wheel, drag, and by
        // focusing a tab with the arrow keys, which browsers bring into view.
        'tabs-scroll',
        className
      )}
      {...props}
    >
      <span
        ref={thumbRef}
        aria-hidden="true"
        className="tabs-underline pointer-events-none absolute left-0 top-0 h-[2px] rounded-full bg-primary opacity-0"
      />
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-md px-3 pb-3 pt-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
      // The bar under it is the selected state; the label turns dark and bold
      // with it, so the open tab reads at a glance even in greyscale.
      'data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=inactive]:hover:text-foreground',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-6 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

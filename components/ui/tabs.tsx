'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * A tab strip that scrolls sideways rather than squeezing.
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
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-10 max-w-full items-center overflow-x-auto rounded-xl border border-border/60 bg-foreground/[0.04] p-1 text-muted-foreground backdrop-blur-sm',
      // A horizontal scrollbar inside a 40px pill is thicker than the thing
      // it is scrolling. The overflow still scrolls by wheel, drag, and by
      // focusing a tab with the arrow keys, which browsers bring into view.
      'tabs-scroll',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex shrink-0 grow basis-auto items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm',
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
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

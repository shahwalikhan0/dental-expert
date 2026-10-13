'use client'

/**
 * The shape of a mouth, drawn once.
 *
 * Two screens draw a full dentition: the picker on the treatment and
 * prescription forms, and the chart on a patient's record. They drew it
 * differently — the picker as two arches of variably-sized teeth curving away
 * from the midline, the chart as thirty-two identical rounded rectangles in
 * two straight rows on a pink gradient. A dentist reading both in one sitting
 * had to re-find the midline each time, and the same tooth was a different
 * width and a different colour depending on which screen named it.
 *
 * So the geometry lives here and both use it. What differs between the two is
 * only what a tooth *means* when you press it — select it, or open its
 * findings — which is the callers' business and is passed in as `tooth`.
 *
 * Every tooth is a real `<button>`, not an SVG path with a click handler. The
 * arch is a per-tooth `translateY`; the accessibility tree stays a flat list of
 * buttons in anatomical order.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { quadrantsOf, QUADRANTS, type Dentition } from '@/lib/teeth'
import { primaryToothNames, toothNames } from '@/lib/treatment-utils'
import { ToothGlyph } from '@/components/dental-chart/tooth-glyph'

/**
 * A tooth's name, either dentition. Shared by the chart and the picker, whose
 * picker read `toothNames` alone and so announced a primary tooth as just
 * "tooth" (bug report 12 Oct, finding 55).
 */
export function toothName(tooth: number): string {
  return toothNames[tooth] ?? primaryToothNames[tooth] ?? 'Tooth'
}

/**
 * How far each tooth sits from its row's baseline, in pixels, indexed by its
 * FDI position — 0 is the central incisor, 7 the third molar.
 *
 * An arch, not a line: the incisors sit at the midline and the molars fall
 * away behind them, so the upper row reads as ∩ and the lower as ∪. That is
 * the shape a dentist is used to, and it makes the midline findable at a
 * glance rather than counted to.
 *
 * Keyed off the tooth's own number rather than its position in the rendered
 * row, because the four quadrants are drawn in two different directions — the
 * right-hand ones run molar-first and the left-hand ones incisor-first. An
 * index-based curve was right for one quadrant and mirrored in the other
 * three, which drew a shallow W.
 */
const ARCH_OFFSET = [0, 0, 1, 2, 4, 6, 8, 10]

/** The arch offset for a tooth, from its FDI position (1 central – 8 third molar). */
export function archOffset(tooth: number): number {
  return ARCH_OFFSET[Math.min(7, Math.max(0, (tooth % 10) - 1))]
}

/** Wider for molars, narrow for incisors — a mouth is not eight equal squares. */
export function toothWidth(tooth: number): string {
  const position = tooth % 10
  // Primary molars sit at positions 4 and 5, and are a little smaller than
  // the permanent molars that replace them.
  if (tooth >= 50 && position >= 4) return 'w-7'
  if (position >= 6) return 'w-8'
  if (position >= 4) return 'w-7'
  if (position === 3) return 'w-6'
  return 'w-5'
}

export interface ToothButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooth: number
  arch: 'upper' | 'lower'
  /** Marked in the primary colour. The picker's "chosen"; the chart's "open". */
  selected?: boolean
  /** The finding's colour, which fills the crown. Null leaves it unfilled. */
  conditionColor?: string | null
  /** Gone from the mouth — drawn faint, with the crown left hollow. */
  absent?: boolean
}

/**
 * One tooth: its crown, drawn, with its FDI number underneath.
 *
 * The number moved out of the shape rather than sitting on top of it. Inside a
 * filled crown it had to be white to stay legible, which meant it disappeared
 * against a pale finding and fought the fissure lines for the same pixels;
 * underneath, the colour says what is wrong and the number says which tooth,
 * and neither has to be read through the other.
 *
 * `forwardRef` because both callers wrap it in a Radix `TooltipTrigger asChild`,
 * which needs the ref and the props to reach the real element.
 */
export const ToothButton = React.forwardRef<HTMLButtonElement, ToothButtonProps>(
  function ToothButton(
    { tooth, arch, selected, conditionColor, absent, className, disabled, children, ...props },
    ref
  ) {
    const offset = archOffset(tooth)

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        style={
          {
            transform: `translateY(${arch === 'upper' ? offset : -offset}px)`,
            // Read by `ToothGlyph`. An absent tooth is an outline, never a
            // colour: the finding is that there is nothing there to colour.
            '--tooth-fill': absent ? 'transparent' : (conditionColor ?? 'hsl(var(--card))'),
            '--tooth-line': selected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          } as React.CSSProperties
        }
        className={cn(
          'group relative flex flex-col items-center gap-0.5 rounded-md p-0.5 transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5',
          selected && 'bg-primary/10 ring-1 ring-primary',
          absent && !selected && 'opacity-45',
          className
        )}
        {...props}
      >
        <span className={cn('block h-7', toothWidth(tooth))}>
          <ToothGlyph tooth={tooth} arch={arch} />
        </span>
        <span
          className={cn(
            'text-[9px] leading-none tabular-nums',
            selected ? 'font-semibold text-primary' : 'text-muted-foreground'
          )}
        >
          {tooth}
        </span>
        {/* Anything the caller wants on top — the chart marks charted surfaces here. */}
        {children}
      </button>
    )
  }
)

export interface ToothArchProps {
  /** Draw one tooth. Wrap {@link ToothButton} rather than replacing it. */
  tooth: (tooth: number, arch: 'upper' | 'lower') => React.ReactNode
  /**
   * Pressing a quadrant's name. Omit and the names are plain labels — which is
   * what the patient's chart wants, where "select all eight" means nothing.
   */
  onQuadrant?: (teeth: readonly number[]) => void
  disabled?: boolean
  className?: string
  /**
   * Which teeth to draw: the thirty-two permanent ones (the default), or a
   * child's twenty primary ones, numbered 51–85.
   */
  dentition?: Dentition
}

export function ToothArch({
  tooth,
  onQuadrant,
  disabled,
  className,
  dentition = 'permanent',
}: ToothArchProps) {
  const rows = quadrantsOf(dentition)
  const heading = (key: 'upperRight' | 'upperLeft' | 'lowerLeft' | 'lowerRight') => {
    const quadrant = QUADRANTS.find((q) => q.key === key)!
    const teeth = rows[key]
    const text = `${quadrant.label} · ${quadrant.short}`

    if (!onQuadrant) {
      return (
        <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
          {text}
        </span>
      )
    }

    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onQuadrant(teeth)}
        className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed"
      >
        {text}
      </button>
    )
  }

  /*
   * Spacing tightens below `sm` so a child's twenty primary teeth fit across a
   * phone without scrolling (bug report 12 Oct, finding 55). The thirty-two
   * permanent teeth cannot fit at that width at any legible size, and scroll
   * inside this box rather than widening the page.
   */
  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="mx-auto w-fit space-y-1 pb-1">
        <div className="flex items-end justify-center gap-6 pb-1">
          {heading('upperRight')}
          {heading('upperLeft')}
        </div>
        <div className="flex items-end justify-center gap-0.5 pb-8 sm:gap-1">
          <div className="flex items-end gap-0.5 sm:gap-1">
            {rows.upperRight.map((t) => tooth(t, 'upper'))}
          </div>
          <div className="mx-0.5 h-10 w-px self-center bg-border sm:mx-1" aria-hidden />
          <div className="flex items-end gap-0.5 sm:gap-1">
            {rows.upperLeft.map((t) => tooth(t, 'upper'))}
          </div>
        </div>

        <div className="flex items-start justify-center gap-0.5 pt-8 sm:gap-1">
          {/*
            Each lower row has to run *towards* the midline it meets at, and
            `FDI_QUADRANTS` (and `PRIMARY_QUADRANTS`) store both of them running
            away from it. Reversing each puts 41 and 31 either side of the
            centre line, the way they sit in a mouth. Reversed here rather than
            in lib/teeth.ts, which is shared and is in FDI's own order.
          */}
          <div className="flex items-start gap-0.5 sm:gap-1">
            {[...rows.lowerRight].reverse().map((t) => tooth(t, 'lower'))}
          </div>
          <div className="mx-0.5 h-10 w-px self-center bg-border sm:mx-1" aria-hidden />
          <div className="flex items-start gap-0.5 sm:gap-1">
            {[...rows.lowerLeft].reverse().map((t) => tooth(t, 'lower'))}
          </div>
        </div>
        <div className="flex items-start justify-center gap-6 pt-1">
          {heading('lowerRight')}
          {heading('lowerLeft')}
        </div>
      </div>
    </div>
  )
}

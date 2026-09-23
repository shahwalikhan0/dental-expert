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
import { FDI_QUADRANTS, QUADRANTS } from '@/lib/teeth'

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
  if (position >= 6) return 'w-8'
  if (position >= 4) return 'w-7'
  if (position === 3) return 'w-6'
  return 'w-5'
}

export interface ToothButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooth: number
  arch: 'upper' | 'lower'
  /** Filled in the primary colour. The picker's "chosen"; the chart's "open". */
  selected?: boolean
  /** The finding's colour, drawn as a dot under the number. Null for none. */
  dotColor?: string | null
  /** Gone from the mouth — drawn faint and dashed rather than simply coloured. */
  absent?: boolean
}

/**
 * One tooth.
 *
 * `forwardRef` because both callers wrap it in a Radix `TooltipTrigger asChild`,
 * which needs the ref and the props to reach the real element.
 */
export const ToothButton = React.forwardRef<HTMLButtonElement, ToothButtonProps>(
  function ToothButton(
    { tooth, arch, selected, dotColor, absent, className, disabled, children, ...props },
    ref
  ) {
    const offset = archOffset(tooth)

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        style={{ transform: `translateY(${arch === 'upper' ? offset : -offset}px)` }}
        className={cn(
          'group relative flex h-9 flex-col items-center justify-center rounded-lg border text-[10px] font-medium transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          toothWidth(tooth),
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5 hover:shadow-md',
          selected
            ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/30'
            : 'border-border/70 bg-card/80 text-muted-foreground hover:border-primary/40',
          absent && !selected && 'border-dashed opacity-50',
          className
        )}
        {...props}
      >
        {tooth}
        {/* Anything the caller wants on top — the chart marks charted surfaces here. */}
        {children}
        {/*
          The finding, as a dot rather than a fill. A filled tooth would fight
          the selected state for the same pixels, and both need to be readable
          at once — you are choosing among the defective ones.
        */}
        {dotColor && (
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 h-1.5 w-1.5 rounded-full ring-1',
              selected ? 'ring-primary-foreground/60' : 'ring-card'
            )}
            style={{ backgroundColor: dotColor }}
          />
        )}
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
}

export function ToothArch({ tooth, onQuadrant, disabled, className }: ToothArchProps) {
  const heading = (key: 'upperRight' | 'upperLeft' | 'lowerLeft' | 'lowerRight') => {
    const quadrant = QUADRANTS.find((q) => q.key === key)!
    const teeth = FDI_QUADRANTS[key]
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

  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="mx-auto w-fit space-y-1 pb-1">
        <div className="flex items-end justify-center gap-6 pb-1">
          {heading('upperRight')}
          {heading('upperLeft')}
        </div>
        <div className="flex items-end justify-center gap-1 pb-8">
          <div className="flex items-end gap-1">
            {FDI_QUADRANTS.upperRight.map((t) => tooth(t, 'upper'))}
          </div>
          <div className="mx-1 h-9 w-px self-center bg-border" aria-hidden />
          <div className="flex items-end gap-1">
            {FDI_QUADRANTS.upperLeft.map((t) => tooth(t, 'upper'))}
          </div>
        </div>

        <div className="flex items-start justify-center gap-1 pt-8">
          {/*
            Each lower row has to run *towards* the midline it meets at, and
            `FDI_QUADRANTS` stores both of them running away from it. Reversing
            each puts 41 and 31 either side of the centre line, the way they sit
            in a mouth. Reversed here rather than in `FDI_QUADRANTS`, which is
            shared and is in FDI's own order.
          */}
          <div className="flex items-start gap-1">
            {[...FDI_QUADRANTS.lowerRight].reverse().map((t) => tooth(t, 'lower'))}
          </div>
          <div className="mx-1 h-9 w-px self-center bg-border" aria-hidden />
          <div className="flex items-start gap-1">
            {[...FDI_QUADRANTS.lowerLeft].reverse().map((t) => tooth(t, 'lower'))}
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

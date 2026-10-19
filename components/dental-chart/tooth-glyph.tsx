/**
 * A tooth, drawn from above.
 *
 * The chart used to draw thirty-two identical rounded rectangles with a number
 * inside, which told you where a tooth was and nothing about what it was. This
 * draws the crown as seen from the occlusal aspect — looking down at the biting
 * surface, the view a real odontogram uses — so an incisor, a canine, a
 * premolar and a molar are told apart by shape before the number is read.
 *
 * Authored here rather than downloaded. Dental chart artwork on the web is
 * almost always under a licence this repository could not honour, and a set of
 * silhouettes is a morning's drawing.
 *
 * Deliberately five archetypes rather than thirty-two portraits. At the size
 * these render — a crown is about twenty pixels across — anything past a
 * silhouette and two grooves turns to mud, and a shape that reads wrong is
 * worse than one that reads as a category. Where the difference is real and
 * visible it is drawn: an upper molar carries four cusps and an oblique ridge,
 * a lower molar five and a mesiodistal groove.
 *
 * Colour comes from two CSS custom properties the caller sets, `--tooth-fill`
 * and `--tooth-line`, so a finding's colour and the selected state are the
 * caller's business and this file only knows about anatomy.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

type ToothType = 'incisor' | 'canine' | 'premolar' | 'upperMolar' | 'lowerMolar' | 'thirdMolar'

export interface ToothShape {
  /** The crown outline, filled. */
  outline: string
  /** Fissures and ridges, stroked over it. */
  lines: string[]
}

/**
 * Drawn in a 40×40 box with the buccal (cheek) side at the top.
 *
 * The arch rows are mirrored about the midline, so orienting every tooth the
 * same way keeps the row readable; turning each one to its true buccal bearing
 * would spin the molars through ninety degrees and make the row look broken.
 */
const SHAPES: Record<ToothType, ToothShape> = {
  // Wide across and shallow front to back — about two to one, which is the
  // proportion that says "incisor" before any of the detail is legible. The
  // flat labial face is the top edge and the incisal ridge runs just behind it.
  incisor: {
    outline:
      'M5.5 14C5.5 11.5 8 11 11 11H29C32 11 34.5 11.5 34.5 14C34.5 21 29 25 20 25C11 25 5.5 21 5.5 14Z',
    lines: ['M9 14.2C13 13 27 13 31 14.2'],
  },
  // A kite coming to the cusp tip, with the ridge running back from it that
  // makes a canine a canine. The one pointed crown in the arch.
  canine: {
    outline:
      'M20 7.5C27.5 11 32 16 31 22C29.5 27.5 25 31 20 32C15 31 10.5 27.5 9 22C8 16 12.5 11 20 7.5Z',
    lines: ['M20 10.5L20 29.5', 'M12.5 20.5L20 24L27.5 20.5'],
  },
  // Two cusps, buccal and lingual, with the groove between them running
  // mesiodistally — the single line that says "premolar, not molar".
  premolar: {
    outline:
      'M20 8C27.5 8 32.5 13 32.5 20C32.5 27 27.5 32 20 32C12.5 32 7.5 27 7.5 20C7.5 13 12.5 8 20 8Z',
    lines: ['M11 20H29'],
  },
  // Four cusps around a central fossa: one groove each way.
  upperMolar: {
    outline:
      'M12.5 8H27.5C31.5 8 33.5 10.5 33.5 15V25C33.5 29.5 31.5 32 27.5 32H12.5C8.5 32 6.5 29.5 6.5 25V15C6.5 10.5 8.5 8 12.5 8Z',
    lines: ['M9.5 20H30.5', 'M20 10V30'],
  },
  // Five cusps: the long mesiodistal groove with two branches off the buccal
  // side and one off the lingual, which is the extra cusp a lower first molar
  // carries and an upper one does not.
  lowerMolar: {
    outline:
      'M12.5 8H27.5C31.5 8 33.5 10.5 33.5 15V25C33.5 29.5 31.5 32 27.5 32H12.5C8.5 32 6.5 29.5 6.5 25V15C6.5 10.5 8.5 8 12.5 8Z',
    lines: ['M9.5 20H30.5', 'M16 10V20', 'M25 10V20', 'M20.5 20V30'],
  },
  // Smaller, rounder and less regular than the molars in front of it, with the
  // Y-shaped fissure a third molar usually shows.
  thirdMolar: {
    outline: 'M20 9C27 9 31.5 13 31.5 20C31.5 27 27 31 20 31C13 31 8.5 27 8.5 20C8.5 13 13 9 20 9Z',
    lines: ['M20 20V29', 'M20 20L12 14', 'M20 20L28 14'],
  },
}

/**
 * Which archetype a tooth is drawn from, by its FDI position.
 *
 * A primary dentition (quadrants 5–8) has no premolars: its positions 4 and 5
 * are the first and second primary molars, drawn as molars.
 */
export function toothType(tooth: number, arch: 'upper' | 'lower'): ToothType {
  if (tooth >= 50 && tooth % 10 >= 4) {
    return arch === 'upper' ? 'upperMolar' : 'lowerMolar'
  }
  switch (tooth % 10) {
    case 1:
    case 2:
      return 'incisor'
    case 3:
      return 'canine'
    case 4:
    case 5:
      return 'premolar'
    case 8:
      return 'thirdMolar'
    default:
      return arch === 'upper' ? 'upperMolar' : 'lowerMolar'
  }
}

/**
 * The outline and grooves of a tooth, in the 40×40 box above. For drawings
 * that are not this component: the printed chart (components/print) draws the
 * same anatomy in black and white on paper.
 */
export function toothShape(tooth: number, arch: 'upper' | 'lower'): ToothShape {
  return SHAPES[toothType(tooth, arch)]
}

export interface ToothGlyphProps {
  tooth: number
  arch: 'upper' | 'lower'
  className?: string
}

export function ToothGlyph({ tooth, arch, className }: ToothGlyphProps) {
  const shape = toothShape(tooth, arch)

  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('h-full w-full', className)}
      // Decorative: the button around it already carries the tooth's name and
      // its finding in `aria-label`, and a screen reader does not want the
      // outline of a first molar read to it.
      aria-hidden
      focusable="false"
    >
      <path
        d={shape.outline}
        fill="var(--tooth-fill)"
        stroke="var(--tooth-line)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {shape.lines.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--tooth-line)"
          strokeWidth={1.4}
          strokeLinecap="round"
          opacity={0.55}
        />
      ))}
    </svg>
  )
}

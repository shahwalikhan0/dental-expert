/**
 * Which crown gets drawn for which tooth.
 *
 * The shapes themselves are a drawing and are not worth asserting on, but the
 * mapping from an FDI number to an archetype is arithmetic and can silently go
 * wrong — an off-by-one here would draw a molar where a canine belongs on every
 * chart in the application, and it would still look like a plausible mouth.
 */
import { describe, it, expect } from 'vitest'
import { toothType } from '@/components/dental-chart/tooth-glyph'
import { ALL_PRIMARY_TEETH, ALL_TEETH } from '@/lib/teeth'

describe('toothType()', () => {
  it('draws the incisors, canines and premolars by position', () => {
    expect(toothType(11, 'upper')).toBe('incisor')
    expect(toothType(12, 'upper')).toBe('incisor')
    expect(toothType(13, 'upper')).toBe('canine')
    expect(toothType(14, 'upper')).toBe('premolar')
    expect(toothType(15, 'upper')).toBe('premolar')
  })

  it('gives the lower molars a different crown from the upper ones', () => {
    // Four cusps above, five below. Drawing one for the other is the kind of
    // wrong that still looks like a tooth.
    expect(toothType(16, 'upper')).toBe('upperMolar')
    expect(toothType(17, 'upper')).toBe('upperMolar')
    expect(toothType(46, 'lower')).toBe('lowerMolar')
    expect(toothType(47, 'lower')).toBe('lowerMolar')
  })

  it('draws every third molar the same, in either jaw', () => {
    expect(toothType(18, 'upper')).toBe('thirdMolar')
    expect(toothType(48, 'lower')).toBe('thirdMolar')
  })

  it('is the same across all four quadrants', () => {
    for (const position of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const upper = [10 + position, 20 + position]
      const lower = [30 + position, 40 + position]
      expect(new Set(upper.map((t) => toothType(t, 'upper'))).size).toBe(1)
      expect(new Set(lower.map((t) => toothType(t, 'lower'))).size).toBe(1)
    }
  })

  it('draws the primary molars as molars — a child has no premolars', () => {
    expect(toothType(54, 'upper')).toBe('upperMolar')
    expect(toothType(55, 'upper')).toBe('upperMolar')
    expect(toothType(75, 'lower')).toBe('lowerMolar')
    expect(toothType(53, 'upper')).toBe('canine')
    expect(toothType(81, 'lower')).toBe('incisor')
  })

  it('has a crown for every primary tooth', () => {
    for (const tooth of ALL_PRIMARY_TEETH) {
      const arch = tooth < 70 ? 'upper' : 'lower'
      expect(toothType(tooth, arch)).toBeTruthy()
    }
  })

  it('has a crown for every permanent tooth', () => {
    for (const tooth of ALL_TEETH) {
      const arch = tooth < 30 ? 'upper' : 'lower'
      expect(toothType(tooth, arch)).toBeTruthy()
    }
  })
})

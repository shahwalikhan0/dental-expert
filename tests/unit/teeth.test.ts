/**
 * Teeth, in and out of a column four tables share.
 *
 * The parsing matters more than it looks: these columns have been written by
 * the treatment form, the lab-order form and now the prescription form, and a
 * value one of them writes has to mean the same thing when another reads it.
 */
import { describe, it, expect } from 'vitest'
import { parseTeeth, formatTeeth, describeTeeth, quadrantOf, isTooth } from '@/lib/teeth'

describe('parseTeeth', () => {
  it('reads an ordinary column', () => {
    expect(parseTeeth('46,47')).toEqual([46, 47])
  })

  it('tolerates the spacing a hand-typed column has', () => {
    expect(parseTeeth(' 46 , 47 ,')).toEqual([46, 47])
  })

  it('sorts and de-duplicates, so two orders of the same teeth compare equal', () => {
    expect(parseTeeth('47,46,47')).toEqual([46, 47])
  })

  it('treats an empty or missing column as no teeth', () => {
    expect(parseTeeth('')).toEqual([])
    expect(parseTeeth(null)).toEqual([])
    expect(parseTeeth(undefined)).toEqual([])
  })

  it('discards anything that is not a permanent FDI tooth', () => {
    // 19 and 49 are not teeth in FDI; 99 and "abc" are not numbers of teeth at
    // all. Rendering any of them would print "Teeth: NaN" on a prescription.
    expect(parseTeeth('46,19,49,99,abc,0')).toEqual([46])
  })

  it('does not accept deciduous numbering as permanent', () => {
    // 51–85 are primary teeth. This column is permanent dentition only, and
    // silently accepting a 55 would put a child's tooth in an adult's chart.
    expect(parseTeeth('55,75')).toEqual([])
  })
})

describe('formatTeeth', () => {
  it('writes a column back', () => {
    expect(formatTeeth([47, 46])).toBe('46,47')
  })

  it('gives null rather than an empty string for no teeth', () => {
    // "No teeth recorded" and "the empty set" are the same thing clinically.
    // Storing both would make every reader check for both.
    expect(formatTeeth([])).toBeNull()
    expect(formatTeeth(null)).toBeNull()
    expect(formatTeeth([19, 99])).toBeNull()
  })

  it('round-trips', () => {
    expect(formatTeeth(parseTeeth('48,41,46'))).toBe('41,46,48')
  })
})

describe('quadrantOf', () => {
  it('places each quadrant', () => {
    expect(quadrantOf(18)).toBe('upperRight')
    expect(quadrantOf(21)).toBe('upperLeft')
    expect(quadrantOf(38)).toBe('lowerLeft')
    expect(quadrantOf(41)).toBe('lowerRight')
  })

  it('refuses a non-tooth', () => {
    expect(quadrantOf(99)).toBeNull()
  })
})

describe('describeTeeth', () => {
  it('names a single tooth', () => {
    expect(describeTeeth([46])).toBe('46')
  })

  it('collapses a run within one quadrant', () => {
    expect(describeTeeth([13, 14, 15, 16])).toBe('13–16')
  })

  it('writes a pair out rather than as a span', () => {
    // "16, 17" is shorter to read than "16–17" and cannot be misread as three.
    expect(describeTeeth([16, 17])).toBe('16, 17')
  })

  it('never spans the midline', () => {
    // 13–23 would read as eleven teeth to anybody who knows the notation. It
    // is four.
    expect(describeTeeth([13, 12, 11, 21])).toBe('11–13, 21')
  })

  it('lists separate runs', () => {
    expect(describeTeeth([16, 17, 18, 46, 47])).toBe('16–18, 46, 47')
  })

  it('is empty for no teeth', () => {
    expect(describeTeeth([])).toBe('')
    expect(describeTeeth(null)).toBe('')
  })
})

describe('isTooth', () => {
  it('rejects the values a query string can produce', () => {
    expect(isTooth(Number('abc'))).toBe(false)
    expect(isTooth(46.5)).toBe(false)
    expect(isTooth('46' as unknown as number)).toBe(false)
  })
})

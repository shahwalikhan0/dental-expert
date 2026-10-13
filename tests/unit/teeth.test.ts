/**
 * Teeth, in and out of a column four tables share.
 *
 * The parsing matters more than it looks: these columns have been written by
 * the treatment form, the lab-order form and now the prescription form, and a
 * value one of them writes has to mean the same thing when another reads it.
 */
import { describe, it, expect } from 'vitest'
import {
  parseTeeth,
  formatTeeth,
  describeTeeth,
  describeTeethByQuadrant,
  groupTeeth,
  quadrantOf,
  isTooth,
  isPermanentTooth,
  isPrimaryTooth,
  readTeeth,
} from '@/lib/teeth'

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

  it('discards anything that is not an FDI tooth', () => {
    // 19, 49, 56 and 86 are not teeth in FDI; 99 and "abc" are not numbers of
    // teeth at all. Rendering any of them would print "Teeth: NaN" on a
    // prescription.
    expect(parseTeeth('46,19,49,56,86,99,abc,0')).toEqual([46])
  })

  it('reads primary teeth as well as permanent ones', () => {
    // 51–85 are primary teeth (bug report 12 Oct, findings 54 and 55). A
    // child's extraction on 75 dropped from the column would read as an
    // extraction of no tooth at all.
    expect(parseTeeth('75,55,16')).toEqual([16, 55, 75])
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

  it('places primary teeth in the quadrant they share with the permanent ones', () => {
    expect(quadrantOf(55)).toBe('upperRight')
    expect(quadrantOf(65)).toBe('upperLeft')
    expect(quadrantOf(75)).toBe('lowerLeft')
    expect(quadrantOf(85)).toBe('lowerRight')
  })

  it('refuses a non-tooth', () => {
    expect(quadrantOf(99)).toBeNull()
    expect(quadrantOf(56)).toBeNull()
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

  it('accepts both dentitions and tells them apart', () => {
    expect(isTooth(46)).toBe(true)
    expect(isTooth(75)).toBe(true)
    expect(isPermanentTooth(46)).toBe(true)
    expect(isPermanentTooth(75)).toBe(false)
    expect(isPrimaryTooth(75)).toBe(true)
    expect(isPrimaryTooth(46)).toBe(false)
  })
})

describe('readTeeth', () => {
  it('reads what the forms send, tidied into a column', () => {
    expect(readTeeth('47, 46,')).toEqual({ ok: true, column: '46,47', teeth: [46, 47] })
    expect(readTeeth([75, 16])).toEqual({ ok: true, column: '16,75', teeth: [16, 75] })
  })

  it('treats nothing as no teeth', () => {
    expect(readTeeth(null)).toEqual({ ok: true, column: null, teeth: [] })
    expect(readTeeth('')).toEqual({ ok: true, column: null, teeth: [] })
    expect(readTeeth(undefined)).toEqual({ ok: true, column: null, teeth: [] })
  })

  it('refuses anything that is not a tooth, naming it', () => {
    // The value a treatment was saved with in the 12 October pass (finding 54).
    const result = readTeeth('99,ABC')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('"99"')
    expect(readTeeth('46.5').ok).toBe(false)
    expect(readTeeth('19').ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// groupTeeth / describeTeethByQuadrant
// ---------------------------------------------------------------------------
describe('groupTeeth()', () => {
  it('splits a set across the quadrants it touches', () => {
    expect(groupTeeth([13, 15, 25, 34, 44]).map((g) => [g.short, g.description])).toEqual([
      ['UR', '13, 15'],
      ['UL', '25'],
      ['LL', '34'],
      ['LR', '44'],
    ])
  })

  it('returns quadrants in FDI order however the teeth arrive', () => {
    expect(groupTeeth([44, 34, 25, 13]).map((g) => g.short)).toEqual(['UR', 'UL', 'LL', 'LR'])
  })

  it('leaves out the quadrants with nothing in them', () => {
    // A case confined to one quadrant should read as one line, not as one line
    // and three blanks.
    expect(groupTeeth([46, 47]).map((g) => g.short)).toEqual(['LR'])
  })

  it('collapses adjacent runs within a quadrant', () => {
    expect(groupTeeth([11, 12, 13, 14])[0].description).toBe('11–14')
  })

  it('names the quadrant in full as well as in short', () => {
    expect(groupTeeth([46])[0]).toMatchObject({
      key: 'lowerRight',
      short: 'LR',
      label: 'Lower right',
      teeth: [46],
    })
  })

  it('drops anything that is not a tooth', () => {
    expect(groupTeeth([11, 0, 99, NaN])).toEqual([
      { key: 'upperRight', short: 'UR', label: 'Upper right', teeth: [11], description: '11' },
    ])
  })

  it('is empty for no teeth', () => {
    expect(groupTeeth([])).toEqual([])
    expect(groupTeeth(null)).toEqual([])
    expect(groupTeeth(undefined)).toEqual([])
  })
})

describe('describeTeethByQuadrant()', () => {
  it('writes one line naming each quadrant', () => {
    expect(describeTeethByQuadrant([13, 15, 25, 34, 44])).toBe('UR 13, 15 · UL 25 · LL 34 · LR 44')
  })

  it('is empty for no teeth, so a caller can fall back', () => {
    expect(describeTeethByQuadrant([])).toBe('')
  })

  it('reads a stored column end to end', () => {
    expect(describeTeethByQuadrant(parseTeeth('16,15,14, 24 ,,46'))).toBe(
      'UR 14–16 · UL 24 · LR 46'
    )
  })
})

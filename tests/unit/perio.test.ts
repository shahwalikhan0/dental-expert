import { describe, it, expect } from 'vitest'
import {
  ALL_SITES,
  ALL_TEETH,
  HEALTHY_MAX,
  WATCH_MAX,
  attachmentLoss,
  isUpper,
  severityOf,
  summarise,
  validDepth,
  validRecession,
  validTooth,
  type Measurement,
} from '@/lib/perio'

/**
 * The periodontal chart.
 *
 * The figures at the top of a chart are what a practice acts on, and the one
 * that is easy to get wrong is bleeding: a percentage of the whole mouth
 * instead of the sites actually probed reports a bleeding patient as healthy.
 */

const site = (over: Partial<Measurement> = {}): Measurement => ({
  toothNumber: 16,
  site: 'MB',
  pocketDepth: 3,
  recession: 0,
  bleeding: false,
  suppuration: false,
  plaque: false,
  ...over,
})

describe('the mouth', () => {
  it('has thirty-two teeth in FDI notation', () => {
    expect(ALL_TEETH).toHaveLength(32)
    expect(ALL_TEETH).toContain(18)
    expect(ALL_TEETH).toContain(48)
  })

  it('has six sites per tooth', () => {
    expect(ALL_SITES).toHaveLength(6)
  })

  it('knows an upper tooth from a lower', () => {
    expect(isUpper(16)).toBe(true)
    expect(isUpper(26)).toBe(true)
    expect(isUpper(46)).toBe(false)
    expect(isUpper(36)).toBe(false)
  })
})

describe('severityOf', () => {
  it('follows the standard bands', () => {
    expect(severityOf(1)).toBe('HEALTHY')
    expect(severityOf(HEALTHY_MAX)).toBe('HEALTHY')
    expect(severityOf(HEALTHY_MAX + 1)).toBe('WATCH')
    expect(severityOf(WATCH_MAX)).toBe('WATCH')
    expect(severityOf(WATCH_MAX + 1)).toBe('DISEASE')
  })

  // Absent means "not probed", which is not zero. A zero would read as a
  // perfectly healthy site nobody measured.
  it('separates unprobed from zero', () => {
    expect(severityOf(null)).toBe('UNPROBED')
    expect(severityOf(undefined)).toBe('UNPROBED')
    expect(severityOf(0)).toBe('HEALTHY')
  })
})

describe('attachmentLoss', () => {
  // The number that says how much support a tooth has lost. A 4mm pocket on a
  // gum that has receded 3mm is a very different tooth from one that has not.
  it('is depth plus recession', () => {
    expect(attachmentLoss({ pocketDepth: 4, recession: 3 })).toBe(7)
    expect(attachmentLoss({ pocketDepth: 4, recession: 0 })).toBe(4)
  })

  it('treats a missing recession as none', () => {
    expect(attachmentLoss({ pocketDepth: 5, recession: null })).toBe(5)
  })

  it('is unknown when the site was not probed', () => {
    expect(attachmentLoss({ pocketDepth: null, recession: 2 })).toBeNull()
  })
})

describe('summarise', () => {
  it('counts only the sites that were probed', () => {
    const summary = summarise([
      site({ pocketDepth: 2 }),
      site({ site: 'B', pocketDepth: 3 }),
      site({ site: 'DB', pocketDepth: null }),
    ])

    expect(summary.sitesProbed).toBe(2)
  })

  // The failure this guards against: dividing bleeding sites by all 192 sites
  // instead of by the sites probed. A partial chart that bled everywhere would
  // report 12% and read as a healthy patient.
  it('reports bleeding as a share of probed sites, not of the whole mouth', () => {
    const summary = summarise([
      site({ pocketDepth: 4, bleeding: true }),
      site({ site: 'B', pocketDepth: 5, bleeding: true }),
      site({ site: 'DB', pocketDepth: null, bleeding: false }),
    ])

    expect(summary.bleedingPercent).toBe(100)
  })

  it('finds the deepest pocket and the mean', () => {
    const summary = summarise([
      site({ pocketDepth: 2 }),
      site({ site: 'B', pocketDepth: 8 }),
      site({ site: 'DB', pocketDepth: 5 }),
    ])

    expect(summary.worstPocket).toBe(8)
    expect(summary.meanPocket).toBe(5)
  })

  it('counts the sites that are 6mm and over', () => {
    const summary = summarise([
      site({ pocketDepth: 5 }),
      site({ site: 'B', pocketDepth: 6 }),
      site({ site: 'DB', pocketDepth: 9 }),
    ])

    expect(summary.deepSites).toBe(2)
  })

  it('counts the teeth actually charted', () => {
    const summary = summarise([
      site({ toothNumber: 16 }),
      site({ toothNumber: 16, site: 'B' }),
      site({ toothNumber: 26 }),
    ])

    expect(summary.teethCharted).toBe(2)
  })

  it('reads an empty chart as nothing rather than dividing by zero', () => {
    expect(summarise([])).toMatchObject({
      sitesProbed: 0,
      bleedingPercent: 0,
      worstPocket: null,
      meanPocket: null,
    })
  })
})

describe('what the chart will accept', () => {
  it('takes a plausible probing depth', () => {
    expect(validDepth(0)).toBe(true)
    expect(validDepth(12)).toBe(true)
    expect(validDepth(16)).toBe(false)
    expect(validDepth(-1)).toBe(false)
    expect(validDepth(3.5)).toBe(false)
    expect(validDepth('4')).toBe(false)
  })

  // Negative where the margin sits above the CEJ, which is a real measurement
  // and not a typo.
  it('takes negative recession', () => {
    expect(validRecession(-3)).toBe(true)
    expect(validRecession(0)).toBe(true)
    expect(validRecession(-11)).toBe(false)
  })

  it('only takes teeth that exist', () => {
    expect(validTooth(16)).toBe(true)
    expect(validTooth(19)).toBe(false)
    expect(validTooth(0)).toBe(false)
  })
})

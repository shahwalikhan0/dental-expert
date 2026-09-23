import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  treatmentStatusConfig,
  treatmentPlanStatusConfig,
  treatmentPlanItemStatusConfig,
  toothConditionConfig,
  toothNumbers,
  toothNames,
  formatDuration,
  formatCurrency,
  parseToothNumbers,
  formatToothNumbers,
  getToothQuadrant,
  isMolar,
  isPremolar,
  isCanine,
  isIncisor,
  getToothType,
  calculatePlanProgress,
  getTreatmentStatusBadge,
} from '@/lib/treatment-utils'

// ---------------------------------------------------------------------------
// Status configs
// ---------------------------------------------------------------------------
describe('treatmentStatusConfig', () => {
  it('has all 4 statuses', () => {
    expect(Object.keys(treatmentStatusConfig)).toEqual(
      expect.arrayContaining(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
    )
  })

  it('each status has label, color, bgColor', () => {
    Object.values(treatmentStatusConfig).forEach((cfg) => {
      expect(cfg.label).toBeTruthy()
      expect(cfg.color).toBeTruthy()
      expect(cfg.bgColor).toBeTruthy()
    })
  })
})

describe('treatmentPlanStatusConfig', () => {
  it('has 6 statuses', () => {
    expect(Object.keys(treatmentPlanStatusConfig)).toHaveLength(6)
  })
})

describe('treatmentPlanItemStatusConfig', () => {
  it('includes PENDING and COMPLETED', () => {
    expect(treatmentPlanItemStatusConfig.PENDING).toBeDefined()
    expect(treatmentPlanItemStatusConfig.COMPLETED).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Tooth condition configs
// ---------------------------------------------------------------------------
describe('toothConditionConfig', () => {
  it('has HEALTHY condition with green fill', () => {
    expect(toothConditionConfig.HEALTHY.label).toBe('Healthy')
    expect(toothConditionConfig.HEALTHY.fillColor).toBe('#22c55e')
  })

  /**
   * Read from the schema rather than from a number written here, because the
   * number written here is what went stale: the config was missing six
   * conditions the chart can write and carried two the database cannot store,
   * so a tooth charted as fractured drew no colour and read as healthy.
   */
  it('covers the ToothCondition enum exactly', () => {
    const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8')
    const block = schema.match(/enum ToothCondition \{([^}]*)\}/)
    expect(block).not.toBeNull()

    const conditions = block![1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    expect(Object.keys(toothConditionConfig).sort()).toEqual(conditions.sort())
  })
})

// ---------------------------------------------------------------------------
// Tooth numbering (FDI)
// ---------------------------------------------------------------------------
describe('toothNumbers', () => {
  it('has 8 teeth per quadrant', () => {
    expect(toothNumbers.upperRight).toHaveLength(8)
    expect(toothNumbers.upperLeft).toHaveLength(8)
    expect(toothNumbers.lowerLeft).toHaveLength(8)
    expect(toothNumbers.lowerRight).toHaveLength(8)
  })

  it('total 32 unique teeth', () => {
    const all = [
      ...toothNumbers.upperRight,
      ...toothNumbers.upperLeft,
      ...toothNumbers.lowerLeft,
      ...toothNumbers.lowerRight,
    ]
    expect(all).toHaveLength(32)
    expect(new Set(all).size).toBe(32)
  })
})

describe('toothNames', () => {
  it('maps all 32 teeth', () => {
    expect(Object.keys(toothNames)).toHaveLength(32)
  })

  it('returns correct name for tooth 11', () => {
    expect(toothNames[11]).toBe('Upper Right Central Incisor')
  })
})

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration()', () => {
  it('formats minutes < 60', () => {
    expect(formatDuration(30)).toBe('30 min')
  })

  it('formats exact hours', () => {
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(120)).toBe('2 hr')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(90)).toBe('1 hr 30 min')
  })
})

// ---------------------------------------------------------------------------
// parseToothNumbers
// ---------------------------------------------------------------------------
describe('parseToothNumbers()', () => {
  it('parses comma-separated numbers', () => {
    expect(parseToothNumbers('11, 12, 13')).toEqual([11, 12, 13])
  })

  it('parses range notation', () => {
    expect(parseToothNumbers('11-14')).toEqual([11, 12, 13, 14])
  })

  it('parses mixed format', () => {
    expect(parseToothNumbers('11, 21-23, 31')).toEqual([11, 21, 22, 23, 31])
  })

  it('deduplicates and sorts', () => {
    expect(parseToothNumbers('31, 11, 11, 21')).toEqual([11, 21, 31])
  })

  it('returns empty for empty string', () => {
    expect(parseToothNumbers('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// formatToothNumbers
// ---------------------------------------------------------------------------
describe('formatToothNumbers()', () => {
  it('names the quadrant each tooth is in', () => {
    expect(formatToothNumbers([21, 11, 31])).toBe('UR 11 \u00b7 UL 21 \u00b7 LL 31')
  })

  it('collapses a run within one quadrant', () => {
    expect(formatToothNumbers([11, 12, 13, 14])).toBe('UR 11\u201314')
  })

  it('never collapses a run across the midline', () => {
    // 13\u201323 would read as eleven teeth to anybody who knows the notation,
    // when it means four.
    expect(formatToothNumbers([12, 11, 21, 22])).toBe('UR 11, 12 \u00b7 UL 21, 22')
  })

  it("leaves the caller's array alone", () => {
    const teeth = [21, 11, 31]
    formatToothNumbers(teeth)
    expect(teeth).toEqual([21, 11, 31])
  })

  it('returns dash for empty array', () => {
    expect(formatToothNumbers([])).toBe('-')
  })

  it('returns dash for null/undefined', () => {
    expect(formatToothNumbers(null as any)).toBe('-')
  })
})

// ---------------------------------------------------------------------------
// Tooth classification
// ---------------------------------------------------------------------------
describe('tooth classification helpers', () => {
  it('getToothQuadrant returns correct quadrant', () => {
    expect(getToothQuadrant(11)).toBe(1)
    expect(getToothQuadrant(21)).toBe(2)
    expect(getToothQuadrant(31)).toBe(3)
    expect(getToothQuadrant(41)).toBe(4)
  })

  it('isMolar returns true for teeth ending in 6-8', () => {
    expect(isMolar(16)).toBe(true)
    expect(isMolar(27)).toBe(true)
    expect(isMolar(38)).toBe(true)
    expect(isMolar(11)).toBe(false)
  })

  it('isPremolar returns true for teeth ending in 4-5', () => {
    expect(isPremolar(14)).toBe(true)
    expect(isPremolar(25)).toBe(true)
    expect(isPremolar(13)).toBe(false)
  })

  it('isCanine returns true for teeth ending in 3', () => {
    expect(isCanine(13)).toBe(true)
    expect(isCanine(43)).toBe(true)
    expect(isCanine(11)).toBe(false)
  })

  it('isIncisor returns true for teeth ending in 1-2', () => {
    expect(isIncisor(11)).toBe(true)
    expect(isIncisor(22)).toBe(true)
    expect(isIncisor(13)).toBe(false)
  })

  it('getToothType identifies all types', () => {
    expect(getToothType(16)).toBe('molar')
    expect(getToothType(14)).toBe('premolar')
    expect(getToothType(13)).toBe('canine')
    expect(getToothType(11)).toBe('incisor')
  })
})

// ---------------------------------------------------------------------------
// calculatePlanProgress
// ---------------------------------------------------------------------------
describe('calculatePlanProgress()', () => {
  it('returns 0 for empty items', () => {
    expect(calculatePlanProgress([])).toBe(0)
  })

  it('returns 100 when all completed', () => {
    expect(calculatePlanProgress([{ status: 'COMPLETED' }, { status: 'COMPLETED' }])).toBe(100)
  })

  it('returns 50 when half completed', () => {
    expect(calculatePlanProgress([{ status: 'COMPLETED' }, { status: 'PENDING' }])).toBe(50)
  })

  it('returns 0 when none completed', () => {
    expect(calculatePlanProgress([{ status: 'PENDING' }, { status: 'IN_PROGRESS' }])).toBe(0)
  })

  it('rounds to nearest integer', () => {
    expect(
      calculatePlanProgress([{ status: 'COMPLETED' }, { status: 'PENDING' }, { status: 'PENDING' }])
    ).toBe(33)
  })
})

// ---------------------------------------------------------------------------
// getTreatmentStatusBadge
// ---------------------------------------------------------------------------
describe('getTreatmentStatusBadge()', () => {
  it('returns label for known status', () => {
    expect(getTreatmentStatusBadge('COMPLETED').label).toBe('Completed')
  })

  it('falls back to PLANNED for unknown status', () => {
    expect(getTreatmentStatusBadge('UNKNOWN').label).toBe('Planned')
  })
})

// ---------------------------------------------------------------------------
// formatCurrency (treatment-utils version)
// ---------------------------------------------------------------------------
describe('formatCurrency() — treatment-utils', () => {
  it('formats number in PKR', () => {
    expect(formatCurrency(2500)).toMatch(/Rs/)
    expect(formatCurrency(2500)).toMatch(/2,500/)
  })

  it('formats string input', () => {
    expect(formatCurrency('1500')).toMatch(/1,500/)
  })
})

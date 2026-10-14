import { describe, it, expect } from 'vitest'
import { catalogueQuery, readListResponse } from '@/hooks/use-catalogue-search'

describe('readListResponse — the shapes the list routes answer in', () => {
  it('reads a named array with pagination (patients, procedures)', () => {
    expect(readListResponse({ patients: [{ id: 'a' }], pagination: { total: 240 } })).toEqual({
      rows: [{ id: 'a' }],
      total: 240,
    })
  })

  it('reads data with pagination (medications, inventory)', () => {
    expect(
      readListResponse({ success: true, data: [{ id: 'm' }], pagination: { total: 3, pages: 1 } })
    ).toEqual({ rows: [{ id: 'm' }], total: 3 })
  })

  it('reads a named array with no total (billing products)', () => {
    expect(readListResponse({ products: [{ id: 'p' }] })).toEqual({
      rows: [{ id: 'p' }],
      total: null,
    })
  })

  it('reads a bare array, and survives nonsense', () => {
    expect(readListResponse([{ id: 'x' }])).toEqual({ rows: [{ id: 'x' }], total: 1 })
    expect(readListResponse(null)).toEqual({ rows: [], total: null })
    expect(readListResponse({ error: 'nope' })).toEqual({ rows: [], total: null })
  })
})

describe('catalogueQuery', () => {
  it('sends fixed params, the term and the limit, leaving blanks out', () => {
    expect(catalogueQuery({ sort: 'name', active: 'true', category: '' }, 'amox', 10)).toBe(
      'sort=name&active=true&search=amox&limit=10'
    )
  })

  it('sends no term for the preloaded first page', () => {
    expect(catalogueQuery(undefined, '', 10)).toBe('limit=10')
  })

  it('uses the route’s own search parameter', () => {
    expect(catalogueQuery(undefined, 'login', 10, 'q')).toBe('q=login&limit=10')
  })
})

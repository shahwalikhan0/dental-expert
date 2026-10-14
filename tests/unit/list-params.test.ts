import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  applyListPatch,
  parseFilterValue,
  parseListParams,
  type ListParamsConfig,
} from '@/lib/list-params'

const config: ListParamsConfig<{ status: string; from: string; overdue: boolean; min: number }> = {
  defaults: { status: 'all', from: '', overdue: false, min: 0 },
}

const q = (query: string) => new URLSearchParams(query)

describe('parseFilterValue', () => {
  it('types a value like its default', () => {
    expect(parseFilterValue('PAID', 'all')).toBe('PAID')
    expect(parseFilterValue('true', false)).toBe(true)
    expect(parseFilterValue('1', false)).toBe(true)
    expect(parseFilterValue('no', false)).toBe(false)
    expect(parseFilterValue('25', 0)).toBe(25)
  })

  it('falls back to the default for a missing or unreadable value', () => {
    expect(parseFilterValue(null, 'all')).toBe('all')
    expect(parseFilterValue('abc', 5)).toBe(5)
    expect(parseFilterValue('', 5)).toBe(5)
  })
})

describe('parseListParams', () => {
  it('reads an empty address as the defaults, page 1, the standard page size', () => {
    expect(parseListParams(q(''), config)).toEqual({
      search: '',
      filters: { status: 'all', from: '', overdue: false, min: 0 },
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    })
  })

  it('reads search, filters, page and page size', () => {
    const state = parseListParams(
      q('search=ali&status=PAID&overdue=true&page=3&pageSize=50'),
      config
    )
    expect(state).toMatchObject({
      search: 'ali',
      filters: { status: 'PAID', overdue: true },
      page: 3,
      pageSize: 50,
    })
  })

  it('ignores a nonsense page or size', () => {
    const state = parseListParams(q('page=-2&pageSize=abc'), config)
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(DEFAULT_PAGE_SIZE)
  })

  it('honours a custom search key and page size', () => {
    const state = parseListParams(q('q=login'), { ...config, searchKey: 'q', pageSize: 50 })
    expect(state.search).toBe('login')
    expect(state.pageSize).toBe(50)
  })
})

describe('applyListPatch', () => {
  it('goes back to page 1 when the search changes', () => {
    expect(applyListPatch(q('page=4'), { search: 'ali' }, config).toString()).toBe('search=ali')
  })

  it('goes back to page 1 when a filter changes', () => {
    expect(applyListPatch(q('page=4'), { filters: { status: 'PAID' } }, config).toString()).toBe(
      'status=PAID'
    )
  })

  it('keeps the page when nothing that narrows the list changed', () => {
    expect(
      applyListPatch(q('status=PAID&page=4'), { filters: { status: 'PAID' } }, config).toString()
    ).toBe('status=PAID&page=4')
  })

  it('moves the page on its own', () => {
    expect(applyListPatch(q('status=PAID'), { page: 2 }, config).toString()).toBe(
      'status=PAID&page=2'
    )
    expect(applyListPatch(q('page=2'), { page: 1 }, config).toString()).toBe('')
  })

  it('leaves values at their default out of the address', () => {
    const next = applyListPatch(
      q('status=PAID&overdue=true&search=x'),
      { search: '  ', filters: { status: 'all', overdue: false } },
      config
    )
    expect(next.toString()).toBe('')
  })

  it('trims the search', () => {
    expect(applyListPatch(q(''), { search: '  ali  ' }, config).get('search')).toBe('ali')
  })

  it('writes a boolean as true', () => {
    expect(applyListPatch(q(''), { filters: { overdue: true } }, config).toString()).toBe(
      'overdue=true'
    )
  })

  it('resets the page when the page size changes, and omits the default size', () => {
    expect(applyListPatch(q('page=3'), { pageSize: 50 }, config).toString()).toBe('pageSize=50')
    expect(
      applyListPatch(q('pageSize=50'), { pageSize: DEFAULT_PAGE_SIZE }, config).toString()
    ).toBe('')
  })

  it('keeps parameters it does not own — the trail, a patient', () => {
    const next = applyListPatch(q('t=abc&patientId=p1&page=2'), { search: 'x' }, config)
    expect(next.get('t')).toBe('abc')
    expect(next.get('patientId')).toBe('p1')
    expect(next.get('page')).toBeNull()
  })

  it('ignores reserved keys smuggled in as filters', () => {
    const next = applyListPatch(q(''), { filters: { page: 9 } as never }, config)
    expect(next.get('page')).toBeNull()
  })
})

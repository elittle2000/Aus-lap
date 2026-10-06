import { describe, expect, it } from 'vitest'
import { dueState, prepReadiness, spendSummary } from './prep'
import type { PrepItem } from './types'

function item(p: Partial<PrepItem>): PrepItem {
  return {
    id: Math.random().toString(36),
    sourceKey: null,
    sourceList: null,
    item: 'x',
    category: 'Vehicle',
    plannedCost: 100,
    include: true,
    priority: 'Medium',
    buyBy: '2026-11-01',
    sheetNotes: '',
    status: 'todo',
    actualCost: null,
    owner: null,
    notes: '',
    link: '',
    updatedAt: '',
    updatedBy: 'import',
    ...p,
  }
}

describe('dueState', () => {
  const today = '2026-10-06'
  it('a buy-by month that has ended is overdue', () => {
    expect(dueState(item({ buyBy: '2026-09-01' }), today)).toBe('overdue')
  })
  it('the current month is due this month, right up to its last day', () => {
    expect(dueState(item({ buyBy: '2026-10-01' }), today)).toBe('due-this-month')
    expect(dueState(item({ buyBy: '2026-10-01' }), '2026-10-31')).toBe('due-this-month')
    expect(dueState(item({ buyBy: '2026-10-01' }), '2026-11-01')).toBe('overdue')
  })
  it('later months are upcoming', () => {
    expect(dueState(item({ buyBy: '2026-11-01' }), today)).toBe('upcoming')
  })
  it('done, dropped and ordered items are never overdue', () => {
    expect(dueState(item({ buyBy: '2026-01-01', status: 'done' }), today)).toBe('done')
    expect(dueState(item({ buyBy: '2026-01-01', status: 'dropped' }), today)).toBe('dropped')
    expect(dueState(item({ buyBy: '2026-01-01', status: 'ordered' }), today)).toBe('in-progress')
  })
  it('items with no date say so', () => {
    expect(dueState(item({ buyBy: null }), today)).toBe('no-date')
  })
})

describe('spendSummary', () => {
  const items = [
    item({ plannedCost: 1200, priority: 'Critical', buyBy: '2026-09-01', status: 'done', actualCost: 1350 }),
    item({ plannedCost: 500, priority: 'High', buyBy: '2026-09-01', status: 'ordered', actualCost: 480 }),
    item({ plannedCost: 300, priority: 'High', buyBy: '2026-10-01', status: 'ordered' }),
    item({ plannedCost: 200, priority: 'Low', buyBy: '2026-10-01' }),
    item({ plannedCost: 999, priority: 'Low', status: 'dropped' }),
    item({ plannedCost: 777, include: false }), // duplicate row: never counted
    item({ plannedCost: 50, removedFromSheet: true }), // gone from spreadsheet: not counted
  ]
  const s = spendSummary(items)

  it('totals planned, actual, remaining and forecast', () => {
    expect(s.planned).toBe(2200)
    expect(s.actual).toBe(1830)
    // ordered without a price yet (300) + still to do (200)
    expect(s.remaining).toBe(500)
    expect(s.forecast).toBe(2330)
  })

  it('splits by priority and by month', () => {
    expect(s.byPriority.map((l) => [l.key, l.planned, l.actual, l.remaining])).toEqual([
      ['Critical', 1200, 1350, 0],
      ['High', 800, 480, 300],
      ['Low', 200, 0, 200],
    ])
    expect(s.byMonth.map((l) => [l.key, l.planned])).toEqual([
      ['2026-09', 1700],
      ['2026-10', 500],
    ])
  })

  it('readiness counts done over counted, non-dropped items', () => {
    expect(prepReadiness(items)).toEqual({ done: 1, total: 4 })
    expect(prepReadiness(items, 'Critical')).toEqual({ done: 1, total: 1 })
  })
})

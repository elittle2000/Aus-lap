import { describe, expect, it } from 'vitest'
import { nextActions, staysSorted } from './actions'
import { staySpans } from './stays'
import type { PrepItem, Stay } from './types'

const prep = (p: Partial<PrepItem>): PrepItem => ({
  id: p.item ?? 'x', sourceKey: 'k', sourceList: null, item: 'x', category: 'Vehicle', plannedCost: 100, include: true, priority: 'Medium',
  buyBy: '2026-11-01', sheetNotes: '', status: 'todo', actualCost: null, owner: null, notes: '', link: '', updatedAt: '', updatedBy: 'import', ...p,
})
const stay = (baseCamp: string, len: number, p: Partial<Stay> = {}): Stay => ({
  id: baseCamp, sourceKey: null, kind: 'stay', baseCamp, type: 'Camping', regionRaw: null,
  days: Array.from({ length: len }, () => ({ activity: '', buffer: false })), chosenSite: '', bookingRequirement: 'Unknown', status: 'Not booked',
  bookingRef: '', cost: null, bookedVia: '', link: '', cancelBy: null, notes: '', updatedAt: '', updatedBy: 'import', ...p,
})

describe('nextActions', () => {
  const today = '2026-10-06'
  const stays = [
    stay('Fraser', 5, { bookingRequirement: 'Must book' }), // 31 May 2027 → act by 2 Mar 2027
    stay('Free camp', 2, { bookingRequirement: 'No booking needed' }),
    stay('Buffer', 3, { kind: 'buffer', bookingRequirement: 'No booking needed' }),
    stay('Booked', 2, { status: 'Booked', bookingRequirement: 'Must book' }),
    stay('Pub', 1, { bookingRequirement: 'Recommended' }), // day 13 = 12 Jun 2027 → act by 13 May 2027
  ]
  const spans = staySpans(stays, '2027-05-31')

  it('orders prep and stays together by act-by date, skipping done, dropped, excluded and sorted stays', () => {
    const items = [
      prep({ item: 'Overdue belt', buyBy: '2026-09-01', priority: 'Critical' }),
      prep({ item: 'Done thing', buyBy: '2026-09-01', status: 'done' }),
      prep({ item: 'Dropped thing', buyBy: '2026-09-01', status: 'dropped' }),
      prep({ item: 'Duplicate', buyBy: '2026-09-01', include: false }),
      prep({ item: 'April item', buyBy: '2027-04-01' }),
      prep({ item: 'Oct item', buyBy: '2026-10-01' }),
    ]
    const a = nextActions(items, stays, spans, today, 10)
    expect(a.map((x) => (x.kind === 'prep' ? x.item.item : `book ${x.stay.baseCamp}`))).toEqual(['Overdue belt', 'Oct item', 'book Fraser', 'April item', 'book Pub'])
    expect(a[0]).toMatchObject({ due: 'overdue' })
    expect(a.find((x) => x.kind === 'stay')!.actBy).toBe('2027-03-02')
  })

  it('limits to five by default', () => {
    const items = Array.from({ length: 9 }, (_, i) => prep({ item: `i${i}` }))
    expect(nextActions(items, stays, spans, today)).toHaveLength(5)
  })

  it('drops stays that are already over', () => {
    const a = nextActions([], stays, spans, '2027-06-06', 10)
    expect(a.map((x) => x.id)).toEqual(['Pub'])
  })
})

describe('staysSorted', () => {
  it('counts real stays in the window that are booked or need no booking', () => {
    const stays = [stay('A', 5, { status: 'Confirmed' }), stay('B', 5), stay('Buf', 5, { kind: 'buffer' }), stay('C', 5, { bookingRequirement: 'No booking needed' }), stay('Late', 5)]
    const spans = staySpans(stays, '2027-05-31')
    expect(staysSorted(stays, spans, '2027-05-31', 20)).toEqual({ done: 2, total: 3 })
  })
})

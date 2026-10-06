import { describe, expect, it } from 'vitest'
import { resizeStay, staySpans, stayOnDay, totalDays } from './stays'
import type { BookingStatus, Stay } from './types'

let n = 0
function stay(baseCamp: string, length: number, opts: { kind?: Stay['kind']; status?: BookingStatus } = {}): Stay {
  const kind = opts.kind ?? 'stay'
  return {
    id: `s${++n}-${baseCamp}`,
    sourceKey: null,
    kind,
    baseCamp,
    type: kind === 'buffer' ? null : 'Camping',
    regionRaw: null,
    days: Array.from({ length }, (_, i) => ({ activity: `${baseCamp} day ${i + 1}`, buffer: kind === 'buffer' })),
    chosenSite: '',
    bookingRequirement: 'Unknown',
    status: opts.status ?? 'Not booked',
    bookingRef: '',
    cost: null,
    bookedVia: '',
    link: '',
    cancelBy: null,
    notes: '',
    updatedAt: '',
    updatedBy: 'import',
  }
}

const trip = () => [
  stay('Fraser', 5),
  stay('Byron', 3),
  stay('Buffer', 4, { kind: 'buffer' }),
  stay('Melbourne', 3, { status: 'Booked' }),
  stay('Ferry', 1, { status: 'Confirmed' }),
]
const names = (s: Stay[]) => s.map((x) => `${x.baseCamp}:${x.days.length}`)

describe('staySpans', () => {
  it('derives every date from the departure date and the stays before it', () => {
    const stays = trip()
    const spans = staySpans(stays, '2027-05-31')
    expect(spans.get(stays[0].id)).toMatchObject({ startDay: 1, endDay: 5, startDate: '2027-05-31', endDate: '2027-06-04', departDate: '2027-06-05', nights: 5 })
    expect(spans.get(stays[1].id)).toMatchObject({ startDay: 6, startDate: '2027-06-05' })
    expect(spans.get(stays[4].id)).toMatchObject({ startDay: 16, startDate: '2027-06-15', endDate: '2027-06-15' })
  })

  it('moves everything when the departure date moves', () => {
    const stays = trip()
    expect(staySpans(stays, '2027-06-01').get(stays[4].id)!.startDate).toBe('2027-06-16')
  })

  it('handles month, year and leap-day boundaries', () => {
    const s = [stay('A', 300), stay('B', 1)]
    // 31 May 2027 + 300 days crosses into 2028, which has 29 Feb
    expect(staySpans(s, '2027-05-31').get(s[1].id)!.startDate).toBe('2028-03-26')
    const leap = [stay('A', 1), stay('B', 1)]
    expect(staySpans(leap, '2028-02-28').get(leap[1].id)!.startDate).toBe('2028-02-29')
  })

  it('finds the stay for a trip day', () => {
    const stays = trip()
    expect(stayOnDay(stays, 1)?.baseCamp).toBe('Fraser')
    expect(stayOnDay(stays, 6)?.baseCamp).toBe('Byron')
    expect(stayOnDay(stays, 16)?.baseCamp).toBe('Ferry')
    expect(stayOnDay(stays, 17)).toBeNull()
  })
})

describe('resizeStay — shift mode', () => {
  it('lengthening a stay pushes every later stay back and lengthens the trip', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[1].id, 5, 'shift')
    expect(r.problem).toBeNull()
    expect(names(r.stays)).toEqual(['Fraser:5', 'Byron:5', 'Buffer:4', 'Melbourne:3', 'Ferry:1'])
    expect(r.tripLengthChange).toBe(2)
    expect(r.movedCount).toBe(3)
    expect(r.movedBooked.map((m) => [m.baseCamp, m.fromDay, m.toDay])).toEqual([
      ['Melbourne', 13, 15],
      ['Ferry', 16, 18],
    ])
  })

  it('shortening keeps the first days and pulls later stays forward', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[0].id, 2, 'shift')
    expect(r.stays[0].days.map((d) => d.activity)).toEqual(['Fraser day 1', 'Fraser day 2'])
    expect(r.tripLengthChange).toBe(-3)
    expect(r.movedBooked.map((m) => m.toDay)).toEqual([10, 13])
  })

  it('new days are blank', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[1].id, 4, 'shift')
    expect(r.stays[1].days[3]).toEqual({ activity: '', buffer: false })
  })

  it('warns when the stay being resized is itself booked', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[3].id, 4, 'shift')
    expect(r.movedBooked.map((m) => m.baseCamp)).toEqual(['Melbourne', 'Ferry'])
  })

  it('does not modify the original list', () => {
    const stays = trip()
    const before = JSON.stringify(stays)
    resizeStay(stays, stays[1].id, 9, 'shift')
    expect(JSON.stringify(stays)).toBe(before)
  })

  it('rejects lengths under one day and unknown stays', () => {
    const stays = trip()
    expect(resizeStay(stays, stays[0].id, 0, 'shift').problem).toMatch(/at least one day/)
    expect(resizeStay(stays, 'nope', 3, 'shift').problem).toMatch(/no longer exists/)
    expect(resizeStay(stays, stays[0].id, 5, 'shift')).toMatchObject({ problem: null, movedCount: 0, tripLengthChange: 0 })
  })
})

describe('resizeStay — absorb mode (take days from the next buffer)', () => {
  it('lengthening takes days from the next buffer so booked stays after it do not move', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[0].id, 7, 'absorb')
    expect(names(r.stays)).toEqual(['Fraser:7', 'Byron:3', 'Buffer:2', 'Melbourne:3', 'Ferry:1'])
    expect(r.tripLengthChange).toBe(0)
    expect(r.movedBooked).toEqual([])
    expect(r.absorbedBy).toBe(stays[2].id)
    expect(totalDays(r.stays)).toBe(totalDays(stays))
  })

  it('shortening gives the days back to the buffer', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[1].id, 1, 'absorb')
    expect(names(r.stays)).toEqual(['Fraser:5', 'Byron:1', 'Buffer:6', 'Melbourne:3', 'Ferry:1'])
    expect(r.movedBooked).toEqual([])
  })

  it('removes the buffer block when all its days are used', () => {
    const stays = trip()
    const r = resizeStay(stays, stays[1].id, 7, 'absorb')
    expect(names(r.stays)).toEqual(['Fraser:5', 'Byron:7', 'Melbourne:3', 'Ferry:1'])
  })

  it('refuses when the buffer is too short or there is none', () => {
    const stays = trip()
    expect(resizeStay(stays, stays[1].id, 8, 'absorb').problem).toMatch(/only has 4 days/)
    expect(resizeStay(stays, stays[3].id, 4, 'absorb').problem).toMatch(/no buffer block after/)
  })

  it('still reports a booked stay that sits between the resized stay and the buffer', () => {
    const stays = [stay('A', 2), stay('Booked', 2, { status: 'Booked' }), stay('Buffer', 5, { kind: 'buffer' }), stay('Later', 2, { status: 'Booked' })]
    const r = resizeStay(stays, stays[0].id, 4, 'absorb')
    expect(r.movedBooked.map((m) => m.baseCamp)).toEqual(['Booked'])
  })
})

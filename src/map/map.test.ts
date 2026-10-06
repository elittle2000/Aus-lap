import { describe, expect, it } from 'vitest'
import { carPosition, splitRoute, type RoutePoint } from './progress'
import { Geocoder, kmBetween, queriesFor, suspiciousJumps, type Fetcher } from './geocode'

const pt = (name: string, lat: number, lng: number, startDay: number, endDay: number): RoutePoint => ({ name, stayId: name, lat, lng, startDay, endDay })
// Days 1–5 at A, 6–7 buffer, 8–10 at B, 11 ferry, 12–14 at C
const route = [pt('A', 0, 0, 1, 5), pt('B', 0, 10, 8, 10), pt('C', 10, 10, 12, 14)]

describe('carPosition', () => {
  it('waits at the start before departure', () => {
    expect(carPosition(route, -30)).toMatchObject({ phase: 'before', lat: 0, lng: 0 })
  })
  it('sits at the stay on its days', () => {
    expect(carPosition(route, 1)).toMatchObject({ phase: 'at-stay', atStayId: 'A', segment: 0 })
    expect(carPosition(route, 9)).toMatchObject({ phase: 'at-stay', atStayId: 'B', segment: 1 })
  })
  it('drives part-way between stays on in-between days', () => {
    // Left A after day 5, arrives B on day 8: day 6 is 1/3 of the way, day 7 is 2/3.
    expect(carPosition(route, 6)).toMatchObject({ phase: 'between', segment: 0 })
    expect(carPosition(route, 6)!.lng).toBeCloseTo(10 / 3)
    expect(carPosition(route, 7)!.lng).toBeCloseTo(20 / 3)
    expect(carPosition(route, 11)).toMatchObject({ phase: 'between', segment: 1, fraction: 0.5, lat: 5, lng: 10 })
  })
  it('stops at the end once the trip is over', () => {
    expect(carPosition(route, 99)).toMatchObject({ phase: 'finished', lat: 10, lng: 10 })
  })
  it('handles no route at all', () => {
    expect(carPosition([], 1)).toBeNull()
  })
})

describe('splitRoute', () => {
  it('everything is still to come before departure', () => {
    expect(splitRoute(route, carPosition(route, 0)!)).toEqual({ done: [], todo: route })
  })
  it('splits the line at the car', () => {
    const car = carPosition(route, 11)!
    const { done, todo } = splitRoute(route, car)
    expect(done.map((p) => [p.lat, p.lng])).toEqual([[0, 0], [0, 10], [5, 10]])
    expect(todo.map((p) => [p.lat, p.lng])).toEqual([[5, 10], [10, 10]])
  })
})

describe('queriesFor', () => {
  const qs = (name: string, ref?: Parameters<typeof queriesFor>[1]) => queriesFor(name, ref).map((x) => `${x.fallback ? '~' : ''}${x.q}`)
  it('tries the full name, then its parts, then the hint', () => {
    expect(qs('Little Bay Beach (South West Rocks)')).toEqual(['Little Bay Beach South West Rocks', 'Little Bay Beach', '~South West Rocks Little Bay Beach', '~South West Rocks', '~Little Bay'])
    expect(qs('Byron Bay', { baseCamp: 'Byron Bay', region: 'NSW', generalLocation: 'Byron Bay region, NSW far north coast' })).toEqual(['Byron Bay'])
  })
  it('drops labels that are not part of the place name', () => {
    expect(qs('STOP & EARN: Camp host - Cape Range NP')[0]).toBe('Cape Range NP')
    expect(qs('Coober Pedy (optional)')[0]).toBe('Coober Pedy')
    expect(qs('Port Augusta to Eyre Peninsula transit').slice(0, 2)).toEqual(['Eyre Peninsula', '~Port Augusta'])
  })
  it('never guesses with a single short word', () => {
    expect(qs('West coast beaches')).not.toContain('~West')
  })
})

describe('Geocoder', () => {
  const fake = (answers: Record<string, unknown[]>): { fetcher: Fetcher; asked: string[] } => {
    const asked: string[] = []
    return {
      asked,
      fetcher: async (url) => {
        const u = new URL(url)
        const key = `${u.searchParams.get('q')}${u.searchParams.get('bounded') ? ' [near]' : ''}`
        asked.push(key)
        return (answers[key] ?? []) as never
      },
    }
  }
  const hit = (lat: number, lon: number, name: string, extra = {}) => ({ lat: String(lat), lon: String(lon), display_name: `${name}, State, Australia`, address: { state: 'New South Wales' }, ...extra })

  it('prefers a match near the previous stop over a same-named place far away', async () => {
    const { fetcher } = fake({
      'Little Bay Beach South West Rocks [near]': [],
      'Little Bay Beach South West Rocks': [],
      'Little Bay Beach [near]': [hit(-30.88, 153.07, 'Little Bay Beach, Arakoon')],
      'Little Bay Beach': [hit(-33.98, 151.25, 'Little Bay Beach, Sydney')],
    })
    const p = await new Geocoder(fetcher, 0).locate('Little Bay Beach (South West Rocks)', null, { lat: -30.9, lng: 153.0 })
    expect(p).toMatchObject({ lat: -30.88, quality: 'good', state: 'NSW' })
  })

  it('rejects a far-off guess but keeps it as a flagged last resort', async () => {
    const { fetcher } = fake({ '~': [], 'Sandy Cove': [hit(-33.5, 151.3, 'Sandy Cove, Gosford')] })
    const p = await new Geocoder(fetcher, 0).locate('Nirranda Coast (Sandy Cove)', null, { lat: -38.5, lng: 142.8 })
    expect(p).toMatchObject({ lat: -33.5, quality: 'check' })
  })

  it('skips a road that only shares the name', async () => {
    const { fetcher } = fake({ Geraldton: [hit(-31, 116, 'Old Geraldton Road', { addresstype: 'road' })], 'Geraldton [near]': [], })
    const g = new Geocoder(fetcher, 0)
    expect(await g.locate('Geraldton')).toMatchObject({ quality: 'check' }) // only the road exists: flagged
  })

  it('waits at least the set gap between requests', async () => {
    const { fetcher } = fake({})
    const g = new Geocoder(fetcher, 50)
    await g.locate('Nowhere Special')
    const t = Date.now()
    await g.locate('Nowhere Else')
    expect(Date.now() - t).toBeGreaterThanOrEqual(45)
  })
})

describe('distances', () => {
  it('measures roughly right', () => {
    // Brisbane → Sydney ≈ 730 km
    expect(kmBetween({ lat: -27.47, lng: 153.03 }, { lat: -33.87, lng: 151.21 })).toBeGreaterThan(700)
    expect(kmBetween({ lat: -27.47, lng: 153.03 }, { lat: -33.87, lng: 151.21 })).toBeLessThan(760)
  })
  it('flags a point far from both neighbours', () => {
    expect([...suspiciousJumps([{ lat: -30, lng: 153 }, { lat: -42, lng: 147 }, { lat: -30.1, lng: 153 }])]).toEqual([1])
    expect([...suspiciousJumps([{ lat: -30, lng: 153 }, null, { lat: -30.1, lng: 153 }])]).toEqual([])
    // The first and last stops only have one neighbour, so a long first/last leg isn't flagged.
    expect([...suspiciousJumps([{ lat: -30, lng: 153 }, { lat: -42, lng: 147 }])]).toEqual([])
  })
})

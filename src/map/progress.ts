import type { IsoDate } from '../lib/dates'
import { daysBetween } from '../lib/dates'
import type { Stay } from '../domain/types'
import type { StaySpan } from '../domain/stays'
import type { LatLng } from './geocode'

// Where the car is on the route on a given day.
//
// The route is the stays that have a map position, in order. On a day at a stay with
// a position, the car is there. On flexible days, ferry days, or at a stay we couldn't
// find, the car is part-way along the line between the last and next known places,
// in proportion to how many of those in-between days have passed, so it "drives".

export interface RoutePoint extends LatLng {
  stayId: string
  name: string
  startDay: number
  endDay: number
}

export function routePoints(stays: Stay[], spans: Map<string, StaySpan>): RoutePoint[] {
  return stays.flatMap((s) => {
    const sp = spans.get(s.id)
    if (!s.geo || !sp || s.kind !== 'stay') return []
    return [{ lat: s.geo.lat, lng: s.geo.lng, stayId: s.id, name: s.baseCamp, startDay: sp.startDay, endDay: sp.endDay }]
  })
}

export interface CarPosition extends LatLng {
  /** Index of the route point the car has most recently reached (−1: not started). */
  segment: number
  /** 0–1 of the way from point[segment] to point[segment + 1]. */
  fraction: number
  phase: 'before' | 'at-stay' | 'between' | 'finished'
  /** The stay the car is at, when phase is 'at-stay'. */
  atStayId: string | null
}

export function carPosition(points: RoutePoint[], dayNumber: number): CarPosition | null {
  if (!points.length) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (dayNumber < first.startDay) return { lat: first.lat, lng: first.lng, segment: 0, fraction: 0, phase: 'before', atStayId: null }
  if (dayNumber > last.endDay) return { lat: last.lat, lng: last.lng, segment: points.length - 1, fraction: 0, phase: 'finished', atStayId: null }

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (dayNumber >= p.startDay && dayNumber <= p.endDay) return { lat: p.lat, lng: p.lng, segment: i, fraction: 0, phase: 'at-stay', atStayId: p.stayId }
    const next = points[i + 1]
    if (next && dayNumber > p.endDay && dayNumber < next.startDay) {
      // Days between leaving p and arriving at next; the car is part-way there.
      const gap = next.startDay - p.endDay
      const fraction = (dayNumber - p.endDay) / gap
      return { lat: p.lat + (next.lat - p.lat) * fraction, lng: p.lng + (next.lng - p.lng) * fraction, segment: i, fraction, phase: 'between', atStayId: null }
    }
  }
  return { lat: last.lat, lng: last.lng, segment: points.length - 1, fraction: 0, phase: 'finished', atStayId: null }
}

/** The line split at the car: the part already driven and the part still to come. */
export function splitRoute(points: LatLng[], car: Pick<CarPosition, 'segment' | 'fraction' | 'lat' | 'lng' | 'phase'>): { done: LatLng[]; todo: LatLng[] } {
  if (car.phase === 'before') return { done: [], todo: points }
  const head = points.slice(0, car.segment + 1)
  const here = { lat: car.lat, lng: car.lng }
  return { done: [...head, here], todo: [here, ...points.slice(car.segment + 1)] }
}

/** Trip day number for a date (1 on departure day). */
export const tripDayOf = (departure: IsoDate, date: IsoDate) => daysBetween(departure, date) + 1

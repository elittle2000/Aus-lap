import { addDays, endOfMonth, type IsoDate } from '../lib/dates'
import { comparePrep, counts, dueState, type DueState } from './prep'
import { isBooked, type StaySpan } from './stays'
import type { BookingRequirement, PrepItem, Stay } from './types'

// "What needs doing": one list across prep items and stays, ordered by when action is due.
// Until the booking-rules engine (step 5) knows when each booking window opens,
// stays use a simple lead time before arrival as their act-by date.

export const PLACEHOLDER_LEAD_DAYS: Record<Exclude<BookingRequirement, 'No booking needed'>, number> = {
  'Must book': 90,
  Unknown: 90,
  Recommended: 30,
}

export type Action =
  | { kind: 'prep'; id: string; actBy: IsoDate; item: PrepItem; due: DueState }
  | { kind: 'stay'; id: string; actBy: IsoDate; stay: Stay; span: StaySpan }

export function stayNeedsBooking(s: Stay): boolean {
  return s.kind === 'stay' && s.bookingRequirement !== 'No booking needed' && !isBooked(s.status)
}

export function stayActBy(s: Stay, span: StaySpan): IsoDate {
  const lead = s.bookingRequirement === 'No booking needed' ? 0 : PLACEHOLDER_LEAD_DAYS[s.bookingRequirement]
  return addDays(span.startDate, -lead)
}

export function nextActions(prepItems: PrepItem[], stays: Stay[], spans: Map<string, StaySpan>, today: IsoDate, limit = 5): Action[] {
  const prep: Action[] = prepItems
    .filter((i) => counts(i) && (i.status === 'todo' || i.status === 'ordered'))
    .sort(comparePrep)
    .map((item) => ({ kind: 'prep', id: item.id, actBy: item.buyBy ? endOfMonth(item.buyBy) : '9999-12-31', item, due: dueState(item, today) }))

  const stayActions: Action[] = stays
    .filter((s) => stayNeedsBooking(s) && spans.get(s.id) && spans.get(s.id)!.endDate >= today)
    .map((stay) => {
      const span = spans.get(stay.id)!
      return { kind: 'stay', id: stay.id, actBy: stayActBy(stay, span), stay, span }
    })

  // Ordered items (already in hand) go after anything still to do with the same date.
  const weight = (a: Action) => (a.kind === 'prep' && a.item.status === 'ordered' ? 1 : 0)
  return [...prep, ...stayActions].sort((a, b) => (a.actBy === b.actBy ? weight(a) - weight(b) : a.actBy < b.actBy ? -1 : 1)).slice(0, limit)
}

/** Stays whose first day falls within [from, from + days). "Sorted" = booked, confirmed, or no booking needed. */
export function staysSorted(stays: Stay[], spans: Map<string, StaySpan>, from: IsoDate, days: number) {
  const until = addDays(from, days)
  const inWindow = stays.filter((s) => {
    const sp = spans.get(s.id)
    return s.kind === 'stay' && sp && sp.endDate >= from && sp.startDate < until
  })
  return { done: inWindow.filter((s) => !stayNeedsBooking(s)).length, total: inWindow.length }
}

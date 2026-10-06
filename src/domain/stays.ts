import { tripDayDate, type IsoDate } from '../lib/dates'
import type { Stay, StayDay, BookingStatus } from './types'
import type { SheetDay } from '../import/parseWorkbook'

// A stay never stores its own dates. Its start is worked out from the stays before it,
// so changing one stay's length (or the departure date) moves everything after it.

export const BUFFER_NAME = /^buffer\b|flexible day/i

/** A block is a buffer when every day is flagged buffer and it isn't a named place. */
export function isBufferBlock(baseCamp: string, days: { buffer: boolean }[]): boolean {
  return days.every((d) => d.buffer) && BUFFER_NAME.test(baseCamp)
}

export interface DayBlock {
  baseCamp: string
  firstDay: number
  days: SheetDay[]
}

/** Consecutive days at the same base camp make one block. */
export function groupDays(days: SheetDay[]): DayBlock[] {
  const blocks: DayBlock[] = []
  for (const d of days) {
    const last = blocks[blocks.length - 1]
    if (last && last.baseCamp === d.baseCamp) last.days.push(d)
    else blocks.push({ baseCamp: d.baseCamp, firstDay: d.dayNumber, days: [d] })
  }
  return blocks
}

const normaliseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Re-import match key: the base camp name plus which occurrence it is
 * ("buffer flexible day#3" is the third buffer block). Stable when days are
 * added or removed elsewhere in the itinerary.
 */
export function blockKeys(blocks: { baseCamp: string }[]): string[] {
  const seen = new Map<string, number>()
  return blocks.map((b) => {
    const k = normaliseKey(b.baseCamp)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return `stay:${k}#${n}`
  })
}

export function isBooked(status: BookingStatus): boolean {
  return status === 'Booked' || status === 'Confirmed'
}

export interface StaySpan {
  startDay: number
  endDay: number
  startDate: IsoDate
  endDate: IsoDate
  /** The morning you leave: the day after the last day. */
  departDate: IsoDate
  nights: number
}

/** Start/end day numbers and dates for every stay, in order. */
export function staySpans(stays: Pick<Stay, 'id' | 'days'>[], departure: IsoDate): Map<string, StaySpan> {
  const spans = new Map<string, StaySpan>()
  let day = 1
  for (const s of stays) {
    const len = s.days.length
    const startDay = day
    const endDay = day + len - 1
    spans.set(s.id, {
      startDay,
      endDay,
      startDate: tripDayDate(departure, startDay),
      endDate: tripDayDate(departure, endDay),
      departDate: tripDayDate(departure, endDay + 1),
      nights: len,
    })
    day += len
  }
  return spans
}

export function totalDays(stays: Pick<Stay, 'days'>[]): number {
  return stays.reduce((n, s) => n + s.days.length, 0)
}

/** Which stay you're at on a given trip day (1-based), if any. */
export function stayOnDay(stays: Stay[], dayNumber: number): Stay | null {
  let day = 1
  for (const s of stays) {
    if (dayNumber >= day && dayNumber < day + s.days.length) return s
    day += s.days.length
  }
  return null
}

// ---------- Changing a stay's length ----------

export type ResizeMode =
  /** Every later stay moves by the change. */
  | 'shift'
  /** Take the days from (or give them back to) the next buffer block, so stays after it don't move. */
  | 'absorb'

export interface MovedStay {
  id: string
  baseCamp: string
  status: BookingStatus
  fromDay: number
  toDay: number
}

export interface ResizeResult {
  stays: Stay[]
  /** Booked or Confirmed stays whose dates change. Show these before saving. */
  movedBooked: MovedStay[]
  /** How many stays in total change dates. */
  movedCount: number
  /** Change in total trip length, in days. */
  tripLengthChange: number
  /** The buffer block that gave or took days, when mode is 'absorb'. */
  absorbedBy: string | null
  problem: string | null
}

const blankDay = (buffer: boolean): StayDay => ({ activity: '', buffer })

function withLength<T extends Pick<Stay, 'days' | 'kind'>>(stay: T, length: number): T {
  const days = stay.days.slice(0, length)
  while (days.length < length) days.push(blankDay(stay.kind === 'buffer'))
  return { ...stay, days }
}

export function resizeStay(stays: Stay[], stayId: string, newLength: number, mode: ResizeMode): ResizeResult {
  const idx = stays.findIndex((s) => s.id === stayId)
  const none = (problem: string | null): ResizeResult => ({ stays, movedBooked: [], movedCount: 0, tripLengthChange: 0, absorbedBy: null, problem })
  if (idx < 0) return none('That stay no longer exists.')
  if (!Number.isInteger(newLength) || newLength < 1) return none('A stay must be at least one day.')

  const delta = newLength - stays[idx].days.length
  if (delta === 0) return none(null)

  const next = stays.slice()
  next[idx] = withLength(stays[idx], newLength)
  let absorbedBy: string | null = null

  if (mode === 'absorb') {
    const bufIdx = stays.findIndex((s, i) => i > idx && s.kind === 'buffer')
    if (bufIdx < 0) return none('There is no buffer block after this stay to take the days from.')
    const buf = stays[bufIdx]
    const remaining = buf.days.length - delta
    if (remaining < 0) {
      return none(`The next buffer block only has ${buf.days.length} day${buf.days.length === 1 ? '' : 's'}.`)
    }
    absorbedBy = buf.id
    if (remaining === 0) next.splice(bufIdx, 1)
    else next[bufIdx] = withLength(buf, remaining)
  }

  const before = staySpanDays(stays)
  const after = staySpanDays(next)
  const moved: MovedStay[] = []
  for (const s of next) {
    const from = before.get(s.id)
    const to = after.get(s.id)
    if (from === undefined || to === undefined || from === to) continue
    moved.push({ id: s.id, baseCamp: s.baseCamp, status: s.status, fromDay: from, toDay: to })
  }
  // A stay whose length changed keeps its start but its end moves; if it's booked, that matters too.
  const resized = next[idx]
  const resizedBooked = isBooked(resized.status) ? [{ id: resized.id, baseCamp: resized.baseCamp, status: resized.status, fromDay: before.get(resized.id)!, toDay: after.get(resized.id)! }] : []

  return {
    stays: next,
    movedBooked: [...resizedBooked, ...moved.filter((m) => isBooked(m.status))],
    movedCount: moved.length,
    tripLengthChange: totalDays(next) - totalDays(stays),
    absorbedBy,
    problem: null,
  }
}

function staySpanDays(stays: Pick<Stay, 'id' | 'days'>[]): Map<string, number> {
  const m = new Map<string, number>()
  let day = 1
  for (const s of stays) {
    m.set(s.id, day)
    day += s.days.length
  }
  return m
}

import type { BookingRequirement, BookingStatus, Priority, PrepStatus } from '../domain/types'
import type { DueState } from '../domain/prep'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export type Tone = 'stone' | 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'ochre'
export const TONES: Record<Tone, string> = {
  stone: 'bg-stone-100 text-stone-700',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-900',
  green: 'bg-green-100 text-green-800',
  blue: 'bg-sky-100 text-sky-800',
  violet: 'bg-violet-100 text-violet-800',
  ochre: 'bg-ochre-100 text-ochre-700',
}

export const PRIORITY_TONE: Record<Priority, Tone> = { Critical: 'red', High: 'amber', Medium: 'blue', Low: 'stone' }

export const BOOKING_TONE: Record<BookingStatus, Tone> = { 'Not booked': 'red', Researching: 'amber', Booked: 'blue', Confirmed: 'green' }
export const REQUIREMENT_TONE: Record<BookingRequirement, Tone> = { 'Must book': 'red', Recommended: 'amber', 'No booking needed': 'green', Unknown: 'stone' }

export const DUE_LABEL: Record<DueState, [string, Tone]> = {
  overdue: ['Overdue', 'red'],
  'due-this-month': ['Due this month', 'amber'],
  upcoming: ['Upcoming', 'stone'],
  'in-progress': ['Ordered', 'blue'],
  done: ['Done', 'green'],
  dropped: ['Dropped', 'stone'],
  'no-date': ['No date', 'stone'],
}

export const PREP_STATUS_TONE: Record<PrepStatus, Tone> = { todo: 'stone', ordered: 'blue', done: 'green', dropped: 'stone' }

export const inputCls = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base focus:border-ochre-500 focus:outline-none focus:ring-2 focus:ring-ochre-200'
export const btnPrimary = 'inline-flex items-center justify-center rounded-xl bg-ochre-600 px-4 py-2.5 font-medium text-white hover:bg-ochre-700 disabled:opacity-50'
export const btnSecondary = 'inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 font-medium text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50'


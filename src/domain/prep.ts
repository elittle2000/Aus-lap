import { endOfMonth, monthKey, type IsoDate } from '../lib/dates'
import { PRIORITIES, type PrepItem, type Priority } from './types'

// "Buy by" dates in the spreadsheet are the first of a month and mean "during that month".
// So an item is due this month while we're in that month, and overdue once the month ends.

export type DueState = 'done' | 'dropped' | 'in-progress' | 'overdue' | 'due-this-month' | 'upcoming' | 'no-date'

export function dueState(item: Pick<PrepItem, 'status' | 'buyBy'>, today: IsoDate): DueState {
  if (item.status === 'done') return 'done'
  if (item.status === 'dropped') return 'dropped'
  if (item.status === 'ordered') return 'in-progress'
  if (!item.buyBy) return 'no-date'
  if (today > endOfMonth(item.buyBy)) return 'overdue'
  if (monthKey(today) === monthKey(item.buyBy)) return 'due-this-month'
  return 'upcoming'
}

/** Items that count towards the plan: in the spreadsheet as Include = Yes, or added in the app. */
export const counts = (i: PrepItem) => i.include && !i.removedFromSheet

const PRIORITY_RANK: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }

/** Overdue first, then by buy-by month, then priority. */
export function comparePrep(a: PrepItem, b: PrepItem): number {
  const ad = a.buyBy ?? '9999-12-31'
  const bd = b.buyBy ?? '9999-12-31'
  if (ad !== bd) return ad < bd ? -1 : 1
  const ap = a.priority ? PRIORITY_RANK[a.priority] : 9
  const bp = b.priority ? PRIORITY_RANK[b.priority] : 9
  if (ap !== bp) return ap - bp
  return a.item.localeCompare(b.item)
}

export interface SpendLine {
  key: string
  planned: number
  actual: number
  remaining: number
}

export interface SpendSummary {
  /** Planned cost of every counted item that hasn't been dropped. */
  planned: number
  /** Money actually spent (actual costs entered). */
  actual: number
  /** Planned cost of items not yet paid for. */
  remaining: number
  /** actual + remaining: where the total is heading. */
  forecast: number
  byPriority: SpendLine[]
  byMonth: SpendLine[]
}

/** Cost still to pay for one item: nothing once dropped, done or paid; otherwise its planned cost. */
function remainingFor(i: PrepItem): number {
  if (i.status === 'dropped' || i.status === 'done' || i.actualCost !== null) return 0
  return i.plannedCost ?? 0
}

export function spendSummary(items: PrepItem[]): SpendSummary {
  const counted = items.filter((i) => counts(i) && i.status !== 'dropped')
  const line = (key: string, list: PrepItem[]): SpendLine => ({
    key,
    planned: sum(list.map((i) => i.plannedCost ?? 0)),
    actual: sum(list.map((i) => i.actualCost ?? 0)),
    remaining: sum(list.map(remainingFor)),
  })
  const total = line('total', counted)

  const byPriority = [...PRIORITIES, null].map((p) => line(p ?? 'None', counted.filter((i) => i.priority === p))).filter((l) => l.planned || l.actual)

  const months = [...new Set(counted.map((i) => (i.buyBy ? monthKey(i.buyBy) : 'none')))].sort()
  const byMonth = months.map((m) => line(m, counted.filter((i) => (i.buyBy ? monthKey(i.buyBy) : 'none') === m)))

  return { planned: total.planned, actual: total.actual, remaining: total.remaining, forecast: total.actual + total.remaining, byPriority, byMonth }
}

export interface Readiness {
  done: number
  total: number
}

export function prepReadiness(items: PrepItem[], onlyPriority?: Priority): Readiness {
  const list = items.filter((i) => counts(i) && i.status !== 'dropped' && (!onlyPriority || i.priority === onlyPriority))
  return { done: list.filter((i) => i.status === 'done').length, total: list.length }
}

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

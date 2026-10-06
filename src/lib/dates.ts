// All dates in the app are plain calendar dates stored as 'YYYY-MM-DD' strings.
// Arithmetic is done in UTC so a device's own timezone can never shift a date by a day.

export type IsoDate = string

const DAY_MS = 86_400_000

function toUtc(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
}

/** Excel stores dates as days since 30 Dec 1899. */
export function excelSerialToIso(serial: number): IsoDate {
  return fromUtc(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS)
}

/** Date of a trip day: day 1 is the departure date. */
export function tripDayDate(departure: IsoDate, dayNumber: number): IsoDate {
  return addDays(departure, dayNumber - 1)
}

/** 'YYYY-MM' */
export function monthKey(iso: IsoDate): string {
  return iso.slice(0, 7)
}

export function endOfMonth(iso: IsoDate): IsoDate {
  const [y, m] = iso.split('-').map(Number)
  return fromUtc(Date.UTC(y, m, 0))
}

/** Today's calendar date in an Australian timezone (default: home, Brisbane). */
export function todayIn(timeZone = 'Australia/Brisbane', now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...opts })
const fmtShort = fmt({ day: 'numeric', month: 'short' })
const fmtFull = fmt({ day: 'numeric', month: 'short', year: 'numeric' })
const fmtWeekday = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtMonth = fmt({ month: 'short', year: 'numeric' })
const fmtNumeric = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' })

const asDate = (iso: IsoDate) => new Date(toUtc(iso))

/** 31 May */
export const formatShort = (iso: IsoDate) => fmtShort.format(asDate(iso))
/** 31 May 2027 */
export const formatDate = (iso: IsoDate) => fmtFull.format(asDate(iso))
/** Mon, 31 May 2027 */
export const formatWeekday = (iso: IsoDate) => fmtWeekday.format(asDate(iso))
/** 31/05/2027 */
export const formatNumeric = (iso: IsoDate) => fmtNumeric.format(asDate(iso))
/** May 2027 — accepts 'YYYY-MM' or a full date */
export const formatMonth = (isoOrMonth: string) => fmtMonth.format(asDate(isoOrMonth.length === 7 ? `${isoOrMonth}-01` : isoOrMonth))

/** 31 May – 4 Jun 2027 */
export function formatRange(start: IsoDate, end: IsoDate): string {
  if (start === end) return formatDate(start)
  return `${formatShort(start)} – ${formatDate(end)}`
}

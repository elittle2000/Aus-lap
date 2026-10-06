import * as XLSX from 'xlsx'
import { excelSerialToIso, isIsoDate, type IsoDate } from '../lib/dates'
import { PRIORITIES, STAY_TYPES, BOOKING_STATUSES, type Priority, type StayType, type BookingStatus, type BudgetLine, type LocationRef } from '../domain/types'

// Reads only the sheets the app needs. Pay, bank and savings sheets are never opened.

export interface SheetPrepItem {
  row: number
  sourceList: string | null
  item: string
  category: string
  plannedCost: number | null
  include: boolean
  priority: Priority | null
  buyBy: IsoDate | null
  notes: string
}

export interface SheetDay {
  dayNumber: number
  regionRaw: string | null
  baseCamp: string
  type: StayType | null
  activity: string
  buffer: boolean
  chosenSite: string
  bookingStatus: BookingStatus
}

export interface ParsedWorkbook {
  departureDate: IsoDate | null
  prepItems: SheetPrepItem[]
  days: SheetDay[]
  locations: LocationRef[]
  budgetLines: BudgetLine[]
  /** Problems worth showing before importing. Errors block the import. */
  errors: string[]
  warnings: string[]
}

const SHEETS = {
  prep: 'Pre-departure Costs',
  itinerary: 'Itinerary',
  lapBudget: 'Lap Budget',
  inputs: 'Inputs & Assumptions',
} as const

export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  // Dense mode off; dates stay as Excel serial numbers so no timezone conversion happens.
  return XLSX.read(data, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false })
}

type Cell = string | number | boolean | null

/** 1-indexed cell access to match row/column numbers seen in Excel. */
function cell(ws: XLSX.WorkSheet, row: number, col: number): Cell {
  const c = ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as XLSX.CellObject | undefined
  if (!c || c.v === undefined || c.v === null) return null
  if (typeof c.v === 'string') {
    const t = c.v.trim()
    return t === '' ? null : t
  }
  if (c.v instanceof Date) return c.v.toISOString().slice(0, 10)
  return c.v as Cell
}

function lastRow(ws: XLSX.WorkSheet): number {
  if (!ws['!ref']) return 0
  return XLSX.utils.decode_range(ws['!ref']).e.r + 1
}

/** Blank, or a placeholder dash meaning blank. */
const text = (v: Cell) => (v === null || (typeof v === 'string' && /^[-–—]$/.test(v)) ? '' : String(v))
const num = (v: Cell) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v.replace(/[$,]/g, ''))) ? Number(v.replace(/[$,]/g, '')) : null)
const norm = (v: Cell) => text(v).toLowerCase().replace(/\s+/g, ' ').trim()

function toIsoDate(v: Cell): IsoDate | null {
  if (typeof v === 'number') return excelSerialToIso(v)
  if (typeof v === 'string') {
    if (isIsoDate(v)) return v as IsoDate
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) // dd/mm/yyyy
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function findHeaderRow(ws: XLSX.WorkSheet, col: number, label: string, maxRow = 15): number | null {
  for (let r = 1; r <= maxRow; r++) if (norm(cell(ws, r, col)) === label.toLowerCase()) return r
  return null
}

function parsePrep(ws: XLSX.WorkSheet, errors: string[], warnings: string[]): SheetPrepItem[] {
  // Columns B–H: Item, Category, Cost ($), Include?, Priority, Buy by, Notes
  const header = findHeaderRow(ws, 2, 'Item')
  if (!header) {
    errors.push(`"${SHEETS.prep}": couldn't find the header row (a cell reading "Item" in column B).`)
    return []
  }
  const expected = ['item', 'category', 'cost ($)', 'include?', 'priority', 'buy by', 'notes']
  const actual = expected.map((_, i) => norm(cell(ws, header, 2 + i)))
  if (actual.join('|') !== expected.join('|')) {
    warnings.push(`"${SHEETS.prep}" columns B–H read "${actual.join(', ')}", expected "${expected.join(', ')}".`)
  }

  const items: SheetPrepItem[] = []
  let sourceList: string | null = null
  const end = lastRow(ws)
  for (let r = header + 1; r <= end; r++) {
    const b = cell(ws, r, 2)
    // The totals block starts at the first row whose label starts with TOTAL.
    if (typeof b === 'string' && /^total\b/i.test(b)) break
    if (b === null) continue
    const rest = [3, 4, 5, 6, 7, 8].map((c) => cell(ws, r, c))
    if (rest.every((v) => v === null)) {
      sourceList = text(b) // section heading
      continue
    }
    const includeRaw = norm(rest[2])
    if (includeRaw !== 'yes' && includeRaw !== 'no') {
      warnings.push(`"${SHEETS.prep}" row ${r} ("${text(b)}"): Include? is "${text(rest[2])}", treated as No.`)
    }
    const priorityRaw = text(rest[3])
    const priority = (PRIORITIES as readonly string[]).includes(priorityRaw) ? (priorityRaw as Priority) : null
    if (priorityRaw && !priority) warnings.push(`"${SHEETS.prep}" row ${r}: unknown priority "${priorityRaw}".`)
    const buyBy = toIsoDate(rest[4])
    if (rest[4] !== null && !buyBy) warnings.push(`"${SHEETS.prep}" row ${r}: couldn't read Buy by "${text(rest[4])}".`)
    items.push({
      row: r,
      sourceList,
      item: text(b),
      category: text(rest[0]),
      plannedCost: num(rest[1]),
      include: includeRaw === 'yes',
      priority,
      buyBy,
      notes: text(rest[5]),
    })
  }
  return items
}

function parseItinerary(ws: XLSX.WorkSheet, errors: string[], warnings: string[]): { days: SheetDay[]; locations: LocationRef[] } {
  const header = findHeaderRow(ws, 1, 'Day #')
  if (!header) {
    errors.push(`"${SHEETS.itinerary}": couldn't find the header row (a cell reading "Day #" in column A).`)
    return { days: [], locations: [] }
  }
  // Columns A–J: Day #, Date, Month label, Region, Base camp / area, Type, Activity / notes, Buffer day?, Chosen site, Booking status
  const col = { day: 1, region: 4, camp: 5, type: 6, activity: 7, buffer: 8, site: 9, status: 10 }
  const days: SheetDay[] = []
  const end = lastRow(ws)
  for (let r = header + 1; r <= end; r++) {
    const dayNumber = num(cell(ws, r, col.day))
    if (dayNumber === null) continue
    const typeRaw = text(cell(ws, r, col.type))
    const type = (STAY_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as StayType) : null
    if (typeRaw && !type) warnings.push(`"${SHEETS.itinerary}" day ${dayNumber}: unknown type "${typeRaw}".`)
    const statusRaw = text(cell(ws, r, col.status))
    const bookingStatus = (BOOKING_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as BookingStatus) : 'Not booked'
    if (statusRaw && statusRaw !== bookingStatus) warnings.push(`"${SHEETS.itinerary}" day ${dayNumber}: unknown booking status "${statusRaw}", treated as Not booked.`)
    const bufferRaw = cell(ws, r, col.buffer)
    const baseCamp = text(cell(ws, r, col.camp))
    if (!baseCamp) warnings.push(`"${SHEETS.itinerary}" day ${dayNumber}: no base camp.`)
    days.push({
      dayNumber,
      regionRaw: text(cell(ws, r, col.region)) || null,
      baseCamp,
      type,
      activity: text(cell(ws, r, col.activity)),
      buffer: bufferRaw === true || norm(bufferRaw) === 'true' || norm(bufferRaw) === 'yes',
      chosenSite: text(cell(ws, r, col.site)),
      bookingStatus,
    })
  }
  days.sort((a, b) => a.dayNumber - b.dayNumber)
  const gap = days.findIndex((d, i) => d.dayNumber !== i + 1)
  if (gap >= 0) errors.push(`"${SHEETS.itinerary}": Day # should run 1, 2, 3… without gaps, but day ${gap + 1} is numbered ${days[gap].dayNumber}.`)

  // Locations reference table: columns L–N, header "Base camp / area" in column L.
  const locations: LocationRef[] = []
  let refHeader: number | null = null
  for (let r = 1; r <= 15; r++) if (norm(cell(ws, r, 12)) === 'base camp / area') refHeader = r
  if (refHeader) {
    for (let r = refHeader + 1; r <= end; r++) {
      const name = text(cell(ws, r, 12))
      if (!name) continue
      locations.push({ baseCamp: name, region: text(cell(ws, r, 13)) || null, generalLocation: text(cell(ws, r, 14)) || null })
    }
  } else {
    warnings.push(`"${SHEETS.itinerary}": no Locations reference table found in columns L–N.`)
  }
  return { days, locations }
}

function parseBudget(ws: XLSX.WorkSheet, warnings: string[]): BudgetLine[] {
  // Category lines only: the rows between the "Category" header and the "TOTAL" row.
  const header = findHeaderRow(ws, 2, 'Category', 40)
  if (!header) {
    warnings.push(`"${SHEETS.lapBudget}": couldn't find the "Category" header, so no on-road budget was imported.`)
    return []
  }
  const lines: BudgetLine[] = []
  for (let r = header + 1; r <= header + 40; r++) {
    const label = text(cell(ws, r, 2))
    if (!label || /^total/i.test(label)) break
    const monthly = num(cell(ws, r, 3))
    if (monthly !== null) lines.push({ category: label, monthly })
  }
  return lines
}

function parseDeparture(ws: XLSX.WorkSheet | undefined, warnings: string[]): IsoDate | null {
  if (!ws) {
    warnings.push(`No "${SHEETS.inputs}" sheet, so the departure date wasn't read.`)
    return null
  }
  // Only the departure row is read from this sheet: the row whose label in column B starts with "Departure".
  for (let r = 1; r <= 60; r++) {
    if (/^departure/i.test(text(cell(ws, r, 2)))) {
      const d = toIsoDate(cell(ws, r, 3))
      if (d) return d
    }
  }
  warnings.push(`Couldn't find a "Departure" date in column C of "${SHEETS.inputs}".`)
  return null
}

export function parseWorkbook(wb: XLSX.WorkBook): ParsedWorkbook {
  const errors: string[] = []
  const warnings: string[] = []
  const get = (name: string) => wb.Sheets[name] as XLSX.WorkSheet | undefined

  const prepWs = get(SHEETS.prep)
  const itinWs = get(SHEETS.itinerary)
  if (!prepWs) errors.push(`The workbook has no "${SHEETS.prep}" sheet.`)
  if (!itinWs) errors.push(`The workbook has no "${SHEETS.itinerary}" sheet.`)

  const prepItems = prepWs ? parsePrep(prepWs, errors, warnings) : []
  const { days, locations } = itinWs ? parseItinerary(itinWs, errors, warnings) : { days: [], locations: [] }
  const lapWs = get(SHEETS.lapBudget)
  const budgetLines = lapWs ? parseBudget(lapWs, warnings) : []
  if (!lapWs) warnings.push(`No "${SHEETS.lapBudget}" sheet, so no on-road budget was imported.`)
  const departureDate = parseDeparture(get(SHEETS.inputs), warnings)

  // An empty sheet would remove everything on import, so refuse it outright.
  if (prepWs && !prepItems.length && !errors.length) errors.push(`"${SHEETS.prep}" has no items.`)
  if (itinWs && !days.length && !errors.length) errors.push(`"${SHEETS.itinerary}" has no days.`)

  return { departureDate, prepItems, days, locations, budgetLines, errors, warnings }
}

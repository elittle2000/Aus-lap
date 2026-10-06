import type { IsoDate } from '../lib/dates'
import type { BookingRequirement, PrepItem, Stay, StayType } from '../domain/types'
import { blockKeys, groupDays, isBooked, isBufferBlock, staySpans, type DayBlock } from '../domain/stays'
import type { ParsedWorkbook, SheetPrepItem } from './parseWorkbook'

// Re-runnable import. Rows are matched by name (plus occurrence number for repeats),
// never by row position, so inserting a row in the spreadsheet doesn't look like
// every later row changed. Only spreadsheet-owned fields are ever updated; status,
// actual cost, owner, notes, links and booking details entered in the app are kept.

export interface FieldChange {
  field: string
  from: string
  to: string
}

export interface Changed<T> {
  existing: T
  changes: FieldChange[]
}

export interface ImportPlan {
  prep: {
    added: (SheetPrepItem & { key: string })[]
    changed: Changed<PrepItem>[]
    removed: PrepItem[]
    unchanged: number
  }
  stays: {
    added: DayBlock[]
    changed: Changed<Stay>[]
    removed: Stay[]
    unchanged: number
    /** Booked/confirmed stays whose dates would move after this import. */
    movedBooked: { stay: Stay; fromDate: IsoDate; toDate: IsoDate }[]
  }
  departure: { from: IsoDate; to: IsoDate } | null
  isFirstImport: boolean
}

export interface CurrentData {
  prepItems: PrepItem[]
  stays: Stay[]
  /** Stays that left the spreadsheet but held our booking data. */
  archivedStays?: Stay[]
  departureDate: IsoDate
}

/** Live stays plus archived ones, so a stay that returns to the spreadsheet gets its booking data back. */
const staysByKey = (current: CurrentData) =>
  new Map([...(current.archivedStays ?? []), ...current.stays].filter((s) => s.sourceKey).map((s) => [s.sourceKey!, s]))

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function prepKeys(items: { item: string }[]): string[] {
  const seen = new Map<string, number>()
  return items.map((i) => {
    const k = normalise(i.item)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return `prep:${k}#${n}`
  })
}

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

function compare(pairs: [string, unknown, unknown][]): FieldChange[] {
  return pairs.filter(([, a, b]) => show(a) !== show(b)).map(([field, a, b]) => ({ field, from: show(a), to: show(b) }))
}

function prepChanges(existing: PrepItem, sheet: SheetPrepItem): FieldChange[] {
  return compare([
    ['Item', existing.item, sheet.item],
    ['Category', existing.category, sheet.category],
    ['Cost', existing.plannedCost, sheet.plannedCost],
    ['Include?', existing.include, sheet.include],
    ['Priority', existing.priority, sheet.priority],
    ['Buy by', existing.buyBy, sheet.buyBy],
    ['Spreadsheet notes', existing.sheetNotes, sheet.notes],
    ['Section', existing.sourceList, sheet.sourceList],
    ...(existing.removedFromSheet ? [['Back in spreadsheet', 'No', 'Yes'] as [string, unknown, unknown]] : []),
  ])
}

function stayType(block: DayBlock): StayType | null {
  return block.days.find((d) => d.type)?.type ?? null
}

function stayChanges(existing: Stay, block: DayBlock): FieldChange[] {
  const sheetActivities = block.days.map((d) => d.activity)
  const appActivities = existing.days.map((d) => d.activity)
  const changes = compare([
    ['Days', existing.days.length, block.days.length],
    ['Type', existing.type, stayType(block)],
    ['Region (sheet)', existing.regionRaw, block.days[0].regionRaw],
  ])
  if (existing.days.length === block.days.length && appActivities.some((a, i) => a !== sheetActivities[i])) {
    const n = appActivities.filter((a, i) => a !== sheetActivities[i]).length
    changes.push({ field: 'Activities', from: `${n} day${n === 1 ? '' : 's'} differ`, to: 'from spreadsheet' })
  }
  if (!existing.chosenSite && block.days[0].chosenSite) changes.push({ field: 'Chosen site', from: '—', to: block.days[0].chosenSite })
  if (existing.status === 'Not booked' && block.days[0].bookingStatus !== 'Not booked') {
    changes.push({ field: 'Status', from: existing.status, to: block.days[0].bookingStatus })
  }
  if (existing.removedFromSheet) changes.push({ field: 'Back in spreadsheet', from: 'No', to: 'Yes' })
  return changes
}

export function planImport(current: CurrentData, parsed: ParsedWorkbook): ImportPlan {
  // ----- prep -----
  const sheetKeys = prepKeys(parsed.prepItems)
  const existingByKey = new Map(current.prepItems.filter((p) => p.sourceKey).map((p) => [p.sourceKey!, p]))
  const prep: ImportPlan['prep'] = { added: [], changed: [], removed: [], unchanged: 0 }
  parsed.prepItems.forEach((sheet, i) => {
    const key = sheetKeys[i]
    const existing = existingByKey.get(key)
    if (!existing) return void prep.added.push({ ...sheet, key })
    const changes = prepChanges(existing, sheet)
    if (changes.length) prep.changed.push({ existing, changes })
    else prep.unchanged++
  })
  const sheetKeySet = new Set(sheetKeys)
  prep.removed = current.prepItems.filter((p) => p.sourceKey && !sheetKeySet.has(p.sourceKey) && !p.removedFromSheet)

  // ----- stays -----
  const blocks = groupDays(parsed.days)
  const keys = blockKeys(blocks)
  const stayByKey = staysByKey(current)
  const stays: ImportPlan['stays'] = { added: [], changed: [], removed: [], unchanged: 0, movedBooked: [] }
  blocks.forEach((block, i) => {
    const existing = stayByKey.get(keys[i])
    if (!existing) return void stays.added.push(block)
    const changes = stayChanges(existing, block)
    if (changes.length) stays.changed.push({ existing, changes })
    else stays.unchanged++
  })
  const blockKeySet = new Set(keys)
  stays.removed = current.stays.filter((s) => s.sourceKey && !blockKeySet.has(s.sourceKey) && !s.removedFromSheet)

  const departure = parsed.departureDate && parsed.departureDate !== current.departureDate ? { from: current.departureDate, to: parsed.departureDate } : null
  const isFirstImport = current.prepItems.every((p) => !p.sourceKey) && current.stays.every((s) => !s.sourceKey)

  // Which booked stays would change dates? Compare spans before and after (using today's departure date).
  if (!isFirstImport) {
    const preview = applyImport(current, parsed, { now: '1970-01-01T00:00:00Z', newId: (k) => k, applyDeparture: false })
    const before = staySpans(current.stays, current.departureDate)
    const after = staySpans(preview.stays, current.departureDate)
    for (const s of preview.stays) {
      const b = before.get(s.id)
      const a = after.get(s.id)
      if (b && a && isBooked(s.status) && (b.startDate !== a.startDate || b.endDate !== a.endDate)) {
        stays.movedBooked.push({ stay: s, fromDate: b.startDate, toDate: a.startDate })
      }
    }
  }

  return { prep, stays, departure, isFirstImport }
}

export interface ApplyOptions {
  now: string
  newId: (key: string) => string
  /** Take the departure date from the spreadsheet. Always true on the first import. */
  applyDeparture: boolean
}

export interface ApplyResult {
  prepItems: PrepItem[]
  stays: Stay[]
  /** Stays no longer in the spreadsheet that hold booking details or notes; kept so nothing is lost. */
  archivedStays: Stay[]
  departureDate: IsoDate
}

function defaultRequirement(kind: Stay['kind'], type: StayType | null): BookingRequirement {
  if (kind === 'buffer') return 'No booking needed'
  if (type === 'Ferry crossing' || type === 'Hotel/cabin') return 'Must book'
  return 'Unknown'
}

function hasAppData(s: Stay): boolean {
  return s.status !== 'Not booked' || !!(s.bookingRef || s.cost !== null || s.notes || s.link || s.bookedVia || s.cancelBy || s.chosenSite)
}

export function applyImport(current: CurrentData, parsed: ParsedWorkbook, opts: ApplyOptions): ApplyResult {
  const audit = { updatedAt: opts.now, updatedBy: 'import' as const }

  // ----- prep -----
  const keys = prepKeys(parsed.prepItems)
  const byKey = new Map(current.prepItems.filter((p) => p.sourceKey).map((p) => [p.sourceKey!, p]))
  const sheetItems: PrepItem[] = parsed.prepItems.map((sheet, i) => {
    const existing = byKey.get(keys[i])
    const sheetFields = {
      sourceList: sheet.sourceList,
      item: sheet.item,
      category: sheet.category,
      plannedCost: sheet.plannedCost,
      include: sheet.include,
      priority: sheet.priority,
      buyBy: sheet.buyBy,
      sheetNotes: sheet.notes,
    }
    if (existing) {
      const changed = prepChanges(existing, sheet).length > 0
      return changed ? { ...existing, ...sheetFields, removedFromSheet: false, ...audit } : existing
    }
    return {
      id: opts.newId(keys[i]),
      sourceKey: keys[i],
      ...sheetFields,
      status: 'todo',
      actualCost: null,
      owner: null,
      notes: '',
      link: '',
      ...audit,
    }
  })
  const keySet = new Set(keys)
  const kept = current.prepItems
    .filter((p) => !p.sourceKey || !keySet.has(p.sourceKey))
    .map((p) => (p.sourceKey && !p.removedFromSheet ? { ...p, removedFromSheet: true, ...audit } : p))
  const prepItems = [...sheetItems, ...kept]

  // ----- stays -----
  const blocks = groupDays(parsed.days)
  const blockKeyList = blockKeys(blocks)
  const stayByKey = staysByKey(current)
  const fromSheet: Stay[] = blocks.map((block, i) => {
    const key = blockKeyList[i]
    const kind = isBufferBlock(block.baseCamp, block.days) ? 'buffer' : 'stay'
    const type = stayType(block)
    const sheetFields = {
      kind,
      baseCamp: block.baseCamp,
      type,
      regionRaw: block.days[0].regionRaw,
      days: block.days.map((d) => ({ activity: d.activity, buffer: d.buffer })),
    } satisfies Partial<Stay>
    const existing = stayByKey.get(key)
    if (existing) {
      if (stayChanges(existing, block).length === 0) return existing
      return {
        ...existing,
        ...sheetFields,
        chosenSite: existing.chosenSite || block.days[0].chosenSite,
        status: existing.status === 'Not booked' ? block.days[0].bookingStatus : existing.status,
        removedFromSheet: false,
        ...audit,
      }
    }
    return {
      id: opts.newId(key),
      sourceKey: key,
      ...sheetFields,
      chosenSite: block.days[0].chosenSite,
      bookingRequirement: defaultRequirement(kind, type),
      status: block.days[0].bookingStatus,
      bookingRef: '',
      cost: null,
      bookedVia: '',
      link: '',
      cancelBy: null,
      notes: '',
      ...audit,
    }
  })

  // Stays added in the app (no sourceKey) keep their place: after whichever stay came before them.
  const stays: Stay[] = [...fromSheet]
  current.stays.forEach((s, i) => {
    if (s.sourceKey) return
    const prevKey = current.stays.slice(0, i).reverse().find((p) => p.sourceKey)?.sourceKey
    const at = prevKey ? stays.findIndex((x) => x.sourceKey === prevKey) + 1 : 0
    stays.splice(at > 0 ? at : prevKey ? stays.length : 0, 0, s)
  })

  // Stays dropped from the spreadsheet leave the timeline. Any with our booking data are archived, not deleted.
  const blockKeySet = new Set(blockKeyList)
  const newlyArchived = current.stays
    .filter((s) => s.sourceKey && !blockKeySet.has(s.sourceKey) && hasAppData(s))
    .map((s) => ({ ...s, removedFromSheet: true, ...audit }))
  const archivedStays = [...(current.archivedStays ?? []).filter((a) => !blockKeySet.has(a.sourceKey ?? '')), ...newlyArchived]

  const departureDate = (opts.applyDeparture || current.prepItems.length + current.stays.length === 0) && parsed.departureDate ? parsed.departureDate : current.departureDate

  return { prepItems, stays, archivedStays, departureDate }
}

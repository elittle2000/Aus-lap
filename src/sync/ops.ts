import type { BudgetLine, ChangeEntry, LocationRef, PrepItem, Stay } from '../domain/types'
import type { IsoDate } from '../lib/dates'

// Works out which database rows to write after a local change, by comparing the
// app state before and after. Records are replaced (never mutated) on every edit,
// so "this object is a different object" means "this row changed".

export type Table = 'prep_items' | 'stays' | 'change_log' | 'app_settings'

export interface TripSettings {
  departureDate: IsoDate
  homeAddress: string
}

export interface LastImport {
  fileName: string
  at: string
  by: string
}

/** The part of the app state that is shared between phones. */
export interface SyncedState {
  prepItems: PrepItem[]
  stays: Stay[]
  archivedStays: Stay[]
  changes: ChangeEntry[]
  trip: TripSettings
  budgetLines: BudgetLine[]
  locations: LocationRef[]
  lastImport: LastImport | null
}

export type Row =
  | { table: 'prep_items'; id: string; data: PrepItem; deleted: boolean }
  | { table: 'stays'; id: string; position: number; archived: boolean; data: Stay; deleted: boolean }
  | { table: 'change_log'; id: string; at: string; data: ChangeEntry }
  | { table: 'app_settings'; key: 'trip' | 'budget_lines' | 'locations' | 'last_import'; data: unknown }

export const rowKey = (r: Row) => `${r.table}:${r.table === 'app_settings' ? r.key : r.id}`

/** Archived stays sit after the live ones, so position stays unique and route order is kept. */
export const ARCHIVE_OFFSET = 1_000_000

interface StayPlace {
  stay: Stay
  position: number
  archived: boolean
}

function stayPlaces(s: Pick<SyncedState, 'stays' | 'archivedStays'>): Map<string, StayPlace> {
  const m = new Map<string, StayPlace>()
  s.stays.forEach((stay, i) => m.set(stay.id, { stay, position: i, archived: false }))
  s.archivedStays.forEach((stay, i) => m.set(stay.id, { stay, position: ARCHIVE_OFFSET + i, archived: true }))
  return m
}

export function computeRows(prev: SyncedState, next: SyncedState): Row[] {
  const rows: Row[] = []

  // Prep items
  if (prev.prepItems !== next.prepItems) {
    const before = new Map(prev.prepItems.map((p) => [p.id, p]))
    for (const p of next.prepItems) if (before.get(p.id) !== p) rows.push({ table: 'prep_items', id: p.id, data: p, deleted: false })
    const now = new Set(next.prepItems.map((p) => p.id))
    for (const p of prev.prepItems) if (!now.has(p.id)) rows.push({ table: 'prep_items', id: p.id, data: p, deleted: true })
  }

  // Stays: a row changes if the stay changed, moved in the route, or was archived/restored.
  if (prev.stays !== next.stays || prev.archivedStays !== next.archivedStays) {
    const before = stayPlaces(prev)
    const after = stayPlaces(next)
    for (const [id, a] of after) {
      const b = before.get(id)
      if (!b || b.stay !== a.stay || b.position !== a.position || b.archived !== a.archived) {
        rows.push({ table: 'stays', id, position: a.position, archived: a.archived, data: a.stay, deleted: false })
      }
    }
    for (const [id, b] of before) {
      if (!after.has(id)) rows.push({ table: 'stays', id, position: b.position, archived: b.archived, data: b.stay, deleted: true })
    }
  }

  // Change log: append-only, so only new entries.
  if (prev.changes !== next.changes) {
    const seen = new Set(prev.changes.map((c) => c.id))
    for (const c of next.changes) if (!seen.has(c.id)) rows.push({ table: 'change_log', id: c.id, at: c.at, data: c })
  }

  if (prev.trip.departureDate !== next.trip.departureDate || prev.trip.homeAddress !== next.trip.homeAddress) {
    rows.push({ table: 'app_settings', key: 'trip', data: next.trip })
  }
  if (prev.budgetLines !== next.budgetLines) rows.push({ table: 'app_settings', key: 'budget_lines', data: next.budgetLines })
  if (prev.locations !== next.locations) rows.push({ table: 'app_settings', key: 'locations', data: next.locations })
  if (prev.lastImport !== next.lastImport && next.lastImport) rows.push({ table: 'app_settings', key: 'last_import', data: next.lastImport })

  return rows
}

/** Everything, as rows: used for the first upload of a phone's data. */
export function allRows(s: SyncedState): Row[] {
  const empty: SyncedState = { prepItems: [], stays: [], archivedStays: [], changes: [], trip: { departureDate: '', homeAddress: '' }, budgetLines: [], locations: [], lastImport: null }
  return computeRows(empty, s)
}

// ---------- applying rows from the database ----------

export interface DbRows {
  prep_items: { id: string; data: PrepItem; deleted: boolean; updated_at: string }[]
  stays: { id: string; position: number; archived: boolean; data: Stay; deleted: boolean; updated_at: string }[]
  change_log: { id: string; at: string; data: ChangeEntry; updated_by: string }[]
  app_settings: { key: string; data: unknown }[]
}

/**
 * Build the shared state from database rows. Rows still waiting to upload from
 * this phone (pending) win over what the database says, so an offline edit
 * isn't undone by a refresh.
 */
export function stateFromRows(db: DbRows, pending: Row[], fallback: SyncedState): SyncedState {
  const prep = new Map(db.prep_items.map((r) => [r.id, { data: { ...r.data, updatedAt: r.updated_at }, deleted: r.deleted }]))
  const stays = new Map(db.stays.map((r) => [r.id, { data: { ...r.data, updatedAt: r.updated_at }, position: r.position, archived: r.archived, deleted: r.deleted }]))
  const changes = new Map(db.change_log.map((r) => [r.id, r.data]))
  const settings = new Map(db.app_settings.map((r) => [r.key, r.data]))

  for (const p of pending) {
    if (p.table === 'prep_items') prep.set(p.id, { data: p.data, deleted: p.deleted })
    else if (p.table === 'stays') stays.set(p.id, { data: p.data, position: p.position, archived: p.archived, deleted: p.deleted })
    else if (p.table === 'change_log') changes.set(p.id, p.data)
    else settings.set(p.key, p.data)
  }

  const liveStays = [...stays.values()].filter((s) => !s.deleted).sort((a, b) => a.position - b.position)
  return {
    prepItems: [...prep.values()].filter((p) => !p.deleted).map((p) => p.data),
    stays: liveStays.filter((s) => !s.archived).map((s) => s.data),
    archivedStays: liveStays.filter((s) => s.archived).map((s) => s.data),
    changes: [...changes.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    trip: { ...fallback.trip, ...((settings.get('trip') as TripSettings | undefined) ?? {}) },
    budgetLines: (settings.get('budget_lines') as BudgetLine[] | undefined) ?? fallback.budgetLines,
    locations: (settings.get('locations') as LocationRef[] | undefined) ?? fallback.locations,
    lastImport: (settings.get('last_import') as LastImport | undefined) ?? fallback.lastImport,
  }
}

/** Row in the shape the database expects. */
export function toDbRecord(r: Row): Record<string, unknown> {
  switch (r.table) {
    case 'prep_items':
      return { id: r.id, data: r.data, deleted: r.deleted }
    case 'stays':
      return { id: r.id, position: r.position, archived: r.archived, data: r.data, deleted: r.deleted }
    case 'change_log':
      return { id: r.id, at: r.at, data: r.data }
    case 'app_settings':
      return { key: r.key, data: r.data }
  }
}

/** The phone's current state, in database-row form (so incoming rows can be laid over it). */
export function rowsFromState(s: SyncedState): DbRows {
  const places = stayPlaces(s)
  return {
    prep_items: s.prepItems.map((p) => ({ id: p.id, data: p, deleted: false, updated_at: p.updatedAt })),
    stays: [...places.entries()].map(([id, p]) => ({ id, position: p.position, archived: p.archived, data: p.stay, deleted: false, updated_at: p.stay.updatedAt })),
    change_log: s.changes.map((c) => ({ id: c.id, at: c.at, data: c, updated_by: String(c.by) })),
    app_settings: [
      { key: 'trip', data: s.trip },
      { key: 'budget_lines', data: s.budgetLines },
      { key: 'locations', data: s.locations },
      ...(s.lastImport ? [{ key: 'last_import', data: s.lastImport }] : []),
    ],
  }
}

/** Lay database rows that just arrived over the phone's current state. */
export function mergeIncoming(current: SyncedState, incoming: Partial<DbRows>, pending: Row[]): SyncedState {
  const base = rowsFromState(current)
  const overlay = <T extends { id?: string; key?: string }>(rows: T[], extra: T[] | undefined): T[] => {
    if (!extra?.length) return rows
    const k = (r: T) => r.id ?? r.key!
    const m = new Map(rows.map((r) => [k(r), r]))
    for (const r of extra) m.set(k(r), r)
    return [...m.values()]
  }
  return stateFromRows(
    {
      prep_items: overlay(base.prep_items, incoming.prep_items),
      stays: overlay(base.stays, incoming.stays),
      change_log: overlay(base.change_log, incoming.change_log),
      app_settings: overlay(base.app_settings, incoming.app_settings),
    },
    pending,
    current,
  )
}

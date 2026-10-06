import { describe, expect, it } from 'vitest'
import { ARCHIVE_OFFSET, allRows, computeRows, mergeIncoming, rowsFromState, stateFromRows, type Row, type SyncedState } from './ops'
import type { PrepItem, Stay } from '../domain/types'

const prep = (id: string, p: Partial<PrepItem> = {}): PrepItem => ({
  id, sourceKey: null, sourceList: null, item: id, category: '', plannedCost: null, include: true, priority: null, buyBy: null,
  sheetNotes: '', status: 'todo', actualCost: null, owner: null, notes: '', link: '', updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'ethan', ...p,
})
const stay = (id: string, p: Partial<Stay> = {}): Stay => ({
  id, sourceKey: null, kind: 'stay', baseCamp: id, type: null, regionRaw: null, days: [{ activity: '', buffer: false }], chosenSite: '',
  bookingRequirement: 'Unknown', status: 'Not booked', bookingRef: '', cost: null, bookedVia: '', link: '', cancelBy: null, notes: '',
  updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'ethan', ...p,
})
const base = (): SyncedState => ({
  prepItems: [prep('a'), prep('b')],
  stays: [stay('s1'), stay('s2'), stay('s3')],
  archivedStays: [],
  changes: [],
  trip: { departureDate: '2027-05-31', homeAddress: '' },
  budgetLines: [],
  locations: [],
  lastImport: null,
})
const keys = (rows: Row[]) => rows.map((r) => (r.table === 'app_settings' ? `${r.table}:${r.key}` : `${r.table}:${r.id}${'deleted' in r && r.deleted ? ' (deleted)' : ''}`))

describe('computeRows', () => {
  it('nothing changed → nothing to upload', () => {
    const s = base()
    expect(computeRows(s, { ...s })).toEqual([])
  })

  it('an edited prep item uploads just that item', () => {
    const s = base()
    const next = { ...s, prepItems: [s.prepItems[0], { ...s.prepItems[1], status: 'done' as const }] }
    expect(keys(computeRows(s, next))).toEqual(['prep_items:b'])
  })

  it('a removed item is uploaded as a soft delete', () => {
    const s = base()
    expect(keys(computeRows(s, { ...s, prepItems: [s.prepItems[0]] }))).toEqual(['prep_items:b (deleted)'])
  })

  it('removing a stay re-numbers the stays after it', () => {
    const s = base()
    const rows = computeRows(s, { ...s, stays: [s.stays[0], s.stays[2]] })
    expect(keys(rows)).toEqual(['stays:s3', 'stays:s2 (deleted)'])
    expect(rows.find((r) => r.table === 'stays' && r.id === 's3')).toMatchObject({ position: 1 })
  })

  it('archiving a stay moves it to the archive positions', () => {
    const s = base()
    const rows = computeRows(s, { ...s, stays: [s.stays[0], s.stays[1]], archivedStays: [s.stays[2]] })
    expect(rows).toEqual([expect.objectContaining({ table: 'stays', id: 's3', archived: true, position: ARCHIVE_OFFSET, deleted: false })])
  })

  it('only new change-log entries are sent', () => {
    const s = { ...base(), changes: [{ id: 'c1', at: '1', by: 'ethan' as const, entity: 'prep' as const, entityId: null, summary: 'x' }] }
    const next = { ...s, changes: [{ ...s.changes[0], id: 'c2', at: '2' }, ...s.changes] }
    expect(keys(computeRows(s, next))).toEqual(['change_log:c2'])
  })

  it('settings rows go up only when they change', () => {
    const s = base()
    expect(keys(computeRows(s, { ...s, trip: { ...s.trip } }))).toEqual([])
    expect(keys(computeRows(s, { ...s, trip: { ...s.trip, departureDate: '2027-06-01' } }))).toEqual(['app_settings:trip'])
    expect(keys(computeRows(s, { ...s, budgetLines: [{ category: 'Fuel', monthly: 550 }] }))).toEqual(['app_settings:budget_lines'])
  })

  it('allRows uploads everything for a first sync', () => {
    expect(keys(allRows(base()))).toEqual(['prep_items:a', 'prep_items:b', 'stays:s1', 'stays:s2', 'stays:s3', 'app_settings:trip', 'app_settings:budget_lines', 'app_settings:locations'])
  })
})

describe('stateFromRows / mergeIncoming', () => {
  it('round-trips the state through database rows, keeping route order', () => {
    const s = { ...base(), archivedStays: [stay('old')] }
    const back = stateFromRows(rowsFromState(s), [], s)
    expect(back.stays.map((x) => x.id)).toEqual(['s1', 's2', 's3'])
    expect(back.archivedStays.map((x) => x.id)).toEqual(['old'])
    expect(back.prepItems.map((x) => x.id)).toEqual(['a', 'b'])
    expect(back.trip).toEqual(s.trip)
  })

  it("applies the other phone's change", () => {
    const s = base()
    const merged = mergeIncoming(s, { prep_items: [{ id: 'b', data: prep('b', { status: 'done', updatedBy: 'dana' }), deleted: false, updated_at: '2026-10-06T01:00:00Z' }] }, [])
    expect(merged.prepItems.find((p) => p.id === 'b')).toMatchObject({ status: 'done', updatedBy: 'dana', updatedAt: '2026-10-06T01:00:00Z' })
  })

  it("applies the other phone's delete and reorder", () => {
    const s = base()
    const merged = mergeIncoming(
      s,
      {
        stays: [
          { id: 's1', position: 0, archived: false, data: s.stays[0], deleted: true, updated_at: '' },
          { id: 's3', position: 0, archived: false, data: s.stays[2], deleted: false, updated_at: '' },
          { id: 'new', position: 1, archived: false, data: stay('new'), deleted: false, updated_at: '' },
          { id: 's2', position: 2, archived: false, data: s.stays[1], deleted: false, updated_at: '' },
        ],
      },
      [],
    )
    expect(merged.stays.map((x) => x.id)).toEqual(['s3', 'new', 's2'])
  })

  it('changes still waiting to upload from this phone win over incoming ones', () => {
    const s = base()
    const mine = prep('b', { status: 'ordered' })
    const merged = mergeIncoming(s, { prep_items: [{ id: 'b', data: prep('b', { status: 'dropped' }), deleted: false, updated_at: '' }] }, [{ table: 'prep_items', id: 'b', data: mine, deleted: false }])
    expect(merged.prepItems.find((p) => p.id === 'b')!.status).toBe('ordered')
  })

  it('newest change-log entries come first', () => {
    const s = base()
    const merged = mergeIncoming(s, { change_log: [{ id: 'x', at: '2026-10-06T00:00:00Z', data: { id: 'x', at: '2026-10-06T00:00:00Z', by: 'dana', entity: 'prep', entityId: null, summary: 'later' }, updated_by: 'dana' }, { id: 'y', at: '2026-10-05T00:00:00Z', data: { id: 'y', at: '2026-10-05T00:00:00Z', by: 'dana', entity: 'prep', entityId: null, summary: 'earlier' }, updated_by: 'dana' }] }, [])
    expect(merged.changes.map((c) => c.summary)).toEqual(['later', 'earlier'])
  })
})

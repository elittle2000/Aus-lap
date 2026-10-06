import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { IsoDate } from './lib/dates'
import type { BudgetLine, ChangeEntry, LocationRef, Person, PersonId, PrepItem, Stay } from './domain/types'
import { PREP_STATUS_LABEL } from './domain/types'
import { resizeStay, type ResizeMode } from './domain/stays'
import { applyImport } from './import/diff'
import type { ParsedWorkbook } from './import/parseWorkbook'

// Step 2: data lives in this browser only (localStorage).
// Step 3 swaps this for the shared Supabase database; the shapes stay the same.

export interface Settings {
  departureDate: IsoDate
  people: Person[]
  /** Who is using this device. Replaced by real sign-in in step 3. */
  me: PersonId
  /** Starting point for the map (kept on-device, never in the code). */
  homeAddress: string
}

interface State {
  settings: Settings
  prepItems: PrepItem[]
  stays: Stay[]
  archivedStays: Stay[]
  budgetLines: BudgetLine[]
  locations: LocationRef[]
  changes: ChangeEntry[]
  lastImport: { fileName: string; at: string; by: PersonId } | null
}

interface Actions {
  updatePrep: (id: string, patch: Partial<PrepItem>) => void
  addPrep: (item: Omit<PrepItem, 'id' | 'sourceKey' | 'updatedAt' | 'updatedBy'>) => string
  deletePrep: (id: string) => void
  updateStay: (id: string, patch: Partial<Stay>) => void
  resizeStay: (id: string, length: number, mode: ResizeMode) => string | null
  deleteArchivedStay: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  importWorkbook: (parsed: ParsedWorkbook, fileName: string, applyDeparture: boolean) => void
  resetAll: () => void
}

const initial: State = {
  settings: {
    departureDate: '2027-05-31',
    people: [
      { id: 'ethan', name: 'Ethan' },
      { id: 'dana', name: 'Dana' },
    ],
    me: 'ethan',
    homeAddress: '',
  },
  prepItems: [],
  stays: [],
  archivedStays: [],
  budgetLines: [],
  locations: [],
  changes: [],
  lastImport: null,
}

const MAX_CHANGES = 300
const now = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  actualCost: 'actual cost',
  owner: 'who',
  notes: 'notes',
  link: 'link',
  chosenSite: 'chosen site',
  bookingRequirement: 'booking need',
  bookingRef: 'booking ref',
  cost: 'cost',
  bookedVia: 'booked via',
  cancelBy: 'cancel-by date',
  item: 'name',
  category: 'category',
  plannedCost: 'planned cost',
  priority: 'priority',
  buyBy: 'buy-by date',
}

function describe(name: string, patch: Record<string, unknown>, people: Person[]): string {
  const parts = Object.entries(patch).map(([k, v]) => {
    const label = FIELD_LABEL[k] ?? k
    if (k === 'status' && typeof v === 'string' && v in PREP_STATUS_LABEL) return `marked ${PREP_STATUS_LABEL[v as keyof typeof PREP_STATUS_LABEL]}`
    if (k === 'status') return `marked ${v}`
    if (k === 'owner') return v ? `assigned to ${people.find((p) => p.id === v)?.name ?? v}` : 'unassigned'
    return `changed ${label}`
  })
  return `${name}: ${parts.join(', ')}`
}

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => {
      const log = (entry: Omit<ChangeEntry, 'at' | 'by'>, by: ChangeEntry['by'] = get().settings.me): ChangeEntry[] =>
        [{ ...entry, at: now(), by }, ...get().changes].slice(0, MAX_CHANGES)

      return {
        ...initial,

        updatePrep: (id, patch) => {
          const item = get().prepItems.find((p) => p.id === id)
          if (!item) return
          const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => item[k as keyof PrepItem] !== v))
          if (!Object.keys(changed).length) return
          set({
            prepItems: get().prepItems.map((p) => (p.id === id ? { ...p, ...changed, updatedAt: now(), updatedBy: get().settings.me } : p)),
            changes: log({ entity: 'prep', entityId: id, summary: describe(item.item, changed, get().settings.people) }),
          })
        },

        addPrep: (fields) => {
          const id = newId()
          set({
            prepItems: [...get().prepItems, { ...fields, id, sourceKey: null, updatedAt: now(), updatedBy: get().settings.me }],
            changes: log({ entity: 'prep', entityId: id, summary: `Added ${fields.item}` }),
          })
          return id
        },

        deletePrep: (id) => {
          const item = get().prepItems.find((p) => p.id === id)
          if (!item) return
          set({ prepItems: get().prepItems.filter((p) => p.id !== id), changes: log({ entity: 'prep', entityId: id, summary: `Deleted ${item.item}` }) })
        },

        updateStay: (id, patch) => {
          const stay = get().stays.find((s) => s.id === id)
          if (!stay) return
          const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => stay[k as keyof Stay] !== v))
          if (!Object.keys(changed).length) return
          set({
            stays: get().stays.map((s) => (s.id === id ? { ...s, ...changed, updatedAt: now(), updatedBy: get().settings.me } : s)),
            changes: log({ entity: 'stay', entityId: id, summary: describe(stay.baseCamp, changed, get().settings.people) }),
          })
        },

        resizeStay: (id, length, mode) => {
          const stay = get().stays.find((s) => s.id === id)
          if (!stay) return 'That stay no longer exists.'
          const r = resizeStay(get().stays, id, length, mode)
          if (r.problem) return r.problem
          const me = get().settings.me
          const stays = r.stays.map((s) => (s.id === id || s.id === r.absorbedBy ? { ...s, updatedAt: now(), updatedBy: me } : s))
          const how = mode === 'absorb' ? ' (days taken from / given to the next buffer)' : r.tripLengthChange ? `; trip is now ${r.tripLengthChange > 0 ? '+' : ''}${r.tripLengthChange} days` : ''
          set({ stays, changes: log({ entity: 'stay', entityId: id, summary: `${stay.baseCamp}: ${stay.days.length} → ${length} days${how}` }) })
          return null
        },

        deleteArchivedStay: (id) => set({ archivedStays: get().archivedStays.filter((s) => s.id !== id) }),

        updateSettings: (patch) => {
          const s = get().settings
          const changes = patch.departureDate && patch.departureDate !== s.departureDate ? log({ entity: 'settings', entityId: null, summary: `Departure date changed to ${patch.departureDate}` }) : get().changes
          set({ settings: { ...s, ...patch }, changes })
        },

        importWorkbook: (parsed, fileName, applyDeparture) => {
          const state = get()
          const result = applyImport(
            { prepItems: state.prepItems, stays: state.stays, archivedStays: state.archivedStays, departureDate: state.settings.departureDate },
            parsed,
            { now: now(), newId: () => newId(), applyDeparture },
          )
          set({
            prepItems: result.prepItems,
            stays: result.stays,
            archivedStays: result.archivedStays,
            budgetLines: parsed.budgetLines,
            locations: parsed.locations,
            settings: { ...state.settings, departureDate: result.departureDate },
            lastImport: { fileName, at: now(), by: state.settings.me },
            changes: log({ entity: 'import', entityId: null, summary: `Imported ${fileName}` }),
          })
        },

        resetAll: () => set({ ...initial, settings: { ...initial.settings, me: get().settings.me } }),
      }
    },
    { name: 'big-lap', version: 1 },
  ),
)

export const useMe = () => useStore((s) => s.settings.me)
export const personName = (people: Person[], id: string | null | undefined) => (id === 'import' ? 'Spreadsheet import' : (people.find((p) => p.id === id)?.name ?? '—'))

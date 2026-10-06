import type { IsoDate } from '../lib/dates'
import type { GeoPoint } from '../map/geocode'

export type PersonId = 'ethan' | 'dana'

export interface Person {
  id: PersonId
  name: string
}

/** Who changed a record and when. Every editable record carries this. */
export interface Audit {
  updatedAt: string // ISO timestamp
  updatedBy: PersonId | 'import'
}

// ---------- Prep checklist ----------

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PREP_STATUSES = ['todo', 'ordered', 'done', 'dropped'] as const
export type PrepStatus = (typeof PREP_STATUSES)[number]

export const PREP_STATUS_LABEL: Record<PrepStatus, string> = {
  todo: 'To do',
  ordered: 'Ordered / booked in',
  done: 'Done',
  dropped: 'Dropped',
}

export interface PrepItem extends Audit {
  id: string
  /** Stable match key for re-imports; null for items added in the app. */
  sourceKey: string | null
  /** Spreadsheet section heading, e.g. "FROM 'PRE-TRIP TO-DO'". */
  sourceList: string | null
  // Spreadsheet-owned fields (updated by re-import)
  item: string
  category: string
  plannedCost: number | null
  include: boolean
  priority: Priority | null
  buyBy: IsoDate | null
  sheetNotes: string
  // App-owned fields (never touched by re-import)
  status: PrepStatus
  actualCost: number | null
  owner: PersonId | null
  notes: string
  link: string
  /** Receipt photos, as paths in the shared file storage. */
  receipts?: string[]
  /** Set when a re-import no longer finds this row in the spreadsheet. */
  removedFromSheet?: boolean
}

// ---------- Stays ----------

export const STAY_TYPES = ['Camping', 'Hotel/cabin', 'Ferry crossing', 'Other'] as const
export type StayType = (typeof STAY_TYPES)[number]

export const BOOKING_STATUSES = ['Not booked', 'Researching', 'Booked', 'Confirmed'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const BOOKING_REQUIREMENTS = ['Must book', 'Recommended', 'No booking needed', 'Unknown'] as const
export type BookingRequirement = (typeof BOOKING_REQUIREMENTS)[number]

export interface StayDay {
  activity: string
  /** Day was flagged "Buffer day?" in the spreadsheet. */
  buffer: boolean
}

export interface Stay extends Audit {
  id: string
  sourceKey: string | null
  /** 'buffer' blocks are flexible days, not places. */
  kind: 'stay' | 'buffer'
  baseCamp: string
  type: StayType | null
  regionRaw: string | null
  days: StayDay[]
  chosenSite: string
  bookingRequirement: BookingRequirement
  status: BookingStatus
  bookingRef: string
  cost: number | null
  bookedVia: string
  link: string
  cancelBy: IsoDate | null
  notes: string
  /** Map position, looked up once from the base camp name (or set by hand). */
  geo?: GeoPoint | null
  removedFromSheet?: boolean
}

export interface BudgetLine {
  category: string
  monthly: number
}

export interface LocationRef {
  baseCamp: string
  region: string | null
  generalLocation: string | null
}

export interface ChangeEntry {
  id: string
  at: string
  by: PersonId | 'import'
  entity: 'prep' | 'stay' | 'settings' | 'import'
  entityId: string | null
  summary: string
}

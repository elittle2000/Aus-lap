import * as XLSX from 'xlsx'
import type { BudgetLine, ChangeEntry, Person, PrepItem, Stay } from '../domain/types'
import { PREP_STATUS_LABEL } from '../domain/types'
import { staySpans } from '../domain/stays'
import { tripDayDate, type IsoDate } from './dates'

// One-click export of everything to an Excel workbook, so the data is never locked in.

interface ExportInput {
  departureDate: IsoDate
  people: Person[]
  prepItems: PrepItem[]
  stays: Stay[]
  archivedStays: Stay[]
  budgetLines: BudgetLine[]
  changes: ChangeEntry[]
}

export function buildExport(d: ExportInput): XLSX.WorkBook {
  const name = (id: string | null) => (id === 'import' ? 'Import' : (d.people.find((p) => p.id === id)?.name ?? ''))
  const spans = staySpans(d.stays, d.departureDate)
  const wb = XLSX.utils.book_new()
  const add = (title: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), title)

  add(
    'Prep',
    d.prepItems.map((i) => ({
      Item: i.item,
      Category: i.category,
      Section: i.sourceList ?? 'Added in app',
      'Planned ($)': i.plannedCost,
      'Include?': i.include ? 'Yes' : 'No',
      Priority: i.priority,
      'Buy by': i.buyBy,
      Status: PREP_STATUS_LABEL[i.status],
      'Actual ($)': i.actualCost,
      Who: name(i.owner),
      Notes: i.notes,
      'Spreadsheet notes': i.sheetNotes,
      Link: i.link,
      'In spreadsheet?': i.sourceKey ? (i.removedFromSheet ? 'Removed' : 'Yes') : 'No',
      'Last changed': i.updatedAt,
      'Changed by': name(i.updatedBy),
    })),
  )

  add(
    'Stays',
    d.stays.map((s) => {
      const sp = spans.get(s.id)!
      return {
        'Start day': sp.startDay,
        'Start date': sp.startDate,
        'End date': sp.endDate,
        Nights: sp.nights,
        'Base camp': s.kind === 'buffer' ? 'Buffer / flexible days' : s.baseCamp,
        Type: s.type,
        'Chosen site': s.chosenSite,
        'Needs booking?': s.bookingRequirement,
        Status: s.status,
        'Booking ref': s.bookingRef,
        'Cost ($)': s.cost,
        'Booked via': s.bookedVia,
        Link: s.link,
        'Cancel by': s.cancelBy,
        Notes: s.notes,
        'Last changed': s.updatedAt,
        'Changed by': name(s.updatedBy),
      }
    }),
  )

  const days: Record<string, unknown>[] = []
  for (const s of d.stays) {
    const sp = spans.get(s.id)!
    s.days.forEach((day, i) =>
      days.push({ 'Day #': sp.startDay + i, Date: tripDayDate(d.departureDate, sp.startDay + i), 'Base camp': s.baseCamp, Activity: day.activity, 'Buffer day?': day.buffer ? 'Yes' : 'No', Status: s.status }),
    )
  }
  add('Days', days)

  if (d.archivedStays.length) add('Removed stays', d.archivedStays.map((s) => ({ 'Base camp': s.baseCamp, Status: s.status, 'Booking ref': s.bookingRef, 'Cost ($)': s.cost, Notes: s.notes })))
  add('On-road budget', d.budgetLines.map((l) => ({ Category: l.category, 'Per month ($)': l.monthly })))
  add('Change log', d.changes.map((c) => ({ When: c.at, Who: name(c.by), What: c.summary })))
  return wb
}

export function downloadExport(d: ExportInput) {
  XLSX.writeFile(buildExport(d), `big-lap-export-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true })
}

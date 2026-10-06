import * as XLSX from 'xlsx'

// Builds a small workbook laid out like the real one, for tests. Not used by the app.

type Row = (string | number | boolean | null)[]

/** Excel serial for a 'YYYY-MM-DD' date. */
export const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000

export interface FixtureDay {
  camp: string
  type?: string | null
  activity?: string
  buffer?: boolean
  region?: string
  site?: string
  status?: string
}

export interface FixtureOptions {
  departure?: string
  prep?: Row[] // rows from column B: [item, category, cost, include, priority, buyBy(serial), notes]
  days?: FixtureDay[]
}

export const defaultPrep: Row[] = [
  ["FROM 'PRE-TRIP TO-DO'"],
  ['Timing belt', 'Vehicle', 1200, 'Yes', 'Critical', serial('2026-09-01'), null],
  ['Lithium battery', 'Vehicle', 1700, 'Yes', 'High', serial('2026-12-01'), 'shop around'],
  ['Camp chairs', 'Camp setup', 200, 'Yes', 'Medium', serial('2026-10-01'), null],
  ['CAR PREP — duplicates'],
  ['Timing belt (dup)', 'Vehicle', 1200, 'No', 'Critical', serial('2026-09-01'), null],
]

export const defaultDays: FixtureDay[] = [
  { camp: "Fraser Island (K'gari)", type: 'Camping', activity: 'Barge', region: 'QLD/NSW' },
  { camp: "Fraser Island (K'gari)", type: 'Camping', activity: 'Beach' },
  { camp: 'Byron Bay', type: 'Camping', activity: 'Lighthouse' },
  { camp: 'Buffer / flexible day', type: null, buffer: true, activity: 'Unplanned' },
  { camp: 'Buffer / flexible day', type: null, buffer: true, activity: 'Unplanned' },
  { camp: 'Spirit of Tasmania crossing', type: 'Ferry crossing', activity: 'Board' },
  { camp: 'STOP & EARN: Camp host - Cape Range NP', type: 'Other', buffer: true, activity: 'Host' },
  { camp: 'STOP & EARN: Camp host - Cape Range NP', type: null, buffer: true, activity: 'Host' },
  { camp: 'Buffer / flexible day', type: null, buffer: true, activity: 'Unplanned' },
]

export function buildWorkbook(opts: FixtureOptions = {}): Uint8Array {
  const departure = opts.departure ?? '2027-05-31'
  const prep = opts.prep ?? defaultPrep
  const days = opts.days ?? defaultDays
  const wb = XLSX.utils.book_new()

  const prepRows: Row[] = [
    ['Pre-departure Costs'],
    ['Merged from the planner'],
    [],
    [null, 'Item', 'Category', 'Cost ($)', 'Include?', 'Priority', 'Buy by', 'Notes'],
    ...prep.map((r) => [null, ...r]),
    [],
    [null, 'TOTAL TO SPEND BEFORE DEPARTURE', null, 99999],
    [null, 'Critical', 14200],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prepRows), 'Pre-departure Costs')

  const itin: Row[] = [
    ['Day by day itinerary'],
    ['Edit freely'],
    ['Dates are driven by departure'],
    ['Day #', 'Date', 'Month label', 'Region', 'Base camp / area', 'Type', 'Activity / notes', 'Buffer day?', 'Chosen site / property', 'Booking status', null, 'LOCATIONS REFERENCE', null, null],
  ]
  days.forEach((d, i) => {
    itin.push([i + 1, serial(departure) + i, 'Jan 1999', d.region ?? null, d.camp, d.type ?? null, d.activity ?? '', d.buffer ?? false, d.site ?? null, d.status ?? 'Not booked'])
  })
  // Locations reference sits beside the itinerary in L–N; its own header is on the first data row (Excel row 5).
  const refs: Row[] = [
    ['Base camp / area', 'Region', 'General location'],
    ["Fraser Island (K'gari)", 'QLD/NSW', 'Via River Heads barge'],
    ['Byron Bay', 'NSW', 'Far north coast'],
  ]
  refs.forEach((r, i) => {
    const row = (itin[4 + i] ??= [])
    while (row.length < 11) row.push(null)
    row.splice(11, 3, ...r)
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(itin), 'Itinerary')

  const lap: Row[] = [
    ['Combined Lap Budget'],
    [],
    [],
    [null, 'THE POT'],
    [null, 'Your lap fund at departure', 28626],
    [],
    [null, 'Category', 'Per month', serial('2027-06-01')],
    [null, 'Fuel', 550, 550],
    [null, 'Camp fees & parks', 450, 450],
    [null, 'Activities, tours & park passes', 300, 300],
    [null, 'TOTAL COMBINED SPEND', 1300, 1300],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lap), 'Lap Budget')

  const inputs: Row[] = [['Inputs'], [], [null, 'Take-home pay', 9999], [null, 'Departure — lap begins', serial(departure)]]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inputs), 'Inputs & Assumptions')

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

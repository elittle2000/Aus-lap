import { describe, expect, it } from 'vitest'
import { applyImport, planImport, type CurrentData } from './diff'
import { parseWorkbook, readWorkbook } from './parseWorkbook'
import { buildWorkbook, defaultDays, defaultPrep, serial } from './fixtureWorkbook'
import { staySpans } from '../domain/stays'

const parse = (bytes: Uint8Array) => parseWorkbook(readWorkbook(bytes))
const empty: CurrentData = { prepItems: [], stays: [], departureDate: '2027-05-31' }
const opts = { now: '2026-10-06T00:00:00Z', newId: (k: string) => `id-${k}`, applyDeparture: false }

function firstImport() {
  const parsed = parse(buildWorkbook())
  const result = applyImport(empty, parsed, opts)
  return { parsed, current: { ...result } as CurrentData }
}

describe('first import', () => {
  it('everything is new', () => {
    const plan = planImport(empty, parse(buildWorkbook()))
    expect(plan.isFirstImport).toBe(true)
    expect(plan.prep.added).toHaveLength(4)
    expect(plan.stays.added).toHaveLength(6)
  })

  it('sets sensible defaults', () => {
    const { current } = firstImport()
    expect(current.prepItems[0]).toMatchObject({ status: 'todo', actualCost: null, owner: null, updatedBy: 'import' })
    const req = Object.fromEntries(current.stays.map((s) => [s.baseCamp, [s.kind, s.bookingRequirement]]))
    expect(req['Buffer / flexible day']).toEqual(['buffer', 'No booking needed'])
    expect(req['Spirit of Tasmania crossing']).toEqual(['stay', 'Must book'])
    expect(req['STOP & EARN: Camp host - Cape Range NP']).toEqual(['stay', 'Unknown'])
    expect(req['Byron Bay']).toEqual(['stay', 'Unknown'])
  })
})

describe('re-import', () => {
  it('an identical workbook changes nothing', () => {
    const { current, parsed } = firstImport()
    const plan = planImport(current, parsed)
    expect(plan.prep).toMatchObject({ added: [], changed: [], removed: [], unchanged: 4 })
    expect(plan.stays).toMatchObject({ added: [], changed: [], removed: [], unchanged: 6, movedBooked: [] })
  })

  it('never overwrites status, actual cost, owner or notes entered in the app', () => {
    const { current } = firstImport()
    current.prepItems[0] = { ...current.prepItems[0], status: 'done', actualCost: 1350, owner: 'dana', notes: 'Paid at Toyota', link: 'https://x' }
    // The spreadsheet changes this item's cost and buy-by date.
    const prep = defaultPrep.map((r) => (r[0] === 'Timing belt' ? ['Timing belt', 'Vehicle', 1400, 'Yes', 'Critical', serial('2026-11-01'), null] : r))
    const parsed = parse(buildWorkbook({ prep }))
    const plan = planImport(current, parsed)
    expect(plan.prep.changed).toHaveLength(1)
    expect(plan.prep.changed[0].changes).toEqual([
      { field: 'Cost', from: '1200', to: '1400' },
      { field: 'Buy by', from: '2026-09-01', to: '2026-11-01' },
    ])
    const result = applyImport(current, parsed, opts)
    expect(result.prepItems[0]).toMatchObject({ plannedCost: 1400, buyBy: '2026-11-01', status: 'done', actualCost: 1350, owner: 'dana', notes: 'Paid at Toyota', link: 'https://x' })
  })

  it('matches rows by name, so an inserted row is one addition, not a cascade of changes', () => {
    const { current } = firstImport()
    const prep = [defaultPrep[0], ['New: mail redirection', 'Admin', 90, 'Yes', 'High', serial('2027-05-01'), null], ...defaultPrep.slice(1)]
    const plan = planImport(current, parse(buildWorkbook({ prep })))
    expect(plan.prep.added.map((a) => a.item)).toEqual(['New: mail redirection'])
    expect(plan.prep.changed).toEqual([])
    expect(plan.prep.unchanged).toBe(4)
  })

  it('a row deleted from the spreadsheet is flagged, not deleted, and is never counted', () => {
    const { current } = firstImport()
    current.prepItems[1] = { ...current.prepItems[1], status: 'ordered', notes: 'ordered from X' }
    const prep = defaultPrep.filter((r) => r[0] !== 'Lithium battery')
    const parsed = parse(buildWorkbook({ prep }))
    expect(planImport(current, parsed).prep.removed.map((p) => p.item)).toEqual(['Lithium battery'])
    const result = applyImport(current, parsed, opts)
    const kept = result.prepItems.find((p) => p.item === 'Lithium battery')!
    expect(kept).toMatchObject({ removedFromSheet: true, status: 'ordered', notes: 'ordered from X' })
    // Re-importing again doesn't report it twice.
    expect(planImport({ ...current, ...result }, parsed).prep.removed).toEqual([])
  })

  it('keeps items added in the app', () => {
    const { current, parsed } = firstImport()
    current.prepItems.push({ ...current.prepItems[0], id: 'mine', sourceKey: null, item: 'Travel insurance', status: 'todo' })
    const result = applyImport(current, parsed, opts)
    expect(result.prepItems.map((p) => p.item)).toContain('Travel insurance')
  })

  it('keeps booking details on stays and warns when a booked stay would move', () => {
    const { current } = firstImport()
    const ferry = current.stays.findIndex((s) => s.baseCamp === 'Spirit of Tasmania crossing')
    current.stays[ferry] = { ...current.stays[ferry], status: 'Booked', bookingRef: 'SOT123', cost: 900 }
    // Add a day at Byron Bay in the spreadsheet: the ferry would move a day later.
    const days = [...defaultDays.slice(0, 3), { camp: 'Byron Bay', type: 'Camping', activity: 'Extra' }, ...defaultDays.slice(3)]
    const parsed = parse(buildWorkbook({ days }))
    const plan = planImport(current, parsed)
    expect(plan.stays.changed.map((c) => [c.existing.baseCamp, c.changes[0].field])).toEqual([['Byron Bay', 'Days']])
    expect(plan.stays.movedBooked.map((m) => [m.stay.baseCamp, m.fromDate, m.toDate])).toEqual([['Spirit of Tasmania crossing', '2027-06-05', '2027-06-06']])
    const result = applyImport(current, parsed, opts)
    const after = result.stays.find((s) => s.baseCamp === 'Spirit of Tasmania crossing')!
    expect(after).toMatchObject({ status: 'Booked', bookingRef: 'SOT123', cost: 900 })
    expect(staySpans(result.stays, result.departureDate).get(after.id)!.startDate).toBe('2027-06-06')
  })

  it('archives a removed stay that holds booking data, and restores it if it comes back', () => {
    const { current } = firstImport()
    const byron = current.stays.findIndex((s) => s.baseCamp === 'Byron Bay')
    current.stays[byron] = { ...current.stays[byron], status: 'Researching', notes: 'try Broken Head' }
    const without = parse(buildWorkbook({ days: defaultDays.filter((d) => d.camp !== 'Byron Bay') }))
    expect(planImport(current, without).stays.removed.map((s) => s.baseCamp)).toEqual(['Byron Bay'])
    const r1 = applyImport(current, without, opts)
    expect(r1.stays.map((s) => s.baseCamp)).not.toContain('Byron Bay')
    expect(r1.archivedStays.map((s) => [s.baseCamp, s.notes])).toEqual([['Byron Bay', 'try Broken Head']])

    const r2 = applyImport({ ...current, ...r1 }, parse(buildWorkbook()), opts)
    expect(r2.stays.find((s) => s.baseCamp === 'Byron Bay')).toMatchObject({ status: 'Researching', notes: 'try Broken Head' })
    expect(r2.archivedStays).toEqual([])
  })

  it('fills chosen site and status from the spreadsheet only when the app has none', () => {
    const { current } = firstImport()
    const fraser = current.stays.findIndex((s) => s.baseCamp === "Fraser Island (K'gari)")
    current.stays[fraser] = { ...current.stays[fraser], status: 'Confirmed', chosenSite: 'Central Station' }
    const days = defaultDays.map((d) => ({ ...d, site: 'Some site', status: 'Booked' }))
    const result = applyImport(current, parse(buildWorkbook({ days })), opts)
    expect(result.stays.find((s) => s.baseCamp === "Fraser Island (K'gari)")).toMatchObject({ status: 'Confirmed', chosenSite: 'Central Station' })
    expect(result.stays.find((s) => s.baseCamp === 'Byron Bay')).toMatchObject({ status: 'Booked', chosenSite: 'Some site' })
  })

  it('reports a changed departure date and applies it only when asked', () => {
    const { current } = firstImport()
    const parsed = parse(buildWorkbook({ departure: '2027-06-01' }))
    expect(planImport(current, parsed).departure).toEqual({ from: '2027-05-31', to: '2027-06-01' })
    expect(applyImport(current, parsed, opts).departureDate).toBe('2027-05-31')
    expect(applyImport(current, parsed, { ...opts, applyDeparture: true }).departureDate).toBe('2027-06-01')
  })
})

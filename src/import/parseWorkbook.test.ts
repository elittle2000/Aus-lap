import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorkbook, readWorkbook } from './parseWorkbook'
import { buildWorkbook, defaultPrep, serial } from './fixtureWorkbook'
import { groupDays, isBufferBlock } from '../domain/stays'
import { tripDayDate } from '../lib/dates'

const parse = (bytes: Uint8Array) => parseWorkbook(readWorkbook(bytes))

describe('parseWorkbook (fixture)', () => {
  const parsed = parse(buildWorkbook())

  it('reads prep items, skipping section headings and the totals block', () => {
    expect(parsed.errors).toEqual([])
    expect(parsed.prepItems.map((p) => p.item)).toEqual(['Timing belt', 'Lithium battery', 'Camp chairs', 'Timing belt (dup)'])
    expect(parsed.prepItems[0]).toMatchObject({
      sourceList: "FROM 'PRE-TRIP TO-DO'",
      category: 'Vehicle',
      plannedCost: 1200,
      include: true,
      priority: 'Critical',
      buyBy: '2026-09-01',
    })
    expect(parsed.prepItems[3]).toMatchObject({ include: false, sourceList: 'CAR PREP — duplicates' })
    expect(parsed.prepItems[1].notes).toBe('shop around')
  })

  it('reads itinerary days, ignoring the Date and Month label columns', () => {
    expect(parsed.days).toHaveLength(9)
    expect(parsed.days[0]).toMatchObject({ dayNumber: 1, baseCamp: "Fraser Island (K'gari)", type: 'Camping', buffer: false, bookingStatus: 'Not booked' })
    expect(parsed.days[3]).toMatchObject({ type: null, buffer: true })
  })

  it('reads the locations reference table', () => {
    expect(parsed.locations).toEqual([
      { baseCamp: "Fraser Island (K'gari)", region: 'QLD/NSW', generalLocation: 'Via River Heads barge' },
      { baseCamp: 'Byron Bay', region: 'NSW', generalLocation: 'Far north coast' },
    ])
  })

  it('reads only the budget category lines and the departure date', () => {
    expect(parsed.budgetLines).toEqual([
      { category: 'Fuel', monthly: 550 },
      { category: 'Camp fees & parks', monthly: 450 },
      { category: 'Activities, tours & park passes', monthly: 300 },
    ])
    expect(parsed.departureDate).toBe('2027-05-31')
  })

  it('treats the camp-host block as a stay even though its days are flagged buffer', () => {
    const blocks = groupDays(parsed.days)
    expect(blocks.map((b) => [b.baseCamp, b.days.length, isBufferBlock(b.baseCamp, b.days)])).toEqual([
      ["Fraser Island (K'gari)", 2, false],
      ['Byron Bay', 1, false],
      ['Buffer / flexible day', 2, true],
      ['Spirit of Tasmania crossing', 1, false],
      ['STOP & EARN: Camp host - Cape Range NP', 2, false],
      ['Buffer / flexible day', 1, true],
    ])
  })

  it('still finds the header when rows are inserted above it', () => {
    const bytes = buildWorkbook({ prep: [['Extra note row'], ...defaultPrep] })
    const p = parse(bytes)
    expect(p.prepItems.map((x) => x.item)[0]).toBe('Timing belt')
    expect(p.prepItems[0].sourceList).toBe("FROM 'PRE-TRIP TO-DO'")
  })

  it('reports unknown values instead of silently guessing', () => {
    const p = parse(buildWorkbook({ prep: [['Odd item', 'Vehicle', 10, 'Maybe', 'Urgent', serial('2026-09-01'), null]] }))
    expect(p.prepItems[0]).toMatchObject({ include: false, priority: null })
    expect(p.warnings.join('\n')).toMatch(/Include\? is "Maybe"/)
    expect(p.warnings.join('\n')).toMatch(/unknown priority "Urgent"/)
  })

  it('refuses a workbook with no items or no days, rather than wiping the app', () => {
    const p = parse(buildWorkbook({ prep: [], days: [] }))
    expect(p.errors).toEqual(['"Pre-departure Costs" has no items.'])
    expect(parse(buildWorkbook({ days: [] })).errors).toEqual(['"Itinerary" has no days.'])
  })

  it('fails clearly when a required sheet is missing', () => {
    const p = parseWorkbook({ SheetNames: [], Sheets: {} })
    expect(p.errors).toEqual(['The workbook has no "Pre-departure Costs" sheet.', 'The workbook has no "Itinerary" sheet.'])
  })
})

// The real workbook lives in data/ (never committed). When it's present, check it matches the brief.
const realPath = resolve(import.meta.dirname, '../../data/Ethan_Lap_Budget_v9_2.xlsx')
describe.skipIf(!existsSync(realPath))('parseWorkbook (real v9.2 workbook)', () => {
  const parsed = existsSync(realPath) ? parse(readFileSync(realPath)) : null!

  it('has no errors', () => expect(parsed.errors).toEqual([]))

  it('matches the prep figures in the brief', () => {
    const items = parsed.prepItems
    const included = items.filter((i) => i.include)
    const excluded = items.filter((i) => !i.include)
    const total = (xs: typeof items) => xs.reduce((n, i) => n + (i.plannedCost ?? 0), 0)
    expect(items).toHaveLength(64)
    expect(included).toHaveLength(52)
    expect(total(included)).toBe(26138)
    expect(excluded).toHaveLength(12)
    expect(total(excluded)).toBe(9280)
    const byP = (p: string) => included.filter((i) => i.priority === p)
    expect([byP('Critical'), byP('High'), byP('Medium'), byP('Low')].map((l) => l.length)).toEqual([13, 11, 18, 10])
    expect([byP('Critical'), byP('High'), byP('Medium'), byP('Low')].map(total)).toEqual([14200, 6609, 4174, 1155])
    expect(new Set(items.map((i) => i.sourceList)).size).toBe(4)
    expect(included.every((i) => i.buyBy?.endsWith('-01'))).toBe(true)
    expect(excluded.every((i) => i.buyBy === null && i.priority === null)).toBe(true)
    expect(parsed.warnings).toEqual([])
  })

  it('matches the itinerary figures in the brief', () => {
    expect(parsed.departureDate).toBe('2027-05-31')
    expect(parsed.days).toHaveLength(438)
    expect(tripDayDate(parsed.departureDate!, 438)).toBe('2028-08-10')
    const blocks = groupDays(parsed.days)
    const buffers = blocks.filter((b) => isBufferBlock(b.baseCamp, b.days))
    expect(blocks).toHaveLength(95)
    expect(blocks.length - buffers.length).toBe(82)
    expect(buffers).toHaveLength(13)
    expect(buffers.reduce((n, b) => n + b.days.length, 0)).toBe(207)
    expect(parsed.days.every((d) => d.bookingStatus === 'Not booked' && d.chosenSite === '')).toBe(true)
    expect(parsed.locations).toHaveLength(73)
  })

  it('imports the 13 on-road budget lines totalling $3,940', () => {
    expect(parsed.budgetLines).toHaveLength(13)
    expect(parsed.budgetLines.reduce((n, l) => n + l.monthly, 0)).toBe(3940)
  })
})

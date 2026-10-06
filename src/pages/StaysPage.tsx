import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { useTrip } from '../hooks'
import { stayNeedsBooking } from '../domain/actions'
import { BOOKING_STATUSES, type BookingStatus, type Stay } from '../domain/types'
import { formatMonth, formatRange, monthKey } from '../lib/dates'
import { Card, Chip, Empty, SectionTitle } from '../components/ui'
import { BOOKING_TONE, REQUIREMENT_TONE, cx, inputCls } from '../components/styles'
import type { StaySpan } from '../domain/stays'

type Filter = 'all' | 'needs' | BookingStatus

export default function StaysPage() {
  const { stays, archivedStays, deleteArchivedStay } = useStore()
  const { spans, length, today } = useTrip()
  const [filter, setFilter] = useState<Filter>('all')
  const [showBuffers, setShowBuffers] = useState(true)
  const [showPast, setShowPast] = useState(false)

  if (!stays.length) return <Empty>No stays yet. Import the workbook from the More tab.</Empty>

  // Number the real stays 1, 2, 3… in route order; buffers aren't numbered.
  const numbers = new Map<string, number>()
  stays.filter((s) => s.kind === 'stay').forEach((s, i) => numbers.set(s.id, i + 1))
  const realStays = stays.filter((s) => s.kind === 'stay')
  const needs = realStays.filter(stayNeedsBooking).length

  const visible = stays.filter((s) => {
    const sp = spans.get(s.id)!
    if (!showPast && sp.endDate < today) return false
    if (s.kind === 'buffer') return showBuffers && filter === 'all'
    if (filter === 'needs') return stayNeedsBooking(s)
    return filter === 'all' || s.status === filter
  })

  const groups = new Map<string, Stay[]>()
  for (const s of visible) {
    const k = monthKey(spans.get(s.id)!.startDate)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Stays & bookings</h1>
        <p className="text-sm text-stone-500">
          {realStays.length} stays over {length} days · {needs} still need booking
        </p>
      </div>

      <Card className="space-y-3">
        <select aria-label="Show" className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All stays</option>
          <option value="needs">Still need booking</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-ochre-600" checked={showBuffers} onChange={(e) => setShowBuffers(e.target.checked)} /> Buffer days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-ochre-600" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Past stays
          </label>
        </div>
      </Card>

      {visible.length === 0 && <Empty>No stays match.</Empty>}

      {[...groups.entries()].map(([m, list]) => (
        <section key={m}>
          <SectionTitle>{formatMonth(m)}</SectionTitle>
          <ul className="space-y-2">
            {list.map((s) => (
              <StayRow key={s.id} stay={s} span={spans.get(s.id)!} number={numbers.get(s.id)} />
            ))}
          </ul>
        </section>
      ))}

      {archivedStays.length > 0 && (
        <Card>
          <SectionTitle>No longer in the spreadsheet</SectionTitle>
          <p className="mb-2 text-sm text-stone-600">These were removed from the workbook but had booking details or notes, so they've been kept here.</p>
          <ul className="divide-y divide-stone-100">
            {archivedStays.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-medium">{s.baseCamp}</span>
                  <span className="text-sm text-stone-500">
                    {s.status}
                    {s.bookingRef && ` · ref ${s.bookingRef}`}
                    {s.notes && ` · ${s.notes}`}
                  </span>
                </span>
                <button className="text-sm text-red-700" onClick={() => confirm(`Delete ${s.baseCamp} for good?`) && deleteArchivedStay(s.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function StayRow({ stay, span, number }: { stay: Stay; span: StaySpan; number?: number }) {
  if (stay.kind === 'buffer') {
    return (
      <li>
        <Link to={`/stays/${stay.id}`} className="flex items-center justify-between rounded-xl border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-500">
          <span>Flexible days · {formatRange(span.startDate, span.endDate)}</span>
          <span className="tabular-nums">{span.nights}d</span>
        </Link>
      </li>
    )
  }
  return (
    <li>
      <Link to={`/stays/${stay.id}`} className="flex gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', { 'Not booked': 'bg-red-600', Researching: 'bg-amber-500', Booked: 'bg-sky-600', Confirmed: 'bg-green-600' }[stay.status])}>{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug">{stay.baseCamp}</span>
          {stay.chosenSite && <span className="block truncate text-sm text-stone-700">{stay.chosenSite}</span>}
          <span className="block text-sm text-stone-500">
            {formatRange(span.startDate, span.endDate)} · {span.nights} night{span.nights === 1 ? '' : 's'}
            {stay.type && stay.type !== 'Camping' ? ` · ${stay.type}` : ''}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip tone={BOOKING_TONE[stay.status]}>{stay.status}</Chip>
            {stay.geo?.state && <Chip>{stay.geo.state}</Chip>}
            {stay.bookingRequirement !== 'Unknown' && <Chip tone={REQUIREMENT_TONE[stay.bookingRequirement]}>{stay.bookingRequirement}</Chip>}
          </span>
        </span>
      </Link>
    </li>
  )
}


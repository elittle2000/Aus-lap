import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { personName, useStore } from '../store'
import { useTrip } from '../hooks'
import { resizeStay, type ResizeMode, type ResizeResult } from '../domain/stays'
import { BOOKING_REQUIREMENTS, BOOKING_STATUSES, type Stay } from '../domain/types'
import { needsPoint } from '../map/geocode'
import { formatDate, formatRange, formatWeekday, tripDayDate } from '../lib/dates'
import { formatAud, parseAmount } from '../lib/money'
import { Card, Chip, Field, SectionTitle, Segmented } from '../components/ui'
import { BOOKING_TONE, btnPrimary, btnSecondary, inputCls } from '../components/styles'

const PlacePicker = lazy(() => import('../map/PlacePicker'))

export default function StayDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { stays, updateStay, settings } = useStore()
  const { spans, departure } = useTrip()
  const stay = stays.find((s) => s.id === id)

  if (!stay) {
    return (
      <p>
        That stay isn't in the itinerary any more.{' '}
        <Link to="/stays" className="text-ochre-700 underline">
          Back to stays
        </Link>
      </p>
    )
  }
  const span = spans.get(stay.id)!
  const idx = stays.indexOf(stay)
  const prev = stays[idx - 1]
  const next = stays[idx + 1]
  const save = (patch: Partial<Stay>) => updateStay(stay.id, patch)

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="text-sm text-ochre-700">
        ← Back
      </button>
      <div>
        <h1 className="text-2xl font-semibold leading-tight">{stay.kind === 'buffer' ? 'Flexible days' : stay.baseCamp}</h1>
        <p className="text-stone-600">
          {formatRange(span.startDate, span.endDate)} · day {span.startDay}
          {span.nights > 1 ? `–${span.endDay}` : ''} · {span.nights} night{span.nights === 1 ? '' : 's'}
        </p>
        <p className="text-sm text-stone-500">Leave {formatWeekday(span.departDate)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stay.type && <Chip>{stay.type}</Chip>}
          {stay.kind === 'stay' && <Chip tone={BOOKING_TONE[stay.status]}>{stay.status}</Chip>}
        </div>
      </div>

      {stay.kind === 'stay' && (
        <Card className="space-y-4">
          <Field group label="Booking status">
            <Segmented label="Booking status" value={stay.status} onChange={(status) => save({ status })} options={BOOKING_STATUSES.map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field group label="Does it need booking?" hint="'No booking needed' is for free camps and the like, so they don't sit as 'Not booked' forever.">
            <Segmented label="Does it need booking?" value={stay.bookingRequirement} onChange={(bookingRequirement) => save({ bookingRequirement })} options={BOOKING_REQUIREMENTS.map((s) => ({ value: s, label: s }))} />
          </Field>
          <TextField label="Chosen site / property" value={stay.chosenSite} onSave={(chosenSite) => save({ chosenSite })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Booking ref" value={stay.bookingRef} onSave={(bookingRef) => save({ bookingRef })} />
            <TextField label="Booked via" value={stay.bookedVia} onSave={(bookedVia) => save({ bookedVia })} placeholder="e.g. Parks WA" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Cost" inputMode="decimal" value={stay.cost === null ? '' : String(stay.cost)} onSave={(v) => save({ cost: parseAmount(v) })} placeholder="$" />
            <Field label="Cancel by">
              <input type="date" className={inputCls} value={stay.cancelBy ?? ''} onChange={(e) => save({ cancelBy: e.target.value || null })} />
            </Field>
          </div>
          {stay.cost !== null && span.nights > 0 && <p className="-mt-2 text-xs text-stone-500">{formatAud(stay.cost / span.nights)} a night</p>}
          <TextField label="Link" type="url" value={stay.link} onSave={(link) => save({ link: link.trim() })} placeholder="https://" />
          {stay.link && (
            <a href={stay.link} target="_blank" rel="noreferrer" className="-mt-2 block truncate text-sm text-ochre-700 underline">
              {stay.link}
            </a>
          )}
          <TextField label="Notes" multiline value={stay.notes} onSave={(notes) => save({ notes })} />
        </Card>
      )}

      {needsPoint(stay) && <MapPosition stay={stay} />}

      <LengthEditor stay={stay} />

      <Card>
        <SectionTitle>Day by day</SectionTitle>
        <ol className="space-y-3">
          {stay.days.map((d, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">
                Day {span.startDay + i} · {formatWeekday(tripDayDate(departure, span.startDay + i))}
              </span>
              <span className="block text-stone-600">{d.activity || <em className="text-stone-400">No plan yet</em>}</span>
            </li>
          ))}
        </ol>
      </Card>

      <p className="text-xs text-stone-500">
        Last changed by {personName(settings.people, stay.updatedBy)} on {new Date(stay.updatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      <div className="flex justify-between gap-2 text-sm">
        {prev ? (
          <Link to={`/stays/${prev.id}`} replace className="text-ochre-700">
            ← {prev.kind === 'buffer' ? 'Flexible days' : prev.baseCamp}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/stays/${next.id}`} replace className="text-right text-ochre-700">
            {next.kind === 'buffer' ? 'Flexible days' : next.baseCamp} →
          </Link>
        )}
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onSave,
  multiline,
  ...rest
}: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; type?: string; inputMode?: 'decimal' }) {
  const [v, setV] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  // Pick up changes made elsewhere (e.g. by the other person once syncing is on).
  if (value !== prevValue) {
    setPrevValue(value)
    setV(value)
  }
  return (
    <Field label={label}>
      {multiline ? (
        <textarea className={inputCls} rows={3} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} />
      ) : (
        <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} {...rest} />
      )}
    </Field>
  )
}

function LengthEditor({ stay }: { stay: Stay }) {
  const { stays, resizeStay: commit } = useStore()
  const { spans, departure } = useTrip()
  const [open, setOpen] = useState(false)
  const [length, setLength] = useState(stay.days.length)
  const [mode, setMode] = useState<ResizeMode>('absorb')
  const [error, setError] = useState<string | null>(null)

  const hasBufferAfter = stays.slice(stays.indexOf(stay) + 1).some((s) => s.kind === 'buffer')
  const effectiveMode: ResizeMode = stay.kind === 'buffer' || !hasBufferAfter ? 'shift' : mode
  const preview: ResizeResult | null = length !== stay.days.length ? resizeStay(stays, stay.id, length, effectiveMode) : null
  const dayDate = (day: number) => formatDate(tripDayDate(departure, day))

  if (!open) {
    return (
      <button className={btnSecondary + ' w-full'} onClick={() => (setLength(stay.days.length), setOpen(true))}>
        Change length ({stay.days.length} day{stay.days.length === 1 ? '' : 's'})
      </button>
    )
  }
  return (
    <Card className="space-y-4">
      <SectionTitle>Change length</SectionTitle>
      <div className="flex items-center gap-3">
        <button className={btnSecondary + ' size-11 text-xl'} aria-label="One day fewer" onClick={() => setLength(Math.max(1, length - 1))}>
          −
        </button>
        <span className="min-w-20 text-center text-lg font-semibold tabular-nums">
          {length} day{length === 1 ? '' : 's'}
        </span>
        <button className={btnSecondary + ' size-11 text-xl'} aria-label="One day more" onClick={() => setLength(length + 1)}>
          +
        </button>
      </div>

      {stay.kind === 'stay' && hasBufferAfter && (
        <Field group label="Where do the days come from?">
          <Segmented
            label="Where do the days come from?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'absorb', label: 'Next buffer days' },
              { value: 'shift', label: 'Push everything later' },
            ]}
          />
        </Field>
      )}

      {preview && (
        <div className="rounded-xl bg-stone-100 p-3 text-sm">
          {preview.problem ? (
            <p className="text-red-700">{preview.problem}</p>
          ) : (
            <>
              <p>
                Ends {dayDate(spans.get(stay.id)!.startDay + length - 1)}.{' '}
                {preview.movedCount === 0 ? 'No other stays move.' : `${preview.movedCount} later stay${preview.movedCount === 1 ? '' : 's'} move.`}{' '}
                {preview.tripLengthChange !== 0 && `The trip becomes ${preview.tripLengthChange > 0 ? 'longer' : 'shorter'} by ${Math.abs(preview.tripLengthChange)} day${Math.abs(preview.tripLengthChange) === 1 ? '' : 's'}.`}
              </p>
              {preview.movedBooked.length > 0 && (
                <div className="mt-2 rounded-lg bg-red-50 p-2 text-red-800 ring-1 ring-red-200">
                  <p className="font-semibold">⚠ This changes dates on {preview.movedBooked.length} booked stay{preview.movedBooked.length === 1 ? '' : 's'}:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {preview.movedBooked.map((m) => (
                      <li key={m.id}>
                        {m.baseCamp} ({m.status}){m.fromDay !== m.toDay ? `: ${dayDate(m.fromDay)} → ${dayDate(m.toDay)}` : ': its end date changes'}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">You'll need to change those bookings too.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          className={btnPrimary + ' flex-1'}
          disabled={!preview || !!preview.problem}
          onClick={() => {
            const problem = commit(stay.id, length, effectiveMode)
            if (problem) setError(problem)
            else setOpen(false)
          }}
        >
          {preview?.movedBooked.length ? 'Change anyway' : 'Save'}
        </button>
        <button className={btnSecondary} onClick={() => (setOpen(false), setError(null))}>
          Cancel
        </button>
      </div>
    </Card>
  )
}

function MapPosition({ stay }: { stay: Stay }) {
  const setStayGeo = useStore((s) => s.setStayGeo)
  const geo = stay.geo
  return (
    <Card className="space-y-2">
      <SectionTitle right={geo?.state ? <Chip>{geo.state}</Chip> : undefined}>On the map</SectionTitle>
      {!geo && <p className="text-sm text-stone-600">Not on the map yet. Tap where it is to place it.</p>}
      {geo?.quality === 'check' && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>
            This is a best guess (<em>{geo.label}</em>). If it's wrong, drag the pin. If it's right:
          </span>
          <button className="shrink-0 font-semibold underline" onClick={() => setStayGeo([{ id: stay.id, geo: { ...geo, quality: 'good' } }], `${stay.baseCamp}: map position confirmed`)}>
            Looks right
          </button>
        </div>
      )}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-stone-200" />}>
        <PlacePicker stay={stay} />
      </Suspense>
      {geo && <p className="text-xs text-stone-500">{geo.quality === 'manual' ? 'Placed by hand' : `Found as: ${geo.label}`}. Drag the pin to move it.</p>}
    </Card>
  )
}

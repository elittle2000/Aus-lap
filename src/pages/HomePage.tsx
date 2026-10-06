import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { personName, useStore } from '../store'
import { useTrip } from '../hooks'
import { nextActions, staysSorted, type Action } from '../domain/actions'
import { prepReadiness } from '../domain/prep'
import { formatDate, formatRange, formatMonth, formatShort } from '../lib/dates'
import { Card, Chip, Empty, PrioChip, Progress, SectionTitle } from '../components/ui'
import { DUE_LABEL, btnPrimary, BOOKING_TONE } from '../components/styles'
import { stayOnDay } from '../domain/stays'
import { missingPlaces, useFindPlaces } from '../map/useFindPlaces'
import { needsPoint } from '../map/geocode'
import { carPosition, routePoints } from '../map/progress'

// The map library is large, so it loads after the rest of the page.
const RouteMap = lazy(() => import('../map/RouteMap'))

export default function HomePage() {
  const { prepItems, stays, changes, settings } = useStore()
  const trip = useTrip()

  if (!prepItems.length && !stays.length) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">G'day</h1>
        <Card>
          <p className="mb-4">Nothing here yet. Start by importing the budget workbook. It's read on this device and never uploaded.</p>
          <Link to="/import" className={btnPrimary}>
            Import workbook
          </Link>
        </Card>
      </div>
    )
  }

  const actions = nextActions(prepItems, stays, trip.spans, trip.today)
  const all = prepReadiness(prepItems)
  const critical = prepReadiness(prepItems, 'Critical')
  // Before we leave, "next 90 days" means the first 90 days of the trip.
  const windowStart = trip.phase === 'before' ? trip.departure : trip.today
  const sorted = staysSorted(stays, trip.spans, windowStart, 90)
  const recent = changes.filter((c) => c.by !== settings.me && c.by !== 'import').slice(0, 5)
  const current = trip.phase === 'during' ? stayOnDay(stays, trip.dayNumber) : null

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-ochre-600 p-4 text-white shadow-sm">
        {trip.phase === 'before' && (
          <>
            <p className="text-5xl font-bold tabular-nums">{trip.daysToGo}</p>
            <p className="text-ochre-100">days until we leave · {formatDate(trip.departure)}</p>
          </>
        )}
        {trip.phase === 'during' && (
          <>
            <p className="text-3xl font-bold">
              Day {trip.dayNumber} <span className="text-xl font-normal text-ochre-100">of {trip.length}</span>
            </p>
            {current && <p className="text-ochre-100">{current.kind === 'buffer' ? 'Flexible day' : current.baseCamp}</p>}
          </>
        )}
        {trip.phase === 'after' && <p className="text-2xl font-bold">The lap is done. Welcome home!</p>}
      </section>

      <TripMap />

      <Card>
        <SectionTitle>Next up</SectionTitle>
        {actions.length ? (
          <ul className="divide-y divide-stone-100">
            {actions.map((a) => (
              <ActionRow key={`${a.kind}-${a.id}`} a={a} />
            ))}
          </ul>
        ) : (
          <Empty>Nothing waiting. Nice.</Empty>
        )}
      </Card>

      <Card>
        <SectionTitle>Readiness</SectionTitle>
        <div className="space-y-3">
          <Progress label="Prep items done" done={all.done} total={all.total} />
          <Progress label="Critical items done" done={critical.done} total={critical.total} tone="red" />
          <Progress label={trip.phase === 'before' ? 'First 90 days of stays sorted' : 'Stays in the next 90 days sorted'} done={sorted.done} total={sorted.total} tone="green" />
        </div>
      </Card>

      <Card>
        <SectionTitle>Recent changes by others</SectionTitle>
        {recent.length ? (
          <ul className="space-y-2 text-sm">
            {recent.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{personName(settings.people, c.by)}</span> · {c.summary}
                <span className="block text-xs text-stone-500">{new Date(c.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Nothing yet. Changes the other person makes will show here.</p>
        )}
      </Card>
    </div>
  )
}

function ActionRow({ a }: { a: Action }) {
  if (a.kind === 'prep') {
    const [label, tone] = DUE_LABEL[a.due]
    return (
      <li>
        <Link to={`/prep?item=${a.id}`} className="flex items-start justify-between gap-3 py-2.5">
          <span>
            <span className="block font-medium">{a.item.item}</span>
            <span className="text-sm text-stone-500">Buy by {a.item.buyBy ? formatMonth(a.item.buyBy) : '—'}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Chip tone={tone}>{label}</Chip>
            <PrioChip p={a.item.priority} />
          </span>
        </Link>
      </li>
    )
  }
  return (
    <li>
      <Link to={`/stays/${a.id}`} className="flex items-start justify-between gap-3 py-2.5">
        <span>
          <span className="block font-medium">Book {a.stay.baseCamp}</span>
          <span className="text-sm text-stone-500">
            {formatRange(a.span.startDate, a.span.endDate)} · act by {formatShort(a.actBy)}
          </span>
        </span>
        <Chip tone={BOOKING_TONE[a.stay.status]}>{a.stay.status}</Chip>
      </Link>
    </li>
  )
}

function TripMap() {
  const stays = useStore((s) => s.stays)
  const { spans, dayNumber, daysToGo } = useTrip()
  const { run, progress, error } = useFindPlaces()
  const missing = missingPlaces(stays)
  const toCheck = stays.filter((s) => needsPoint(s) && s.geo?.quality === 'check')
  const points = routePoints(stays, spans)
  const car = carPosition(points, dayNumber)
  const name = (id: string | null | undefined) => stays.find((s) => s.id === id)?.baseCamp ?? ''

  if (!stays.length) return null

  const finder = progress ? (
    <div>
      <p className="mb-1 text-sm">
        Finding places on the map… {progress.done} of {progress.total}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full bg-ochre-500 transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-stone-500">One a second, as the free map service asks. Keep the app open.</p>
    </div>
  ) : null

  if (!points.length) {
    return (
      <Card>
        <SectionTitle>The route</SectionTitle>
        {finder ?? (
          <>
            <p className="mb-3 text-sm text-stone-600">
              Put all {missing.length} stops on the map. It looks each one up once (about {Math.ceil((missing.length * 1.5) / 60)} minutes) and both phones get the result.
            </p>
            <button className={btnPrimary + ' w-full'} onClick={run}>
              Put the route on the map
            </button>
          </>
        )}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </Card>
    )
  }

  const where =
    car?.phase === 'before'
      ? `Parked at the start: ${points[0].name}. ${daysToGo} days to go.`
      : car?.phase === 'at-stay'
        ? `Today: ${name(car.atStayId)}`
        : car?.phase === 'between'
          ? `On the road from ${points[car.segment].name} to ${points[car.segment + 1].name}`
          : 'The lap is done!'

  return (
    <Card className="space-y-2 p-2">
      <Suspense fallback={<div className="h-[260px] animate-pulse rounded-xl bg-stone-200" />}>
        <RouteMap />
      </Suspense>
      <div className="space-y-2 px-2 pb-1">
        <p className="text-sm font-medium">{where}</p>
        {finder}
        {!progress && !error && missing.length > 0 && (
          <p className="text-sm text-stone-600">
            {missing.length} stop{missing.length === 1 ? ' isn’t' : 's aren’t'} on the map yet.{' '}
            <button className="font-medium text-ochre-700 underline" onClick={run}>
              Find {missing.length === 1 ? 'it' : 'them'}
            </button>
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {toCheck.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-stone-600">
              {toCheck.length} place{toCheck.length === 1 ? '' : 's'} to double-check on the map
            </summary>
            <ul className="mt-1 list-disc pl-5">
              {toCheck.map((s) => (
                <li key={s.id}>
                  <Link to={`/stays/${s.id}`} className="text-ochre-700 underline">
                    {s.baseCamp}
                  </Link>{' '}
                  <span className="text-stone-500">→ {s.geo?.label}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  )
}

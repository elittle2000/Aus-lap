import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { parseWorkbook, readWorkbook, type ParsedWorkbook } from '../import/parseWorkbook'
import { planImport, type ImportPlan } from '../import/diff'
import { groupDays, isBufferBlock } from '../domain/stays'
import { formatDate, tripDayDate } from '../lib/dates'
import { formatAud } from '../lib/money'
import { PRIORITIES } from '../domain/types'
import { Card, Chip, SectionTitle } from '../components/ui'
import { btnPrimary, btnSecondary } from '../components/styles'

export default function ImportPage() {
  const store = useStore()
  const navigate = useNavigate()
  const [file, setFile] = useState<{ name: string; parsed: ParsedWorkbook; plan: ImportPlan } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [applyDeparture, setApplyDeparture] = useState(false)

  async function onFile(f: File | undefined) {
    setReadError(null)
    setFile(null)
    if (!f) return
    try {
      const parsed = parseWorkbook(readWorkbook(new Uint8Array(await f.arrayBuffer())))
      const s = useStore.getState()
      const plan = planImport({ prepItems: s.prepItems, stays: s.stays, archivedStays: s.archivedStays, departureDate: s.settings.departureDate }, parsed)
      setFile({ name: f.name, parsed, plan })
      setApplyDeparture(plan.isFirstImport)
    } catch (e) {
      setReadError(`Couldn't read that file as an Excel workbook (${(e as Error).message}).`)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Import workbook</h1>
      <Card>
        <p className="mb-3 text-sm text-stone-600">
          Choose the budget workbook (.xlsx). It's read on this device only. The app reads just the prep list, itinerary, on-road budget lines and departure date, never the pay, bank or savings sheets. You'll see
          what changes before anything is saved.
        </p>
        <input type="file" accept=".xlsx,.xlsm" aria-label="Workbook file" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ochre-100 file:px-3 file:py-2 file:font-medium file:text-ochre-700" />
        {store.lastImport && <p className="mt-2 text-xs text-stone-500">Last import: {store.lastImport.fileName} on {new Date(store.lastImport.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        {readError && <p className="mt-2 text-sm text-red-700">{readError}</p>}
      </Card>

      {file && <Summary parsed={file.parsed} />}
      {file && !file.plan.isFirstImport && <Diff plan={file.plan} />}

      {file && (
        <Card className="space-y-3">
          {file.parsed.errors.length > 0 ? (
            <p className="text-red-700">Fix the problems above in the workbook, then choose it again.</p>
          ) : (
            <>
              {file.plan.departure && !file.plan.isFirstImport && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-ochre-600" checked={applyDeparture} onChange={(e) => setApplyDeparture(e.target.checked)} />
                  <span>
                    Also change the departure date from {formatDate(file.plan.departure.from)} to {formatDate(file.plan.departure.to)} (moves every stay)
                  </span>
                </label>
              )}
              <button
                className={btnPrimary + ' w-full'}
                onClick={() => {
                  store.importWorkbook(file.parsed, file.name, applyDeparture)
                  navigate('/')
                }}
              >
                {file.plan.isFirstImport ? 'Import' : 'Apply these changes'}
              </button>
              <button className={btnSecondary + ' w-full'} onClick={() => setFile(null)}>
                Cancel
              </button>
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function Summary({ parsed }: { parsed: ParsedWorkbook }) {
  const items = parsed.prepItems
  const included = items.filter((i) => i.include)
  const total = (xs: typeof items) => xs.reduce((n, i) => n + (i.plannedCost ?? 0), 0)
  const blocks = groupDays(parsed.days)
  const buffers = blocks.filter((b) => isBufferBlock(b.baseCamp, b.days))
  const lastDay = parsed.days.length && parsed.departureDate ? tripDayDate(parsed.departureDate, parsed.days.length) : null

  return (
    <Card>
      <SectionTitle>What's in the file</SectionTitle>
      {parsed.errors.map((e) => (
        <p key={e} className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {e}
        </p>
      ))}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-stone-500">Prep items</dt>
        <dd>
          {items.length} · <strong>{included.length} included</strong> ({formatAud(total(included))}) · {items.length - included.length} excluded duplicates ({formatAud(total(items.filter((i) => !i.include)))})
        </dd>
        <dt className="text-stone-500">By priority</dt>
        <dd>
          {PRIORITIES.map((p) => {
            const l = included.filter((i) => i.priority === p)
            return `${p} ${l.length} (${formatAud(total(l))})`
          }).join(' · ')}
        </dd>
        <dt className="text-stone-500">Itinerary</dt>
        <dd>
          {parsed.days.length} days{parsed.departureDate && lastDay && `, ${formatDate(parsed.departureDate)} – ${formatDate(lastDay)}`}
        </dd>
        <dt className="text-stone-500">Grouped into</dt>
        <dd>
          {blocks.length} blocks: {blocks.length - buffers.length} stays + {buffers.length} buffer blocks ({buffers.reduce((n, b) => n + b.days.length, 0)} days)
        </dd>
        <dt className="text-stone-500">Places list</dt>
        <dd>{parsed.locations.length} locations</dd>
        <dt className="text-stone-500">On-road budget</dt>
        <dd>
          {parsed.budgetLines.length} lines, {formatAud(parsed.budgetLines.reduce((n, l) => n + l.monthly, 0))}/month
        </dd>
      </dl>
      {parsed.warnings.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-800">{parsed.warnings.length} things to check</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {parsed.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function Diff({ plan }: { plan: ImportPlan }) {
  const { prep, stays } = plan
  const nothing = !prep.added.length && !prep.changed.length && !prep.removed.length && !stays.added.length && !stays.changed.length && !stays.removed.length && !plan.departure
  return (
    <Card className="space-y-3">
      <SectionTitle>Changes since last import</SectionTitle>
      <p className="text-sm text-stone-600">Statuses, actual costs, owners, notes and booking details you've entered are never overwritten.</p>
      {nothing && <p>No changes. The app already matches this workbook.</p>}

      {stays.movedBooked.length > 0 && (
        <div className="rounded-lg bg-red-50 p-2 text-sm text-red-800 ring-1 ring-red-200">
          <p className="font-semibold">⚠ Booked stays whose dates would move:</p>
          <ul className="list-disc pl-5">
            {stays.movedBooked.map((m) => (
              <li key={m.stay.id}>
                {m.stay.baseCamp}: {formatDate(m.fromDate)} → {formatDate(m.toDate)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DiffGroup title="New prep items" tone="green" rows={prep.added.map((a) => a.item)} />
      <DiffGroup title="Changed prep items" tone="amber" rows={prep.changed.map((c) => `${c.existing.item}: ${c.changes.map((f) => `${f.field} ${f.from} → ${f.to}`).join('; ')}`)} />
      <DiffGroup title="Removed from spreadsheet (kept in app, flagged)" tone="red" rows={prep.removed.map((p) => p.item)} />
      <DiffGroup title="New stays" tone="green" rows={stays.added.map((b) => `${b.baseCamp} (${b.days.length} days from day ${b.firstDay})`)} />
      <DiffGroup title="Changed stays" tone="amber" rows={stays.changed.map((c) => `${c.existing.baseCamp}: ${c.changes.map((f) => `${f.field} ${f.from} → ${f.to}`).join('; ')}`)} />
      <DiffGroup title="Removed stays" tone="red" rows={stays.removed.map((s) => s.baseCamp)} />
      {(prep.unchanged > 0 || stays.unchanged > 0) && (
        <p className="text-sm text-stone-500">
          Unchanged: {prep.unchanged} prep items, {stays.unchanged} stays.
        </p>
      )}
    </Card>
  )
}

function DiffGroup({ title, rows, tone }: { title: string; rows: string[]; tone: 'green' | 'amber' | 'red' }) {
  if (!rows.length) return null
  return (
    <details open={rows.length <= 8}>
      <summary className="cursor-pointer text-sm font-medium">
        <Chip tone={tone}>{rows.length}</Chip> {title}
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </details>
  )
}

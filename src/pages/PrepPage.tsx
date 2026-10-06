import { useMemo, useState, type ChangeEvent, type FocusEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { personName, useStore } from '../store'
import { useTrip } from '../hooks'
import { comparePrep, counts, dueState, spendSummary } from '../domain/prep'
import { PREP_STATUSES, PREP_STATUS_LABEL, PRIORITIES, type PersonId, type PrepItem, type PrepStatus, type Priority } from '../domain/types'
import { formatMonth, monthKey, type IsoDate } from '../lib/dates'
import { formatAud, formatAudExact, parseAmount } from '../lib/money'
import { Card, Chip, Empty, Field, PrioChip, SectionTitle, Segmented, Sheet } from '../components/ui'
import { DUE_LABEL, btnPrimary, btnSecondary, cx, inputCls } from '../components/styles'

type StatusFilter = 'open' | 'all' | PrepStatus
type OwnerFilter = 'any' | 'none' | PersonId

export default function PrepPage() {
  const { prepItems, settings } = useStore()
  const { today } = useTrip()
  const [params, setParams] = useSearchParams()
  const openId = params.get('item')
  const [adding, setAdding] = useState(false)

  const [status, setStatus] = useState<StatusFilter>('open')
  const [priority, setPriority] = useState<'any' | Priority>('any')
  const [category, setCategory] = useState('any')
  const [month, setMonth] = useState('any')
  const [owner, setOwner] = useState<OwnerFilter>('any')
  const [showExcluded, setShowExcluded] = useState(false)

  const summary = useMemo(() => spendSummary(prepItems), [prepItems])
  const categories = useMemo(() => [...new Set(prepItems.map((i) => i.category).filter(Boolean))].sort(), [prepItems])
  const months = useMemo(() => [...new Set(prepItems.filter((i) => i.buyBy).map((i) => monthKey(i.buyBy!)))].sort(), [prepItems])
  const excludedCount = prepItems.filter((i) => !counts(i)).length

  const filtered = prepItems
    .filter((i) => showExcluded || counts(i))
    .filter((i) => (status === 'open' ? i.status === 'todo' || i.status === 'ordered' : status === 'all' || i.status === status))
    .filter((i) => priority === 'any' || i.priority === priority)
    .filter((i) => category === 'any' || i.category === category)
    .filter((i) => month === 'any' || (i.buyBy && monthKey(i.buyBy) === month) || (month === 'none' && !i.buyBy))
    .filter((i) => owner === 'any' || (owner === 'none' ? !i.owner : i.owner === owner))
    .sort(comparePrep)

  const groups = new Map<string, PrepItem[]>()
  for (const i of filtered) {
    const k = i.buyBy ? monthKey(i.buyBy) : 'none'
    groups.set(k, [...(groups.get(k) ?? []), i])
  }

  const openItem = prepItems.find((i) => i.id === openId) ?? null
  const close = () => setParams({}, { replace: true })

  if (!prepItems.length) return <Empty>No prep items yet. Import the workbook from the More tab.</Empty>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Prep checklist</h1>
        <button className={btnSecondary} onClick={() => setAdding(true)}>
          + Add
        </button>
      </div>

      <SpendCard summary={summary} />

      <Card className="space-y-3">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
            { value: 'dropped', label: 'Dropped' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Priority" className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="any">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select aria-label="Category" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="any">Any category</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Buy-by month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="any">Any month</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
            <option value="none">No date</option>
          </select>
          <select aria-label="Who" className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value as OwnerFilter)}>
            <option value="any">Anyone</option>
            {settings.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="none">Unassigned</option>
          </select>
        </div>
        {excludedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} className="size-4 accent-ochre-600" />
            Show {excludedCount} excluded duplicates (never counted)
          </label>
        )}
      </Card>

      <p className="text-sm text-stone-500">
        {filtered.length} item{filtered.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 && <Empty>No items match these filters.</Empty>}

      {[...groups.entries()].map(([m, items]) => (
        <section key={m}>
          <SectionTitle right={<span className="text-sm tabular-nums text-stone-500">{formatAud(items.filter(counts).reduce((n, i) => n + (i.plannedCost ?? 0), 0))}</span>}>
            {m === 'none' ? 'No buy-by date' : formatMonth(m)}
          </SectionTitle>
          <ul className="space-y-2">
            {items.map((i) => (
              <PrepRow key={i.id} item={i} today={today} ownerName={i.owner ? personName(settings.people, i.owner) : null} onOpen={() => setParams({ item: i.id })} />
            ))}
          </ul>
        </section>
      ))}

      <Sheet open={!!openItem} onClose={close} title={openItem?.item ?? ''}>
        {openItem && <PrepEditor item={openItem} onDone={close} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add an item">
        <AddPrep onDone={(id) => (setAdding(false), setParams({ item: id }))} />
      </Sheet>
    </div>
  )
}

function SpendCard({ summary }: { summary: ReturnType<typeof spendSummary> }) {
  const [view, setView] = useState<'priority' | 'month'>('priority')
  const rows = view === 'priority' ? summary.byPriority : summary.byMonth
  const paidPct = summary.forecast ? Math.round((summary.actual / summary.forecast) * 100) : 0
  return (
    <Card>
      <SectionTitle>Spend</SectionTitle>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-stone-500">Planned</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatAud(summary.planned)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Spent</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatAud(summary.actual)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Still to buy</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatAud(summary.remaining)}</dd>
        </div>
      </dl>
      <div className="my-3 h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <div className="h-full bg-ochre-500" style={{ width: `${paidPct}%` }} />
      </div>
      <p className="mb-3 text-sm text-stone-600">
        Heading for <strong className="tabular-nums">{formatAud(summary.forecast)}</strong>
        {summary.forecast !== summary.planned && (
          <span className={summary.forecast > summary.planned ? 'text-red-700' : 'text-green-700'}>
            {' '}
            ({summary.forecast > summary.planned ? '+' : '−'}
            {formatAud(Math.abs(summary.forecast - summary.planned))} vs plan)
          </span>
        )}
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-ochre-700">Breakdown</summary>
        <div className="mt-3">
          <Segmented
            label="Breakdown"
            value={view}
            onChange={setView}
            options={[
              { value: 'priority', label: 'By priority' },
              { value: 'month', label: 'By month' },
            ]}
          />
          <table className="mt-3 w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 font-medium">{view === 'priority' ? 'Priority' : 'Month'}</th>
                <th className="py-1 text-right font-medium">Planned</th>
                <th className="py-1 text-right font-medium">Spent</th>
                <th className="py-1 text-right font-medium">To buy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5">{view === 'month' ? (r.key === 'none' ? 'No date' : formatMonth(r.key)) : r.key}</td>
                  <td className="py-1.5 text-right">{formatAud(r.planned)}</td>
                  <td className="py-1.5 text-right">{formatAud(r.actual)}</td>
                  <td className="py-1.5 text-right">{formatAud(r.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}

function PrepRow({ item, today, ownerName, onOpen }: { item: PrepItem; today: IsoDate; ownerName: string | null; onOpen: () => void }) {
  const due = dueState(item, today)
  const [label, tone] = DUE_LABEL[due]
  const muted = !counts(item) || item.status === 'done' || item.status === 'dropped'
  return (
    <li>
      <button onClick={onOpen} className={cx('w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-stone-200', muted && 'opacity-60')}>
        <div className="flex items-start justify-between gap-2">
          <span className={cx('font-medium', item.status === 'done' && 'line-through')}>{item.item}</span>
          <span className="shrink-0 tabular-nums text-stone-700">{item.actualCost !== null ? formatAudExact(item.actualCost) : item.plannedCost !== null ? formatAud(item.plannedCost) : ''}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone={tone}>{label}</Chip>
          <PrioChip p={item.priority} />
          <Chip>{item.category || 'No category'}</Chip>
          {ownerName && <Chip tone="violet">{ownerName}</Chip>}
          {!item.include && <Chip>Excluded duplicate</Chip>}
          {item.removedFromSheet && <Chip tone="amber">Gone from spreadsheet</Chip>}
          {!item.sourceKey && <Chip tone="ochre">Added in app</Chip>}
        </div>
      </button>
    </li>
  )
}

function PrepEditor({ item, onDone }: { item: PrepItem; onDone: () => void }) {
  const { updatePrep, deletePrep, settings } = useStore()
  const [actual, setActual] = useState(item.actualCost === null ? '' : String(item.actualCost))
  const [notes, setNotes] = useState(item.notes)
  const [link, setLink] = useState(item.link)
  const fromSheet = !!item.sourceKey
  const save = (patch: Partial<PrepItem>) => updatePrep(item.id, patch)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <PrioChip p={item.priority} />
        <Chip>{item.category}</Chip>
        {item.buyBy && <Chip>Buy by {formatMonth(item.buyBy)}</Chip>}
        {item.plannedCost !== null && <Chip>Planned {formatAud(item.plannedCost)}</Chip>}
      </div>
      {item.sheetNotes && <p className="rounded-lg bg-stone-100 p-2 text-sm text-stone-700">{item.sheetNotes}</p>}

      <Field group label="Status">
        <Segmented label="Status" value={item.status} onChange={(status) => save({ status })} options={PREP_STATUSES.map((s) => ({ value: s, label: PREP_STATUS_LABEL[s] }))} />
      </Field>

      <Field group label="Who's handling it">
        <Segmented
          label="Who's handling it"
          value={item.owner ?? 'none'}
          onChange={(v) => save({ owner: v === 'none' ? null : (v as PersonId) })}
          options={[...settings.people.map((p) => ({ value: p.id as string, label: p.name })), { value: 'none', label: 'Nobody yet' }]}
        />
      </Field>

      <Field label="Actual cost" hint={actual && parseAmount(actual) === null ? 'Not a number' : undefined}>
        <input inputMode="decimal" className={inputCls} placeholder={item.plannedCost !== null ? `Planned ${formatAud(item.plannedCost)}` : '$'} value={actual} onChange={(e) => setActual(e.target.value)} onBlur={() => save({ actualCost: parseAmount(actual) })} />
      </Field>

      <Field label="Notes">
        <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => save({ notes })} />
      </Field>

      <Field label="Link" hint="A product page or receipt. Photo receipts arrive with the shared database (step 3).">
        <input type="url" className={inputCls} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => save({ link: link.trim() })} />
      </Field>
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className="block truncate text-sm text-ochre-700 underline">
          {item.link}
        </a>
      )}

      {fromSheet ? (
        <p className="text-xs text-stone-500">
          Name, category, planned cost, priority and buy-by come from the spreadsheet{item.sourceList ? ` (${item.sourceList})` : ''}. Change them there and re-import; your status, costs and notes are kept.
        </p>
      ) : (
        <AppItemFields item={item} />
      )}

      <div className="flex gap-2">
        <button
          className={btnPrimary + ' flex-1'}
          onClick={() => {
            save({ actualCost: parseAmount(actual), notes, link: link.trim() })
            onDone()
          }}
        >
          Done
        </button>
        {(!fromSheet || item.removedFromSheet) && (
          <button
            className={btnSecondary + ' text-red-700'}
            onClick={() => {
              if (confirm(`Delete "${item.item}"?`)) {
                deletePrep(item.id)
                onDone()
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

/** Items added in the app have no spreadsheet behind them, so all their fields are editable here. */
function AppItemFields({ item }: { item: PrepItem }) {
  const updatePrep = useStore((s) => s.updatePrep)
  const [planned, setPlanned] = useState(item.plannedCost === null ? '' : String(item.plannedCost))
  return (
    <div className="space-y-4 rounded-xl bg-ochre-50 p-3">
      <ItemBasics
        value={{ item: item.item, category: item.category, priority: item.priority, buyBy: item.buyBy }}
        onChange={(patch) => updatePrep(item.id, patch)}
      />
      <Field label="Planned cost">
        <input inputMode="decimal" className={inputCls} value={planned} onChange={(e) => setPlanned(e.target.value)} onBlur={() => updatePrep(item.id, { plannedCost: parseAmount(planned) })} />
      </Field>
    </div>
  )
}

type Basics = Pick<PrepItem, 'item' | 'category' | 'priority' | 'buyBy'>

/** live: report every keystroke (new-item form). Otherwise text fields save when you leave them. */
function ItemBasics({ value, onChange, live = false }: { value: Basics; onChange: (patch: Partial<Basics>) => void; live?: boolean }) {
  const text = (key: 'item' | 'category') =>
    live
      ? { value: value[key], onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ [key]: e.target.value }) }
      : { defaultValue: value[key], onBlur: (e: FocusEvent<HTMLInputElement>) => (key === 'category' || e.target.value.trim()) && onChange({ [key]: e.target.value.trim() }) }
  const categories = useStore((s) => [...new Set(s.prepItems.map((i) => i.category).filter(Boolean))].sort().join('|'))
  return (
    <>
      <Field label="Item">
        <input className={inputCls} required {...text('item')} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <input className={inputCls} list="prep-categories" {...text('category')} />
          <datalist id="prep-categories">
            {categories.split('|').map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Priority">
          <select className={inputCls} value={value.priority ?? ''} onChange={(e) => onChange({ priority: (e.target.value || null) as Priority | null })}>
            <option value="">None</option>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Buy by (month)">
        <input type="month" className={inputCls} value={value.buyBy?.slice(0, 7) ?? ''} onChange={(e) => onChange({ buyBy: e.target.value ? `${e.target.value}-01` : null })} />
      </Field>
    </>
  )
}

function AddPrep({ onDone }: { onDone: (id: string) => void }) {
  const addPrep = useStore((s) => s.addPrep)
  const [basics, setBasics] = useState<Basics>({ item: '', category: 'Admin', priority: 'Medium', buyBy: null })
  const [planned, setPlanned] = useState('')
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!basics.item.trim()) return
        const id = addPrep({
          ...basics,
          item: basics.item.trim(),
          category: basics.category.trim(),
          sourceList: null,
          plannedCost: parseAmount(planned),
          include: true,
          sheetNotes: '',
          status: 'todo',
          actualCost: null,
          owner: null,
          notes: '',
          link: '',
        })
        onDone(id)
      }}
    >
      <p className="text-sm text-stone-600">For things that aren't in the spreadsheet, like documents, insurance or mail redirection. They count towards the totals.</p>
      <ItemBasics live value={basics} onChange={(p) => setBasics({ ...basics, ...p })} />
      <Field label="Planned cost (optional)">
        <input inputMode="decimal" className={inputCls} value={planned} onChange={(e) => setPlanned(e.target.value)} />
      </Field>
      <button type="submit" className={btnPrimary + ' w-full'}>
        Add item
      </button>
    </form>
  )
}

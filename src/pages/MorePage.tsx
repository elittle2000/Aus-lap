import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { formatDate } from '../lib/dates'
import { Card, Field, SectionTitle, Segmented } from '../components/ui'
import { btnPrimary, btnSecondary, inputCls } from '../components/styles'
import type { PersonId } from '../domain/types'

export default function MorePage() {
  const s = useStore()
  const { settings, updateSettings } = s
  const hasData = s.prepItems.length + s.stays.length > 0

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">More</h1>

      <Card className="space-y-4">
        <SectionTitle>Who's using this phone?</SectionTitle>
        <Segmented label="Who's using this phone?" value={settings.me} onChange={(me: PersonId) => updateSettings({ me })} options={settings.people.map((p) => ({ value: p.id, label: p.name }))} />
        <p className="text-xs text-stone-500">Changes are recorded against this name. Proper sign-in replaces this in step 3.</p>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Trip</SectionTitle>
        <Field label="Departure date" hint={`Every stay's dates follow from this. Currently ${formatDate(settings.departureDate)}.`}>
          <input
            type="date"
            className={inputCls}
            value={settings.departureDate}
            onChange={(e) => {
              const d = e.target.value
              if (d && confirm(`Move the departure to ${formatDate(d)}? Every stay moves with it.`)) updateSettings({ departureDate: d })
            }}
          />
        </Field>
        <Field label="Starting point" hint="Used for the start pin on the map (step 4). Kept on this device.">
          <input className={inputCls} defaultValue={settings.homeAddress} onBlur={(e) => updateSettings({ homeAddress: e.target.value.trim() })} placeholder="Home address" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {settings.people.map((p, i) => (
            <Field key={p.id} label={`Person ${i + 1}`}>
              <input
                className={inputCls}
                defaultValue={p.name}
                onBlur={(e) => e.target.value.trim() && updateSettings({ people: settings.people.map((x) => (x.id === p.id ? { ...x, name: e.target.value.trim() } : x)) })}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>Data</SectionTitle>
        <Link to="/import" className={btnPrimary + ' w-full'}>
          {hasData ? 'Re-import workbook' : 'Import workbook'}
        </Link>
        <button
          className={btnSecondary + ' w-full'}
          disabled={!hasData}
          onClick={async () => {
            const { downloadExport } = await import('../lib/exportData')
            downloadExport({
              departureDate: settings.departureDate,
              people: settings.people,
              prepItems: s.prepItems,
              stays: s.stays,
              archivedStays: s.archivedStays,
              budgetLines: s.budgetLines,
              changes: s.changes,
            })
          }}
        >
          Export everything to Excel
        </button>
        <button
          className="w-full py-2 text-sm text-red-700"
          onClick={() => confirm('Delete all data on this device? Export first if you want a copy.') && s.resetAll()}
        >
          Clear all data on this device
        </button>
      </Card>
    </div>
  )
}

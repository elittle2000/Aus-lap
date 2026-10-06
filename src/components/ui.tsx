import { useEffect, type ReactNode } from 'react'
import type { Priority } from '../domain/types'
import { PRIORITY_TONE, TONES, cx, type Tone } from './styles'


export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200', className)}>{children}</section>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{children}</h2>
      {right}
    </div>
  )
}

export function Chip({ tone = 'stone', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>
}

export const PrioChip = ({ p }: { p: Priority | null }) => (p ? <Chip tone={PRIORITY_TONE[p]}>{p}</Chip> : null)

export function Progress({ label, done, total, tone = 'ochre' }: { label: string; done: number; total: number; tone?: 'ochre' | 'red' | 'green' }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const bar = { ochre: 'bg-ochre-500', red: 'bg-red-500', green: 'bg-green-600' }[tone]
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-stone-500">
          {done} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cx('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-full px-3 py-1.5 text-sm ring-1 transition-colors',
            value === o.value ? 'bg-ochre-600 text-white ring-ochre-600' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** group: wraps a set of buttons (e.g. Segmented), so it must not be a <label> — that would rename the first button. */
export function Field({ label, children, hint, group = false }: { label: string; children: ReactNode; hint?: ReactNode; group?: boolean }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block">
      <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </Tag>
  )
}

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-sand p-4 pb-8 shadow-xl sm:max-w-lg sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <button onClick={onClose} className="-m-1 rounded-full p-1 text-2xl leading-none text-stone-500 hover:bg-stone-200" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-stone-500">{children}</p>
}

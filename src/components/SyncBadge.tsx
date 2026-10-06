import { useSyncStatus } from '../sync/engine'
import { supabase } from '../lib/supabase'
import { cx } from './styles'

/** Small status line in the header: synced / syncing / offline with N waiting. */
export function SyncBadge() {
  const { status, pending, message } = useSyncStatus()
  if (!supabase) return <span className="text-xs text-stone-400">This device only</span>
  const [label, dot] =
    status === 'offline'
      ? [pending ? `Offline · ${pending} waiting` : 'Offline', 'bg-stone-400']
      : status === 'error'
        ? [pending ? `Not synced · ${pending} waiting` : 'Sync problem', 'bg-red-500']
        : status === 'syncing' || status === 'loading'
          ? ['Syncing…', 'bg-amber-400']
          : ['Synced', 'bg-green-500']
  return (
    <span className="flex items-center gap-1.5 text-xs text-stone-500" title={message ?? undefined}>
      <span className={cx('size-2 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  )
}

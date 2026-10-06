import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import { syncedOf, useStore } from '../store'
import { allRows, computeRows, mergeIncoming, rowKey, stateFromRows, toDbRecord, type DbRows, type Row, type Table } from './ops'

// Keeps this phone and the shared database in step.
//
//  * Local edits are saved on the phone straight away, then queued ("outbox") and
//    uploaded. The outbox is kept in local storage, so edits made with no signal
//    survive closing the app and go up when the phone is back online.
//  * The other phone's edits arrive live (Supabase Realtime). After reconnecting,
//    or when the app comes back to the foreground, everything is re-read to catch
//    anything missed.
//  * If both phones edit the same record before syncing, the later upload wins.

const OUTBOX_KEY = 'big-lap-outbox'
const TABLES: Table[] = ['prep_items', 'stays', 'change_log', 'app_settings']

export type SyncStatus = 'idle' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error'

export const useSyncStatus = create<{ status: SyncStatus; pending: number; lastSynced: string | null; message: string | null }>(() => ({
  status: 'idle',
  pending: 0,
  lastSynced: null,
  message: null,
}))

function loadOutbox(): Map<string, Row> {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    return new Map(raw ? (JSON.parse(raw) as [string, Row][]) : [])
  } catch {
    return new Map()
  }
}

export class SyncEngine {
  private outbox = loadOutbox()
  private applyingRemote = false
  private unsubscribeStore: (() => void) | null = null
  private channel: RealtimeChannel | null = null
  private flushing: Promise<void> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 2000
  private remoteTimer: ReturnType<typeof setTimeout> | null = null
  private incoming: Partial<DbRows> = {}
  private stopped = false
  private readonly db: SupabaseClient

  constructor(db: SupabaseClient) {
    this.db = db
  }

  async start() {
    this.setStatus({ status: 'loading' })
    await this.pull({ firstRun: true })

    // Every local change → work out the rows that changed → outbox → upload.
    this.unsubscribeStore = useStore.subscribe((state, prev) => {
      if (this.applyingRemote) return
      const before = syncedOf(prev)
      const after = syncedOf(state)
      // Safety net: never wipe a whole table from one phone in one go.
      if ((before.prepItems.length > 5 && !after.prepItems.length) || (before.stays.length > 5 && !after.stays.length)) {
        this.setStatus({ status: 'error', message: 'Refused to delete everything. Reload the app to get the shared data back.' })
        return
      }
      const rows = computeRows(before, after)
      if (rows.length) this.enqueue(rows)
    })

    this.channel = this.db.channel('big-lap')
    for (const table of TABLES) {
      this.channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (payload.eventType === 'DELETE') return // rows are only ever soft-deleted
        const list = (this.incoming[table] ??= []) as unknown[]
        list.push(payload.new)
        this.scheduleIncoming()
      })
    }
    let firstConnect = true
    this.channel.subscribe((status) => {
      // On reconnect, re-read everything in case we missed changes while away.
      if (status === 'SUBSCRIBED' && !firstConnect) void this.pull()
      if (status === 'SUBSCRIBED') firstConnect = false
    })

    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    document.addEventListener('visibilitychange', this.onVisible)
    void this.flush()
  }

  stop() {
    this.stopped = true
    this.unsubscribeStore?.()
    if (this.channel) void this.db.removeChannel(this.channel)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    document.removeEventListener('visibilitychange', this.onVisible)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.remoteTimer) clearTimeout(this.remoteTimer)
  }

  /** Forget this phone's queued changes (used when signing out). */
  static clearOutbox() {
    localStorage.removeItem(OUTBOX_KEY)
  }

  private onOnline = () => {
    this.retryDelay = 2000
    void this.flush().then(() => this.pull())
  }
  private onOffline = () => this.setStatus({ status: 'offline' })
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.flush().then(() => this.pull())
  }

  private enqueue(rows: Row[]) {
    for (const r of rows) this.outbox.set(rowKey(r), r)
    this.saveOutbox()
    void this.flush()
  }

  private saveOutbox() {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify([...this.outbox.entries()]))
    } catch {
      // Storage full or unavailable: the queue still lives in memory for this session.
    }
    useSyncStatus.setState({ pending: this.outbox.size })
  }

  /** Upload everything queued. Safe to call often; runs one upload at a time. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.outbox.size ? this.flush() : undefined))
    if (!this.outbox.size) {
      if (useSyncStatus.getState().status !== 'loading') this.setStatus({ status: navigator.onLine ? 'synced' : 'offline' })
      return Promise.resolve()
    }
    if (!navigator.onLine) {
      this.setStatus({ status: 'offline' })
      return Promise.resolve()
    }
    this.setStatus({ status: 'syncing' })
    this.flushing = this.upload().finally(() => (this.flushing = null))
    return this.flushing
  }

  private async upload() {
    const batch = [...this.outbox.entries()]
    const byTable = new Map<Table, [string, Row][]>()
    for (const e of batch) byTable.set(e[1].table, [...(byTable.get(e[1].table) ?? []), e])
    try {
      // Settings and reference data first, then records, then the log.
      for (const table of ['app_settings', 'prep_items', 'stays', 'change_log'] as Table[]) {
        const entries = byTable.get(table) ?? []
        for (let i = 0; i < entries.length; i += 200) {
          const chunk = entries.slice(i, i + 200)
          const { error } = await this.db.from(table).upsert(chunk.map(([, r]) => toDbRecord(r)), {
            onConflict: table === 'app_settings' ? 'key' : 'id',
            // The change log is append-only. A retried upload of an entry that already
            // arrived (the connection dropped after the save) is simply skipped.
            ignoreDuplicates: table === 'change_log',
          })
          if (error) throw error
          // Only clear what we sent; anything re-queued meanwhile stays.
          for (const [k, r] of chunk) if (this.outbox.get(k) === r) this.outbox.delete(k)
          this.saveOutbox()
        }
      }
      this.retryDelay = 2000
      this.setStatus({ status: 'synced', lastSynced: new Date().toISOString(), message: null })
    } catch (e) {
      const message = (e as { message?: string }).message ?? String(e)
      this.setStatus({ status: navigator.onLine ? 'error' : 'offline', message })
      if (!this.stopped) {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => void this.flush(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
      }
    }
  }

  private scheduleIncoming() {
    // A spreadsheet import changes ~150 rows at once; apply the burst in one go.
    if (this.remoteTimer) clearTimeout(this.remoteTimer)
    this.remoteTimer = setTimeout(() => {
      const incoming = this.incoming
      this.incoming = {}
      this.applyState(mergeIncoming(syncedOf(useStore.getState()), incoming, [...this.outbox.values()]))
    }, 250)
  }

  private applyState(next: ReturnType<typeof stateFromRows>) {
    this.applyingRemote = true
    try {
      useStore.getState().applyRemote(next)
    } finally {
      this.applyingRemote = false
    }
  }

  /** Read everything from the database and update the phone, keeping unsent local changes. */
  async pull({ firstRun = false } = {}) {
    if (!navigator.onLine) {
      if (firstRun) this.setStatus({ status: 'offline' })
      return
    }
    try {
      const db = await this.readAll()
      const empty = TABLES.every((t) => (db[t] as unknown[]).length === 0)
      const local = syncedOf(useStore.getState())
      const hasLocal = local.prepItems.length + local.stays.length > 0

      if (firstRun && empty && hasLocal) {
        // First phone to connect: upload what's on it.
        this.enqueue(allRows(local))
        return
      }
      this.applyState(stateFromRows(db, [...this.outbox.values()], local))
      if (!this.outbox.size) this.setStatus({ status: 'synced', lastSynced: new Date().toISOString(), message: null })
    } catch (e) {
      this.setStatus({ status: 'error', message: (e as Error).message })
    }
  }

  private async readAll(): Promise<DbRows> {
    const read = async <T>(table: Table, columns: string): Promise<T[]> => {
      const out: T[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.db.from(table).select(columns).range(from, from + 999)
        if (error) throw error
        out.push(...(data as T[]))
        if (data.length < 1000) return out
      }
    }
    const [prep_items, stays, change_log, app_settings] = await Promise.all([
      read<DbRows['prep_items'][number]>('prep_items', 'id,data,deleted,updated_at'),
      read<DbRows['stays'][number]>('stays', 'id,position,archived,data,deleted,updated_at'),
      read<DbRows['change_log'][number]>('change_log', 'id,at,data,updated_by'),
      read<DbRows['app_settings'][number]>('app_settings', 'key,data'),
    ])
    return { prep_items, stays, change_log, app_settings }
  }

  private setStatus(s: Partial<ReturnType<typeof useSyncStatus.getState>>) {
    useSyncStatus.setState(s)
  }
}

import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Stay } from '../domain/types'
import { Geocoder, needsPoint, suspiciousJumps, type GeoPoint, type LatLng } from './geocode'

/** Resolves once the app is on screen and online (phones pause hidden pages). */
function whenActive(): Promise<void> {
  const ready = () => document.visibilityState === 'visible' && navigator.onLine
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => {
      if (!ready()) return
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
      resolve()
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
  })
}

/** Keep the screen on while searching, where the phone supports it; re-acquired when the app comes back. */
async function keepAwake(): Promise<() => void> {
  type WakeLock = { release: () => Promise<void> }
  const api = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }).wakeLock
  if (!api) return () => {}
  let lock: WakeLock | null = null
  const grab = async () => {
    try {
      if (document.visibilityState === 'visible') lock = await api.request('screen')
    } catch {
      // Not allowed (e.g. low battery mode): carry on without it.
    }
  }
  await grab()
  document.addEventListener('visibilitychange', grab)
  return () => {
    document.removeEventListener('visibilitychange', grab)
    void lock?.release().catch(() => {})
  }
}

/** Stays that should be on the map but have no position yet. */
export const missingPlaces = (stays: Stay[]) => stays.filter((s) => needsPoint(s) && !s.geo)

/**
 * Looks up every stay that has no map position, one request a second (the map
 * service's rule), saving every few so progress isn't lost if the app closes.
 * Each place is only ever looked up once: the result is stored on the stay and synced.
 */
export function useFindPlaces() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    setError(null)
    const { stays, locations, setStayGeo } = useStore.getState()
    const refs = new Map(locations.map((l) => [l.baseCamp, l]))
    const todo = missingPlaces(stays)
    setProgress({ done: 0, total: todo.length })
    const geocoder = new Geocoder()
    // Before each retry: wait as usual, and if the app is hidden or offline, pause until it's back.
    const defaultWait = geocoder.beforeRetry
    geocoder.beforeRetry = async (attempt) => {
      await defaultWait(attempt)
      await whenActive()
    }
    const release = await keepAwake()
    let failed = 0
    let lastError = ''
    let pending: { id: string; geo: GeoPoint | null }[] = []
    let found = 0
    const flush = () => {
      if (pending.length) setStayGeo(pending, `Found map positions for ${pending.length} place${pending.length === 1 ? '' : 's'}`)
      pending = []
    }
    try {
      for (const [i, stay] of todo.entries()) {
        // Search near the last confidently-placed stop before this one on the route.
        const current = useStore.getState().stays
        const idx = current.findIndex((s) => s.id === stay.id)
        const near: LatLng | null = [...current.slice(0, idx)].reverse().find((s) => s.geo && s.geo.quality !== 'check')?.geo ?? null
        await whenActive()
        let geo: GeoPoint | null = null
        try {
          geo = await geocoder.locate(stay.baseCamp, refs.get(stay.baseCamp), near)
        } catch (e) {
          // Still failing after retries: skip this stop and keep going; it can be retried later.
          failed++
          lastError = (e as Error).message
        }
        if (geo) {
          pending.push({ id: stay.id, geo })
          found++
        }
        setProgress({ done: i + 1, total: todo.length })
        if (pending.length >= 8) flush()
      }
      flush()
      // A point far from both its neighbours is probably a same-named place elsewhere: flag it.
      const after = useStore.getState().stays.filter((s) => needsPoint(s))
      const jumps = suspiciousJumps(after.map((s) => s.geo ?? null))
      const flagged = after.filter((s, i) => jumps.has(i) && s.geo && s.geo.quality === 'good')
      if (flagged.length) useStore.getState().setStayGeo(flagged.map((s) => ({ id: s.id, geo: { ...s.geo!, quality: 'check' } })), `Flagged ${flagged.length} map position${flagged.length === 1 ? '' : 's'} to check`)
      const notFound = todo.length - found - failed
      const parts = []
      if (failed) parts.push(`${failed} search${failed === 1 ? '' : 'es'} didn't get an answer (${lastError}). Tap "Find them" to try those again.`)
      if (notFound) parts.push(`${notFound} place${notFound === 1 ? '' : 's'} couldn't be found. Open each stay to put it on the map by hand.`)
      if (parts.length) setError(parts.join(' '))
    } catch (e) {
      flush()
      setError(`The map search stopped: ${(e as Error).message}. Places already found are kept; tap "Find them" to carry on.`)
    } finally {
      release()
      running.current = false
      setProgress(null)
    }
  }, [])

  return { run, progress, error }
}

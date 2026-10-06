import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Stay } from '../domain/types'
import { Geocoder, needsPoint, suspiciousJumps, type GeoPoint, type LatLng } from './geocode'

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
        const geo = await geocoder.locate(stay.baseCamp, refs.get(stay.baseCamp), near)
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
      if (found < todo.length) setError(`${todo.length - found} place${todo.length - found === 1 ? '' : 's'} couldn't be found. Open each stay to put it on the map by hand.`)
    } catch (e) {
      flush()
      setError(navigator.onLine ? `The map search stopped: ${(e as Error).message}. Try again later; places already found are kept.` : 'No signal. Try again when you are back online; places already found are kept.')
    } finally {
      running.current = false
      setProgress(null)
    }
  }, [])

  return { run, progress, error }
}

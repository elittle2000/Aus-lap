import type { LocationRef, Stay } from '../domain/types'

// Finds a map position for each base camp, once, using OpenStreetMap's Nominatim.
// Usage policy: at most one request a second, results cached (we store them on the
// stay, so each place is looked up once ever), no bulk use.
// https://operations.osmfoundation.org/policies/nominatim/

export interface GeoPoint {
  lat: number
  lng: number
  /** What the map service called the place it found. */
  label: string
  /** 'good' = found the place by its own name; 'check' = a guess worth eyeballing; 'manual' = set by hand. */
  quality: 'good' | 'check' | 'manual'
  /** Two-letter state worked out from the position (the spreadsheet's Region column is unreliable). */
  state: AuState | null
}

export type AuState = 'QLD' | 'NSW' | 'VIC' | 'TAS' | 'SA' | 'WA' | 'NT' | 'ACT'

const STATE_NAMES: Record<string, AuState> = {
  queensland: 'QLD',
  'new south wales': 'NSW',
  victoria: 'VIC',
  tasmania: 'TAS',
  'south australia': 'SA',
  'western australia': 'WA',
  'northern territory': 'NT',
  'australian capital territory': 'ACT',
}

/** Stays that aren't a place on the map: flexible days and the ferry crossings themselves. */
export function needsPoint(stay: Pick<Stay, 'kind' | 'type'>): boolean {
  return stay.kind === 'stay' && stay.type !== 'Ferry crossing'
}

const NOISE = [/^stop\s*&\s*earn:\s*/i, /\bcamp host\s*[-–]\s*/i, /\((optional|extended|pre-ferry|tall trees)\)/gi, /\btransit\b/gi, /\bcrossing\b/gi]

/** Search strings to try, best first. */
export function queriesFor(baseCamp: string, ref?: LocationRef | null): { q: string; fallback: boolean }[] {
  let name = baseCamp
  for (const n of NOISE) name = name.replace(n, ' ')
  const inParens = [...name.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[/+,]/)).map((s) => s.trim()).filter(Boolean)
  const outside = name.replace(/\([^)]*\)/g, ' ')
  // "Port Augusta to Eyre Peninsula" → try the destination, then the origin
  const legs = outside.split(/\s+to\s+/i).reverse()
  const mains = legs.flatMap((l) => l.split(/\s+\/\s+|\s*&\s*|,/)).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2)

  const out: { q: string; fallback: boolean }[] = []
  const add = (q: string, fallback: boolean) => {
    const clean = q.replace(/\s+/g, ' ').trim()
    // A single short word ("West") matches something random somewhere.
    if (fallback && !/\s/.test(clean) && clean.length < 6) return
    if (clean && !out.some((o) => o.q.toLowerCase() === clean.toLowerCase())) out.push({ q: clean, fallback })
  }
  // The full name with its parenthetical detail, e.g. "Red Cliff Campground Gibraltar Range NP"
  if (inParens.length === 1) add(`${outside} ${inParens[0]}`, false)
  mains.forEach((m, i) => add(m, i > 0))
  inParens.forEach((p) => add(`${p} ${mains[0] ?? ''}`, true))
  inParens.forEach((p) => add(p, true))
  // Vague names: "Nirranda Coast" → "Nirranda", "West coast beaches" → "West coast"
  const GENERIC = /\b(coast|beaches|beach|region|area|fringe|extended|np|national park)\b/gi
  mains.forEach((m) => add(m.replace(GENERIC, ' '), true))
  if (ref?.generalLocation) {
    // "Byron Bay region, NSW far north coast" → "Byron Bay"
    add(ref.generalLocation.split(/,| region\b| via /i)[0], true)
  }
  return out
}

interface NominatimHit {
  lat: string
  lon: string
  display_name: string
  addresstype?: string
  address?: { state?: string }
}

export interface LatLng {
  lat: number
  lng: number
}

/** Half-width of the "near the previous stop" search box, in degrees (~2° ≈ 200 km). */
const NEAR_DEG = 2

export type Fetcher = (url: string) => Promise<NominatimHit[]>

const browserFetch: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`Map search answered ${r.status}`)
  return r.json()
}

/** Furthest a guess may be from the previous stop before it's treated as a different place. */
const MAX_GUESS_KM = 600

function toPoint(hit: NominatimHit, quality: GeoPoint['quality']): GeoPoint {
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name.split(',').slice(0, 3).join(','),
    quality,
    state: STATE_NAMES[(hit.address?.state ?? '').toLowerCase()] ?? null,
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Rate-limited lookups: one request a second at most, per the usage policy. */
export class Geocoder {
  private last = 0
  private readonly fetcher: Fetcher
  private readonly gapMs: number

  private readonly retries: number
  /** Called before each retry; by default waits 3 s, 8 s, 20 s. Also where the app pauses while hidden. */
  beforeRetry: (attempt: number) => Promise<void> = (attempt) => wait([3000, 8000, 20000][attempt] ?? 20000)

  constructor(fetcher: Fetcher = browserFetch, gapMs = 1100, retries = 3) {
    this.fetcher = fetcher
    this.gapMs = gapMs
    this.retries = retries
  }

  private async search(q: string, near?: LatLng): Promise<NominatimHit | null> {
    const delay = this.last + this.gapMs - Date.now()
    if (delay > 0) await wait(delay)
    this.last = Date.now()
    // Near the previous stop: only look within a box around it.
    const box = near ? `&bounded=1&viewbox=${near.lng - NEAR_DEG},${near.lat + NEAR_DEG},${near.lng + NEAR_DEG},${near.lat - NEAR_DEG}` : ''
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=au&limit=1&addressdetails=1&accept-language=en${box}&q=${encodeURIComponent(q)}`
    // A dropped connection or a "slow down" answer shouldn't end the whole run: wait and try again.
    for (let attempt = 0; ; attempt++) {
      try {
        const hits = await this.fetcher(url)
        return hits[0] ?? null
      } catch (e) {
        if (attempt >= this.retries) throw e
        await this.beforeRetry(attempt)
        this.last = Date.now()
      }
    }
  }

  /**
   * near = the previous stop on the route. Every search is tried close to it first, so
   * "Little Bay Beach" finds the one at South West Rocks rather than the one in Sydney.
   */
  async locate(baseCamp: string, ref?: LocationRef | null, near?: LatLng | null): Promise<GeoPoint | null> {
    const queries = queriesFor(baseCamp, ref)
    // Each search near the previous stop first, then anywhere; the base camp's own name before guesses.
    const attempts = queries.flatMap((x) => (near ? [{ ...x, around: near }, { ...x, around: undefined }] : [{ ...x, around: undefined }]))
    const wantsRoad = /\b(road|rd|track|trail|highway|way)\b/i.test(baseCamp)
    let backup: GeoPoint | null = null
    for (const { q, fallback, around } of attempts) {
      const hit = await this.search(q, around)
      if (!hit) continue
      // A guess hundreds of km from where we just were is a same-named place elsewhere.
      if (fallback && near && kmBetween(near, { lat: Number(hit.lat), lng: Number(hit.lon) }) > MAX_GUESS_KM) {
        backup ??= toPoint(hit, 'check')
        continue
      }
      // A road that merely shares the name ("Old Geraldton Road") isn't the town.
      if (!wantsRoad && hit.addresstype === 'road') {
        backup ??= toPoint(hit, 'check')
        continue
      }
      const broad = ['state', 'region', 'county', 'island'].includes(hit.addresstype ?? '')
      return toPoint(hit, fallback || broad ? 'check' : 'good')
    }
    // Nothing convincing: offer the first far-off or road match, flagged for checking.
    return backup
  }
}

/** What's at a point (for a pin placed by hand): one request, so no rate limiting needed. */
export async function describePoint(lat: number, lng: number): Promise<Pick<GeoPoint, 'label' | 'state'> | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    const hit = (await r.json()) as NominatimHit
    if (!hit?.display_name) return null
    return { label: hit.display_name.split(',').slice(0, 3).join(','), state: STATE_NAMES[(hit.address?.state ?? '').toLowerCase()] ?? null }
  } catch {
    return null // offline: the pin is still saved, just without a name
  }
}

/** Great-circle distance in km. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Flag points that look wrong for the route: a jump far bigger than a day or two's
 * drive from both neighbours usually means the search found a same-named place elsewhere.
 */
export function suspiciousJumps(points: (LatLng | null)[], limitKm = 600): Set<number> {
  const out = new Set<number>()
  const idx = points.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)
  idx.forEach((i, k) => {
    if (k === 0 || k === idx.length - 1) return // only one neighbour: can't tell which end is wrong
    const p = points[i]!
    if (kmBetween(p, points[idx[k - 1]]!) > limitKm && kmBetween(p, points[idx[k + 1]]!) > limitKm) out.add(i)
  })
  return out
}

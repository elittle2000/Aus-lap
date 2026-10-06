import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store'
import type { Stay } from '../domain/types'
import { describePoint, type GeoPoint } from './geocode'

// A stay's position on the map. Drag the pin, or tap the map, to correct it.

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-95%)">📍</div>',
  iconSize: [0, 0],
})

export default function PlacePicker({ stay }: { stay: Stay }) {
  const setStayGeo = useStore((s) => s.setStayGeo)
  const el = useRef<HTMLDivElement>(null)
  // Neighbouring stops give context when placing a pin that hasn't been found yet.
  const neighbours = useStore((s) => {
    const i = s.stays.findIndex((x) => x.id === stay.id)
    const before = s.stays.slice(0, i).reverse().find((x) => x.geo)?.geo ?? null
    const after = s.stays.slice(i + 1).find((x) => x.geo)?.geo ?? null
    return JSON.stringify([before, after])
  })

  useEffect(() => {
    if (!el.current) return
    const [before, after] = JSON.parse(neighbours) as [GeoPoint | null, GeoPoint | null]
    const map = L.map(el.current, { zoomControl: true, scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    const save = async (lat: number, lng: number) => {
      const about = await describePoint(lat, lng)
      setStayGeo([{ id: stay.id, geo: { lat, lng, label: about?.label ?? 'Set by hand', quality: 'manual', state: about?.state ?? null } }], `${stay.baseCamp}: moved on the map`)
    }

    for (const n of [before, after]) if (n) L.circleMarker([n.lat, n.lng], { radius: 4, color: '#78716c', fillOpacity: 0.6 }).addTo(map)

    if (stay.geo) {
      const marker = L.marker([stay.geo.lat, stay.geo.lng], { icon: pinIcon, draggable: true, autoPan: true }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        void save(p.lat, p.lng)
      })
      map.setView([stay.geo.lat, stay.geo.lng], 9)
    } else {
      const pts = [before, after].filter(Boolean) as GeoPoint[]
      if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 9 })
      else map.setView([-27, 134], 3)
    }
    // No pin yet: tap to place it. (Once there is one, it moves by dragging, so looking around can't move it.)
    if (!stay.geo) map.on('click', (e: L.LeafletMouseEvent) => void save(e.latlng.lat, e.latlng.lng))

    return () => {
      map.remove()
    }
    // Rebuild only when this stay's position or its neighbours change.
  }, [stay.id, stay.geo, stay.baseCamp, neighbours, setStayGeo])

  return <div ref={el} className="h-56 w-full overflow-hidden rounded-xl bg-stone-200" role="application" aria-label={`Map position of ${stay.baseCamp}. Drag the pin or tap the map to move it.`} />
}

import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store'
import { useTrip } from '../hooks'
import { carPosition, routePoints, splitRoute } from './progress'

// The whole route as a line, with a car where the itinerary says we are today.
// Map tiles come from OpenStreetMap's standard tile server (free, with attribution);
// only the tiles you look at are loaded, never downloaded in bulk.

const OCHRE = '#a8631e'

const carIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:28px;line-height:28px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.4));transform:translate(-50%,-60%)">🚙</div>',
  iconSize: [0, 0],
})
const endIcon = (emoji: string) =>
  L.divIcon({ className: '', html: `<div style="font-size:18px;line-height:18px;transform:translate(-50%,-90%)">${emoji}</div>`, iconSize: [0, 0] })

export default function RouteMap({ height = 260, animate = true }: { height?: number; animate?: boolean }) {
  const stays = useStore((s) => s.stays)
  const { spans, dayNumber } = useTrip()
  const el = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const points = useMemo(() => routePoints(stays, spans), [stays, spans])
  const car = useMemo(() => carPosition(points, dayNumber), [points, dayNumber])

  useEffect(() => {
    if (!el.current || !points.length || !car) return
    const map = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const latlngs = points.map((p) => L.latLng(p.lat, p.lng))
    const { done, todo } = splitRoute(points, car)
    L.polyline(todo.map((p) => [p.lat, p.lng]), { color: '#78716c', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(map)
    const driven = L.polyline([], { color: OCHRE, weight: 4 }).addTo(map)

    // Small dots for each stop; tap one to open the stay.
    for (const p of points) {
      L.circleMarker([p.lat, p.lng], { radius: 3, color: '#57534e', weight: 1, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(p.name, { direction: 'top' })
        .on('click', () => navigate(`/stays/${p.stayId}`))
        .addTo(map)
    }
    L.marker(latlngs[0], { icon: endIcon('📍'), interactive: false }).addTo(map)
    L.marker(latlngs[latlngs.length - 1], { icon: endIcon('🏁'), interactive: false }).addTo(map)
    const carMarker = L.marker([car.lat, car.lng], { icon: carIcon, interactive: false, zIndexOffset: 1000 }).addTo(map)

    map.fitBounds(L.latLngBounds(latlngs), { padding: [16, 16] })

    // Drive the car from the start to today's spot along the route when the map opens.
    let frame = 0
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (animate && !reduceMotion && done.length > 1) {
      const seg = done.slice(1).map((p, i) => map.distance([done[i].lat, done[i].lng], [p.lat, p.lng]))
      const total = seg.reduce((a, b) => a + b, 0)
      const duration = 2500
      const t0 = performance.now()
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / duration)
        const eased = 1 - Math.pow(1 - k, 3)
        let left = total * eased
        const path: L.LatLngExpression[] = [[done[0].lat, done[0].lng]]
        let pos: [number, number] = [done[0].lat, done[0].lng]
        for (let i = 0; i < seg.length; i++) {
          const a = done[i]
          const b = done[i + 1]
          if (left >= seg[i]) {
            path.push([b.lat, b.lng])
            pos = [b.lat, b.lng]
            left -= seg[i]
          } else {
            const f = seg[i] ? left / seg[i] : 0
            pos = [a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f]
            path.push(pos)
            break
          }
        }
        driven.setLatLngs(path)
        carMarker.setLatLng(pos)
        if (k < 1) frame = requestAnimationFrame(step)
      }
      carMarker.setLatLng([done[0].lat, done[0].lng])
      frame = requestAnimationFrame(step)
    } else {
      driven.setLatLngs(done.map((p) => [p.lat, p.lng]))
    }

    return () => {
      cancelAnimationFrame(frame)
      map.remove()
    }
  }, [points, car, animate, navigate])

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl bg-stone-200" role="img" aria-label="Map of the route with the car at today's position" />
}

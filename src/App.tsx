import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { cx } from './components/styles'
import { personName, useStore } from './store'
import HomePage from './pages/HomePage'
import PrepPage from './pages/PrepPage'
import StaysPage from './pages/StaysPage'
import StayDetailPage from './pages/StayDetailPage'
import MorePage from './pages/MorePage'

// The spreadsheet reader is large, so it only loads when importing.
const ImportPage = lazy(() => import('./pages/ImportPage'))

const TABS = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/prep', label: 'Prep', icon: '✓' },
  { to: '/stays', label: 'Stays', icon: '⛺' },
  { to: '/more', label: 'More', icon: '☰' },
]

export default function App() {
  const settings = useStore((s) => s.settings)
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-sand/95 px-4 py-3 backdrop-blur">
        <span className="font-semibold tracking-tight text-ochre-700">Big Lap</span>
        <NavLink to="/more" className="text-sm text-stone-500">
          You: <span className="font-medium text-stone-800">{personName(settings.people, settings.me)}</span>
        </NavLink>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/prep" element={<PrepPage />} />
          <Route path="/stays" element={<StaysPage />} />
          <Route path="/stays/:id" element={<StayDetailPage />} />
          <Route path="/import" element={<Suspense fallback={<p className="text-stone-500">Loading…</p>}><ImportPage /></Suspense>} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.to === '/'}
                className={({ isActive }) => cx('flex flex-col items-center py-2 text-xs', isActive ? 'font-semibold text-ochre-700' : 'text-stone-500')}
              >
                <span className="text-xl leading-6" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

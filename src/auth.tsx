import { useEffect, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useStore } from './store'
import { SyncEngine } from './sync/engine'
import { Card } from './components/ui'
import type { PersonId } from './domain/types'
import { confirmedPerson, forgetJoinLink, joinLink, rememberPerson } from './lib/joinLink'

// No sign-in screen. Each of us has a private link:
//   https://…/Aus-lap/?join=<secret>&me=ethan
// Opening it signs the phone in anonymously (no email, no password) and joins the
// trip with the secret. The phone then stays in for good. The link is also kept on
// the phone, so it can quietly rejoin if the session is ever lost.

type Gate = { state: 'loading' } | { state: 'no-access'; reason: 'no-link' | 'bad-link' | 'error'; detail?: string } | { state: 'ready' }

let engine: SyncEngine | null = null

/** null person = not joined; error = couldn't ask (e.g. no signal). */
async function whoAmI(db: SupabaseClient): Promise<{ me: PersonId | null; error: boolean }> {
  const { data, error } = await db.rpc('current_person')
  return { me: (data as PersonId | null) ?? null, error: !!error }
}

/** Wraps the app: with a database configured, nothing shows until this phone has joined with its link. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(supabase ? { state: 'loading' } : { state: 'ready' })

  useEffect(() => {
    if (!supabase) return
    const db = supabase
    let current: string | null | undefined = undefined // undefined = not checked yet

    async function onSession(session: Session | null) {
      const userId = session?.user.id ?? null
      if (userId === current) return
      current = userId
      engine?.stop()
      engine = null
      // Read fresh each time: "Remove this phone" forgets the link before signing out.
      const link = joinLink()

      if (!session) {
        if (!link) return setGate({ state: 'no-access', reason: 'no-link' })
        const { error } = await db.auth.signInAnonymously()
        if (error) setGate({ state: 'no-access', reason: 'error', detail: error.message })
        return // the new session arrives through onAuthStateChange
      }

      const asked = await whoAmI(db)
      let me = asked.me
      // No signal: this phone already joined before, so open the copy kept on it.
      if (asked.error && !me) me = confirmedPerson(session.user.id)
      if (!me && link && !asked.error) {
        const { error } = await db.rpc('join_trip', { trip_key: link.key, person: link.me })
        if (error) {
          if (/wrong link/i.test(error.message)) {
            forgetJoinLink()
            return setGate({ state: 'no-access', reason: 'bad-link' })
          }
          return setGate({ state: 'no-access', reason: 'error', detail: error.message })
        }
        me = (await whoAmI(db)).me
      }
      if (!me) return setGate({ state: 'no-access', reason: link ? 'error' : 'no-link' })
      rememberPerson(session.user.id, me)

      const { data: members } = await db.from('members').select('person_id, display_name')
      const people = useStore.getState().settings.people.map((p) => ({ ...p, name: members?.find((m) => m.person_id === p.id)?.display_name ?? p.name }))
      useStore.getState().updateSettings({ me, people })
      engine = new SyncEngine(db)
      setGate({ state: 'ready' })
      await engine.start()
    }

    db.auth.getSession().then(({ data }) => onSession(data.session))
    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => void onSession(session), 0)
    })
    return () => {
      sub.subscription.unsubscribe()
      engine?.stop()
      engine = null
    }
  }, [])

  if (gate.state === 'loading') return <Centered>Loading…</Centered>
  if (gate.state === 'no-access')
    return (
      <Centered>
        <h1 className="mb-4 text-3xl font-semibold text-ochre-700">Big Lap</h1>
        <Card className="space-y-3">
          {gate.reason === 'no-link' && <p>This app is private. Open it using your personal link (the one Ethan texted you).</p>}
          {gate.reason === 'bad-link' && <p>That link doesn't work any more. Ask Ethan for a new one.</p>}
          {gate.reason === 'error' && (
            <>
              <p>Couldn't connect. Check you have signal, then reload the page.</p>
              {gate.detail && <p className="text-xs text-stone-500">{gate.detail}</p>}
            </>
          )}
        </Card>
      </Centered>
    )
  return <>{children}</>
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">{children}</div>
}

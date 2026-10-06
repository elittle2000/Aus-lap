import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useStore } from './store'
import { SyncEngine } from './sync/engine'
import { Card, Field } from './components/ui'
import { btnPrimary, btnSecondary, inputCls } from './components/styles'
import type { PersonId } from './domain/types'

type Gate = { state: 'loading' } | { state: 'signed-out' } | { state: 'not-member'; email: string } | { state: 'ready' }

let engine: SyncEngine | null = null

/** Wraps the app: with a database configured, nothing shows until one of us has signed in. */
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
      if (!session) return setGate({ state: 'signed-out' })

      const { data: members, error } = await db.from('members').select('person_id, display_name, email')
      const me = members?.find((m) => m.email === session.user.email?.toLowerCase())
      if (error || !me) return setGate({ state: 'not-member', email: session.user.email ?? '' })

      const people = useStore.getState().settings.people.map((p) => ({ ...p, name: members!.find((m) => m.person_id === p.id)?.display_name ?? p.name }))
      useStore.getState().updateSettings({ me: me.person_id as PersonId, people })
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
  if (gate.state === 'signed-out') return <SignIn />
  if (gate.state === 'not-member')
    return (
      <Centered>
        <Card className="space-y-3">
          <p>
            <strong>{gate.email}</strong> isn't one of the two accounts that can use this app.
          </p>
          <button className={btnSecondary + ' w-full'} onClick={() => supabase!.auth.signOut()}>
            Sign out
          </button>
        </Card>
      </Centered>
    )
  return <>{children}</>
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">{children}</div>
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // Never create accounts from here: only the two of us exist.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
    })
    setBusy(false)
    if (error) setError(/signups? not allowed|not found/i.test(error.message) ? "That email isn't one of the two accounts for this app." : error.message)
    else setSent(true)
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Send a new one.' : error.message)
  }

  return (
    <Centered>
      <h1 className="mb-1 text-3xl font-semibold text-ochre-700">Big Lap</h1>
      <p className="mb-6 text-stone-600">Sign in with your email. No password needed.</p>
      <Card>
        {!sent ? (
          <form onSubmit={send} className="space-y-4">
            <Field label="Email">
              <input type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <button className={btnPrimary + ' w-full'} disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-stone-700">
              We've emailed <strong>{email}</strong>. Type the 6-digit code here, or tap the link in the email.
            </p>
            <Field label="Code">
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} required className={inputCls + ' text-center text-2xl tracking-[0.4em]'} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <button className={btnPrimary + ' w-full'} disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="w-full text-sm text-ochre-700" onClick={() => (setSent(false), setCode(''))}>
              Use a different email or send again
            </button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </Card>
    </Centered>
  )
}

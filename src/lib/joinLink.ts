import type { PersonId } from '../domain/types'

// The private join link (?join=<secret>&me=ethan) and what this phone remembers about it.

const JOIN_KEY = 'big-lap-join'
interface JoinLink {
  key: string
  me: PersonId
}

/** Read ?join=…&me=… from the address bar, and remember it on this phone. */
export function joinLink(): JoinLink | null {
  const params = new URLSearchParams(window.location.search)
  const key = params.get('join')
  const me = params.get('me')
  if (key && (me === 'ethan' || me === 'dana')) {
    try {
      localStorage.setItem(JOIN_KEY, JSON.stringify({ key, me }))
    } catch {
      // Private browsing: works for this visit only.
    }
    return { key, me }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(JOIN_KEY) ?? 'null') as JoinLink | null
    return saved?.key && saved.me ? saved : null
  } catch {
    return null
  }
}

const ME_KEY = 'big-lap-me'

/** After a successful join, remember who this phone belongs to, so it can open with no signal. */
export function rememberPerson(userId: string, me: PersonId) {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ userId, me }))
  } catch {
    // ignore
  }
}

export function confirmedPerson(userId: string): PersonId | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as { userId: string; me: PersonId } | null
    return saved?.userId === userId ? saved.me : null
  } catch {
    return null
  }
}

export function forgetJoinLink() {
  localStorage.removeItem(JOIN_KEY)
  localStorage.removeItem(ME_KEY)
}

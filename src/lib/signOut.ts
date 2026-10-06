import { supabase } from './supabase'
import { SyncEngine } from '../sync/engine'
import { forgetJoinLink } from './joinLink'

/** Remove this phone from the trip. Forget the link first, so it doesn't quietly rejoin. */
export async function signOut() {
  if (!supabase) return
  forgetJoinLink()
  history.replaceState(null, '', window.location.pathname + window.location.hash)
  SyncEngine.clearOutbox()
  await supabase.auth.signOut()
}

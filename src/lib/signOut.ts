import { supabase } from './supabase'
import { SyncEngine } from '../sync/engine'

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
  SyncEngine.clearOutbox()
}

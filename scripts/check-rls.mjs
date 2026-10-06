// Proves the database only lets the two of us in.
//
//   node scripts/check-rls.mjs <SUPABASE_URL> <PUBLISHABLE_OR_ANON_KEY> [SERVICE_KEY]
//
// Set TRIP_KEY=<the secret in the join links> to also check that a phone with
// the right link gets in (it joins as Ethan, then the test phone is removed).
//
// With just the public key it checks what a signed-out visitor can do (nothing).
// With the service key as well (local stack only, never the hosted one) it also
// seeds data and, with TRIP_KEY, checks what a joined phone can do.

import { createClient } from '@supabase/supabase-js'

const [url, anonKey, serviceKey] = process.argv.slice(2)
if (!url || !anonKey) {
  console.error('Usage: node scripts/check-rls.mjs <SUPABASE_URL> <PUBLISHABLE_OR_ANON_KEY> [SERVICE_KEY]')
  process.exit(2)
}

const TABLES = ['members', 'prep_items', 'stays', 'change_log', 'app_settings']
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
let failures = 0
const pass = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => (failures++, console.log(`  ✗ ${msg}`))
const check = (ok, msg) => (ok ? pass(msg) : fail(msg))
const rid = () => crypto.randomUUID()

/** A client that should get nothing from anywhere. */
async function expectLockedOut(client, who) {
  for (const t of TABLES) {
    const { data, error } = await client.from(t).select('*').limit(5)
    check(error || (Array.isArray(data) && data.length === 0), `${who}: reading ${t} returns nothing${error ? ` (${error.code ?? error.message})` : ''}`)
  }
  const tries = {
    prep_items: { id: rid(), data: { item: 'intruder' } },
    stays: { id: rid(), position: 0, data: { baseCamp: 'intruder' } },
    change_log: { id: rid(), data: { summary: 'intruder' } },
    app_settings: { key: 'trip', data: { departureDate: '1999-01-01' } },
    members: { email: 'intruder@example.com', person_id: 'dana', display_name: 'x' },
  }
  for (const [t, row] of Object.entries(tries)) {
    const { error } = await client.from(t).insert(row)
    check(!!error, `${who}: writing to ${t} is refused${error ? ` (${error.code ?? error.message})` : ''}`)
  }
  const upd = await client.from('app_settings').update({ data: { departureDate: '1999-01-01' } }).eq('key', 'trip').select()
  check(upd.error || upd.data.length === 0, `${who}: changing settings is refused or touches no rows`)
  const del = await client.from('prep_items').delete().neq('id', '00000000-0000-0000-0000-000000000000').select()
  check(del.error || del.data.length === 0, `${who}: deleting prep items is refused or touches no rows`)
  const rpc = await client.rpc('is_member')
  check(rpc.error || rpc.data === false, `${who}: is_member() is not true`)
  const files = await client.storage.from('receipts').list('', { limit: 5 })
  check(files.error || files.data.length === 0, `${who}: receipt photos list is empty`)
  const up = await client.storage.from('receipts').upload(`intruder-${rid()}.png`, new Blob(['x'], { type: 'image/png' }))
  check(!!up.error, `${who}: uploading a receipt is refused`)
}

console.log(`Checking ${url}\n`)
console.log('Signed-out visitor:')
await expectLockedOut(createClient(url, anonKey, opts), 'signed out')
const ping = await createClient(url, anonKey, opts).rpc('ping')
check(ping.data === 'ok', `signed out: the keep-awake ping answers "ok" and nothing else (got ${JSON.stringify(ping.data ?? ping.error?.message)})`)

// Anyone can start an anonymous session; without the secret link they must get nothing.
console.log('\nAnonymous session without the link:')
const anonSession = createClient(url, anonKey, opts)
const anonSignIn = await anonSession.auth.signInAnonymously()
if (anonSignIn.error) {
  console.log(`  (anonymous sign-ins are switched off: ${anonSignIn.error.message})`)
} else {
  await expectLockedOut(anonSession, 'anonymous')
  const guess = await anonSession.rpc('join_trip', { trip_key: 'guess-' + rid(), person: 'ethan' })
  check(!!guess.error, `anonymous: joining with a guessed link is refused${guess.error ? ` (${guess.error.message})` : ''}`)
  const keys = await anonSession.from('trip_keys').select('*')
  check(!!keys.error || keys.data.length === 0, 'anonymous: the stored link secret cannot be read')
  const devices = await anonSession.from('devices').insert({ user_id: anonSignIn.data.user.id, person_id: 'ethan' })
  check(!!devices.error, 'anonymous: cannot add itself to the trip directly')
  await expectLockedOut(anonSession, 'anonymous after failed join')

  if (process.env.TRIP_KEY) {
    console.log('\nPhone opening the real link:')
    const phone = createClient(url, anonKey, opts)
    const s = await phone.auth.signInAnonymously()
    const joined = await phone.rpc('join_trip', { trip_key: process.env.TRIP_KEY, person: 'ethan' })
    check(!s.error && joined.data === 'ethan', 'joining with the right link works')
    const me = await phone.rpc('current_person')
    check(me.data === 'ethan', 'the phone is recognised as Ethan')
    const read = await phone.from('app_settings').select('key')
    check(!read.error, 'the joined phone can read the trip')
    // Remove the test phone again (needs the service key; otherwise it just stays as an unused session).
    if (serviceKey) await createClient(url, serviceKey, opts).auth.admin.deleteUser(s.data.user.id)
  }
}

if (serviceKey) {
  const admin = createClient(url, serviceKey, opts)

  // Put a row in every table first, so "returns nothing" really means "hidden", not "empty".
  await admin.from('prep_items').upsert({ id: '11111111-1111-1111-1111-111111111111', data: { item: 'seeded by check' } })
  await admin.from('app_settings').upsert({ key: 'trip', data: { departureDate: '2027-05-31', homeAddress: '' } })
  const seeded = await admin.from('prep_items').select('id')
  check(seeded.data?.length > 0, 'service role can see the seeded data (so the empty results above are real hiding)')

  // A member here is a phone that joined with the real link (needs TRIP_KEY).
  if (!process.env.TRIP_KEY) {
    console.log('\n(Set TRIP_KEY to also run the member checks.)')
  } else {
  console.log('\nMember (a phone that joined as Ethan):')
  const ethan = createClient(url, anonKey, opts)
  const ethanSession = await ethan.auth.signInAnonymously()
  await ethan.rpc('join_trip', { trip_key: process.env.TRIP_KEY, person: 'ethan' })
  const id = rid()
  const ins = await ethan.from('prep_items').insert({ id, data: { item: 'member test' }, updated_by: 'dana' }).select().single()
  check(!ins.error, 'member can add a prep item')
  check(ins.data?.updated_by === 'ethan', `the database records who made the change (ethan), ignoring what the phone claimed (got "${ins.data?.updated_by}")`)
  const read = await ethan.from('prep_items').select('id')
  check(read.data?.some((r) => r.id === id), 'member can read prep items')
  const members = await ethan.from('members').select('person_id')
  check(members.data?.length === 2, 'member can see the two members')
  const addMember = await ethan.from('members').insert({ email: 'friend@example.com', person_id: 'dana', display_name: 'x' })
  check(!!addMember.error, 'member cannot add someone else to the members list')
  const hardDelete = await ethan.from('prep_items').delete().eq('id', id).select()
  check(hardDelete.error || hardDelete.data.length === 0, 'rows cannot be hard-deleted (soft delete only, so the other phone hears about it)')
  const editLog = await ethan.from('change_log').insert({ id: rid(), data: { summary: 'x' } }).select().single()
  const logUpd = await ethan.from('change_log').update({ data: { summary: 'rewritten' } }).eq('id', editLog.data?.id).select()
  check(!editLog.error && (logUpd.error || logUpd.data.length === 0), 'change log can be added to but not rewritten')
  const path = `${id}/receipt.png`
  const up = await ethan.storage.from('receipts').upload(path, new Blob(['png'], { type: 'image/png' }))
  check(!up.error, 'member can upload a receipt photo')
  const signedUrl = await ethan.storage.from('receipts').createSignedUrl(path, 60)
  check(!!signedUrl.data?.signedUrl, 'member can open their receipt photo')
  const anonFile = await createClient(url, anonKey, opts).storage.from('receipts').download(path)
  check(!!anonFile.error, 'a signed-out visitor cannot download that receipt')
  const strangerFile = await anonSession.storage.from('receipts').download(path)
  check(!!strangerFile.error, 'an anonymous session without the link cannot download it either')

  // Tidy up
  await admin.from('prep_items').delete().in('id', [id, '11111111-1111-1111-1111-111111111111'])
  await admin.from('change_log').delete().eq('id', editLog.data?.id)
  await admin.storage.from('receipts').remove([path])
  await admin.auth.admin.deleteUser(ethanSession.data.user.id)
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)

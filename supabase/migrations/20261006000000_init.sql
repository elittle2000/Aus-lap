-- Big Lap: shared data for exactly two people.
--
-- Security model
--  * Sign-ups are switched off in Supabase Auth; the two of us are added by hand.
--  * Every table has row level security. The only policies are for signed-in
--    users whose email is in public.members. Signed-out visitors (the "anon"
--    role) have no policy at all, so they can read and write nothing.
--  * The database, not the phone, stamps who changed each row and when.
--
-- Rows hold the app's records as JSON ("data"), so the app and the database
-- can't drift apart field by field. Columns outside "data" are the ones the
-- database itself needs: ordering, who/when, and soft deletes.

-- ---------- members ----------

create table public.members (
  email text primary key check (email = lower(email)),
  person_id text not null unique check (person_id in ('ethan', 'dana')),
  display_name text not null
);

alter table public.members enable row level security;

-- True when the caller is signed in with an email on the members list.
-- security definer so it can read members without members' own policies getting in the way.
create function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

create function public.current_person() returns text
language sql stable security definer set search_path = '' as $$
  select m.person_id from public.members m
  where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

revoke all on function public.is_member() from public, anon;
revoke all on function public.current_person() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.current_person() to authenticated;

create policy "members can see the member list" on public.members
  for select to authenticated using (public.is_member());
-- No insert/update/delete policy: the list is only changed from the Supabase dashboard.

-- ---------- who / when stamping ----------

create function public.stamp_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_person(), 'system');
  return new;
end
$$;

-- ---------- data tables ----------

create table public.prep_items (
  id uuid primary key,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

create table public.stays (
  id uuid primary key,
  -- Route order. Dates are worked out from this order and the departure date.
  position integer not null,
  archived boolean not null default false,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

create table public.change_log (
  id uuid primary key,
  at timestamptz not null default now(),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

-- Single-value documents: trip settings, on-road budget lines, places list, last import.
create table public.app_settings (
  key text primary key check (key in ('trip', 'budget_lines', 'locations', 'last_import')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

create index stays_position on public.stays (position) where not deleted;
create index change_log_at on public.change_log (at desc);

do $$
declare t text;
begin
  foreach t in array array['prep_items', 'stays', 'change_log', 'app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.stamp_change()', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
    -- Rows are soft-deleted (deleted = true) so the other phone hears about it; no hard deletes from the app.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- The change log is append-only.
drop policy "members update" on public.change_log;

revoke all on public.members from anon;

-- Live updates to the other phone.
alter publication supabase_realtime add table public.prep_items, public.stays, public.change_log, public.app_settings;

-- ---------- receipt photos ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

create policy "members read receipts" on storage.objects
  for select to authenticated using (bucket_id = 'receipts' and public.is_member());
create policy "members add receipts" on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts' and public.is_member());
create policy "members remove receipts" on storage.objects
  for delete to authenticated using (bucket_id = 'receipts' and public.is_member());

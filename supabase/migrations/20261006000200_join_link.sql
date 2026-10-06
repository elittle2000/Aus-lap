-- No sign-in screen: each phone joins with a private link instead.
--
-- The link carries a long random secret. Opening it signs the phone in
-- anonymously (no email or password) and calls join_trip(secret, person),
-- which records that phone as Ethan's or Dana's. From then on the phone is
-- a member exactly like an email sign-in was.
--
-- Anyone can create an anonymous session, but without the secret they can't
-- join, so the access rules still give them nothing. Only a hash of the
-- secret is stored, and it lives in a table no one can read through the API.

create extension if not exists pgcrypto with schema extensions;

create table public.trip_keys (
  key_hash text primary key
);
alter table public.trip_keys enable row level security;
revoke all on public.trip_keys from anon, authenticated;
-- No policies: only the database itself (join_trip) can read it.

create table public.devices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  person_id text not null check (person_id in ('ethan', 'dana')),
  joined_at timestamptz not null default now()
);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;

-- Members are now: an email on the members list, or a phone that joined with the link.
create or replace function public.current_person() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select d.person_id from public.devices d where d.user_id = auth.uid()),
    (select m.person_id from public.members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_person() is not null
$$;

create function public.join_trip(trip_key text, person text) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if person not in ('ethan', 'dana') then
    raise exception 'unknown person' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.trip_keys k
    where k.key_hash = encode(extensions.digest(trip_key, 'sha256'), 'hex')
  ) then
    raise exception 'wrong link' using errcode = '28000';
  end if;
  insert into public.devices (user_id, person_id) values (auth.uid(), person)
  on conflict (user_id) do update set person_id = excluded.person_id;
  return person;
end
$$;

revoke all on function public.join_trip(text, text) from public, anon;
grant execute on function public.join_trip(text, text) to authenticated;

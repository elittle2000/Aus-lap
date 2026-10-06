-- A free Supabase project pauses after a quiet week. A scheduled GitHub Action
-- calls this once a day so that never happens. It touches the database but
-- returns nothing about our data, so it's safe for anyone to call.
create function public.ping() returns text
language sql stable set search_path = '' as $$
  select 'ok'::text
$$;

grant execute on function public.ping() to anon, authenticated;

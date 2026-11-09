-- Saving Planner shared database. Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our household',
  invite_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  config      jsonb not null default '{}'::jsonb,   -- sources, categories, goals template, currency, reminder day
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  joined_at    timestamptz not null default now()
);

create table if not exists public.months (
  household_id uuid not null references public.households(id) on delete cascade,
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  data         jsonb not null default '{}'::jsonb,   -- income, expenses, savings plan, "moved" ticks
  updated_at   timestamptz not null default now(),
  primary key (household_id, month)
);

-- Which household does the signed-in user belong to? (security definer avoids RLS recursion)
create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.members where user_id = auth.uid()
$$;

-- Create a household and become its first member.
create or replace function public.create_household(p_name text, p_config jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  insert into households (name, config) values (coalesce(nullif(p_name, ''), 'Our household'), p_config) returning id into hid;
  insert into members (user_id, household_id) values (auth.uid(), hid);
  return hid;
end $$;

-- Join an existing household with its invite code.
create or replace function public.join_household(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  select id into hid from households where invite_code = lower(trim(p_code));
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into members (user_id, household_id) values (auth.uid(), hid);
  return hid;
end $$;

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.months     enable row level security;

drop policy if exists households_select on public.households;
drop policy if exists households_update on public.households;
drop policy if exists members_select    on public.members;
drop policy if exists months_all        on public.months;

create policy households_select on public.households for select using (id = public.my_household());
create policy households_update on public.households for update using (id = public.my_household()) with check (id = public.my_household());
create policy members_select    on public.members    for select using (household_id = public.my_household());
create policy months_all        on public.months     for all
  using (household_id = public.my_household()) with check (household_id = public.my_household());

revoke all on function public.create_household(text, jsonb), public.join_household(text) from public, anon;
grant execute on function public.create_household(text, jsonb), public.join_household(text), public.my_household() to authenticated;

-- Live updates between your phones.
do $$ begin
  begin alter publication supabase_realtime add table public.months;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.households; exception when duplicate_object then null; end;
end $$;

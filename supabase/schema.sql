-- TikZ Studio database schema. Run once in Supabase: Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run.

create table if not exists public.projects (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  tags        text[] not null default '{}' check (cardinality(tags) <= 20),
  is_archived boolean not null default false,
  files       jsonb not null default '[]' check (jsonb_typeof(files) = 'array' and octet_length(files::text) <= 3000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_updated_idx on public.projects (user_id, updated_at desc);

-- Row-level security: every query only ever sees or changes the caller's own rows.
alter table public.projects enable row level security;

drop policy if exists "Users manage their own projects" on public.projects;
create policy "Users manage their own projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Signed-in users may use the table (row-level security above still limits them to their own rows).
grant select, insert, update, delete on public.projects to authenticated;

-- Signed-out (anon) callers get nothing at all.
revoke all on public.projects from anon;

-- Keep updated_at current on every change.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at before update on public.projects
  for each row execute function public.touch_updated_at();

-- ─── Profiles: extra, non-secret user info. Email and password stay in auth.users. ───

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Users may read their profile and change only the display name. Rows are created by the trigger below.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
revoke all on public.profiles from anon;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile automatically on sign-up (display name defaults to the part of the email before @).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(split_part(new.email, '@', 1), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the trigger may call it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Give a profile to anyone who signed up before this table existed.
insert into public.profiles (id, display_name)
select id, left(split_part(email, '@', 1), 80) from auth.users
on conflict (id) do nothing;

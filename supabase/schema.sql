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

-- The LaTeX engine the project compiles with. Keep in sync with ENGINES in src/backend/schemas/compiler.py.
alter table public.projects add column if not exists engine text not null default 'pdflatex'
  check (engine in ('pdflatex', 'xelatex', 'lualatex'));

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

-- Whether the app tour still has to be shown: true for a new user, false once they finish or skip it.
alter table public.profiles add column if not exists show_tour boolean not null default true;

-- Users may read their profile and change only the display name and the tour flag. Rows are created by the trigger below.
grant select on public.profiles to authenticated;
grant update (display_name, show_tour) on public.profiles to authenticated;
revoke all on public.profiles from anon;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile automatically on sign-up, named with the name given at sign-up (the backend stores it as
-- user_metadata.display_name), or the part of the email before @ for accounts made before names were asked for.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the trigger may call it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Deleting a profile (e.g. in the Table Editor) deletes the whole account, so its email can sign up again. Without
-- this the login in auth.users outlives the profile and sign-up keeps saying the email is taken. Deleting the auth
-- user cascades to the profile, projects and figure chats; when that cascade fires this trigger, the user is already gone.
create or replace function public.handle_profile_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = old.id;
  return old;
end;
$$;

-- Only the trigger may call it.
revoke execute on function public.handle_profile_deleted() from public, anon, authenticated;

drop trigger if exists on_profile_deleted on public.profiles;
create trigger on_profile_deleted after delete on public.profiles
  for each row execute function public.handle_profile_deleted();

-- Give a profile to anyone who signed up before this table existed.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), split_part(email, '@', 1)), 80) from auth.users
on conflict (id) do nothing;

-- Profiles made by the older trigger still carry the email default: give them the name from sign-up.
update public.profiles p
set display_name = left(trim(u.raw_user_meta_data ->> 'display_name'), 80)
from auth.users u
where u.id = p.id
  and nullif(trim(u.raw_user_meta_data ->> 'display_name'), '') is not null
  and p.display_name = left(split_part(u.email, '@', 1), 80);

-- ─── Figure chats: Figure Studio conversations, one history per user across all projects. ───

create table if not exists public.figure_chats (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The project the chat was started in (its preamble shapes the figures). Optional; survives project deletion.
  project_id  uuid references public.projects (id) on delete set null,
  title       text not null check (char_length(title) between 1 and 200),
  -- The conversation: prompts, variant code (including the user's edits) and which variant is shown.
  turns       jsonb not null default '[]' check (jsonb_typeof(turns) = 'array' and octet_length(turns::text) <= 2000000),
  -- The variant the user was refining, as {"turn": n, "variant": n}, or null.
  refining    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists figure_chats_user_updated_idx on public.figure_chats (user_id, updated_at desc);

alter table public.figure_chats enable row level security;

drop policy if exists "Users manage their own figure chats" on public.figure_chats;
create policy "Users manage their own figure chats" on public.figure_chats
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.figure_chats to authenticated;
revoke all on public.figure_chats from anon;

drop trigger if exists figure_chats_touch_updated_at on public.figure_chats;
create trigger figure_chats_touch_updated_at before update on public.figure_chats
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════
--  Verbly — Supabase schema
--  Run this in the Supabase SQL editor (or via migration).
-- ═══════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ── users ───────────────────────────────────────────────
-- Mirror of auth.users with plan metadata.
-- Created automatically when a user signs up via the trigger below.

create table if not exists public.users (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  plan                text not null default 'free' check (plan in ('free', 'premium')),
  subscription_status text,
  plan_expires_at     timestamptz,
  created_at          timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users: owner read"
  on public.users for select
  using (auth.uid() = id);

create policy "users: owner update"
  on public.users for update
  using (auth.uid() = id);


-- ── words ───────────────────────────────────────────────

create table if not exists public.words (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.users(id) on delete cascade,
  original     text not null,
  translations text[] not null default '{}',
  source_lang  text not null,
  target_lang  text not null,
  context      text,
  word_type    text,
  tags         text[] not null default '{}',
  custom_tags  text[] not null default '{}',
  saved_at     timestamptz not null default now(),

  unique (user_id, original, source_lang, target_lang)
);

create index if not exists words_user_id_idx      on public.words (user_id);
create index if not exists words_user_saved_at_idx on public.words (user_id, saved_at desc);

alter table public.words enable row level security;

create policy "words: owner select"
  on public.words for select
  using (auth.uid() = user_id);

create policy "words: owner insert"
  on public.words for insert
  with check (auth.uid() = user_id);

create policy "words: owner update"
  on public.words for update
  using (auth.uid() = user_id);

create policy "words: owner delete"
  on public.words for delete
  using (auth.uid() = user_id);


-- ── usage ────────────────────────────────────────────────
-- One row per (user, date); tracks daily translation calls.

create table if not exists public.usage (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.users(id) on delete cascade,
  date                date not null,
  translations_count  integer not null default 0,

  unique (user_id, date)
);

create index if not exists usage_user_date_idx on public.usage (user_id, date);

alter table public.usage enable row level security;

create policy "usage: owner select"
  on public.usage for select
  using (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════
--  Functions & triggers
-- ═══════════════════════════════════════════════════════

-- ── handle_new_user ──────────────────────────────────────
-- Called on every INSERT into auth.users.
-- Creates the corresponding public.users row.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── increment_usage ──────────────────────────────────────
-- Atomically upserts today's usage row and increments the counter.
-- Returns the new translations_count value.

create or replace function public.increment_usage(
  p_user_id uuid,
  p_date    date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.usage (user_id, date, translations_count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, date)
  do update set translations_count = usage.translations_count + 1
  returning translations_count into v_count;

  return v_count;
end;
$$;

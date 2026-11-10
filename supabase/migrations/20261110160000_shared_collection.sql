-- Shared family collection: every phone that knows the family code sees the same data.
-- Accessed only through the "collection" Edge Function (service role); RLS with no policies.

create table if not exists public.cards (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Family-wide settings and lists: settings, wants (chase list), sets, history, badges, plus a change marker.
create table if not exists public.family_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cards enable row level security;
alter table public.family_kv enable row level security;

-- Private bucket for card photos (the app gets short-lived signed links).
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', false)
on conflict (id) do nothing;

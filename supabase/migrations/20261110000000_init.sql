-- eBay connection for the family's seller account (single row).
create table if not exists public.ebay_auth (
  id int primary key default 1 check (id = 1),
  refresh_token text,
  refresh_expires_at timestamptz,
  access_token text,
  access_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One-time "state" values used while connecting to eBay (protects the sign-in redirect).
create table if not exists public.ebay_oauth_state (
  state text primary key,
  return_to text,
  created_at timestamptz not null default now()
);

-- Row level security with no policies: only the Edge Functions (service role) can read/write.
alter table public.ebay_auth enable row level security;
alter table public.ebay_oauth_state enable row level security;

-- Public bucket for listing photos (eBay needs a public https URL for each picture).
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create table if not exists public.youtube_tokens (
  id text primary key,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.youtube_tokens enable row level security;

create policy "server only" on public.youtube_tokens
for all to service_role using (true) with check (true);

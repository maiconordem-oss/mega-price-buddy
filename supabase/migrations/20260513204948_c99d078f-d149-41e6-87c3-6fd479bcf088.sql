create table if not exists public.user_storage (
  username text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (username, key)
);
alter table public.user_storage enable row level security;
-- Sem policies: somente service role (servidor) pode ler/escrever.
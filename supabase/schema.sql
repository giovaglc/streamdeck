-- Stream Deck - esquema de Supabase
-- Ejecuta este SQL en Supabase -> SQL Editor -> New query -> Run

-- ---------------------------------------------------------------
-- 1. Estado del deck (lo comparten el móvil y el PC)
-- ---------------------------------------------------------------
create table if not exists public.deck_state (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  layout         jsonb not null default '{"profiles":{"Principal":{"keys":[]}},"active":"Principal"}'::jsonb,
  bindings       jsonb not null default '{}'::jsonb,
  audio          jsonb not null default '{}'::jsonb,
  desired_audio  jsonb not null default '{}'::jsonb,
  presence       jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. Cola de órdenes: el móvil inserta, el PC ejecuta y marca
-- ---------------------------------------------------------------
create table if not exists public.deck_commands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  command       jsonb not null,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists deck_commands_pending_idx
  on public.deck_commands (user_id, processed_at, created_at);

-- ---------------------------------------------------------------
-- 3. Dispositivos recordados ("remember this device")
-- ---------------------------------------------------------------
create table if not exists public.trusted_devices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_id   text not null,
  label       text,
  last_seen   timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------
-- 4. Row Level Security: cada usuario solo ve lo suyo
-- ---------------------------------------------------------------
alter table public.deck_state       enable row level security;
alter table public.deck_commands    enable row level security;
alter table public.trusted_devices  enable row level security;

drop policy if exists "deck_state_owner" on public.deck_state;
create policy "deck_state_owner"
  on public.deck_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "deck_commands_owner" on public.deck_commands;
create policy "deck_commands_owner"
  on public.deck_commands for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trusted_devices_owner" on public.trusted_devices;
create policy "trusted_devices_owner"
  on public.trusted_devices for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 5. Realtime (para que los sliders se actualicen al instante)
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deck_state'
  ) then
    alter publication supabase_realtime add table public.deck_state;
  end if;
end $$;

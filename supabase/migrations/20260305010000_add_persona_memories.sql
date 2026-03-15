-- Per-persona long-term memory store.
-- Each memory row is scoped by user + agent so personas can retain different user models.

create table if not exists public.persona_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  agent_id text not null,
  memory_type text not null check (memory_type in ('fact', 'preference', 'goal')),
  memory_key text not null,
  content text not null,
  confidence real not null default 0.55 check (confidence >= 0 and confidence <= 1),
  observation_count integer not null default 1 check (observation_count >= 1),
  first_observed_at timestamptz not null default timezone('utc'::text, now()),
  last_observed_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, agent_id, memory_key)
);

create index if not exists persona_memories_user_agent_last_idx
  on public.persona_memories (user_id, agent_id, last_observed_at desc);

alter table public.persona_memories enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'persona_memories' and policyname = 'Users can manage own persona memories'
  ) then
    create policy "Users can manage own persona memories"
      on public.persona_memories
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.touch_persona_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_touch_persona_memories_updated_at on public.persona_memories;
create trigger trg_touch_persona_memories_updated_at
before update on public.persona_memories
for each row execute function public.touch_persona_memories_updated_at();

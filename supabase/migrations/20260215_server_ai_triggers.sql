-- Server-side AI trigger automation for Dayflow
-- Run this migration in Supabase SQL editor.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists auto_ai_reactions boolean not null default false,
  add column if not exists active_gemini_model text not null default 'gemini-1.5-flash',
  add column if not exists ai_timezone text not null default 'UTC';

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  emoji text not null default ':)',
  role text not null,
  personality text not null,
  tone text not null,
  color text not null default '#37352f',
  avatar text,
  "order" integer not null default 0,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists ai_agents_user_order_idx on public.ai_agents (user_id, "order", created_at);

alter table public.ai_agents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_agents' and policyname = 'Users can manage own ai agents'
  ) then
    create policy "Users can manage own ai agents"
      on public.ai_agents
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create table if not exists public.ai_agent_rotations (
  user_id uuid not null references auth.users on delete cascade,
  chain_key text not null,
  next_index integer not null default 0,
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  primary key (user_id, chain_key)
);

alter table public.ai_agent_rotations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_agent_rotations' and policyname = 'No direct access to ai rotations'
  ) then
    create policy "No direct access to ai rotations"
      on public.ai_agent_rotations
      for all
      using (false)
      with check (false);
  end if;
end $$;

create table if not exists public.ai_trigger_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  trigger text not null check (trigger in ('todo_completed', 'todo_added', 'event_added', 'journal_added', 'scheduled_digest')),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamp with time zone not null default timezone('utc'::text, now()),
  locked_at timestamp with time zone,
  processed_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists ai_trigger_queue_pending_idx
  on public.ai_trigger_queue (status, scheduled_for, created_at);

create index if not exists ai_trigger_queue_user_created_idx
  on public.ai_trigger_queue (user_id, created_at desc);

create unique index if not exists ai_trigger_queue_user_dedupe_uq
  on public.ai_trigger_queue (user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.ai_trigger_queue enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_trigger_queue' and policyname = 'Users can view own trigger queue'
  ) then
    create policy "Users can view own trigger queue"
      on public.ai_trigger_queue
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.touch_ai_agents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_touch_ai_agents_updated_at on public.ai_agents;
create trigger trg_touch_ai_agents_updated_at
before update on public.ai_agents
for each row execute function public.touch_ai_agents_updated_at();

create or replace function public.enqueue_ai_trigger(
  p_user_id uuid,
  p_trigger text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_scheduled_for timestamp with time zone default timezone('utc'::text, now())
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dedupe_key is null then
    insert into public.ai_trigger_queue (user_id, trigger, payload, scheduled_for)
    values (p_user_id, p_trigger, coalesce(p_payload, '{}'::jsonb), coalesce(p_scheduled_for, timezone('utc'::text, now())));
  else
    insert into public.ai_trigger_queue (user_id, trigger, payload, dedupe_key, scheduled_for)
    values (p_user_id, p_trigger, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_scheduled_for, timezone('utc'::text, now())))
    on conflict (user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create or replace function public.enqueue_event_added_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_date text;
  start_time text;
begin
  event_date := to_char((new.start_time at time zone 'utc'), 'YYYY-MM-DD');
  start_time := to_char((new.start_time at time zone 'utc'), 'HH24:MI');

  perform public.enqueue_ai_trigger(
    new.user_id,
    'event_added',
    jsonb_build_object(
      'id', new.id,
      'title', new.title,
      'date', event_date,
      'startTime', nullif(start_time, '')
    )
  );

  return new;
end;
$$;

create or replace function public.enqueue_todo_added_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_ai_trigger(
    new.user_id,
    'todo_added',
    jsonb_build_object(
      'id', new.id,
      'text', new.text
    )
  );
  return new;
end;
$$;

create or replace function public.enqueue_todo_completed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.completed, false) = false and coalesce(new.completed, false) = true then
    perform public.enqueue_ai_trigger(
      new.user_id,
      'todo_completed',
      jsonb_build_object(
        'id', new.id,
        'text', new.text
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_journal_added_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  journal_date text;
begin
  journal_date := to_char((new.date at time zone 'utc'), 'YYYY-MM-DD');

  perform public.enqueue_ai_trigger(
    new.user_id,
    'journal_added',
    jsonb_build_object(
      'id', new.id,
      'title', coalesce(new.title, ''),
      'mood', coalesce(new.mood, 'neutral'),
      'date', journal_date
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_event_added on public.calendar_events;
create trigger trg_enqueue_event_added
after insert on public.calendar_events
for each row execute function public.enqueue_event_added_trigger();

drop trigger if exists trg_enqueue_todo_added on public.todos;
create trigger trg_enqueue_todo_added
after insert on public.todos
for each row execute function public.enqueue_todo_added_trigger();

drop trigger if exists trg_enqueue_todo_completed on public.todos;
create trigger trg_enqueue_todo_completed
after update on public.todos
for each row execute function public.enqueue_todo_completed_trigger();

drop trigger if exists trg_enqueue_journal_added on public.journal_entries;
create trigger trg_enqueue_journal_added
after insert on public.journal_entries
for each row execute function public.enqueue_journal_added_trigger();

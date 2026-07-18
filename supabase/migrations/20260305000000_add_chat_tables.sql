-- Normalize chat storage to relational tables.
-- This enables incremental sync/pagination and avoids huge JSON blobs.

create table if not exists public.chat_sessions (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null default '새 대화',
  agent_id text,
  agent_ids text[] not null default '{}',
  created_at timestamptz not null default timezone('utc'::text, now()),
  last_message_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists chat_sessions_user_last_idx
  on public.chat_sessions (user_id, last_message_at desc, updated_at desc);

create table if not exists public.chat_messages (
  id text primary key,
  session_id text not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  "timestamp" timestamptz not null default timezone('utc'::text, now()),
  agent_id text,
  provider text,
  model_name text,
  connection_id text,
  image_url text,
  video_url text,
  action jsonb,
  quick_replies text[],
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists chat_messages_session_order_idx
  on public.chat_messages (session_id, order_index, "timestamp");

create index if not exists chat_messages_user_time_idx
  on public.chat_messages (user_id, "timestamp" desc);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'Users can manage own chat sessions'
  ) then
    create policy "Users can manage own chat sessions"
      on public.chat_sessions
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'Users can manage own chat messages'
  ) then
    create policy "Users can manage own chat messages"
      on public.chat_messages
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.touch_chat_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_sessions_updated_at on public.chat_sessions;
create trigger trg_touch_chat_sessions_updated_at
before update on public.chat_sessions
for each row execute function public.touch_chat_sessions_updated_at();

create or replace function public.touch_chat_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_messages_updated_at on public.chat_messages;
create trigger trg_touch_chat_messages_updated_at
before update on public.chat_messages
for each row execute function public.touch_chat_messages_updated_at();

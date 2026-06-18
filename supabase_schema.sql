-- Dayflow Supabase Schema Initialization

-- Profiles table: 사용자 기본 정보 및 설정
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  avatar_url text,
  gemini_api_key text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Todo Lists: 할 일 목록 폴더
create table todo_lists (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  "order" integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Todos: 할 일 상세 항목
create table todos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  list_id uuid references todo_lists on delete cascade,
  text text not null,
  completed boolean default false,
  "order" integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Journal Categories: 일기 카테고리
create table journal_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Journal Entries: 일기 기록
create table journal_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text,
  content text,
  date timestamp with time zone default timezone('utc'::text, now()) not null,
  mood text check (mood in ('good', 'neutral', 'bad')),
  category_id uuid references journal_categories on delete set null,
  "order" integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Calendar Events: 일정 데이터
create table calendar_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  location text,
  description text,
  color text,
  tags text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Community Posts: AI 및 사용자 게시글
create table community_posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  author text not null,
  content text not null,
  timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
  reply_to uuid references community_posts on delete set null,
  trigger text,
  "order" integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table profiles enable row level security;
alter table todo_lists enable row level security;
alter table todos enable row level security;
alter table journal_categories enable row level security;
alter table journal_entries enable row level security;
alter table calendar_events enable row level security;
alter table community_posts enable row level security;

-- RLS Policies: 사용자는 본인의 데이터만 관리할 수 있음
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

create policy "Users can manage own todo lists" on todo_lists for all using (auth.uid() = user_id);
create policy "Users can manage own todos" on todos for all using (auth.uid() = user_id);
create policy "Users can manage own journal categories" on journal_categories for all using (auth.uid() = user_id);
create policy "Users can manage own journal entries" on journal_entries for all using (auth.uid() = user_id);
create policy "Users can manage own events" on calendar_events for all using (auth.uid() = user_id);
create policy "Users can manage own posts" on community_posts for all using (auth.uid() = user_id);

-- Server-side AI automation objects (queue/ai_agents/triggers) are defined in:
-- supabase/migrations/20260215_server_ai_triggers.sql

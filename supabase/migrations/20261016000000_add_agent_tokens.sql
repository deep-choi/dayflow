-- Personal access tokens that let external AI agents (MCP clients) act on a user's own data.
-- Only a SHA-256 hash of each token is stored; the plaintext is shown to the user once.
-- Tokens are verified by the mcp-server edge function with the service role, so no
-- update policy is exposed: revoking a token means deleting it.

create table if not exists public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  token_prefix text not null,
  can_write boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_tokens_user_idx on public.agent_tokens (user_id, created_at desc);

alter table public.agent_tokens enable row level security;

create policy "Users can view own agent tokens"
  on public.agent_tokens for select
  using (auth.uid() = user_id);

create policy "Users can create own agent tokens"
  on public.agent_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own agent tokens"
  on public.agent_tokens for delete
  using (auth.uid() = user_id);

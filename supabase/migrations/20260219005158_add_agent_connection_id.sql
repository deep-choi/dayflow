-- Add connection_id to ai_agents table to support per-persona API selection
alter table public.ai_agents
add column if not exists connection_id text;

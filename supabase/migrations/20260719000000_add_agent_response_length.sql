-- Store the preferred chat response length for each persona.
alter table public.ai_agents
add column if not exists response_length text not null default 'medium'
check (response_length in ('short', 'medium', 'long'));

-- Remove the legacy automation that generated AI posts from calendar, todo,
-- journal, and scheduled-digest events.

drop trigger if exists trg_enqueue_event_added on public.calendar_events;
drop trigger if exists trg_enqueue_todo_added on public.todos;
drop trigger if exists trg_enqueue_todo_completed on public.todos;
drop trigger if exists trg_enqueue_journal_added on public.journal_entries;

drop function if exists public.enqueue_event_added_trigger();
drop function if exists public.enqueue_todo_added_trigger();
drop function if exists public.enqueue_todo_completed_trigger();
drop function if exists public.enqueue_journal_added_trigger();
drop function if exists public.enqueue_ai_trigger(uuid, text, jsonb, text, timestamptz);

drop table if exists public.ai_trigger_queue;
drop table if exists public.ai_agent_rotations;

alter table public.profiles
  drop column if exists auto_ai_reactions,
  drop column if exists active_gemini_model,
  drop column if exists ai_timezone;

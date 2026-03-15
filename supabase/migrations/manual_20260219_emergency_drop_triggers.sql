-- EMERGENCY: Drop all AI triggers to fix Sync Abort/Timeout issues
-- Run this in Supabase SQL Editor immediately.

drop trigger if exists trg_enqueue_event_added on public.calendar_events;
drop trigger if exists trg_enqueue_todo_added on public.todos;
drop trigger if exists trg_enqueue_todo_completed on public.todos;
drop trigger if exists trg_enqueue_journal_added on public.journal_entries;

-- Optional: cleanup the queue if it's stuck
truncate table public.ai_trigger_queue;

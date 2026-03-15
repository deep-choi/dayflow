-- Remove AI diary automation and access to personal app data triggers.

drop trigger if exists trg_enqueue_event_added on public.calendar_events;
drop trigger if exists trg_enqueue_todo_added on public.todos;
drop trigger if exists trg_enqueue_todo_completed on public.todos;
drop trigger if exists trg_enqueue_journal_added on public.journal_entries;

update public.profiles
set auto_ai_reactions = false
where auto_ai_reactions is distinct from false;

update public.ai_trigger_queue
set status = 'failed',
    processed_at = timezone('utc'::text, now()),
    locked_at = null,
    last_error = 'AI diary automation removed'
where status in ('pending', 'processing', 'retry');

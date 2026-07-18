-- FIX for Sync AbortError
-- The triggers on calendar_events and todos are trying to insert into ai_trigger_queue,
-- but that table likely misses an INSERT policy or RLS is blocking it.

-- 1. Allow Users to Insert into Trigger Queue (Fixes the root cause if RLS is the blocker)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_trigger_queue' and policyname = 'Users can insert own trigger queue'
  ) then
    create policy "Users can insert own trigger queue"
      on public.ai_trigger_queue
      for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- 2. (Optional/Fallback) If adding the policy doesn't fix it, 
-- you can temporarily DISABLE the AI Automation triggers by uncommenting the lines below:
-- Select the lines below and run them to remove the triggers completely.

/*
drop trigger if exists trg_enqueue_event_added on public.calendar_events;
drop trigger if exists trg_enqueue_todo_added on public.todos;
drop trigger if exists trg_enqueue_todo_completed on public.todos;
drop trigger if exists trg_enqueue_journal_added on public.journal_entries;
*/

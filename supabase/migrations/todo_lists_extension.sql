-- ==============================================================
-- 2. todo_lists table enhancement
-- adding due_date to lists
-- ==============================================================

ALTER TABLE public.todo_lists
ADD COLUMN IF NOT EXISTS due_date TEXT,
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'todo';

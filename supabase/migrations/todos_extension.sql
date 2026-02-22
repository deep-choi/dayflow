-- ==============================================================
-- 1. existing 'todos' table enhancement
-- adding start_date, due_date, and sub_tasks (JSONB)
-- ==============================================================

ALTER TABLE public.todos
ADD COLUMN IF NOT EXISTS start_date TEXT,
ADD COLUMN IF NOT EXISTS due_date TEXT,
ADD COLUMN IF NOT EXISTS sub_tasks JSONB;

-- Note: The JSONB column sub_tasks will store array of { "id": "uuid", "text": "...", "completed": boolean }

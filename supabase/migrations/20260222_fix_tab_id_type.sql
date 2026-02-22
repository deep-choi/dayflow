-- life-sync-ai: Fix tab_id and todo_tabs.id type to support non-UUID default labels
-- 1. Drop the foreign key constraint first
ALTER TABLE public.todo_lists DROP CONSTRAINT IF EXISTS todo_lists_tab_id_fkey;

-- 2. Change todo_tabs.id to TEXT
ALTER TABLE public.todo_tabs ALTER COLUMN id TYPE TEXT;

-- 3. Change todo_lists.tab_id to TEXT
ALTER TABLE public.todo_lists ALTER COLUMN tab_id TYPE TEXT;

-- 4. Restore the foreign key constraint (Postgres allows FK between TEXT columns)
ALTER TABLE public.todo_lists 
ADD CONSTRAINT todo_lists_tab_id_fkey 
FOREIGN KEY (tab_id) REFERENCES public.todo_tabs(id) ON DELETE SET NULL;

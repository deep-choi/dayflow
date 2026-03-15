-- life-sync-ai: Fix tab_id and todo_tabs.id type to support non-UUID default labels
-- 1. Drop the foreign key constraint first
ALTER TABLE public.todo_lists DROP CONSTRAINT IF EXISTS todo_lists_tab_id_fkey;

-- 2. Change todo_tabs.id to TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'todo_tabs'
      AND column_name = 'id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.todo_tabs ALTER COLUMN id TYPE TEXT;
  END IF;
END $$;

-- 3. Change todo_lists.tab_id to TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'todo_lists'
      AND column_name = 'tab_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.todo_lists ALTER COLUMN tab_id TYPE TEXT;
  END IF;
END $$;

-- 4. Restore the foreign key constraint (Postgres allows FK between TEXT columns)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'todo_lists_tab_id_fkey'
  ) THEN
    ALTER TABLE public.todo_lists
    ADD CONSTRAINT todo_lists_tab_id_fkey
    FOREIGN KEY (tab_id) REFERENCES public.todo_tabs(id) ON DELETE SET NULL;
  END IF;
END $$;

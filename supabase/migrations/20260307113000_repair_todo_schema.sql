-- Repair todo-related schema drift on older deployments.
-- Safe to run multiple times.

-- 1. Ensure todo_tabs uses text ids so built-in tabs like 'tab_todo' work.
ALTER TABLE public.todo_lists DROP CONSTRAINT IF EXISTS todo_lists_tab_id_fkey;

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
    ALTER TABLE public.todo_tabs ALTER COLUMN id TYPE text USING id::text;
  END IF;
END $$;

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
    ALTER TABLE public.todo_lists ALTER COLUMN tab_id TYPE text USING tab_id::text;
  END IF;
END $$;

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

-- 2. Ensure todo list extension columns exist.
ALTER TABLE public.todo_lists
ADD COLUMN IF NOT EXISTS due_date text,
ADD COLUMN IF NOT EXISTS type text DEFAULT 'todo';

-- 3. Ensure todo detail columns exist.
ALTER TABLE public.todos
ADD COLUMN IF NOT EXISTS start_date text,
ADD COLUMN IF NOT EXISTS due_date text,
ADD COLUMN IF NOT EXISTS sub_tasks jsonb;

-- 4. Ensure todo_steps table exists.
CREATE TABLE IF NOT EXISTS public.todo_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  list_id uuid REFERENCES public.todo_lists(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  "order" integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Ensure todos.step_id exists and references todo_steps.
ALTER TABLE public.todos
ADD COLUMN IF NOT EXISTS step_id uuid REFERENCES public.todo_steps(id) ON DELETE SET NULL;

-- 6. Ensure RLS/policy on todo_steps.
ALTER TABLE public.todo_steps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'todo_steps'
      AND policyname = 'Users can manage own todo steps'
  ) THEN
    CREATE POLICY "Users can manage own todo steps"
    ON public.todo_steps FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

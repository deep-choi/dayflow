-- life-sync-ai: Add todo_steps table for grouping todos within a list
CREATE TABLE IF NOT EXISTS public.todo_steps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    list_id uuid REFERENCES public.todo_lists(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    "order" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add step_id to todos table
ALTER TABLE public.todos 
ADD COLUMN IF NOT EXISTS step_id uuid REFERENCES public.todo_steps(id) ON DELETE SET NULL;

-- Enable RLS for todo_steps
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
    USING (auth.uid() = user_id);
  END IF;
END $$;

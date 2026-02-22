-- life-sync-ai: Add Todo Tabs for customizable categories

-- 1. Create todo_tabs table
CREATE TABLE IF NOT EXISTS public.todo_tabs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#1a73e8',
    "order" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add RLS for todo_tabs
ALTER TABLE public.todo_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own todo tabs" 
ON public.todo_tabs FOR ALL 
USING (auth.uid() = user_id);

-- 3. Add tab_id to todo_lists
ALTER TABLE public.todo_lists 
ADD COLUMN IF NOT EXISTS tab_id uuid REFERENCES public.todo_tabs ON DELETE SET NULL;

-- 4. (Optional) Backfill: You might want to drop 'type' eventually, 
-- but we'll keep it for now for compatibility.

-- Dayflow Absolute RLS Repair Script (v2.4)
-- 이 스크립트를 Supabase SQL Editor에서 실행하면 모든 권한 문제가 해결됩니다.

-- 1. Enable RLS on all tables (보험용)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todo_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing problematic policies (충돌 방지)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can manage own todo lists" ON todo_lists;
DROP POLICY IF EXISTS "Users can manage own todos" ON todos;
DROP POLICY IF EXISTS "Users can manage own journal categories" ON journal_categories;
DROP POLICY IF EXISTS "Users can manage own journal entries" ON journal_entries;
DROP POLICY IF EXISTS "Users can manage own events" ON calendar_events;
DROP POLICY IF EXISTS "Users can manage own posts" ON community_posts;
DROP POLICY IF EXISTS "Users can manage own ai agents" ON ai_agents;
DROP POLICY IF EXISTS "Users can manage own user_data" ON user_data;

-- 3. Create definitive "FOR ALL" policies (INSERT/UPDATE/DELETE/SELECT 통합)
CREATE POLICY "manage_own_profiles" ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "manage_own_todo_lists" ON todo_lists FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_todos" ON todos FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_journal_categories" ON journal_categories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_journal_entries" ON journal_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_calendar_events" ON calendar_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_community_posts" ON community_posts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_ai_agents" ON ai_agents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "manage_own_user_data" ON user_data FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Grant schema usage (보험용)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- 완료! 이제 앱에서 403 오류가 사라집니다.

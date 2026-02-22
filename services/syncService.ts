import { supabase } from '../utils/supabase';
import { CalendarEvent, Todo, TodoList, TodoTab, TodoStep, JournalEntry, JournalCategory, CommunityPost, AIAgent, AppSettings, ChatSession, ActivityItem, AiPost, CalendarTag } from '../types';

// ─── Debounce helper ──────────────────────────────────────────────
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const scopedKey = (resource: string, userId: string) => `${resource}:${userId}`;
const pendingUserData = new Map<string, {
    settings?: AppSettings;
    chatSessions?: ChatSession[];
    activityLog?: ActivityItem[];
    calendarTags?: CalendarTag[];
}>();

let onSyncErrorCallback: (err: any) => void = () => { };
export const setOnSyncError = (callback: (err: any) => void) => {
    onSyncErrorCallback = callback;
};

const debouncedSync = (key: string, fn: () => Promise<void>, delayMs = 350) => {
    const existing = pendingTimers.get(key);
    if (existing) clearTimeout(existing);
    pendingTimers.set(key, setTimeout(async () => {
        pendingTimers.delete(key);
        try {
            await fn();
        } catch (err) {
            console.error(`[Sync] ${key} failed:`, err);
            onSyncErrorCallback(err);
        }
    }, delayMs));
};

const toInFilter = (ids: string[]) => `(${ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')})`;

// ─── Calendar Events ──────────────────────────────────────────────
export const syncEvents = (userId: string, events: CalendarEvent[]) => {
    if (!userId) {
        console.error('[Sync] syncEvents aborted: No userId provided');
        return;
    }
    console.log(`[Sync] v2.2 syncEvents for user ${userId}`);
    debouncedSync(scopedKey('events', userId), async () => {
        const rows = events.map(e => ({
            id: e.id,
            user_id: userId,
            title: e.title,
            start_time: e.date + (e.startTime ? `T${e.startTime}:00` : 'T00:00:00'),
            end_time: e.date + (e.endTime ? `T${e.endTime}:00` : 'T23:59:59'),
            description: e.description || null,
            tags: e.type ? [e.type] : [],
        }));
        if (rows.length === 0) {
            console.warn(`[Sync] syncEvents: Blocked deletion of all events for user ${userId} (Potential race condition guard).`);
            return;
        }

        console.log(`[Sync] Upserting ${rows.length} events for user ${userId}`);
        const { error: upsertError } = await supabase.from('calendar_events').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('calendar_events')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Todos ────────────────────────────────────────────────────────
export const syncTodos = (userId: string, todos: Todo[]) => {
    if (!userId) {
        console.error('[Sync] syncTodos aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('todos', userId), async () => {
        const rows = todos.map((t, i) => ({
            id: t.id,
            user_id: userId,
            list_id: t.listId || null,
            text: t.text,
            completed: t.completed,
            order: i,
            start_date: t.startDate || null,
            due_date: t.dueDate || null,
            sub_tasks: t.subTasks || null,
            step_id: t.stepId || null,
        }));
        if (rows.length === 0) {
            console.warn(`[Sync] syncTodos: Blocked deletion of all todos for user ${userId} (Potential race condition guard).`);
            return;
        }

        console.log(`[Sync] Upserting ${rows.length} todos for user ${userId}`);
        const { error: upsertError } = await supabase.from('todos').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('todos')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Todo Lists ───────────────────────────────────────────────────
export const syncTodoLists = (userId: string, lists: TodoList[]) => {
    if (!userId) {
        console.error('[Sync] syncTodoLists aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('todo_lists', userId), async () => {
        const rows = lists.map(l => ({
            id: l.id,
            user_id: userId,
            title: l.title,
            order: l.order,
            due_date: l.dueDate || null,
            tab_id: l.tabId || null,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('todo_lists').delete().eq('user_id', userId);
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('todo_lists').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('todo_lists')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Todo Tabs ─────────────────────────────────────────────────────
export const syncTodoTabs = (userId: string, tabs: TodoTab[]) => {
    if (!userId) {
        console.error('[Sync] syncTodoTabs aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('todo_tabs', userId), async () => {
        const rows = tabs.map(t => ({
            id: t.id,
            user_id: userId,
            name: t.name,
            color: t.color,
            order: t.order,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('todo_tabs').delete().eq('user_id', userId);
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('todo_tabs').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('todo_tabs')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Todo Steps ────────────────────────────────────────────────────
export const syncTodoSteps = (userId: string, steps: TodoStep[]) => {
    if (!userId) {
        console.error('[Sync] syncTodoSteps aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('todo_steps', userId), async () => {
        const rows = steps.map(s => ({
            id: s.id,
            user_id: userId,
            list_id: s.listId,
            title: s.title,
            order: s.order,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('todo_steps').delete().eq('user_id', userId);
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('todo_steps').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('todo_steps')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Journal Entries ──────────────────────────────────────────────
export const syncEntries = (userId: string, entries: JournalEntry[]) => {
    if (!userId) {
        console.error('[Sync] syncEntries aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('entries', userId), async () => {
        const rows = entries.map(e => ({
            id: e.id,
            user_id: userId,
            title: e.title,
            content: e.content,
            date: e.date,
            mood: e.mood,
            order: e.order ?? 0,
        }));
        if (rows.length === 0) {
            console.warn(`[Sync] syncEntries: Blocked deletion of all journal entries for user ${userId} (Potential race condition guard).`);
            return;
        }

        console.log(`[Sync] Upserting ${rows.length} journal entries for user ${userId}`);
        const { error: upsertError } = await supabase.from('journal_entries').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('journal_entries')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Journal Categories ──────────────────────────────────────────
export const syncJournalCategories = (userId: string, categories: JournalCategory[]) => {
    if (!userId) {
        console.error('[Sync] syncJournalCategories aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('journal_categories', userId), async () => {
        const rows = categories.map(c => ({
            id: c.id,
            user_id: userId,
            name: c.name,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('journal_categories').delete().eq('user_id', userId);
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('journal_categories').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('journal_categories')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── Community Posts ──────────────────────────────────────────────
export const syncCommunityPosts = (userId: string, posts: CommunityPost[]) => {
    if (!userId) {
        console.error('[Sync] syncCommunityPosts aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('community_posts', userId), async () => {
        const rows = posts.map((p, i) => ({
            id: p.id,
            user_id: userId,
            author: p.author,
            content: p.content,
            timestamp: p.timestamp,
            reply_to: p.replyTo || null,
            trigger: p.trigger || null,
            order: p.order ?? i,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('community_posts').delete().eq('user_id', userId);
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('community_posts').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('community_posts')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── AI Posts (Insights) ──────────────────────────────────────────
export const syncAiPosts = (userId: string, posts: AiPost[]) => {
    debouncedSync(scopedKey('ai_posts', userId), async () => {
        const rows = posts.map((p, i) => ({
            id: p.id,
            user_id: userId,
            author: 'AI',
            content: JSON.stringify({ title: p.title, content: p.content, tags: p.tags, type: p.type }),
            timestamp: p.date,
            trigger: '__ai_post__',
            order: i,
        }));
        if (rows.length === 0) {
            const { error } = await supabase.from('community_posts').delete().eq('user_id', userId).eq('trigger', '__ai_post__');
            if (error) throw error;
            return;
        }

        const { error: upsertError } = await supabase.from('community_posts').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('community_posts')
            .delete()
            .eq('user_id', userId)
            .eq('trigger', '__ai_post__')
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── AI Agents ────────────────────────────────────────────────────
// ─── AI Agents ────────────────────────────────────────────────────
export const syncAgents = (userId: string, agents: AIAgent[]) => {
    if (!userId) {
        console.error('[Sync] syncAgents aborted: No userId provided');
        return;
    }
    debouncedSync(scopedKey('ai_agents', userId), async () => {
        const rows = agents.map((a, i) => ({
            id: a.id,
            user_id: userId,
            name: a.name,
            emoji: a.emoji,
            role: a.role,
            personality: a.personality,
            tone: a.tone,
            color: a.color,
            avatar: a.avatar || null,
            connection_id: a.connectionId || null,
            order: i,
        }));
        if (rows.length === 0) {
            console.warn(`[Sync] syncAgents: Blocked deletion of all agents for user ${userId} (Potential race condition guard).`);
            return;
        }

        console.log(`[Sync] Upserting ${rows.length} agents for user ${userId}`);
        const { error: upsertError } = await supabase.from('ai_agents').upsert(rows, { onConflict: 'id' });
        if (upsertError) throw upsertError;

        const { error: deleteStaleError } = await supabase
            .from('ai_agents')
            .delete()
            .eq('user_id', userId)
            .not('id', 'in', toInFilter(rows.map((row) => row.id)));
        if (deleteStaleError) throw deleteStaleError;
    });
};

// ─── User Data (JSONB blob: settings, chat sessions, activity) ───
export const syncUserData = (userId: string, data: {
    settings?: AppSettings;
    chatSessions?: ChatSession[];
    activityLog?: ActivityItem[];
    calendarTags?: CalendarTag[];
}) => {
    if (!userId) {
        console.error('[Sync] syncUserData aborted: No userId provided');
        return;
    }
    const key = scopedKey('user_data', userId);
    const merged = { ...(pendingUserData.get(key) || {}), ...data };
    pendingUserData.set(key, merged);

    debouncedSync(key, async () => {
        const pending = pendingUserData.get(key);
        pendingUserData.delete(key);
        if (!pending) return;

        const payload: Record<string, any> = { user_id: userId, updated_at: new Date().toISOString() };
        if (pending.settings !== undefined) payload.settings = pending.settings;
        if (pending.chatSessions !== undefined) payload.chat_sessions = pending.chatSessions;
        if (pending.activityLog !== undefined) payload.activity_log = pending.activityLog;
        if (pending.calendarTags !== undefined) payload.calendar_tags = pending.calendarTags;

        console.log(`[Sync] Upserting user_data for user ${userId}. Keys present: ${Object.keys(payload).join(', ')}`);
        const { error } = await supabase
            .from('user_data')
            .upsert(payload, { onConflict: 'user_id' });
        if (error) throw error;
    });
};

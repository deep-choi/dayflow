import { supabase } from '../utils/supabase';
import { CalendarEvent, Todo, TodoList, TodoTab, TodoStep, JournalEntry, JournalCategory, CommunityPost, AIAgent, AppSettings, ChatSession, ActivityItem, AiPost, CalendarTag, PersonaMemory } from '../types';

// ─── Debounce helper ──────────────────────────────────────────────
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const scopedKey = (resource: string, userId: string) => `${resource}:${userId}`;
const syncSnapshotKey = (resource: string, userId: string) => `${resource}:${userId}`;
const syncSnapshots = new Map<string, Set<string>>();
const pendingUserData = new Map<string, {
    settingsPatch?: Partial<AppSettings>;
    settingsSnapshot?: AppSettings;
    activityLog?: ActivityItem[];
    calendarTags?: CalendarTag[];
}>();

const getDeletedIds = (resource: string, userId: string, nextIds: string[]): string[] => {
    const key = syncSnapshotKey(resource, userId);
    const prev = syncSnapshots.get(key);
    const next = new Set(nextIds);
    syncSnapshots.set(key, next);
    if (!prev) return [];
    return [...prev].filter((id) => !next.has(id));
};

export const seedSyncSnapshot = (resource: string, userId: string, ids: string[]) => {
    syncSnapshots.set(syncSnapshotKey(resource, userId), new Set(ids));
};

export const clearSyncSnapshots = (userId: string) => {
    const suffix = `:${userId}`;
    [...syncSnapshots.keys()].forEach((key) => {
        if (key.endsWith(suffix)) syncSnapshots.delete(key);
    });
};

const clearScopedMapEntries = <T>(map: Map<string, T>, userId: string) => {
    const suffix = `:${userId}`;
    [...map.keys()].forEach((key) => {
        if (key.endsWith(suffix)) map.delete(key);
    });
};

export const clearPendingSyncTasks = (userId: string) => {
    const suffix = `:${userId}`;
    [...pendingTimers.entries()].forEach(([key, timer]) => {
        if (!key.endsWith(suffix)) return;
        clearTimeout(timer);
        pendingTimers.delete(key);
    });
    clearScopedMapEntries(pendingUserData, userId);
    clearScopedMapEntries(pendingChatSessions, userId);
};

export const clearUserSyncState = (userId: string) => {
    clearPendingSyncTasks(userId);
    clearSyncSnapshots(userId);
};

const normalizeChatAction = (action: any) => {
    if (!action || typeof action !== 'object') return undefined;
    const normalized: any = {
        type: action.type,
        executed: Boolean(action.executed),
    };

    const data = action.data;
    if (data && typeof data === 'object') {
        // Keep payload small and stable for persistence.
        if (typeof data.prompt === 'string') normalized.data = { prompt: data.prompt.slice(0, 1000) };
        else if (typeof data.id === 'string') normalized.data = { id: data.id };
        else if (typeof data.title === 'string') normalized.data = { title: data.title.slice(0, 240) };
    }

    return normalized;
};

const sanitizeStoredMediaUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Data URIs easily exceed storage limits; store only fetchable URLs.
    if (trimmed.startsWith('data:')) return null;
    return trimmed;
};

const isMissingChatTableError = (error: any): boolean =>
    error?.code === '42P01' || error?.code === '42703';

const isMissingPersonaMemoryTableError = (error: any): boolean =>
    error?.code === '42P01' || error?.code === '42703';

const isMissingUserDataResourceError = (error: any): boolean =>
    error?.code === '42P01' || error?.code === '42703';

const isMissingMergeUserDataFunctionError = (error: any): boolean =>
    error?.code === '42883' || `${error?.message || ''}`.includes('merge_user_data_patch');

const TODO_OPTIONAL_DB_COLUMNS = ['start_date', 'due_date', 'sub_tasks', 'step_id'] as const;
type TodoOptionalDbColumn = (typeof TODO_OPTIONAL_DB_COLUMNS)[number];

const getUnsupportedTodoColumns = (error: any): TodoOptionalDbColumn[] => {
    const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return TODO_OPTIONAL_DB_COLUMNS.filter((column) => raw.includes(column));
};

const stripTodoOptionalColumns = <T extends Record<string, any>>(value: T, columns: TodoOptionalDbColumn[]): T => {
    if (!columns.length) return value;
    const next = { ...value };
    columns.forEach((column) => {
        delete next[column];
    });
    return next;
};

const retryTodoUpsertWithFallback = async (
    rows: Record<string, any>[],
): Promise<{ error: any; rows: Record<string, any>[] }> => {
    let payloadRows = rows.map((row) => ({ ...row }));
    let attempt = 0;

    while (attempt < TODO_OPTIONAL_DB_COLUMNS.length) {
        const result = await supabase.from('todos').upsert(payloadRows, { onConflict: 'id' });
        const unsupportedColumns = getUnsupportedTodoColumns(result.error);
        if (!result.error || unsupportedColumns.length === 0) {
            return { error: result.error, rows: payloadRows };
        }
        payloadRows = payloadRows.map((row) => stripTodoOptionalColumns(row, unsupportedColumns));
        attempt += 1;
    }

    const finalResult = await supabase.from('todos').upsert(payloadRows, { onConflict: 'id' });
    return { error: finalResult.error, rows: payloadRows };
};

const TODO_LIST_OPTIONAL_DB_COLUMNS = ['due_date', 'tab_id', 'type'] as const;
type TodoListOptionalDbColumn = (typeof TODO_LIST_OPTIONAL_DB_COLUMNS)[number];

const getUnsupportedTodoListColumns = (error: any): TodoListOptionalDbColumn[] => {
    const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return TODO_LIST_OPTIONAL_DB_COLUMNS.filter((column) => raw.includes(column));
};

const shouldRetryTodoListWithoutTab = (error: any): boolean => {
    const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    return (
        error?.code === '23503' ||
        error?.code === '22P02' ||
        raw.includes('todo_lists_tab_id') ||
        raw.includes('tab_todo') ||
        raw.includes('tab_project') ||
        raw.includes('tab_routine')
    );
};

const stripTodoListOptionalColumns = <T extends Record<string, any>>(value: T, columns: TodoListOptionalDbColumn[]): T => {
    if (!columns.length) return value;
    const next = { ...value };
    columns.forEach((column) => {
        delete next[column];
    });
    return next;
};

const retryTodoListUpsertWithFallback = async (
    rows: Record<string, any>[],
): Promise<{ error: any; rows: Record<string, any>[] }> => {
    let payloadRows = rows.map((row) => ({ ...row }));
    let attempt = 0;

    while (attempt < TODO_LIST_OPTIONAL_DB_COLUMNS.length + 1) {
        const result = await supabase.from('todo_lists').upsert(payloadRows, { onConflict: 'id' });
        if (!result.error) return { error: null, rows: payloadRows };

        const columnsToStrip = new Set<TodoListOptionalDbColumn>(getUnsupportedTodoListColumns(result.error));
        if (shouldRetryTodoListWithoutTab(result.error)) {
            columnsToStrip.add('tab_id');
        }

        if (columnsToStrip.size === 0) {
            return { error: result.error, rows: payloadRows };
        }

        payloadRows = payloadRows.map((row) => stripTodoListOptionalColumns(row, [...columnsToStrip]));
        attempt += 1;
    }

    const finalResult = await supabase.from('todo_lists').upsert(payloadRows, { onConflict: 'id' });
    return { error: finalResult.error, rows: payloadRows };
};

const toPersistedChatSession = (session: ChatSession): ChatSession => ({
    ...session,
    title: (session.title || '새 대화').slice(0, 240),
    messages: (Array.isArray(session.messages) ? session.messages : []).map((message) => ({
        ...message,
        content: (message.content || '').slice(0, 12000),
        imageUrl: sanitizeStoredMediaUrl(message.imageUrl) || undefined,
        videoUrl: sanitizeStoredMediaUrl(message.videoUrl) || undefined,
        action: normalizeChatAction(message.action),
        quickReplies: Array.isArray(message.quickReplies)
            ? message.quickReplies.slice(0, 8).map((reply) => String(reply || '').slice(0, 160))
            : undefined,
    })),
});

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
            end_time: (e.endDate || e.date) + (e.endTime ? `T${e.endTime}:00` : 'T23:59:59'),
            description: e.description || null,
            tags: e.type ? [e.type] : [],
        }));
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('events', userId, rowIds);

        if (rows.length > 0) {
            console.log(`[Sync] Upserting ${rows.length} events for user ${userId}`);
            const { error: upsertError } = await supabase.from('calendar_events').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('calendar_events')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('todos', userId, rowIds);

        if (rows.length > 0) {
            console.log(`[Sync] Upserting ${rows.length} todos for user ${userId}`);
            const { error: upsertError } = await retryTodoUpsertWithFallback(rows);
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('todos')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('todo_lists', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await retryTodoListUpsertWithFallback(rows);
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('todo_lists')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('todo_tabs', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await supabase.from('todo_tabs').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('todo_tabs')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('todo_steps', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await supabase.from('todo_steps').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('todo_steps')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('journal_entries', userId, rowIds);

        if (rows.length > 0) {
            console.log(`[Sync] Upserting ${rows.length} journal entries for user ${userId}`);
            const { error: upsertError } = await supabase.from('journal_entries').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('journal_entries')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('journal_categories', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await supabase.from('journal_categories').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('journal_categories')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('community_posts', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await supabase.from('community_posts').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('community_posts')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('ai_posts', userId, rowIds);

        if (rows.length > 0) {
            const { error: upsertError } = await supabase.from('community_posts').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('community_posts')
                .delete()
                .eq('user_id', userId)
                .eq('trigger', '__ai_post__')
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
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
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('ai_agents', userId, rowIds);

        if (rows.length > 0) {
            console.log(`[Sync] Upserting ${rows.length} agents for user ${userId}`);
            const { error: upsertError } = await supabase.from('ai_agents').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('ai_agents')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) throw deleteError;
        }
    });
};

const pendingChatSessions = new Map<string, ChatSession[]>();

const seedMessageSnapshot = (userId: string, sessionId: string, messageIds: string[]) => {
    syncSnapshots.set(syncSnapshotKey(`chat_messages:${sessionId}`, userId), new Set(messageIds));
};

const clearMessageSnapshot = (userId: string, sessionId: string) => {
    syncSnapshots.delete(syncSnapshotKey(`chat_messages:${sessionId}`, userId));
};

export const syncChatSessions = (userId: string, sessions: ChatSession[]) => {
    if (!userId) {
        console.error('[Sync] syncChatSessions aborted: No userId provided');
        return;
    }

    // Protect only the pre-hydration empty state. Once a snapshot exists,
    // an empty array means "delete all remaining sessions".
    if (sessions.length === 0 && !syncSnapshots.has(syncSnapshotKey('chat_sessions', userId))) {
        console.log('[Sync] syncChatSessions: Sessions list is empty, skipping sync to protect data.');
        return;
    }

    const key = scopedKey('chat_sessions_sync', userId);
    pendingChatSessions.set(key, sessions.map(toPersistedChatSession));

    debouncedSync(key, async () => {
        const pending = pendingChatSessions.get(key);
        pendingChatSessions.delete(key);
        if (!pending) return;

        const sessionRows = pending.map((session) => ({
            id: session.id,
            user_id: userId,
            title: session.title || '새 대화',
            created_at: session.createdAt,
            last_message_at: session.lastMessageAt,
            agent_id: session.agentId || null,
            agent_ids: Array.isArray(session.agentIds) ? session.agentIds : [],
            updated_at: new Date().toISOString(),
        }));

        const sessionIds = sessionRows.map((row) => row.id);
        const deletedSessionIds = getDeletedIds('chat_sessions', userId, sessionIds);

        if (sessionRows.length > 0) {
            const { error: upsertSessionError } = await supabase
                .from('chat_sessions')
                .upsert(sessionRows, { onConflict: 'id' });
            if (upsertSessionError) {
                if (isMissingChatTableError(upsertSessionError)) return;
                throw upsertSessionError;
            }
        }

        if (deletedSessionIds.length > 0) {
            const { error: deleteSessionError } = await supabase
                .from('chat_sessions')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedSessionIds);
            if (deleteSessionError) {
                if (isMissingChatTableError(deleteSessionError)) return;
                throw deleteSessionError;
            }
            deletedSessionIds.forEach((sessionId) => clearMessageSnapshot(userId, sessionId));
        }

        for (const session of pending) {
            const messageRows = session.messages.map((message, index) => ({
                id: message.id,
                session_id: session.id,
                user_id: userId,
                role: message.role,
                content: message.content || '',
                timestamp: message.timestamp,
                agent_id: message.agentId || null,
                provider: message.provider || null,
                model_name: message.modelName || null,
                connection_id: message.connectionId || null,
                image_url: sanitizeStoredMediaUrl(message.imageUrl),
                video_url: sanitizeStoredMediaUrl(message.videoUrl),
                action: message.action || null,
                quick_replies: Array.isArray(message.quickReplies) ? message.quickReplies : null,
                order_index: index,
                updated_at: new Date().toISOString(),
            }));

            const messageIds = messageRows.map((row) => row.id);
            const deletedMessageIds = getDeletedIds(`chat_messages:${session.id}`, userId, messageIds);

            if (messageRows.length > 0) {
                const { error: upsertMessageError } = await supabase
                    .from('chat_messages')
                    .upsert(messageRows, { onConflict: 'id' });
                if (upsertMessageError) {
                    if (isMissingChatTableError(upsertMessageError)) return;
                    throw upsertMessageError;
                }
            } else {
                // Keep in-memory snapshot aligned for empty session message lists.
                seedMessageSnapshot(userId, session.id, []);
            }

            if (deletedMessageIds.length > 0) {
                const { error: deleteMessageError } = await supabase
                    .from('chat_messages')
                    .delete()
                    .eq('user_id', userId)
                    .eq('session_id', session.id)
                    .in('id', deletedMessageIds);
                if (deleteMessageError) {
                    if (isMissingChatTableError(deleteMessageError)) return;
                    throw deleteMessageError;
                }
            }
        }
    });
};

// ─── Persona Memories (per-agent long-term memory) ─────────────────
export const syncPersonaMemories = (userId: string, memories: PersonaMemory[]) => {
    if (!userId) {
        console.error('[Sync] syncPersonaMemories aborted: No userId provided');
        return;
    }

    const key = scopedKey('persona_memories', userId);
    debouncedSync(key, async () => {
        const rows = memories.map((memory) => ({
            id: memory.id,
            user_id: userId,
            agent_id: memory.agentId,
            memory_type: memory.type,
            memory_key: memory.key,
            content: memory.content,
            confidence: memory.confidence,
            observation_count: memory.observationCount,
            first_observed_at: memory.firstObservedAt,
            last_observed_at: memory.lastObservedAt,
            updated_at: new Date().toISOString(),
        }));
        const rowIds = rows.map((row) => row.id);
        const deletedIds = getDeletedIds('persona_memories', userId, rowIds);

        if (rows.length > 0) {
            const { error } = await supabase
                .from('persona_memories')
                .upsert(rows, { onConflict: 'user_id,agent_id,memory_key' });
            if (error) {
                if (isMissingPersonaMemoryTableError(error)) return;
                throw error;
            }
        }

        if (deletedIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('persona_memories')
                .delete()
                .eq('user_id', userId)
                .in('id', deletedIds);
            if (deleteError) {
                if (isMissingPersonaMemoryTableError(deleteError)) return;
                throw deleteError;
            }
        }
    });
};

// ─── User Data (JSONB blob: settings, activity, calendar tags) ───
export const syncUserData = (userId: string, data: {
    settingsPatch?: Partial<AppSettings>;
    settingsSnapshot?: AppSettings;
    activityLog?: ActivityItem[];
    calendarTags?: CalendarTag[];
}) => {
    if (!userId) {
        console.error('[Sync] syncUserData aborted: No userId provided');
        return;
    }
    const key = scopedKey('user_data', userId);
    const existing = pendingUserData.get(key) || {};
    const merged = {
        ...existing,
        ...data,
        settingsPatch: data.settingsPatch
            ? { ...(existing.settingsPatch || {}), ...data.settingsPatch }
            : existing.settingsPatch,
        settingsSnapshot: data.settingsSnapshot ?? existing.settingsSnapshot,
    };
    pendingUserData.set(key, merged);

    debouncedSync(key, async () => {
        const pending = pendingUserData.get(key);
        pendingUserData.delete(key);
        if (!pending) return;

        const hasSettingsPatch = Boolean(pending.settingsPatch && Object.keys(pending.settingsPatch).length > 0);
        const shouldTryMergeRpc =
            hasSettingsPatch ||
            pending.activityLog !== undefined ||
            pending.calendarTags !== undefined;

        if (shouldTryMergeRpc) {
            const { error: mergeError } = await supabase.rpc('merge_user_data_patch', {
                p_user_id: userId,
                p_settings_patch: hasSettingsPatch ? pending.settingsPatch : null,
                p_activity_log: pending.activityLog ?? null,
                p_calendar_tags: pending.calendarTags ?? null,
            });

            if (!mergeError) {
                return;
            }

            if (!isMissingMergeUserDataFunctionError(mergeError)) {
                if (isMissingUserDataResourceError(mergeError)) return;
                throw mergeError;
            }
        }

        const payload: Record<string, any> = { user_id: userId, updated_at: new Date().toISOString() };
        if (pending.settingsSnapshot !== undefined) payload.settings = pending.settingsSnapshot;
        if (pending.activityLog !== undefined) payload.activity_log = pending.activityLog;
        if (pending.calendarTags !== undefined) payload.calendar_tags = pending.calendarTags;

        if (Object.keys(payload).length <= 2) return;

        console.log(`[Sync] Upserting user_data for user ${userId}. Keys present: ${Object.keys(payload).join(', ')}`);
        const { error } = await supabase
            .from('user_data')
            .upsert(payload, { onConflict: 'user_id' });
        if (error) {
            if (isMissingUserDataResourceError(error)) return;
            throw error;
        }
    });
};

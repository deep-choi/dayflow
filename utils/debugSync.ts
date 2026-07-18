import { supabase } from './supabase';
import { AppSettings, CalendarEvent, Todo, TodoList, JournalEntry, JournalCategory, CommunityPost, AIAgent, ActivityItem, CalendarTag } from '../types';

export interface SyncDebugResult {
    success: boolean;
    logs: string[];
    error?: string;
}

export const debugManualSync = async (
    userId: string,
    data: {
        events: CalendarEvent[];
        todos: Todo[];
        todoLists: TodoList[];
        entries: JournalEntry[];
        journalCategories: JournalCategory[];
        communityPosts: CommunityPost[];
        aiAgents: AIAgent[];
        settings: AppSettings;
        activityLog: ActivityItem[];
        calendarTags: CalendarTag[];
    }
): Promise<SyncDebugResult> => {
    const logs: string[] = [];
    const errors: string[] = [];
    logs.push(`Starting manual sync for user: ${userId}`);

    // 1. Events
    try {
        logs.push(`Syncing ${data.events.length} events...`);
        // Try UPSERT instead of DELETE+INSERT to avoid potential AbortError on delete
        if (data.events.length > 0) {
            const eventRows = data.events.map(e => ({
                id: e.id,
                user_id: userId,
                title: e.title,
                start_time: e.date + (e.startTime ? `T${e.startTime}:00` : 'T00:00:00'),
                end_time: (e.endDate || e.date) + (e.endTime ? `T${e.endTime}:00` : 'T23:59:59'),
                description: e.description || null,
                tags: e.type ? [e.type] : [],
            }));
            const { error: insEventErr } = await supabase.from('calendar_events').upsert(eventRows, { onConflict: 'id' });
            if (insEventErr) throw new Error(`Event Upsert Failed: ${insEventErr.message}`);
        }
        logs.push('Events synced successfully (UPSERT).');
    } catch (e: any) {
        const message = e?.message || 'unknown error';
        logs.push(`[ERROR] Events sync failed: ${message}`);
        errors.push(`events: ${message}`);
    }

    // 2. Todos
    try {
        logs.push(`Syncing ${data.todos.length} todos...`);
        if (data.todos.length > 0) {
            const todoRows = data.todos.map((t, i) => ({
                id: t.id,
                user_id: userId,
                list_id: t.listId || null,
                text: t.text,
                completed: t.completed,
                order: i,
            }));
            const { error: insTodoErr } = await supabase.from('todos').upsert(todoRows, { onConflict: 'id' });
            if (insTodoErr) throw new Error(`Todo Upsert Failed: ${insTodoErr.message}`);
        }
        logs.push('Todos synced successfully (UPSERT).');
    } catch (e: any) {
        const message = e?.message || 'unknown error';
        logs.push(`[ERROR] Todos sync failed: ${message}`);
        errors.push(`todos: ${message}`);
    }

    // 3. User Data
    try {
        logs.push('Syncing user_data JSONB...');
        const userDataPayload = {
            user_id: userId,
            settings: data.settings,
            activity_log: data.activityLog,
            calendar_tags: data.calendarTags,
            updated_at: new Date().toISOString()
        };
        const { error: userDataErr } = await supabase.from('user_data').upsert(userDataPayload, { onConflict: 'user_id' });
        if (userDataErr) throw new Error(`UserData Upsert Failed: ${userDataErr.message}`);
        logs.push('User Data synced successfully.');
    } catch (e: any) {
        const message = e?.message || 'unknown error';
        logs.push(`[ERROR] UserData sync failed: ${message}`);
        errors.push(`user_data: ${message}`);
    }

    // 4. AI Agents
    try {
        logs.push(`Syncing ${data.aiAgents.length} agents...`);
        // For agents, order matters and there might be deletions, but sticking to upsert for safety due to AbortError
        if (data.aiAgents.length > 0) {
            const agentRows = data.aiAgents.map((a, i) => ({
                id: a.id,
                user_id: userId,
                name: a.name,
                emoji: a.emoji,
                role: a.role,
                personality: a.personality,
                tone: a.tone,
                color: a.color,
                avatar: a.avatar || null,
                response_length: a.responseLength || 'medium',
                order: i,
            }));
            const { error: insAgentErr } = await supabase.from('ai_agents').upsert(agentRows, { onConflict: 'id' });
            if (insAgentErr) throw new Error(`Agent Upsert Failed: ${insAgentErr.message}`);
        }
        logs.push('AI Agents synced successfully (UPSERT).');
    } catch (e: any) {
        const message = e?.message || 'unknown error';
        logs.push(`[ERROR] Agents sync failed: ${message}`);
        errors.push(`ai_agents: ${message}`);
    }

    return {
        success: errors.length === 0,
        logs,
        error: errors.length > 0 ? errors.join(' | ') : undefined
    };
};

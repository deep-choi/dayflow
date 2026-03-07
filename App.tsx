import React, { useState, useEffect, useRef } from 'react';
import { ViewState, CalendarEvent, Todo, JournalEntry, AiPost, CommunityPost, AIAgent, ActivityItem, AppSettings, TodoList, TodoTab, TodoStep, CalendarTag, JournalCategory, Comment, User, ChatSession, ChatMessage, PersonaMemory, PersonaMemoryType } from './types';
import { Calendar as CalendarIcon, CheckSquare, BookOpen, MessageCircle, Sparkles, ChevronDown, Plus, Trash2, Settings2, Hash, Search, Layout, MoreVertical, Edit3, LogOut, User as UserIcon, X, Users, Menu } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale/ko';
import { supabase } from './utils/supabase';
import CalendarView from './views/CalendarView';
import TodoView from './views/TodoView';
import JournalView from './views/JournalView';
import { DEFAULT_AGENTS } from './data/defaultAgents';
import SettingsView from './views/SettingsView';
import ChatView from './views/ChatView';
import AuthView from './views/AuthView';
import { normalizeKoreanText } from './utils/encodingFix';
import { syncEvents, syncTodos, syncTodoLists, syncTodoTabs, syncTodoSteps, syncEntries, syncJournalCategories, syncCommunityPosts, syncAgents, syncChatSessions, syncPersonaMemories, syncUserData, setOnSyncError, seedSyncSnapshot, clearSyncSnapshots } from './services/syncService';
import { debugManualSync } from './utils/debugSync';
import { useAuthSession } from './hooks/useAuthSession';
import { clearChatSessionsCache, loadChatSessionsCache, saveChatSessionsCache } from './utils/chatSessionCache';

type ChatObservation = {
  text: string;
  timestamp: string;
};

const PERSONA_MEMORY_SESSION_LIMIT = 4;
const PERSONA_MEMORY_LINE_LIMIT = 12;
const PERSONA_MEMORY_ITEM_CHAR_LIMIT = 120;
const PERSONA_MEMORY_TOTAL_CHAR_LIMIT = 1400;
const PERSONA_MEMORY_FACT_LIMIT = 6;
const PERSONA_MEMORY_PREFERENCE_LIMIT = 6;
const PERSONA_MEMORY_GOAL_LIMIT = 6;
const PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT = 3;
const PERSONA_MEMORY_MAX_CONTENT_CHARS = 180;
const PERSONA_MEMORY_DB_PER_AGENT_LIMIT = 24;

type PersonaMemoryBuckets = {
  facts: string[];
  preferences: string[];
  goals: string[];
};

const EMPTY_PERSONA_MEMORY_BUCKETS: PersonaMemoryBuckets = {
  facts: [],
  preferences: [],
  goals: [],
};

const dedupeAgentIds = (ids: Array<string | undefined | null>): string[] =>
  Array.from(
    new Set(
      ids
        .map(id => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    )
  );

const extractAssistantAgentIds = (messages: ChatMessage[]): string[] =>
  dedupeAgentIds(
    (messages || [])
      .filter(message => message.role === 'assistant')
      .map(message => message.agentId)
  );

const inferAgentIdFromMessages = (messages: ChatMessage[], agents: AIAgent[]): string | undefined => {
  if (!messages?.length || !agents?.length) return undefined;

  const taggedAgentId = extractAssistantAgentIds(messages)[0];
  if (taggedAgentId) return taggedAgentId;

  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '').trim();
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  for (const message of assistantMessages) {
    const content = normalize(message.content || '');
    if (!content) continue;
    const matchedAgent = agents.find(agent => content.includes(normalize(agent.name)));
    if (matchedAgent) return matchedAgent.id;
  }
  return undefined;
};

const resolveSessionAgentIds = (
  session: ChatSession,
  agents: AIAgent[],
  fallbackIds: string[] = []
): string[] => {
  const fromSession = dedupeAgentIds([
    ...(Array.isArray(session.agentIds) ? session.agentIds : []),
    session.agentId,
  ]);
  if (fromSession.length > 0) return fromSession;

  const fromMessages = extractAssistantAgentIds(session.messages || []);
  if (fromMessages.length > 0) return fromMessages;

  const inferred = inferAgentIdFromMessages(session.messages || [], agents);
  if (inferred) return [inferred];

  const fallback = dedupeAgentIds(fallbackIds);
  if (fallback.length > 0) return fallback;

  return agents[0]?.id ? [agents[0].id] : [];
};

const isSameAgentIdList = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
};

const hasUserChatMessage = (session: ChatSession): boolean =>
  Array.isArray(session.messages) && session.messages.some((m: ChatMessage) => m.role === 'user');

const isSameChatMessageList = (a: ChatMessage[], b: ChatMessage[]): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.role !== right.role ||
      left.content !== right.content ||
      left.timestamp !== right.timestamp ||
      left.agentId !== right.agentId
    ) {
      return false;
    }

    const leftAction = left.action;
    const rightAction = right.action;
    if (Boolean(leftAction) !== Boolean(rightAction)) return false;
    if (leftAction && rightAction) {
      if (
        leftAction.type !== rightAction.type ||
        leftAction.executed !== rightAction.executed ||
        JSON.stringify(leftAction.data ?? null) !== JSON.stringify(rightAction.data ?? null)
      ) {
        return false;
      }
    }

    const leftQuickReplies = left.quickReplies || [];
    const rightQuickReplies = right.quickReplies || [];
    if (leftQuickReplies.length !== rightQuickReplies.length) return false;
    for (let j = 0; j < leftQuickReplies.length; j += 1) {
      if (leftQuickReplies[j] !== rightQuickReplies[j]) return false;
    }
  }

  return true;
};

const truncateMemoryText = (value: string, maxChars: number): string => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
};

const memorySentenceCandidates = (text: string): string[] =>
  (text || '')
    .split(/[\n.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const normalizeMemoryKey = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');

const collectMemorySignals = (text: string): {
  facts: string[];
  preferences: string[];
  goals: string[];
} => {
  const facts: string[] = [];
  const preferences: string[] = [];
  const goals: string[] = [];
  const sentences = memorySentenceCandidates(text);

  for (const sentence of sentences) {
    const compact = sentence.toLowerCase();
    const normalizedSentence = truncateMemoryText(sentence, PERSONA_MEMORY_ITEM_CHAR_LIMIT);
    if (!normalizedSentence) continue;

    if (
      /(나는|저는|전|내가|내\s|저의|직업|회사|가족|출근|퇴근|학교|거주|사는곳|사는 곳)/.test(compact)
    ) {
      facts.push(normalizedSentence);
    }

    if (
      /(좋아|싫어|선호|취향|원해|원하지|불편|편해|부담|마음에)/.test(compact)
    ) {
      preferences.push(normalizedSentence);
    }

    if (
      /(목표|계획|해야|해볼|해보려고|루틴|습관|줄이|늘리|이번주|이번 주|이번달|이번 달|오늘부터|내일까지|이번에는)/.test(compact)
    ) {
      goals.push(normalizedSentence);
    }
  }

  return { facts, preferences, goals };
};

const dedupeMemoryItems = (items: string[], limit: number): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = normalizeMemoryKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
};

const memoryBucketKeyToType = (key: keyof PersonaMemoryBuckets): PersonaMemoryType => {
  if (key === 'facts') return 'fact';
  if (key === 'preferences') return 'preference';
  return 'goal';
};

const memoryTypeToBucketKey = (type: PersonaMemoryType): keyof PersonaMemoryBuckets => {
  if (type === 'fact') return 'facts';
  if (type === 'preference') return 'preferences';
  return 'goals';
};

const buildPersonaMemoryBuckets = (memories: PersonaMemory[]): Record<string, PersonaMemoryBuckets> => {
  const output: Record<string, PersonaMemoryBuckets> = {};
  if (!Array.isArray(memories) || memories.length === 0) return output;

  const sorted = [...memories].sort((a, b) => {
    const aTime = new Date(a.lastObservedAt || a.updatedAt || a.createdAt).getTime();
    const bTime = new Date(b.lastObservedAt || b.updatedAt || b.createdAt).getTime();
    return bTime - aTime;
  });

  for (const memory of sorted) {
    if (!memory?.agentId || !memory?.content) continue;
    if (!output[memory.agentId]) {
      output[memory.agentId] = {
        facts: [],
        preferences: [],
        goals: [],
      };
    }
    const bucketKey = memoryTypeToBucketKey(memory.type);
    const bucket = output[memory.agentId][bucketKey];
    if (bucket.length >= PERSONA_MEMORY_DB_PER_AGENT_LIMIT) continue;
    bucket.push(memory.content);
  }

  return output;
};

const buildPersonaMemoryContext = (
  sessions: ChatSession[],
  agentId: string,
  activeSessionId: string | null,
  persistentMemory: PersonaMemoryBuckets = EMPTY_PERSONA_MEMORY_BUCKETS,
): string => {
  if (!agentId) return '';

  const related = sessions
    .filter(session => {
      if (session.id === activeSessionId) return false;
      if (!Array.isArray(session.messages) || session.messages.length === 0) return false;
      const sessionAgentIds = dedupeAgentIds([
        ...(Array.isArray(session.agentIds) ? session.agentIds : []),
        session.agentId,
        ...extractAssistantAgentIds(session.messages),
      ]);
      return sessionAgentIds.includes(agentId);
    })
    .sort((a, b) => {
      const aTs = new Date(a.lastMessageAt || a.createdAt).getTime();
      const bTs = new Date(b.lastMessageAt || b.createdAt).getTime();
      return bTs - aTs;
    })
    .slice(0, Math.max(PERSONA_MEMORY_SESSION_LIMIT, 8));

  const factsRaw: string[] = [...(persistentMemory.facts || [])];
  const preferencesRaw: string[] = [...(persistentMemory.preferences || [])];
  const goalsRaw: string[] = [...(persistentMemory.goals || [])];
  const recentLines: string[] = [];

  for (const session of related) {
    const recentMessages = session.messages.slice(-10);
    for (const msg of recentMessages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = truncateMemoryText(msg.content || '', PERSONA_MEMORY_ITEM_CHAR_LIMIT);
      if (!content) continue;

      if (msg.role === 'user') {
        const signals = collectMemorySignals(content);
        factsRaw.push(...signals.facts);
        preferencesRaw.push(...signals.preferences);
        goalsRaw.push(...signals.goals);
      }

      if (recentLines.length < PERSONA_MEMORY_LINE_LIMIT) {
        recentLines.push(`[${truncateMemoryText(session.title || 'Chat', 24)}] ${role}: ${content}`);
      }
    }
  }

  const facts = dedupeMemoryItems(factsRaw, PERSONA_MEMORY_FACT_LIMIT);
  const preferences = dedupeMemoryItems(preferencesRaw, PERSONA_MEMORY_PREFERENCE_LIMIT);
  const goals = dedupeMemoryItems(goalsRaw, PERSONA_MEMORY_GOAL_LIMIT);

  if (facts.length === 0 && preferences.length === 0 && goals.length === 0 && recentLines.length === 0) return '';

  const blocks: string[] = [];
  if (facts.length > 0) {
    blocks.push(
      '[Long-term Memory: Facts]',
      ...facts.map((item, index) => `${index + 1}. ${item}`),
    );
  }
  if (preferences.length > 0) {
    blocks.push(
      '[Long-term Memory: Preferences]',
      ...preferences.map((item, index) => `${index + 1}. ${item}`),
    );
  }
  if (goals.length > 0) {
    blocks.push(
      '[Long-term Memory: Ongoing Goals]',
      ...goals.map((item, index) => `${index + 1}. ${item}`),
    );
  }
  if (recentLines.length > 0) {
    blocks.push('[Recent Cross-Session Context]', ...recentLines);
  }

  return truncateMemoryText(blocks.join('\n'), PERSONA_MEMORY_TOTAL_CHAR_LIMIT);
};

const normalizeCommunityPost = (post: any): CommunityPost => ({
  id: post.id,
  author: post.author,
  content: post.content,
  timestamp: typeof post.timestamp === 'string' ? post.timestamp : new Date(post.timestamp).toISOString(),
  replyTo: post.replyTo ?? post.reply_to ?? undefined,
  trigger: post.trigger,
  order: typeof post.order === 'number' ? post.order : 0,
  comments: Array.isArray(post.comments) ? post.comments : undefined,
});

const normalizeAIAgent = (agent: any, fallbackOrder: number = 0): AIAgent => ({
  id: String(agent?.id || crypto.randomUUID()),
  name: normalizeKoreanText(String(agent?.name || `Persona ${fallbackOrder + 1}`)),
  emoji: String(agent?.emoji || ':)'),
  role: normalizeKoreanText(String(agent?.role || 'AI Assistant')),
  personality: normalizeKoreanText(String(agent?.personality || 'Helpful and practical assistant persona.')),
  tone: normalizeKoreanText(String(agent?.tone || 'Warm and clear.')),
  color: String(agent?.color || '#37352f'),
  avatar: typeof agent?.avatar === 'string' ? agent.avatar : undefined,
  connectionId: typeof agent?.connection_id === 'string' ? agent.connection_id : (typeof agent?.connectionId === 'string' ? agent.connectionId : undefined),
});

const DEFAULT_TAGS: CalendarTag[] = [
  { id: 'tag_1', name: '일정', color: '#4c2889' },
  { id: 'tag_2', name: 'Tasks', color: '#DEB13B' },
  { id: 'tag_3', name: '생일', color: '#35B37E' },
];

const DEFAULT_TODO_TABS: TodoTab[] = [
  { id: 'tab_todo', name: '할 일', color: '#1a73e8', order: 0 },
  { id: 'tab_project', name: '프로젝트', color: '#9c27b0', order: 1 },
];

const DEFAULT_TODO_LIST_ID = '00000000-0000-4000-8000-000000000001';
const LEGACY_DEFAULT_TODO_LIST_IDS = new Set(['default', 'routine']);

const normalizeTodoListId = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  return LEGACY_DEFAULT_TODO_LIST_IDS.has(value) ? DEFAULT_TODO_LIST_ID : value;
};

const normalizeTodoLists = (lists: TodoList[]): TodoList[] => {
  const normalized = (Array.isArray(lists) ? lists : []).map((list) => ({
    ...list,
    id: normalizeTodoListId(list.id) || DEFAULT_TODO_LIST_ID,
  }));

  const deduped = new Map<string, TodoList>();
  normalized.forEach((list) => {
    if (!deduped.has(list.id)) deduped.set(list.id, list);
  });
  return [...deduped.values()];
};

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

const retryTodoInsertWithFallback = async (
  row: Record<string, any>,
): Promise<{ error: any; payload: Record<string, any> }> => {
  let payload = { ...row };
  let attempt = 0;

  while (attempt < TODO_OPTIONAL_DB_COLUMNS.length) {
    const result = await supabase.from('todos').insert([payload]);
    const unsupportedColumns = getUnsupportedTodoColumns(result.error);
    if (!result.error || unsupportedColumns.length === 0) {
      return { error: result.error, payload };
    }
    payload = stripTodoOptionalColumns(payload, unsupportedColumns);
    attempt += 1;
  }

  const finalResult = await supabase.from('todos').insert([payload]);
  return { error: finalResult.error, payload };
};

const retryTodoUpdateWithFallback = async (
  id: string,
  updates: Record<string, any>,
): Promise<{ error: any; payload: Record<string, any> }> => {
  let payload = { ...updates };
  let attempt = 0;

  while (attempt < TODO_OPTIONAL_DB_COLUMNS.length) {
    const result = await supabase.from('todos').update(payload).eq('id', id);
    const unsupportedColumns = getUnsupportedTodoColumns(result.error);
    if (!result.error || unsupportedColumns.length === 0) {
      return { error: result.error, payload };
    }
    payload = stripTodoOptionalColumns(payload, unsupportedColumns);
    if (Object.keys(payload).length === 0) {
      return { error: null, payload };
    }
    attempt += 1;
  }

  const finalResult = await supabase.from('todos').update(payload).eq('id', id);
  return { error: finalResult.error, payload };
};

const DEFAULT_TODO_LISTS: TodoList[] = [
  { id: DEFAULT_TODO_LIST_ID, title: '해야 할 일', order: 1, tabId: 'tab_todo' },
];

const DEFAULT_SETTINGS: AppSettings = {
  autoAiReactions: false,
  chatActionConfirm: true,
  apiConnections: [],
  activeConnectionId: undefined,
};

const CACHE_PREFIX = 'lifesync_cache';
const CACHE_VERSION = 'v2';
const CACHE_KEYS = [
  'events',
  'todoLists',
  'todoTabs',
  'todos',
  'todoSteps',
  'entries',
  'posts',
  'communityPosts',
  'aiAgents',
  'chatSessions',
  'personaMemories',
  'activityLog',
  'settings',
  'calendarTags',
  'journalCategories',
] as const;
type CacheKey = (typeof CACHE_KEYS)[number];

const toScopedCacheKey = (userId: string, key: CacheKey): string =>
  `${CACHE_PREFIX}_${CACHE_VERSION}_${userId}_${key}`;

const CHAT_CACHE_MAX_SESSIONS = 12;
const CHAT_CACHE_MIN_SESSIONS = 1;
const CHAT_CACHE_MAX_MESSAGES_PER_SESSION = 40;
const CHAT_CACHE_MIN_MESSAGES_PER_SESSION = 4;
const CHAT_CACHE_MAX_MESSAGE_CHARS = 1400;
const CHAT_CACHE_MAX_TOTAL_BYTES = 900_000;
const CHAT_CACHE_MAX_QUICK_REPLIES = 6;
const CHAT_CACHE_MAX_QUICK_REPLY_CHARS = 120;

const NON_ESSENTIAL_CACHE_KEYS: CacheKey[] = [
  'activityLog',
  'communityPosts',
  'posts',
];

const isQuotaExceededError = (error: unknown): boolean => {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014
  );
};

const estimateByteSize = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length * 2;
};

const truncateText = (value: string, maxChars: number): string =>
  value.length > maxChars ? value.slice(0, maxChars) : value;

const compactChatSessionsForCache = (
  sessions: ChatSession[],
  maxSessions: number,
  maxMessagesPerSession: number,
): ChatSession[] => {
  if (!Array.isArray(sessions) || sessions.length === 0) return [];

  return [...sessions]
    .sort((left, right) => {
      const leftTime = new Date(left.lastMessageAt || left.createdAt).getTime();
      const rightTime = new Date(right.lastMessageAt || right.createdAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, maxSessions)
    .map((session) => {
      const compactMessages = (Array.isArray(session.messages) ? session.messages : [])
        .slice(-maxMessagesPerSession)
        .map((message) => ({
          ...message,
          content: truncateText(message.content || '', CHAT_CACHE_MAX_MESSAGE_CHARS),
          quickReplies: Array.isArray(message.quickReplies)
            ? message.quickReplies
              .slice(0, CHAT_CACHE_MAX_QUICK_REPLIES)
              .map((reply) => truncateText(reply || '', CHAT_CACHE_MAX_QUICK_REPLY_CHARS))
            : undefined,
          action: message.action
            ? {
              ...message.action,
              // Runtime action payloads can be very large and are not required for cache hydration.
              data: undefined,
            }
            : undefined,
        }));

      return {
        ...session,
        title: truncateText(session.title || '새 채팅', 200),
        messages: compactMessages,
      };
    });
};

const serializeCacheValue = <T,>(key: CacheKey, value: T): string => {
  if (key === 'settings') {
    const settingsValue = (value as unknown as AppSettings) || DEFAULT_SETTINGS;
    const redactedSettings: AppSettings = {
      ...settingsValue,
      geminiApiKey: '',
      apiConnections: Array.isArray(settingsValue.apiConnections)
        ? settingsValue.apiConnections.map((connection) => ({ ...connection, apiKey: '' }))
        : [],
    };
    return JSON.stringify(redactedSettings);
  }

  if (key !== 'chatSessions') {
    return JSON.stringify(value);
  }

  const sessions = Array.isArray(value) ? (value as unknown as ChatSession[]) : [];
  let maxSessions = CHAT_CACHE_MAX_SESSIONS;
  let maxMessagesPerSession = CHAT_CACHE_MAX_MESSAGES_PER_SESSION;
  let compacted = compactChatSessionsForCache(sessions, maxSessions, maxMessagesPerSession);
  let serialized = JSON.stringify(compacted);

  while (
    estimateByteSize(serialized) > CHAT_CACHE_MAX_TOTAL_BYTES &&
    (maxMessagesPerSession > CHAT_CACHE_MIN_MESSAGES_PER_SESSION || maxSessions > CHAT_CACHE_MIN_SESSIONS)
  ) {
    if (maxMessagesPerSession > CHAT_CACHE_MIN_MESSAGES_PER_SESSION) {
      maxMessagesPerSession = Math.max(
        CHAT_CACHE_MIN_MESSAGES_PER_SESSION,
        Math.floor(maxMessagesPerSession / 2),
      );
    } else {
      maxSessions = Math.max(CHAT_CACHE_MIN_SESSIONS, maxSessions - 1);
    }

    compacted = compactChatSessionsForCache(sessions, maxSessions, maxMessagesPerSession);
    serialized = JSON.stringify(compacted);
  }

  return serialized;
};

const recoverFromStorageQuota = (userId: string, key: CacheKey): void => {
  // Also clean legacy unscoped cache key variants that older builds used.
  try {
    localStorage.removeItem(`${CACHE_PREFIX}_${key}`);
  } catch {
    // Ignore storage failures during quota recovery.
  }

  const evictionOrder: CacheKey[] = key === 'chatSessions'
    ? [...NON_ESSENTIAL_CACHE_KEYS, 'entries', 'events']
    : NON_ESSENTIAL_CACHE_KEYS;

  evictionOrder.forEach((targetKey) => {
    try {
      localStorage.removeItem(toScopedCacheKey(userId, targetKey));
    } catch {
      // Ignore storage failures during quota recovery.
    }
  });
};

const VALID_VIEWS: ViewState[] = ['calendar', 'todo', 'journal', 'chat', 'settings'];

const normalizeView = (rawView: string | null): ViewState => {
  if (!rawView) return 'chat';

  // Backward-compat aliases from older URLs.
  const aliased =
    rawView === 'dashboard' || rawView === 'board' ? 'chat'
      : rawView === 'api-settings' || rawView === 'personas' ? 'settings'
        : rawView;

  return VALID_VIEWS.includes(aliased as ViewState) ? (aliased as ViewState) : 'chat';
};

const resolveViewFromUrl = (): ViewState => {
  if (typeof window === 'undefined') return 'chat';
  const params = new URLSearchParams(window.location.search);
  return normalizeView(params.get('view'));
};

type ViewErrorBoundaryProps = {
  view: ViewState;
  onRecover: () => void;
  children: React.ReactNode;
};

type ViewErrorBoundaryState = {
  hasError: boolean;
};

class ViewErrorBoundary extends React.Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ViewErrorBoundary] view render failed:', this.props.view, error, info.componentStack);
  }

  componentDidUpdate(prevProps: ViewErrorBoundaryProps) {
    if (prevProps.view !== this.props.view && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="h-full bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-lg font-semibold text-[#37352f]">화면을 불러오는 중 오류가 발생했습니다.</h2>
          <p className="text-sm text-[#787774]">다른 섹션으로 이동하거나 채팅 화면으로 복구해 주세요.</p>
          <button
            type="button"
            onClick={this.props.onRecover}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#37352f] text-white text-sm font-medium hover:bg-black transition-colors"
          >
            채팅 화면으로 이동
          </button>
        </div>
      </div>
    );
  }
}

// Settings icon component
const SettingsIcon = ({ size = 18 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);
const App: React.FC = () => {
  const bootId = useRef(Math.random().toString(36).slice(2, 6)).current;
  const skipSyncRef = useRef(true); // v2.5: Block sync hooks until specifically enabled
  const isFetchingRef = useRef(false);
  const hasSuccessfulServerHydrationRef = useRef(false);
  const fetchRetryTimerRef = useRef<number | null>(null);
  const latestSessionUserIdRef = useRef<string | null>(null);
  const fetchingUserIdRef = useRef<string | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [currentView, setCurrentView] = useState<ViewState>(() => resolveViewFromUrl());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    console.log(`[App] v2.5 booting id=${bootId}...`);
    // Remove legacy unscoped cache keys to prevent cross-account data bleed.
    CACHE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(`${CACHE_PREFIX}_${key}`);
      } catch {
        // Ignore storage failures.
      }
    });
  }, []);

  useEffect(() => () => {
    if (fetchRetryTimerRef.current) {
      window.clearTimeout(fetchRetryTimerRef.current);
      fetchRetryTimerRef.current = null;
    }
  }, []);

  // App Data State
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todoLists, setTodoLists] = useState<TodoList[]>(DEFAULT_TODO_LISTS);
  const [todoTabs, setTodoTabs] = useState<TodoTab[]>(DEFAULT_TODO_TABS);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todoSteps, setTodoSteps] = useState<TodoStep[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [posts, setPosts] = useState<AiPost[]>([]);

  // Community Board State
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [aiAgents, setAiAgents] = useState<AIAgent[]>(DEFAULT_AGENTS);

  // Activity Log & Settings
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [personaMemories, setPersonaMemories] = useState<PersonaMemory[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [activeChatAgentIds, setActiveChatAgentIds] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULT_SETTINGS }));

  const [calendarTags, setCalendarTags] = useState<CalendarTag[]>(DEFAULT_TAGS);
  const [journalCategories, setJournalCategories] = useState<JournalCategory[]>([]);

  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedJournalCategory, setSelectedJournalCategory] = useState<string>('메모장');
  const [journalSearchQuery, setJournalSearchQuery] = useState('');
  const [isAddingJournalCategory, setIsAddingJournalCategory] = useState(false);
  const [journalCategoryInput, setJournalCategoryInput] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [activeCategoryMenu, setActiveCategoryMenu] = useState<string | null>(null);

  // AI Diary Selection States
  const [selectedAiPostId, setSelectedAiPostId] = useState<string | null>(null);
  const [selectedAiAgentId, setSelectedAiAgentId] = useState<string>('ARIA');
  const [isAddingAiAgent, setIsAddingAiAgent] = useState(false);
  const [aiAgentInput, setAiAgentInput] = useState('');
  const [editingAiAgentId, setEditingAiAgentId] = useState<string | null>(null);
  const [editingAiAgentName, setEditingAiAgentName] = useState('');
  const [activeAiAgentMenu, setActiveAiAgentMenu] = useState<string | null>(null);
  const primaryActiveChatAgentId = activeChatAgentIds[0] || aiAgents[0]?.id || 'ARIA';


  // Undo Toast
  const undoRef = useRef<null | (() => void)>(null);
  const [undoToast, setUndoToast] = useState<{ id: string; label: string } | null>(null);
  const recentChatObservationsRef = useRef<ChatObservation[]>([]);

  const appendChatObservation = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    recentChatObservationsRef.current = [
      ...recentChatObservationsRef.current,
      { text: trimmed.slice(0, 280), timestamp: new Date().toISOString() }
    ].slice(-30);
  };

  useEffect(() => {
    if (!settings.autoAiReactions) return;
    setSettings(prev => (prev.autoAiReactions ? { ...prev, autoAiReactions: false } : prev));
  }, [settings.autoAiReactions]);

  const capturePersonaMemoriesFromUserMessage = (text: string, targetAgentIds: string[]) => {
    if (!currentUser?.id) return;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const availableAgentIdSet = new Set(aiAgents.map((agent) => agent.id));
    const scopedAgentIds = dedupeAgentIds(targetAgentIds).filter((agentId) => availableAgentIdSet.has(agentId));
    if (scopedAgentIds.length === 0) return;

    const signals = collectMemorySignals(trimmedText);
    const bucketCandidates: PersonaMemoryBuckets = {
      facts: dedupeMemoryItems(signals.facts, PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT),
      preferences: dedupeMemoryItems(signals.preferences, PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT),
      goals: dedupeMemoryItems(signals.goals, PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT),
    };
    const hasAnySignal = bucketCandidates.facts.length > 0
      || bucketCandidates.preferences.length > 0
      || bucketCandidates.goals.length > 0;
    if (!hasAnySignal) return;

    const nowIso = new Date().toISOString();
    setPersonaMemories((prev) => {
      const next = [...prev];
      const indexByCompoundKey = new Map<string, number>();
      next.forEach((memory, idx) => {
        indexByCompoundKey.set(`${memory.userId}:${memory.agentId}:${memory.key}`, idx);
      });

      const bucketEntries = Object.entries(bucketCandidates) as Array<[keyof PersonaMemoryBuckets, string[]]>;
      for (const agentId of scopedAgentIds) {
        for (const [bucketKey, items] of bucketEntries) {
          const memoryType = memoryBucketKeyToType(bucketKey);
          for (const sentence of items) {
            const normalizedContent = truncateMemoryText(sentence, PERSONA_MEMORY_MAX_CONTENT_CHARS);
            const normalizedKey = normalizeMemoryKey(normalizedContent);
            if (!normalizedContent || !normalizedKey) continue;
            const persistedKey = `${memoryType}:${normalizedKey}`;
            const compoundKey = `${currentUser.id}:${agentId}:${persistedKey}`;
            const existingIndex = indexByCompoundKey.get(compoundKey);

            if (typeof existingIndex === 'number') {
              const existing = next[existingIndex];
              next[existingIndex] = {
                ...existing,
                content: normalizedContent,
                confidence: Math.min(0.98, Math.max(existing.confidence, 0.55) + 0.03),
                observationCount: (existing.observationCount || 0) + 1,
                lastObservedAt: nowIso,
                updatedAt: nowIso,
              };
              continue;
            }

            const created: PersonaMemory = {
              id: crypto.randomUUID(),
              userId: currentUser.id,
              agentId,
              type: memoryType,
              key: persistedKey,
              content: normalizedContent,
              confidence: 0.55,
              observationCount: 1,
              firstObservedAt: nowIso,
              lastObservedAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            indexByCompoundKey.set(compoundKey, next.length);
            next.push(created);
          }
        }
      }

      const sorted = next.sort((a, b) => {
        const aTime = new Date(a.lastObservedAt || a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.lastObservedAt || b.updatedAt || b.createdAt).getTime();
        return bTime - aTime;
      });

      // Keep bounded memory footprint per user while preserving most recent signals.
      return sorted.slice(0, 800);
    });
  };

  const readCacheState = <T,>(userId: string, key: CacheKey, fallback: T): T => {
    try {
      const scoped = localStorage.getItem(toScopedCacheKey(userId, key));
      if (scoped) return JSON.parse(scoped) as T;
      return fallback;
    } catch {
      return fallback;
    }
  };

  const writeCacheState = <T,>(userId: string, key: CacheKey, value: T): void => {
    const scopedKey = toScopedCacheKey(userId, key);
    const serializedValue = serializeCacheValue(key, value);

    try {
      localStorage.setItem(scopedKey, serializedValue);
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        return;
      }
    }

    // If storage is full, evict less-critical cache slices and retry once.
    recoverFromStorageQuota(userId, key);
    try {
      localStorage.setItem(scopedKey, serializedValue);
    } catch {
      // Ignore final quota failure.
    }
  };

  const clearUserScopedCache = (userId: string): void => {
    CACHE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(toScopedCacheKey(userId, key));
      } catch {
        // Ignore storage failures.
      }
    });
  };

  const resetAppDataState = () => {
    setEvents([]);
    setTodoTabs(DEFAULT_TODO_TABS);
    setTodoLists(DEFAULT_TODO_LISTS);
    setTodoSteps([]);
    setTodos([]);
    setEntries([]);
    setPosts([]);
    setCommunityPosts([]);
    setAiAgents(DEFAULT_AGENTS);
    setChatSessions([]);
    setPersonaMemories([]);
    setActiveChatSessionId(null);
    setActiveChatAgentIds([]);
    setActivityLog([]);
    setSettings({ ...DEFAULT_SETTINGS });
    setCalendarTags(DEFAULT_TAGS);
    setJournalCategories([]);
    setSelectedJournalId(null);
    setSelectedJournalCategory('메모장');
    setSelectedAiPostId(null);
    setSelectedAiAgentId(DEFAULT_AGENTS[0]?.id ?? 'ARIA');
    setUndoToast(null);
    recentChatObservationsRef.current = [];
  };

  const hydrateFromLocalCache = (userId: string) => {
    const cachedEvents = readCacheState<CalendarEvent[]>(userId, 'events', []);
    const cachedTodoTabs = readCacheState<TodoTab[]>(userId, 'todoTabs', DEFAULT_TODO_TABS);
    const cachedTodoLists = readCacheState<TodoList[]>(userId, 'todoLists', DEFAULT_TODO_LISTS);
    const cachedTodoSteps = readCacheState<TodoStep[]>(userId, 'todoSteps', []);
    const cachedTodos = readCacheState<Todo[]>(userId, 'todos', []);
    const cachedEntries = readCacheState<JournalEntry[]>(userId, 'entries', []);
    const cachedPosts = readCacheState<AiPost[]>(userId, 'posts', []);
    const cachedCommunityPosts = readCacheState<CommunityPost[]>(userId, 'communityPosts', []);
    const cachedAgentsRaw = readCacheState<AIAgent[]>(userId, 'aiAgents', DEFAULT_AGENTS);
    const normalizedAgents = (cachedAgentsRaw.length > 0 ? cachedAgentsRaw : DEFAULT_AGENTS).map((agent, idx) => normalizeAIAgent(agent, idx));
    const cachedActivityLog = readCacheState<ActivityItem[]>(userId, 'activityLog', []);
    const cachedSettings = readCacheState<AppSettings>(userId, 'settings', DEFAULT_SETTINGS);
    const cachedTags = readCacheState<CalendarTag[]>(userId, 'calendarTags', DEFAULT_TAGS);
    const cachedCategories = readCacheState<JournalCategory[]>(userId, 'journalCategories', []);
    const cachedPersonaMemories = readCacheState<PersonaMemory[]>(userId, 'personaMemories', []);

    setEvents(cachedEvents);
    setTodoTabs(cachedTodoTabs.length > 0 ? cachedTodoTabs : DEFAULT_TODO_TABS);
    setTodoLists(normalizeTodoLists(cachedTodoLists.length > 0 ? cachedTodoLists : DEFAULT_TODO_LISTS));
    setTodoSteps(cachedTodoSteps.map(step => ({
      ...step,
      listId: normalizeTodoListId(step.listId) || DEFAULT_TODO_LIST_ID,
    })));
    setTodos(cachedTodos.map(todo => ({
      ...todo,
      listId: normalizeTodoListId(todo.listId) || undefined,
    })));
    setEntries(cachedEntries);
    setPosts(cachedPosts);
    setCommunityPosts(cachedCommunityPosts);
    setAiAgents(normalizedAgents);
    setChatSessions([]);
    setPersonaMemories(Array.isArray(cachedPersonaMemories) ? cachedPersonaMemories : []);
    setActivityLog(cachedActivityLog);
    setSettings({ ...DEFAULT_SETTINGS, ...cachedSettings });
    setCalendarTags(cachedTags.length > 0 ? cachedTags : DEFAULT_TAGS);
    setJournalCategories(cachedCategories);
    setSelectedAiAgentId(prev => normalizedAgents.some(agent => agent.id === prev) ? prev : (normalizedAgents[0]?.id || 'ARIA'));
  };

  const hydrateChatSessionsFromIndexedCache = async (userId: string) => {
    const cachedSessions = await loadChatSessionsCache(userId);
    if (!cachedSessions || latestSessionUserIdRef.current !== userId) return;
    setChatSessions(cachedSessions);
  };

  const {
    currentUser,
    setCurrentUser,
    isAuthInitializing,
    authMode,
    setAuthMode,
    isLoggingOut,
    logout,
  } = useAuthSession({
    onSession: async ({ event, user, profile }) => {
      console.log(`[App] v2.5 onSession event: ${event} user: ${user.id} profile_present: ${!!profile}`);

      // Note: Settings are now primarily synced via user_data.settings. 
      // Profile lookups are only used for basic metadata (name, avatar, etc).

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        const isDifferentUser = latestSessionUserIdRef.current !== user.id;
        latestSessionUserIdRef.current = user.id;
        skipSyncRef.current = true;
        hasSuccessfulServerHydrationRef.current = false;
        clearSyncSnapshots(user.id);
        if (fetchRetryTimerRef.current) {
          window.clearTimeout(fetchRetryTimerRef.current);
          fetchRetryTimerRef.current = null;
        }
        if (isDifferentUser) {
          setIsDataLoaded(false);
          resetAppDataState();
          hydrateFromLocalCache(user.id);
          void hydrateChatSessionsFromIndexedCache(user.id);
          setIsDataLoaded(true);
        }
        console.log(`[App] v2.7 background fetchUserData for user: ${user.id}`);
        fetchUserData(user.id);
      }
    },
    onSignedOut: () => {
      console.log('[App] onSignedOut event');
      const previousUserId = latestSessionUserIdRef.current;
      latestSessionUserIdRef.current = null;
      skipSyncRef.current = true;
      hasSuccessfulServerHydrationRef.current = false;
      isFetchingRef.current = false;
      fetchingUserIdRef.current = null;
      if (fetchRetryTimerRef.current) {
        window.clearTimeout(fetchRetryTimerRef.current);
        fetchRetryTimerRef.current = null;
      }
      if (previousUserId) clearSyncSnapshots(previousUserId);
      setIsDataLoaded(false);
      resetAppDataState();
    },
    onBeforeSignOut: () => {
      console.log('[App] onBeforeSignOut event');
      skipSyncRef.current = true;
      hasSuccessfulServerHydrationRef.current = false;
      isFetchingRef.current = false;
      fetchingUserIdRef.current = null;
      if (fetchRetryTimerRef.current) {
        window.clearTimeout(fetchRetryTimerRef.current);
        fetchRetryTimerRef.current = null;
      }
      setIsDataLoaded(false);
      setIsMobileMenuOpen(false);
      setActiveAiAgentMenu(null);
    },
  });

  useEffect(() => {
    setOnSyncError((err: any) => {
      console.error('[App] Global Sync Error Caught:', err);
      if (err.code === '42501' || err.status === 403 || err.message?.includes('RLS')) {
        setSyncStatus('error');
      }
    });
  }, []);

  // Server sync effects
  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'events', events);
      if (skipSyncRef.current) return;
      syncEvents(currentUser.id, events);
    }
  }, [events, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'todos', todos);
      if (skipSyncRef.current) return;
      syncTodos(currentUser.id, todos);
    }
  }, [todos, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'entries', entries);
      if (skipSyncRef.current) return;
      syncEntries(currentUser.id, entries);
    }
  }, [entries, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'posts', posts);
    }
  }, [posts, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'communityPosts', communityPosts);
      if (skipSyncRef.current) return;
      syncCommunityPosts(currentUser.id, communityPosts);
    }
  }, [communityPosts, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'aiAgents', aiAgents);
      if (skipSyncRef.current) return;
      syncAgents(currentUser.id, aiAgents);
    }
  }, [aiAgents, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'todoLists', todoLists);
      if (skipSyncRef.current) return;
      syncTodoLists(currentUser.id, todoLists);
    }
  }, [todoLists, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'todoTabs', todoTabs);
      if (skipSyncRef.current) return;
      syncTodoTabs(currentUser.id, todoTabs);
    }
  }, [todoTabs, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'todoSteps', todoSteps);
      if (skipSyncRef.current) return;
      syncTodoSteps(currentUser.id, todoSteps);
    }
  }, [todoSteps, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'activityLog', activityLog);
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { activityLog });
    }
  }, [activityLog, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'settings', settings);
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { settings });
    }
  }, [settings, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'calendarTags', calendarTags);
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { calendarTags });
    }
  }, [calendarTags, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'journalCategories', journalCategories);
      if (skipSyncRef.current) return;
      syncJournalCategories(currentUser.id, journalCategories);
    }
  }, [journalCategories, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      const cacheReadySessions = compactChatSessionsForCache(
        chatSessions,
        CHAT_CACHE_MAX_SESSIONS,
        CHAT_CACHE_MAX_MESSAGES_PER_SESSION
      ).map((session) => ({
        ...session,
        messages: (session.messages || []).map((message) => ({
          ...message,
          imageUrl: (message.imageUrl && !message.imageUrl.startsWith('data:')) ? message.imageUrl : undefined,
          videoUrl: (message.videoUrl && !message.videoUrl.startsWith('data:')) ? message.videoUrl : undefined,
        })),
      }));
      void saveChatSessionsCache(currentUser.id, cacheReadySessions);
      if (skipSyncRef.current) return;
      syncChatSessions(currentUser.id, chatSessions);
    }
  }, [chatSessions, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      writeCacheState(currentUser.id, 'personaMemories', personaMemories);
      if (skipSyncRef.current) return;
      syncPersonaMemories(currentUser.id, personaMemories);
    }
  }, [personaMemories, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    const onPopState = () => {
      const next = resolveViewFromUrl();
      setCurrentView(prev => (prev === next ? prev : next));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (isAuthInitializing) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') === currentView) return;
    url.searchParams.set('view', currentView);
    window.history.replaceState({}, document.title, `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }, [currentView, isAuthInitializing]);
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [currentView]);
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileMenuOpen]);
  useEffect(() => {
    setChatSessions(prev => {
      let changed = false;
      const fallbackAgentIds = aiAgents[0]?.id ? [aiAgents[0].id] : [];
      const next = prev.map(session => {
        const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, fallbackAgentIds);
        if (resolvedAgentIds.length === 0) return session;
        const normalizedExisting = dedupeAgentIds(Array.isArray(session.agentIds) ? session.agentIds : []);
        const nextPrimary = resolvedAgentIds[0];
        if (session.agentId === nextPrimary && isSameAgentIdList(normalizedExisting, resolvedAgentIds)) return session;
        changed = true;
        return { ...session, agentId: nextPrimary, agentIds: resolvedAgentIds };
      });
      return changed ? next : prev;
    });
  }, [aiAgents]);
  useEffect(() => {
    setActiveChatAgentIds(prev => {
      const valid = dedupeAgentIds(prev).filter(id => aiAgents.some(agent => agent.id === id));
      if (valid.length === 0 && aiAgents[0]?.id) return [aiAgents[0].id];
      return isSameAgentIdList(prev, valid) ? prev : valid;
    });
  }, [aiAgents]);
  useEffect(() => {
    const agentIdSet = new Set(aiAgents.map((agent) => agent.id));
    setPersonaMemories(prev => prev.filter((memory) => agentIdSet.has(memory.agentId)));
  }, [aiAgents]);
  useEffect(() => {
    if (!activeChatSessionId) return;
    const activeSession = chatSessions.find(session => session.id === activeChatSessionId);
    if (!activeSession) return;

    const resolvedAgentIds = resolveSessionAgentIds(activeSession, aiAgents, activeChatAgentIds);
    if (resolvedAgentIds.length === 0) return;
    setActiveChatAgentIds(prev => (isSameAgentIdList(prev, resolvedAgentIds) ? prev : resolvedAgentIds));
  }, [activeChatSessionId, chatSessions, aiAgents]);
  const persistAiAgentsForUser = async (userId: string, sourceAgents: AIAgent[]) => {
    const normalizedAgents = (sourceAgents.length > 0 ? sourceAgents : DEFAULT_AGENTS).map((agent, index) => {
      const normalized = normalizeAIAgent(agent, index);
      return {
        id: normalized.id,
        user_id: userId,
        name: normalized.name,
        emoji: normalized.emoji,
        role: normalized.role,
        personality: normalized.personality,
        tone: normalized.tone,
        color: normalized.color,
        avatar: normalized.avatar ?? null,
        connection_id: normalized.connectionId ?? null,
        order: index,
      };
    });

    const { error: clearError } = await supabase
      .from('ai_agents')
      .delete()
      .eq('user_id', userId);

    if (clearError) {
      throw clearError;
    }

    if (normalizedAgents.length === 0) return;

    const { error: insertError } = await supabase.from('ai_agents').insert(normalizedAgents);
    if (insertError) {
      throw insertError;
    }
  };

  const isFetchStale = (userId: string) => latestSessionUserIdRef.current !== userId;

  const fetchUserData = async (userId: string) => {
    if (isFetchingRef.current && fetchingUserIdRef.current === userId) {
      console.log('[App] fetchUserData already in progress, skipping duplicate call.');
      return;
    }

    if (fetchRetryTimerRef.current) {
      window.clearTimeout(fetchRetryTimerRef.current);
      fetchRetryTimerRef.current = null;
    }

    isFetchingRef.current = true;
    fetchingUserIdRef.current = userId;
    let criticalFetchSucceeded = false;

    try {
      const fetchCritical = Promise.race([
        Promise.all([
          supabase.from('todo_tabs').select('*').eq('user_id', userId).order('order'),
          supabase.from('todo_lists').select('*').eq('user_id', userId).order('order'),
          supabase.from('todo_steps').select('*').eq('user_id', userId).order('order'),
          supabase.from('todos').select('*').eq('user_id', userId).order('order'),
          supabase.from('calendar_events').select('*').eq('user_id', userId),
          supabase.from('user_data').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('chat_sessions').select('*').eq('user_id', userId).order('last_message_at', { ascending: false }),
          supabase.from('chat_messages').select('*').eq('user_id', userId).order('order_index', { ascending: true }).order('timestamp', { ascending: true }),
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Critical fetch timeout')), 10000))
      ]);

      let criticalResults: any;
      try {
        criticalResults = await fetchCritical;
        criticalFetchSucceeded = true;
        setSyncStatus('syncing');
      } catch (err: any) {
        console.warn('[App] fetchCritical failed or timed out:', err.message);
        setSyncStatus('error');
        return;
      }

      if (isFetchStale(userId)) return;

      const [
        todoTabsRes,
        todoListsRes,
        todoStepsRes,
        todosRes,
        eventsRes,
        userDataRes,
        chatSessionsRes,
        chatMessagesRes,
      ] = criticalResults;

      const criticalErrors = [
        todoTabsRes?.error,
        todoListsRes?.error,
        todoStepsRes?.error,
        todosRes?.error,
        eventsRes?.error,
        userDataRes?.error,
      ].filter(Boolean);
      if (criticalErrors.length > 0) {
        console.warn('[App] fetchCritical returned errors:', criticalErrors);
        setSyncStatus('error');
        return;
      }

      const dbTodoTabs = todoTabsRes?.data;
      const dbTodoLists = todoListsRes?.data;
      const dbTodoSteps = todoStepsRes?.data;
      const dbTodos = todosRes?.data;
      const dbEvents = eventsRes?.data;
      const dbUserData = userDataRes?.data;
      const isChatTableUnavailable = (errorCode?: string) => errorCode === '42P01' || errorCode === '42703';
      const dbChatSessions = isChatTableUnavailable(chatSessionsRes?.error?.code) ? [] : chatSessionsRes?.data;
      const dbChatMessages = isChatTableUnavailable(chatMessagesRes?.error?.code) ? [] : chatMessagesRes?.data;

      if (dbTodoTabs && dbTodoTabs.length > 0) {
        setTodoTabs(dbTodoTabs.map((tab: any) => ({
          id: tab.id,
          name: normalizeKoreanText(tab.name),
          color: tab.color,
          order: tab.order
        })));
      } else if (dbTodoTabs && dbTodoTabs.length === 0) {
        setTodoTabs(DEFAULT_TODO_TABS);
      }

      if (dbTodoLists && dbTodoLists.length > 0) {
        setTodoLists(normalizeTodoLists(dbTodoLists.map((list: any) => ({
          ...list,
          title: normalizeKoreanText(list.title),
          dueDate: list.due_date || undefined,
          tabId: list.tab_id || (list.type === 'project' ? 'tab_project' : 'tab_todo')
        }))));
      } else if (dbTodoLists && dbTodoLists.length === 0) {
        setTodoLists(DEFAULT_TODO_LISTS);
      }

      if (dbTodos) setTodos(dbTodos.map((t: any) => {
        let parsedSubTasks: Todo['subTasks'] = undefined;
        if (t.sub_tasks) {
          if (typeof t.sub_tasks === 'string') {
            try {
              parsedSubTasks = JSON.parse(t.sub_tasks);
            } catch {
              parsedSubTasks = undefined;
            }
          } else {
            parsedSubTasks = t.sub_tasks;
          }
        }
        return {
          id: t.id,
          listId: normalizeTodoListId(t.list_id) || undefined,
          text: normalizeKoreanText(t.text),
          completed: t.completed,
          date: typeof t.created_at === 'string' ? t.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          startDate: t.start_date || undefined,
          dueDate: t.due_date || undefined,
          subTasks: parsedSubTasks,
          stepId: t.step_id || undefined
        } as Todo;
      }));

      if (dbTodoSteps) setTodoSteps(dbTodoSteps.map((s: any) => ({
        id: s.id,
        listId: normalizeTodoListId(s.list_id) || DEFAULT_TODO_LIST_ID,
        title: normalizeKoreanText(s.title),
        order: s.order
      } as TodoStep)));

      if (dbEvents) setEvents(dbEvents.map((e: any) => {
        const [startDate, startTime] = e.start_time ? e.start_time.split('T') : ['', ''];
        const [endDate, endTime] = e.end_time ? e.end_time.split('T') : ['', ''];
        return {
          id: e.id,
          title: normalizeKoreanText(e.title),
          date: startDate,
          endDate: endDate || startDate,
          startTime: startTime && startTime !== '00:00:00' ? startTime.substring(0, 5) : undefined,
          endTime: endTime && endTime !== '23:59:59' ? endTime.substring(0, 5) : undefined,
          description: e.description ? normalizeKoreanText(e.description) : undefined,
          type: (e.tags && e.tags.length > 0) ? e.tags[0] : 'tag_1'
        } as CalendarEvent;
      }));

      const chatSessionsFromTables: ChatSession[] = (() => {
        if (!Array.isArray(dbChatSessions) || !Array.isArray(dbChatMessages)) return [];
        const messagesBySession = new Map<string, ChatMessage[]>();

        dbChatMessages.forEach((message: any) => {
          const sessionId = String(message.session_id || '');
          if (!sessionId) return;
          const mapped: ChatMessage = {
            id: String(message.id || crypto.randomUUID()),
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: typeof message.content === 'string' ? message.content : '',
            timestamp: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
            agentId: typeof message.agent_id === 'string' ? message.agent_id : undefined,
            provider: message.provider || undefined,
            modelName: message.model_name || undefined,
            connectionId: message.connection_id || undefined,
            imageUrl: typeof message.image_url === 'string' ? message.image_url : undefined,
            videoUrl: typeof message.video_url === 'string' ? message.video_url : undefined,
            action: message.action || undefined,
            quickReplies: Array.isArray(message.quick_replies) ? message.quick_replies : undefined,
          };
          const bucket = messagesBySession.get(sessionId) || [];
          bucket.push(mapped);
          messagesBySession.set(sessionId, bucket);
        });

        return dbChatSessions.map((session: any) => ({
          id: String(session.id),
          title: typeof session.title === 'string' ? session.title : '새 대화',
          messages: messagesBySession.get(String(session.id)) || [],
          createdAt: typeof session.created_at === 'string' ? session.created_at : new Date().toISOString(),
          lastMessageAt: typeof session.last_message_at === 'string' ? session.last_message_at : (typeof session.created_at === 'string' ? session.created_at : new Date().toISOString()),
          agentId: typeof session.agent_id === 'string' ? session.agent_id : undefined,
          agentIds: Array.isArray(session.agent_ids) ? session.agent_ids : undefined,
        } as ChatSession));
      })();

      if (dbUserData) {
        if (Array.isArray(dbUserData.activity_log)) setActivityLog(dbUserData.activity_log);
        if (Array.isArray(dbUserData.calendar_tags) && dbUserData.calendar_tags.length > 0) setCalendarTags(dbUserData.calendar_tags);
        if (dbUserData.settings) setSettings(prev => ({ ...DEFAULT_SETTINGS, ...prev, ...dbUserData.settings }));
      }

      if (chatSessionsFromTables.length > 0) {
        setChatSessions(chatSessionsFromTables);
      } else if (Array.isArray(dbUserData?.chat_sessions)) {
        // Backward compatibility: read legacy blob once, then migrate to normalized table on next sync.
        setChatSessions(dbUserData.chat_sessions);
        if (dbUserData.chat_sessions.length > 0) {
          syncChatSessions(userId, dbUserData.chat_sessions as ChatSession[]);
        }
      }

      if (isFetchStale(userId)) return;

      let dbJournalCategories: any[] | null = null;
      let dbJournalEntries: any[] | null = null;
      let dbAiAgents: any[] | null = null;
      let dbPosts: any[] | null = null;
      let dbPersonaMemories: any[] | null = null;

      try {
        const fetchSecondary = Promise.race([
          Promise.all([
            supabase.from('journal_categories').select('*').eq('user_id', userId),
            supabase.from('journal_entries').select('*').eq('user_id', userId).order('date', { ascending: false }),
            supabase.from('ai_agents').select('*').eq('user_id', userId).order('order'),
            supabase.from('community_posts').select('*').eq('user_id', userId).order('timestamp', { ascending: false }),
            supabase.from('persona_memories').select('*').eq('user_id', userId).order('last_observed_at', { ascending: false })
          ]),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Secondary fetch timeout')), 10000))
        ]);

        const secondaryResults: any = await fetchSecondary;
        if (isFetchStale(userId)) return;

        const [
          journalCategoriesRes,
          journalEntriesRes,
          aiAgentsRes,
          postsRes,
          personaMemoriesRes
        ] = secondaryResults;
        const isPersonaMemoryTableUnavailable = (errorCode?: string) => errorCode === '42P01' || errorCode === '42703';

        const secondaryErrors = [
          journalCategoriesRes?.error,
          journalEntriesRes?.error,
          aiAgentsRes?.error,
          postsRes?.error,
          isPersonaMemoryTableUnavailable(personaMemoriesRes?.error?.code) ? null : personaMemoriesRes?.error,
        ].filter(Boolean);
        if (secondaryErrors.length > 0) {
          console.warn('[App] fetchSecondary returned errors:', secondaryErrors);
        }

        dbJournalCategories = journalCategoriesRes?.data || null;
        dbJournalEntries = journalEntriesRes?.data || null;
        dbAiAgents = aiAgentsRes?.data || null;
        dbPosts = postsRes?.data || null;
        dbPersonaMemories = isPersonaMemoryTableUnavailable(personaMemoriesRes?.error?.code)
          ? []
          : (personaMemoriesRes?.data || null);

        if (dbJournalCategories) setJournalCategories(dbJournalCategories.map((category: any) => ({ ...category, name: normalizeKoreanText(category.name) })));
        if (dbJournalEntries) {
          const catMap = new Map((dbJournalCategories || []).map((c: any) => [c.id, normalizeKoreanText(c.name)]));
          setEntries(dbJournalEntries.map((e: any) => ({
            id: e.id,
            title: normalizeKoreanText(e.title || ''),
            content: normalizeKoreanText(e.content || ''),
            date: e.date,
            mood: e.mood,
            category: e.category_id ? catMap.get(e.category_id) || '메모장' : '메모장',
            order: e.order || 0
          } as JournalEntry)));
        }
        if (dbAiAgents && dbAiAgents.length > 0) {
          setAiAgents(dbAiAgents.map((a: any, i: number) => normalizeAIAgent(a, i)));
        }
        if (dbPosts) {
          setCommunityPosts((dbPosts || [])
            .map(normalizeCommunityPost)
            .filter(p => !!p.id)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        }
        if (Array.isArray(dbPersonaMemories)) {
          const mappedMemories: PersonaMemory[] = dbPersonaMemories
            .filter((row: any) => row?.agent_id && row?.memory_type && row?.memory_key && row?.content)
            .map((row: any) => ({
              id: String(row.id || crypto.randomUUID()),
              userId,
              agentId: String(row.agent_id),
              type: (row.memory_type === 'preference' || row.memory_type === 'goal') ? row.memory_type : 'fact',
              key: String(row.memory_key),
              content: String(row.content),
              confidence: typeof row.confidence === 'number' ? row.confidence : 0.6,
              observationCount: typeof row.observation_count === 'number' ? row.observation_count : 1,
              firstObservedAt: typeof row.first_observed_at === 'string' ? row.first_observed_at : new Date().toISOString(),
              lastObservedAt: typeof row.last_observed_at === 'string' ? row.last_observed_at : new Date().toISOString(),
              createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
              updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
            }))
            .slice(0, 500);
          setPersonaMemories(mappedMemories);
        }
      } catch (err: any) {
        console.warn('[App] fetchSecondary failed or timed out:', err.message);
      }

      if (isFetchStale(userId)) return;

      // Seed sync snapshots from server-loaded IDs so deletions are differential and safe.
      seedSyncSnapshot('events', userId, (dbEvents || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('todos', userId, (dbTodos || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('todo_lists', userId, (dbTodoLists || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('todo_tabs', userId, (dbTodoTabs || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('todo_steps', userId, (dbTodoSteps || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('journal_entries', userId, (dbJournalEntries || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('journal_categories', userId, (dbJournalCategories || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('community_posts', userId, (dbPosts || []).map((row: any) => String(row.id)));
      seedSyncSnapshot('ai_agents', userId, (dbAiAgents || []).map((row: any) => String(row.id)));

      const seededChatSessions = chatSessionsFromTables.length > 0
        ? chatSessionsFromTables
        : (Array.isArray(dbUserData?.chat_sessions) ? dbUserData.chat_sessions : []);
      seedSyncSnapshot('chat_sessions', userId, seededChatSessions.map((session: ChatSession) => String(session.id)));
      seededChatSessions.forEach((session: ChatSession) => {
        const messageIds = (Array.isArray(session.messages) ? session.messages : []).map((message: ChatMessage) => String(message.id));
        seedSyncSnapshot(`chat_messages:${session.id}`, userId, messageIds);
      });

      hasSuccessfulServerHydrationRef.current = true;
      setSyncStatus('idle');
      console.log(`[App] Data load complete for user ${userId}. Enabling sync hooks.`);
    } finally {
      if (fetchingUserIdRef.current === userId) {
        isFetchingRef.current = false;
        fetchingUserIdRef.current = null;
      }

      if (latestSessionUserIdRef.current === userId) {
        setIsDataLoaded(true);
        if (criticalFetchSucceeded && hasSuccessfulServerHydrationRef.current) {
          if (fetchRetryTimerRef.current) {
            window.clearTimeout(fetchRetryTimerRef.current);
            fetchRetryTimerRef.current = null;
          }
          setTimeout(() => {
            if (latestSessionUserIdRef.current === userId && hasSuccessfulServerHydrationRef.current) {
              skipSyncRef.current = false;
            }
          }, 250);
        } else {
          skipSyncRef.current = true;
          if (!fetchRetryTimerRef.current) {
            fetchRetryTimerRef.current = window.setTimeout(() => {
              fetchRetryTimerRef.current = null;
              if (latestSessionUserIdRef.current === userId && !isFetchingRef.current) {
                console.log('[App] retrying fetchUserData after critical failure...');
                fetchUserData(userId);
              }
            }, 5000);
          }
        }
      }
    }
  };

  const handleLogout = logout;

  useEffect(() => {
    const listIds = new Set(todoLists.map(l => l.id));
    const fallbackId = todoLists[0]?.id ?? DEFAULT_TODO_LIST_ID;
    setTodos(prev => prev.map(t => {
      const normalizedListId = normalizeTodoListId(t.listId);
      return normalizedListId && listIds.has(normalizedListId)
        ? (normalizedListId === t.listId ? t : { ...t, listId: normalizedListId })
        : { ...t, listId: fallbackId };
    }));
  }, [todoLists]);

  // Community post handler
  // Community post handler
  const addCommunityPost = async (post: CommunityPost) => {
    const newOrder = communityPosts.length > 0 ? Math.min(...communityPosts.map(p => p.order || 0)) - 1 : 0;
    const postWithOrder = { ...post, order: newOrder };
    setCommunityPosts(prev => [postWithOrder, ...prev]);

    if (currentUser) {
      const { error } = await supabase.from('community_posts').insert([{
        id: postWithOrder.id,
        user_id: currentUser.id,
        author: postWithOrder.author,
        content: postWithOrder.content,
        timestamp: postWithOrder.timestamp,
        reply_to: postWithOrder.replyTo,
        trigger: postWithOrder.trigger,
        "order": newOrder
      }]);

      if (error) {
        console.error('Failed to persist AI post:', error);
      }
    }
  };

  const updateCommunityPost = (id: string, updates: Partial<CommunityPost>) => {
    setCommunityPosts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const deleteCommunityPost = (id: string) => {
    if (window.confirm('정말로 이 AI 게시글을 삭제하시겠습니까?')) {
      setCommunityPosts(prev => prev.filter(p => p.id !== id));
      if (selectedAiPostId === id) setSelectedAiPostId(null);

      if (currentUser) {
        supabase.from('community_posts').delete().eq('id', id).eq('user_id', currentUser.id)
          .then(({ error }) => {
            if (error) {
              console.error('Failed to delete AI post:', error);
            }
          });
      }
    }
  };

  const addCommunityComment = (postId: string, comment: Omit<Comment, 'id' | 'timestamp'>) => {
    const newComment: Comment = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...comment,
    };
    setCommunityPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, comments: [...(p.comments || []), newComment] } : p
    ));
  };

  const addTodoList = async (title: string, tabId: string, dueDate?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const nextOrder = Math.max(0, ...todoLists.map(l => l.order)) + 1;
    const newList: TodoList = {
      id: crypto.randomUUID(),
      title: trimmed,
      order: nextOrder,
      tabId,
      dueDate
    };
    setTodoLists(prev => [...prev, newList]);

    if (currentUser) {
      await supabase.from('todo_lists').insert([{
        id: newList.id,
        user_id: currentUser.id,
        title: newList.title,
        "order": newList.order,
        tab_id: newList.tabId,
        due_date: newList.dueDate || null
      }]);
    }
  };

  const addTodoTab = async (name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextOrder = Math.max(0, ...todoTabs.map(t => t.order)) + 1;
    const newTab: TodoTab = {
      id: crypto.randomUUID(),
      name: trimmed,
      color,
      order: nextOrder
    };
    setTodoTabs(prev => [...prev, newTab]);
    if (currentUser) {
      await supabase.from('todo_tabs').insert([{
        id: newTab.id,
        user_id: currentUser.id,
        name: newTab.name,
        color: newTab.color,
        "order": newTab.order
      }]);
    }
  };

  const updateTodoTab = async (id: string, updates: Partial<TodoTab>) => {
    setTodoTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (currentUser) {
      await supabase.from('todo_tabs').update(updates).eq('id', id);
    }
  };

  const deleteTodoTab = async (id: string) => {
    if (window.confirm('이 탭을 삭제할까요? 관련 목록은 삭제되지 않지만 다른 탭으로 이동해야 할 수도 있습니다.')) {
      setTodoTabs(prev => prev.filter(t => t.id !== id));
      if (currentUser) {
        await supabase.from('todo_tabs').delete().eq('id', id);
      }
    }
  };

  const addTodoStep = async (title: string, listId: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const normalizedListId = normalizeTodoListId(listId) || DEFAULT_TODO_LIST_ID;
    const nextOrder = Math.max(0, ...todoSteps.filter(s => s.listId === normalizedListId).map(s => s.order)) + 1;
    const newStep: TodoStep = {
      id: crypto.randomUUID(),
      listId: normalizedListId,
      title: trimmed,
      order: nextOrder
    };
    setTodoSteps(prev => [...prev, newStep]);
    if (currentUser) {
      const { error } = await supabase.from('todo_steps').insert([{
        id: newStep.id,
        user_id: currentUser.id,
        list_id: newStep.listId,
        title: newStep.title,
        "order": newStep.order
      }]);
      if (error) {
        setTodoSteps(prev => prev.filter(step => step.id !== newStep.id));
        alert(`단계를 저장하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
      }
    }
  };

  const updateTodoStep = async (id: string, updates: Partial<TodoStep>) => {
    setTodoSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    if (currentUser) {
      await supabase.from('todo_steps').update(updates).eq('id', id);
    }
  };

  const deleteTodoStep = async (id: string) => {
    if (!window.confirm('이 단계를 삭제하시겠습니까? 관련 할 일들은 해제됩니다.')) return;
    setTodoSteps(prev => prev.filter(s => s.id !== id));
    setTodos(prev => prev.map(t => t.stepId === id ? { ...t, stepId: undefined } : t));

    if (currentUser) {
      await supabase.from('todos').update({ step_id: null }).eq('step_id', id);
      await supabase.from('todo_steps').delete().eq('id', id);
    }
  };

  const addJournalCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (journalCategories.some(c => c.name === trimmed)) return;
    const newCategory: JournalCategory = {
      id: crypto.randomUUID(),
      name: trimmed,
    };
    setJournalCategories(prev => [...prev, newCategory]);

    if (currentUser) {
      await supabase.from('journal_categories').insert([{
        id: newCategory.id,
        user_id: currentUser.id,
        name: newCategory.name
      }]);
    }
  };

  const addAiAgent = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (aiAgents.some(a => a.name === trimmed)) return;
    const newAgent: AIAgent = normalizeAIAgent({
      id: crypto.randomUUID(),
      name: trimmed,
      emoji: '👤',
      role: '새로운 페르소나',
      personality: '사용자가 직접 생성한 AI 페르소나입니다.',
      tone: '친절하고 공손한 스타일',
      color: '#37352f',
    });
    const nextAgents = [...aiAgents, newAgent];
    setAiAgents(nextAgents);

    if (currentUser) {
      try {
        await persistAiAgentsForUser(currentUser.id, nextAgents);
      } catch (error) {
        console.error('Failed to persist added AI persona:', error);
      }
    }
  };

  const updateAiAgent = async (id: string, updates: Partial<AIAgent>) => {
    const nextAgents = aiAgents.map(a => a.id === id ? normalizeAIAgent({ ...a, ...updates }) : a);
    setAiAgents(nextAgents);

    if (currentUser) {
      try {
        await persistAiAgentsForUser(currentUser.id, nextAgents);
      } catch (error) {
        console.error('Failed to persist updated AI persona:', error);
      }
    }
  };

  const deleteAiAgent = async (id: string) => {
    const agent = aiAgents.find(a => a.id === id);
    if (!agent) return;

    if (window.confirm(`'${agent.name}' 페르소나를 삭제하시겠습니까? 관련 게시글은 삭제되지 않습니다.`)) {
      const nextAgents = aiAgents.filter(a => a.id !== id);
      setAiAgents(nextAgents);
      if (selectedAiAgentId === id) {
        setSelectedAiAgentId(aiAgents.find(a => a.id !== id)?.id || '');
      }

      if (currentUser) {
        try {
          await persistAiAgentsForUser(currentUser.id, nextAgents);
        } catch (error) {
          console.error('Failed to persist deleted AI persona:', error);
        }
      }
    }
  };

  const updateJournalCategory = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const oldCategory = journalCategories.find(c => c.id === id);
    if (!oldCategory) return;

    // Update category name
    setJournalCategories(prev => prev.map(c => c.id === id ? { ...c, name: trimmed } : c));

    if (currentUser) {
      await supabase.from('journal_categories').update({ name: trimmed }).eq('id', id);
    }

    // Update all entries using this category
    setEntries(prev => prev.map(entry =>
      entry.category === oldCategory.name ? { ...entry, category: trimmed } : entry
    ));

    if (selectedJournalCategory === oldCategory.name) {
      setSelectedJournalCategory(trimmed);
    }
  };


  const deleteJournalCategory = async (id: string) => {
    const category = journalCategories.find(c => c.id === id);
    if (!category) return;

    if (window.confirm(`'${category.name}' 카테고리를 삭제하시겠습니까? 해당 카테고리의 메모들은 삭제되지 않습니다.`)) {
      setJournalCategories(prev => prev.filter(c => c.id !== id));

      if (currentUser) {
        await supabase.from('journal_categories').delete().eq('id', id);
      }

      if (selectedJournalCategory === category.name) {
        setSelectedJournalCategory(journalCategories.find(c => c.id !== id)?.name || '메모장');
      }
    }
  };

  const updateTodoList = async (id: string, updates: Partial<TodoList>) => {
    setTodoLists(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    if (currentUser) {
      const dbUpdates: any = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.tabId !== undefined) dbUpdates.tab_id = updates.tabId;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate || null;

      if (Object.keys(dbUpdates).length > 0) {
        await supabase.from('todo_lists').update(dbUpdates).eq('id', id);
      }
    }
  };

  const updateTodoListOrder = (newLists: TodoList[]) => {
    setTodoLists(newLists);
  };

  const deleteTodoList = async (id: string) => {
    const list = todoLists.find(l => l.id === id);
    if (!list) return;

    if (window.confirm(`'${list.title}' 목록을 삭제하시겠습니까? 포함된 할 일도 모두 삭제됩니다.`)) {
      setTodoLists(prev => prev.filter(l => l.id !== id));
      setTodos(prev => prev.filter(t => t.listId !== id));

      if (currentUser) {
        await supabase.from('todos').delete().eq('list_id', id);
        await supabase.from('todo_lists').delete().eq('id', id);
      }
    }
  };

  const logActivity = (item: Omit<ActivityItem, 'id' | 'timestamp'>) => {
    const entry: ActivityItem = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...item,
    };
    setActivityLog(prev => [entry, ...prev].slice(0, 200));
  };

  const showUndo = (label: string, undoFn: () => void) => {
    const id = crypto.randomUUID();
    undoRef.current = undoFn;
    setUndoToast({ id, label });

    setTimeout(() => {
      setUndoToast(prev => (prev?.id === id ? null : prev));
    }, 6000);
  };

  const handleUndo = () => {
    undoRef.current?.();
    setUndoToast(null);
  };

  const handleExportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      events,
      todos,
      entries,
      posts,
      communityPosts,
      agents: aiAgents,
      personaMemories,
      settings,
      activityLog,
      userName: currentUser?.name || '',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifesync-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAllData = async () => {
    const confirmed = window.confirm('모든 기록을 삭제할까요? (일정/할 일/메모/채팅/레거시 AI 게시글/활동 기록)\n이 작업은 되돌릴 수 없습니다.');
    if (!confirmed) return;

    if (currentUser) {
      try {
        const userId = currentUser.id;
        const safeDeleteByUser = async (table: string) => {
          const result = await supabase.from(table).delete().eq('user_id', userId);
          if (result.error && result.error.code !== '42P01') {
            throw result.error;
          }
        };

        await Promise.all([
          safeDeleteByUser('ai_trigger_queue'),
          safeDeleteByUser('ai_agent_rotations'),
          safeDeleteByUser('chat_messages'),
          safeDeleteByUser('chat_sessions'),
          safeDeleteByUser('persona_memories'),
          safeDeleteByUser('user_data'),
          safeDeleteByUser('ai_agents'),
          safeDeleteByUser('community_posts'),
          safeDeleteByUser('calendar_events'),
          safeDeleteByUser('journal_categories'),
          safeDeleteByUser('journal_entries'),
          safeDeleteByUser('todo_steps'),
          safeDeleteByUser('todo_tabs'),
          safeDeleteByUser('todos'),
          safeDeleteByUser('todo_lists'),
        ]);
      } catch (error) {
        console.error('Failed to clear remote records:', error);
        alert('서버 기록 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
    }

    setEvents([]);
    setTodos([]);
    setTodoTabs(DEFAULT_TODO_TABS);
    setTodoLists(DEFAULT_TODO_LISTS);
    setTodoSteps([]);
    setEntries([]);
    setJournalCategories([]);
    setPosts([]);
    setCommunityPosts([]);
    setAiAgents(DEFAULT_AGENTS);
    setChatSessions([]);
    setPersonaMemories([]);
    setActiveChatSessionId(null);
    setActiveChatAgentIds([]);
    setActivityLog([]);
    setCalendarTags(DEFAULT_TAGS);
    setSelectedJournalId(null);
    setSelectedJournalCategory('메모장');
    setSelectedAiPostId(null);
    setSelectedAiAgentId(DEFAULT_AGENTS[0]?.id ?? 'ARIA');
    if (currentUser) {
      clearUserScopedCache(currentUser.id);
      void clearChatSessionsCache(currentUser.id);
      clearSyncSnapshots(currentUser.id);
    }
  };

  const handleClearActivity = () => {
    setActivityLog([]);
  };

  const handleClearPosts = () => {
    setPosts([]);
    setCommunityPosts([]);
  };

  const handleClearEvents = () => {
    setEvents([]);
  };

  const handleClearTodos = () => {
    setTodos([]);
    setTodoLists(DEFAULT_TODO_LISTS);
  };

  const handleClearEntries = () => {
    setEntries([]);
  };

  const handleClearChat = () => {
    setChatSessions([]);
    setActiveChatSessionId(null);
    if (currentUser) {
      void clearChatSessionsCache(currentUser.id);
      supabase.from('chat_sessions').delete().eq('user_id', currentUser.id).then(({ error }) => {
        if (error && error.code !== '42P01') {
          console.error('Failed to clear chat sessions:', error);
        }
      });
    }
  };

  const handleManualSync = async () => {
    if (!currentUser) {
      alert('로그인이 필요합니다.');
      return;
    }
    const confirmSync = window.confirm('지금 동기화를 진행하시겠습니까?\n이 작업은 PC의 데이터를 서버로 강제 전송합니다.');
    if (!confirmSync) return;

    try {
      const result = await debugManualSync(currentUser.id, {
        events,
        todos,
        todoLists,
        entries,
        journalCategories,
        communityPosts,
        aiAgents,
        settings,
        activityLog,
        calendarTags
      });

      if (result.success) {
        alert('동기화 성공!\n\n' + result.logs.join('\n'));
      } else {
        alert('동기화 실패:\n' + (result.error || '알 수 없는 오류') + '\n\n로그:\n' + result.logs.join('\n'));
      }
    } catch (e: any) {
      alert('동기화 중 오류 발생: ' + e.message);
    }
  };

  // Handlers with AI triggers
  const addEvent = async (event: CalendarEvent) => {
    setEvents(prev => [...prev, event]);
    const endDate = event.endDate || event.date;

    if (currentUser) {
      await supabase.from('calendar_events').insert([{
        id: event.id,
        user_id: currentUser.id,
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: endDate + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
        description: event.description,
        color: calendarTags.find(t => t.id === event.type)?.color || '#4c2889',
        tags: [event.type]
      }]);
    }

    logActivity({
      type: 'event_added',
      label: `일정 추가: ${event.title}`,
      meta: { id: event.id, date: event.date },
    });
    showUndo('일정이 추가됨', async () => {
      setEvents(prev => prev.filter(e => e.id !== event.id));
      if (currentUser) {
        await supabase.from('calendar_events').delete().eq('id', event.id);
      }
      logActivity({
        type: 'event_deleted',
        label: `일정 취소(Undo): ${event.title}`,
        meta: { id: event.id },
      });
    });
  };

  const updateEvent = async (event: CalendarEvent, previous: CalendarEvent) => {
    setEvents(prev => prev.map(e => e.id === event.id ? event : e));
    const endDate = event.endDate || event.date;
    const previousEndDate = previous.endDate || previous.date;

    if (currentUser) {
      await supabase.from('calendar_events').update({
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: endDate + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
        description: event.description,
        color: calendarTags.find(t => t.id === event.type)?.color || '#4c2889',
        tags: [event.type]
      }).eq('id', event.id);
    }

    logActivity({
      type: 'event_updated',
      label: `일정 수정: ${event.title}`,
      meta: { id: event.id, date: event.date },
    });
    showUndo('일정이 수정됨', async () => {
      setEvents(prev => prev.map(e => e.id === previous.id ? previous : e));
      if (currentUser) {
        await supabase.from('calendar_events').update({
          title: previous.title,
          start_time: previous.date + (previous.startTime ? `T${previous.startTime}:00` : 'T00:00:00'),
          end_time: previousEndDate + (previous.endTime ? `T${previous.endTime}:00` : 'T23:59:59'),
          description: previous.description,
          tags: [previous.type]
        }).eq('id', previous.id);
      }
      logActivity({
        type: 'event_updated',
        label: `일정 복원(Undo): ${previous.title}`,
        meta: { id: previous.id, date: previous.date },
      });
    });
  };

  const deleteEvent = async (id: string) => {
    const removed = events.find(e => e.id === id);
    if (!removed) return;
    const removedEndDate = removed.endDate || removed.date;

    setEvents(prev => prev.filter(e => e.id !== id));

    if (currentUser) {
      await supabase.from('calendar_events').delete().eq('id', id);
    }

    logActivity({
      type: 'event_deleted',
      label: `일정 삭제: ${removed.title}`,
      meta: { id },
    });
    showUndo('일정이 삭제됨', async () => {
      setEvents(prev => [removed, ...prev]);
      if (currentUser) {
        await supabase.from('calendar_events').insert([{
          id: removed.id,
          user_id: currentUser.id,
          title: removed.title,
          start_time: removed.date + (removed.startTime ? `T${removed.startTime}:00` : 'T00:00:00'),
          end_time: removedEndDate + (removed.endTime ? `T${removed.endTime}:00` : 'T23:59:59'),
          description: removed.description,
          tags: [removed.type]
        }]);
      }
      logActivity({
        type: 'event_added',
        label: `일정 복원(Undo): ${removed.title}`,
        meta: { id: removed.id, date: removed.date },
      });
    });
  };

  const addTodo = async (text: string, listId?: string, dueDate?: string, stepId?: string, category: Todo['category'] = 'personal') => {
    const targetListId = normalizeTodoListId(listId) || todoLists[0]?.id || DEFAULT_TODO_LIST_ID;
    const listLabel = todoLists.find(l => l.id === targetListId)?.title || '목록';
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      date: new Date().toISOString().slice(0, 10),
      category,
      listId: targetListId,
      stepId,
      dueDate,
      subTasks: [],
    };

    setTodos(prev => [...prev, newTodo]);

    if (currentUser) {
      const todoRow = {
        id: newTodo.id,
        user_id: currentUser.id,
        list_id: targetListId,
        step_id: stepId || null,
        text: newTodo.text,
        completed: newTodo.completed,
        "order": todos.length,
        due_date: newTodo.dueDate || null,
        sub_tasks: newTodo.subTasks || null
      };

      const { error } = await retryTodoInsertWithFallback(todoRow);

      if (error) {
        setTodos(prev => prev.filter(t => t.id !== newTodo.id));
        alert(`할 일을 저장하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
        return;
      }
    }

    logActivity({
      type: 'todo_added',
      label: `할 일 추가: ${text} (${listLabel})`,
      meta: { id: newTodo.id, listId: targetListId },
    });
    showUndo('할 일이 추가됨', async () => {
      setTodos(prev => prev.filter(t => t.id !== newTodo.id));
      if (currentUser) {
        await supabase.from('todos').delete().eq('id', newTodo.id);
      }
      logActivity({
        type: 'todo_deleted',
        label: `할 일 취소(Undo): ${text}`,
        meta: { id: newTodo.id },
      });
    });
  };

  const updateTodo = async (id: string, updates: Partial<Todo>) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (currentUser) {
      const dbUpdates: any = {};
      if (updates.text !== undefined) dbUpdates.text = updates.text;
      if (updates.completed !== undefined) dbUpdates.completed = updates.completed;
      if (updates.listId !== undefined) dbUpdates.list_id = updates.listId;
      if (updates.stepId !== undefined) dbUpdates.step_id = updates.stepId || null;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate || null;
      if (updates.subTasks !== undefined) dbUpdates.sub_tasks = updates.subTasks || null;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await retryTodoUpdateWithFallback(id, dbUpdates);
        if (error) {
          alert(`할 일을 수정하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
        }
      }
    }
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    const wasCompleted = todo.completed;
    const newCompleted = !wasCompleted;

    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: newCompleted } : t));

    if (currentUser) {
      await supabase.from('todos').update({ completed: newCompleted }).eq('id', id);
    }

    if (newCompleted) {
      logActivity({
        type: 'todo_completed',
        label: `할 일 완료: ${todo.text}`,
        meta: { id: todo.id },
      });
      showUndo('완료 처리됨', async () => {
        setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: false } : t));
        if (currentUser) {
          await supabase.from('todos').update({ completed: false }).eq('id', id);
        }
        logActivity({
          type: 'todo_uncompleted',
          label: `완료 취소(Undo): ${todo.text}`,
          meta: { id: todo.id },
        });
      });
    }
  };

  const deleteTodo = async (id: string) => {
    const removed = todos.find(t => t.id === id);
    if (!removed) return;

    setTodos(prev => prev.filter(t => t.id !== id));

    if (currentUser) {
      await supabase.from('todos').delete().eq('id', id);
    }

    logActivity({
      type: 'todo_deleted',
      label: `할 일 삭제: ${removed.text}`,
      meta: { id },
    });
    showUndo('할 일이 삭제됨', async () => {
      setTodos(prev => [removed, ...prev]);
      if (currentUser) {
        const restoreRow = {
          id: removed.id,
          user_id: currentUser.id,
          list_id: normalizeTodoListId(removed.listId) || DEFAULT_TODO_LIST_ID,
          step_id: removed.stepId || null,
          text: removed.text,
          completed: removed.completed,
          "order": todos.length,
          due_date: removed.dueDate || null,
          sub_tasks: removed.subTasks || null
        };
        const { error } = await retryTodoInsertWithFallback(restoreRow);
        if (error) {
          alert(`할 일을 복원하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
        }
      }
      logActivity({
        type: 'todo_added',
        label: `할 일 복원(Undo): ${removed.text}`,
        meta: { id: removed.id },
      });
    });
  };

  const addEntry = async (title: string, content: string, category: string = '메모장', mood: string = 'neutral') => {
    const categoryObj = journalCategories.find(c => c.name === category);
    const newEntry: JournalEntry = {
      id: crypto.randomUUID(),
      title,
      content,
      category,
      mood: mood as JournalEntry['mood'],
      date: new Date().toISOString(),
      order: 0,
    };

    const newOrder = entries.length > 0 ? Math.min(...entries.map(e => e.order || 0)) - 1 : 0;
    const entryWithOrder = { ...newEntry, order: newOrder };

    setEntries(prev => [entryWithOrder, ...prev]);
    setSelectedJournalId(newEntry.id); // 즉시 새 메모 선택

    logActivity({
      type: 'journal_added',
      label: `일기 기록: ${title}`,
      meta: { id: newEntry.id, mood, title },
    });

    showUndo('일기가 기록됨', async () => {
      setEntries(prev => prev.filter(e => e.id !== newEntry.id));
      if (currentUser) {
        await supabase.from('journal_entries').delete().eq('id', newEntry.id);
      }
      logActivity({
        type: 'journal_deleted',
        label: `일기 취소(Undo)`,
        meta: { id: newEntry.id },
      });
    });

    // DB 저장은 비동기로 처리 (UI와 AI 반응을 방해하지 않음)
    if (currentUser) {
      supabase.from('journal_entries').insert([{
        id: newEntry.id,
        user_id: currentUser.id,
        title,
        content,
        category_id: categoryObj?.id,
        mood: newEntry.mood,
        date: newEntry.date,
        "order": newOrder
      }]).then(({ error }) => {
        if (error) console.error('Failed to sync entry to Supabase:', error);
      });
    }
  };

  const deleteEntry = async (id: string) => {
    const removed = entries.find(e => e.id === id);
    if (!removed) return;

    setEntries(prev => prev.filter(e => e.id !== id));

    if (currentUser) {
      await supabase.from('journal_entries').delete().eq('id', id);
    }

    logActivity({
      type: 'journal_deleted',
      label: `일기 삭제: ${removed.content.slice(0, 20)}${removed.content.length > 20 ? '…' : ''}`,
      meta: { id },
    });
    showUndo('일기가 삭제됨', async () => {
      setEntries(prev => [removed, ...prev]);
      if (currentUser) {
        const categoryObj = journalCategories.find(c => c.name === removed.category);
        await supabase.from('journal_entries').insert([{
          id: removed.id,
          user_id: currentUser.id,
          title: removed.title,
          content: removed.content,
          category_id: categoryObj?.id,
          mood: removed.mood,
          date: removed.date,
          "order": removed.order
        }]);
      }
      logActivity({
        type: 'journal_added',
        label: `일기 복원(Undo)`,
        meta: { id: removed.id },
      });
    });
  };

  const updateEntry = async (id: string, updates: Partial<JournalEntry>) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    if (currentUser) {
      const dbUpdates: any = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.content !== undefined) dbUpdates.content = updates.content;
      if (updates.mood !== undefined) dbUpdates.mood = updates.mood;
      if (updates.category !== undefined) {
        const cat = journalCategories.find(c => c.name === updates.category);
        dbUpdates.category_id = cat?.id;
      }

      if (Object.keys(dbUpdates).length > 0) {
        await supabase.from('journal_entries').update(dbUpdates).eq('id', id);
      }
    }
  }

  const addPost = (post: AiPost) => setPosts(prev => [post, ...prev]);
  const deletePost = (id: string) => setPosts(prev => prev.filter(p => p.id !== id));

  const addCalendarTag = () => {
    const newTag: CalendarTag = {
      id: crypto.randomUUID(),
      name: '새 태그',
      color: '#37352f'
    };
    setCalendarTags(prev => [...prev, newTag]);
  };

  const updateCalendarTag = (id: string, updates: Partial<CalendarTag>) => {
    setCalendarTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const deleteCalendarTag = (id: string) => {
    if (calendarTags.length <= 1) return;
    setCalendarTags(prev => prev.filter(t => t.id !== id));
  };

  const updateAgents = async (agents: AIAgent[]) => {
    const normalized = agents.map((agent, index) => normalizeAIAgent(agent, index));
    setAiAgents(normalized);

    if (currentUser) {
      try {
        await persistAiAgentsForUser(currentUser.id, normalized);
      } catch (error) {
        console.error('Failed to persist AI persona list:', error);
      }
    }
  };

  const updateUser = async (updatedUser: User) => {
    setCurrentUser(updatedUser);
    if (currentUser) {
      await supabase.from('profiles').update({
        name: updatedUser.name,
        avatar_url: updatedUser.avatar
      }).eq('id', updatedUser.id);
    }
  };

  const navItems: { id: ViewState; label: string; icon: React.ElementType }[] = [
    { id: 'chat', label: '새 채팅', icon: MessageCircle },
    { id: 'calendar', label: '캘린더', icon: CalendarIcon },
    { id: 'todo', label: '할 일', icon: CheckSquare },
    { id: 'journal', label: '메모장', icon: BookOpen },
  ];
  const mobileNavItems: { id: ViewState; label: string; icon: React.ElementType }[] = [
    ...navItems,
    { id: 'settings', label: '설정', icon: Settings2 },
  ];

  const renderView = () => {
    switch (currentView) {
      case 'calendar':
        return (
          <CalendarView
            events={events}
            tags={calendarTags}
            onAddEvent={addEvent}
            onDeleteEvent={deleteEvent}
            onUpdateEvent={updateEvent}
          />
        );
      case 'todo':
        return (
          <TodoView
            todos={todos}
            lists={todoLists}
            tabs={todoTabs}
            steps={todoSteps}
            onAddList={addTodoList}
            onUpdateList={updateTodoList}
            onUpdateListOrder={updateTodoListOrder}
            onAddTodo={addTodo}
            onUpdateTodo={updateTodo}
            onToggleTodo={toggleTodo}
            onDeleteTodo={deleteTodo}
            onDeleteList={deleteTodoList}
            onAddTab={addTodoTab}
            onUpdateTab={updateTodoTab}
            onDeleteTab={deleteTodoTab}
            onAddStep={addTodoStep}
            onUpdateStep={updateTodoStep}
            onDeleteStep={deleteTodoStep}
          />
        );
      case 'journal':
        return (
          <JournalView
            entries={entries}
            categories={journalCategories}
            selectedId={selectedJournalId}
            selectedCategory={selectedJournalCategory}
            searchQuery={journalSearchQuery}
            onSelectId={setSelectedJournalId}
            onSelectCategory={setSelectedJournalCategory}
            onSearchQuery={setJournalSearchQuery}
            onAddEntry={addEntry}
            onUpdateEntry={updateEntry}
            onDeleteEntry={deleteEntry}
            onAddCategory={addJournalCategory}
          />
        );
      case 'settings':
        return (
          <SettingsView
            agents={aiAgents}
            onUpdateAgents={updateAgents}
            settings={settings}
            onUpdateSettings={setSettings}
            currentUser={currentUser}
            onUpdateUser={updateUser}
            onExportData={handleExportData}
            onClearAllData={handleClearAllData}
            onClearActivity={handleClearActivity}
            onClearPosts={handleClearPosts}
            onClearEvents={handleClearEvents}
            onClearTodos={handleClearTodos}
            onClearEntries={handleClearEntries}
            onClearChat={handleClearChat}
          />
        );
      case 'chat':
      default: {
        const activeSession = chatSessions.find(s => s.id === activeChatSessionId);
        const activeAgentIdsForChat = dedupeAgentIds(activeChatAgentIds).filter(id =>
          aiAgents.some(agent => agent.id === id)
        );
        const sessionAgentIds =
          activeAgentIdsForChat.length > 0
            ? activeAgentIdsForChat
            : (aiAgents[0]?.id ? [aiAgents[0].id] : []);
        const selectedChatAgents = sessionAgentIds
          .map(id => aiAgents.find(agent => agent.id === id))
          .filter(Boolean) as AIAgent[];
        const personaMemoryBucketsByAgent = buildPersonaMemoryBuckets(personaMemories);
        const personaMemoryContextByAgent = sessionAgentIds.reduce((acc, agentId) => {
          const memory = buildPersonaMemoryContext(
            chatSessions,
            agentId,
            activeChatSessionId,
            personaMemoryBucketsByAgent[agentId] || EMPTY_PERSONA_MEMORY_BUCKETS,
          );
          if (memory) acc[agentId] = memory;
          return acc;
        }, {} as Record<string, string>);

        return (
          <ChatView
            events={events}
            todos={todos}
            entries={entries}
            posts={posts}
            todoLists={todoLists}
            onAddEvent={addEvent}
            onDeleteEvent={deleteEvent}
            onAddTodo={addTodo}
            onAddEntry={addEntry}
            onAddPost={addPost}
            requireConfirm={settings.chatActionConfirm}
            settings={settings}
            agent={selectedChatAgents[0] || aiAgents[0]}
            agents={aiAgents}
            selectedAgentIds={sessionAgentIds}
            selectedAgents={selectedChatAgents}
            onSelectAgents={(agentIds) => {
              const normalized = dedupeAgentIds(agentIds).filter(id => aiAgents.some(agent => agent.id === id));
              const nextAgentIds = normalized.length > 0 ? normalized : (aiAgents[0]?.id ? [aiAgents[0].id] : []);
              setActiveChatAgentIds(nextAgentIds);
              if (activeChatSessionId) {
                setChatSessions(prev => prev.map(session =>
                  session.id === activeChatSessionId
                    ? { ...session, agentId: nextAgentIds[0], agentIds: nextAgentIds }
                    : session
                ));
              } else {
                setActiveChatSessionId(null);
              }
            }}
            onUpdateAgent={updateAiAgent}
            onUserMessage={(text, context) => {
              const nextAgentIds = sessionAgentIds.length > 0
                ? sessionAgentIds
                : (aiAgents[0]?.id ? [aiAgents[0].id] : []);
              const addressedAgentIds = dedupeAgentIds(context?.addressedAgentIds || []);
              const memoryTargetIds = addressedAgentIds.length > 0 ? addressedAgentIds : nextAgentIds;
              if (!activeChatSessionId) {
                const newId = crypto.randomUUID();
                const newSession: ChatSession = {
                  id: newId,
                  title: text.slice(0, 20) + (text.length > 20 ? '...' : ''),
                  messages: [],
                  createdAt: new Date().toISOString(),
                  lastMessageAt: new Date().toISOString(),
                  agentId: nextAgentIds[0],
                  agentIds: nextAgentIds,
                };
                setChatSessions(prev => [newSession, ...prev]);
                setActiveChatSessionId(newId);
              } else {
                setChatSessions(prev => prev.map(session =>
                  session.id === activeChatSessionId
                    ? { ...session, agentId: nextAgentIds[0], agentIds: nextAgentIds }
                    : session
                ));
              }
              appendChatObservation(text);
              capturePersonaMemoriesFromUserMessage(text, memoryTargetIds);
            }}
            initialMessages={activeSession?.messages}
            currentSessionId={activeChatSessionId}
            personaMemoryContextByAgent={personaMemoryContextByAgent}
            defaultUserName={currentUser?.name || ''}
            onUpdateMessages={(sessionId: string, messages: ChatMessage[]) => {
              setChatSessions((prev: ChatSession[]) => {
                let changed = false;
                const next = prev.map((s: ChatSession) => {
                  if (s.id !== sessionId) return s;

                  let title = s.title;
                  if (title === '새 대화' && messages.length > 0) {
                    const firstUserMsg = messages.find((m: ChatMessage) => m.role === 'user');
                    if (firstUserMsg) {
                      title = firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '');
                    }
                  }

                  const lastMsg = messages[messages.length - 1];
                  const nextLastMessageAt = lastMsg?.timestamp || s.lastMessageAt;

                  // Maintain current user selected agentIds; do not drop them just because they haven't spoken yet
                  const currentAgentIds = dedupeAgentIds([
                    ...(Array.isArray(s.agentIds) ? s.agentIds : []),
                  ]);

                  // For the primary agentId fallback
                  const messageAgentIds = dedupeAgentIds(
                    messages
                      .filter((message: ChatMessage) => message.role === 'assistant')
                      .map((message: ChatMessage) => message.agentId)
                  );
                  const nextAgentId = messageAgentIds.length > 0 ? messageAgentIds[0] : s.agentId;
                  const nextAgentIds = currentAgentIds.length > 0 ? currentAgentIds : (messageAgentIds.length > 0 ? messageAgentIds : [s.agentId]);

                  const unchanged =
                    isSameChatMessageList(s.messages, messages) &&
                    s.title === title &&
                    s.lastMessageAt === nextLastMessageAt &&
                    s.agentId === nextAgentId &&
                    isSameAgentIdList(currentAgentIds, nextAgentIds);

                  if (unchanged) return s;
                  changed = true;

                  return {
                    ...s,
                    messages,
                    title,
                    lastMessageAt: nextLastMessageAt,
                    agentId: nextAgentId,
                    agentIds: nextAgentIds,
                  };
                });
                return changed ? next : prev;
              });
            }}
          />
        );
      }
    }
  };

  const headerLabel =
    mobileNavItems.find(i => i.id === currentView)?.label ||
    (currentView === 'settings' ? '설정' : 'Dashboard');
  const historySessions = chatSessions.filter((session: ChatSession) => hasUserChatMessage(session));

  const handleNewChat = () => {
    setActiveChatSessionId(null);
    setActiveChatAgentIds(primaryActiveChatAgentId ? [primaryActiveChatAgentId] : []);
    setCurrentView('chat');
  };

  const handleMobileNavigate = (view: ViewState) => {
    if (view === 'chat') {
      handleNewChat();
    } else {
      setCurrentView(view);
    }
    setIsMobileMenuOpen(false);
  };

  if (!currentUser && isAuthInitializing) {
    return <div className="min-h-screen bg-white" />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-white relative animate-in fade-in duration-300">
        <AuthView initialMode={authMode} onLogin={(user) => setCurrentUser(user)} />
      </div>
    );
  }



  return (
    <div className="flex h-[100dvh] bg-[#fbfbfa] font-sans selection:bg-[#2ecc71]/20 relative overflow-x-hidden">
      {/* Full Page Loading Overlay Removed in v2.6 for "Instant" feel */}
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex w-16 lg:w-[240px] bg-[#f7f7f5] border-r border-[#e9e9e8] flex-col justify-between transition-all duration-300 z-50 flex-shrink-0">
        <div>
          {/* Logo Section */}
          <button
            type="button"
            className="w-full p-4 lg:p-5 flex items-center gap-3 group hover:bg-[#efefef] transition-colors text-left"
            onClick={handleNewChat}
            aria-label="새 채팅 시작"
          >
            <div className="w-8 h-8 bg-[#37352f] text-white rounded-[10px] flex items-center justify-center transition-transform group-hover:rotate-6">
              <Sparkles size={16} />
            </div>
            <span className="hidden lg:block text-lg font-bold tracking-tight text-[#37352f]">LifeSync AI</span>
          </button>

          <nav className="px-2 space-y-0.5">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => item.id === 'chat' ? handleNewChat() : setCurrentView(item.id)}
                className={`
                  w-full flex items-center px-3 py-1.5 rounded-[4px] transition-colors group
                  ${currentView === item.id
                    ? 'bg-[#efefef] text-[#37352f] font-medium'
                    : 'text-[#787774] hover:bg-[#efefef] hover:text-[#37352f]'}
                `}
              >
                <item.icon size={18} className={currentView === item.id ? 'text-[#37352f]' : 'text-[#9b9a97] group-hover:text-[#37352f]'} />
                <span className="hidden lg:block ml-2.5 text-sm">
                  {item.label}
                </span>
              </button>
            ))}
          </nav>
          {
            currentView === 'chat' && (
              <div className="hidden lg:block mt-6 pt-4 border-t border-[#e9e9e8] px-2">
                <div className="flex items-center justify-between px-3 mb-2 group">
                  <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">채팅 기록</span>
                  <button
                    onClick={handleNewChat}
                    className="p-1 hover:bg-[#efefef] rounded text-[#9b9a97] opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="space-y-0.5 overflow-y-auto max-h-[400px] scrollbar-hide">
                  {historySessions.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-[#9b9a97] italic">
                      진행 중인 대화가 없습니다.
                    </div>
                  ) : (
                    historySessions
                      .slice(0, 5)
                      .map(session => (
                        <div key={session.id} className="group relative">
                          <div
                            onClick={() => {
                              const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, activeChatAgentIds);
                              setActiveChatSessionId(session.id);
                              setActiveChatAgentIds(resolvedAgentIds);
                              const normalizedSessionIds = dedupeAgentIds([
                                ...(Array.isArray(session.agentIds) ? session.agentIds : []),
                                session.agentId,
                              ]);
                              if (session.agentId !== resolvedAgentIds[0] || !isSameAgentIdList(normalizedSessionIds, resolvedAgentIds)) {
                                setChatSessions(prev => prev.map(s => s.id === session.id
                                  ? { ...s, agentId: resolvedAgentIds[0], agentIds: resolvedAgentIds }
                                  : s));
                              }
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-[4px] cursor-pointer transition-colors text-sm group ${activeChatSessionId === session.id
                              ? 'bg-[#efefef] text-[#37352f] font-medium'
                              : 'text-[#787774] hover:bg-[#efefef] hover:text-[#37352f]'
                              }`}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, activeChatAgentIds);
                                setActiveChatSessionId(session.id);
                                setActiveChatAgentIds(resolvedAgentIds);
                                const normalizedSessionIds = dedupeAgentIds([
                                  ...(Array.isArray(session.agentIds) ? session.agentIds : []),
                                  session.agentId,
                                ]);
                                if (session.agentId !== resolvedAgentIds[0] || !isSameAgentIdList(normalizedSessionIds, resolvedAgentIds)) {
                                  setChatSessions(prev => prev.map(s => s.id === session.id
                                    ? { ...s, agentId: resolvedAgentIds[0], agentIds: resolvedAgentIds }
                                    : s));
                                }
                              }
                            }}
                          >
                            <div className="flex items-center">
                              <MessageCircle size={14} className="mr-2.5 opacity-40 shrink-0" />
                              <span className="truncate flex-1 pr-6">{session.title}</span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('이 대화 기록을 삭제하시겠습니까?')) {
                                setChatSessions(prev => prev.filter(s => s.id !== session.id));
                                if (activeChatSessionId === session.id) setActiveChatSessionId(null);
                              }
                            }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-[#d9d9d8] z-10 rounded text-[#9b9a97] opacity-0 group-hover:opacity-100 transition-all"
                            aria-label="채팅 삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )
          }

          {
            currentView === 'board' && (
              <div className="hidden lg:block mt-4 pt-4 border-t border-[#e9e9e8] px-2 space-y-6">
                {/* AI Agents (Categories) */}
                <div className="space-y-0.5">
                  <div className="px-3 flex items-center justify-between mb-1.5 group">
                    <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">AI 페르소나</span>
                    <button
                      onClick={() => setIsAddingAiAgent(!isAddingAiAgent)}
                      className={`p-0.5 hover:bg-[#efefef] rounded transition-all ${isAddingAiAgent ? 'bg-[#efefef]' : ''}`}
                    >
                      <Plus size={14} className="text-[#787774]" />
                    </button>
                  </div>

                  {isAddingAiAgent && (
                    <div className="px-2 mb-2">
                      <input
                        type="text"
                        placeholder="새 페르소나..."
                        value={aiAgentInput}
                        onChange={e => setAiAgentInput(e.target.value)}
                        className="w-full bg-white border border-[#e9e9e8] rounded-[4px] py-1.5 px-3 text-sm outline-none shadow-sm"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            addAiAgent(aiAgentInput);
                            setAiAgentInput('');
                            setIsAddingAiAgent(false);
                          }
                          if (e.key === 'Escape') setIsAddingAiAgent(false);
                        }}
                      />
                    </div>
                  )}

                  {aiAgents.map(agent => (
                    <div key={agent.id} className="relative group/agent">
                      {editingAiAgentId === agent.id ? (
                        <div className="px-2 py-1">
                          <input
                            type="text"
                            value={editingAiAgentName}
                            onChange={e => setEditingAiAgentName(e.target.value)}
                            className="w-full bg-white border border-[#37352f] rounded-[4px] py-1 px-2 text-sm outline-none shadow-sm"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                updateAiAgent(agent.id, { name: editingAiAgentName });
                                setEditingAiAgentId(null);
                              }
                              if (e.key === 'Escape') setEditingAiAgentId(null);
                            }}
                            onBlur={() => {
                              updateAiAgent(agent.id, { name: editingAiAgentName });
                              setEditingAiAgentId(null);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <button
                            onClick={() => setSelectedAiAgentId(agent.id)}
                            className={`flex-1 flex items-center px-3 py-1.5 rounded-[4px] transition-colors group ${selectedAiAgentId === agent.id
                              ? 'bg-[#efefef] text-[#37352f] font-medium'
                              : 'text-[#9b9a97] hover:bg-[#efefef] hover:text-[#37352f]'
                              }`}
                          >
                            <div className="mr-2 flex-shrink-0">
                              {agent.avatar ? (
                                <img src={agent.avatar} alt={agent.name} className="w-5 h-5 rounded-full object-cover border border-[#e9e9e8]" />
                              ) : (
                                <span className="text-sm">{agent.emoji}</span>
                              )}
                            </div>
                            <span className="text-sm truncate">{agent.name}</span>
                            <span className="ml-2 text-[11px] opacity-40 font-medium">
                              {communityPosts.filter(p => p.author === agent.id).length}
                            </span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveAiAgentMenu(activeAiAgentMenu === agent.id ? null : agent.id);
                            }}
                            className={`p-1 hover:bg-[#e9e9e8] rounded opacity-0 group-hover/agent:opacity-100 transition-opacity mr-1 ${activeAiAgentMenu === agent.id ? 'opacity-100 bg-[#e9e9e8]' : ''}`}
                          >
                            <MoreVertical size={14} className="text-[#9b9a97]" />
                          </button>
                        </div>
                      )}

                      {activeAiAgentMenu === agent.id && (
                        <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-[#e9e9e8] rounded-[4px] shadow-lg z-[100] py-1 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={() => {
                              setEditingAiAgentId(agent.id);
                              setEditingAiAgentName(agent.name);
                              setActiveAiAgentMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#37352f] hover:bg-[#efefef] transition-colors text-left"
                          >
                            <Edit3 size={12} className="text-[#9b9a97]" /> 이름 변경
                          </button>
                          <button
                            onClick={() => {
                              deleteAiAgent(agent.id);
                              setActiveAiAgentMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#eb5757] hover:bg-[#fff0f0] transition-colors text-left"
                          >
                            <Trash2 size={12} /> 삭제
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* AI Post List */}
                <div className="space-y-0.5 overflow-hidden">
                  <div className="px-3 mb-1.5">
                    <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">AI 게시글</span>
                  </div>
                  <div className="max-h-[350px] overflow-y-auto custom-scrollbar space-y-0.5">
                    {communityPosts
                      .filter(p => !selectedAiAgentId || p.author === selectedAiAgentId)
                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                      .slice(0, 5)
                      .map(post => (
                        <button
                          key={post.id}
                          onClick={() => setSelectedAiPostId(post.id)}
                          className={`w-full text-left px-3 py-2 rounded-[4px] transition-colors group ${selectedAiPostId === post.id
                            ? 'bg-[#efefef] text-[#37352f] font-medium'
                            : 'text-[#9b9a97] hover:bg-[#efefef] hover:text-[#37352f]'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm truncate pr-2">
                              {post.content.split('\n')[0].substring(0, 15)}...
                            </span>
                            <span className="text-[10px] opacity-60 font-medium flex-shrink-0">
                              {format(parseISO(post.timestamp), 'MM.dd')}
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )
          }

          {
            currentView === 'journal' && (
              <div className="mt-8 px-2 space-y-6 overflow-hidden">
                {/* Categories Section */}
                <div className="space-y-0.5">
                  <div className="px-3 mb-1.5 flex items-center justify-between group">
                    <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">카테고리</span>
                    <button
                      onClick={() => setIsAddingJournalCategory(true)}
                      className="p-1 hover:bg-[#efefef] rounded text-[#9b9a97] hover:text-[#37352f] transition-all"
                    >
                      <Plus size={16} />
                    </button>
                  </div>



                  {journalCategories.map(cat => (
                    <div
                      key={cat.id}
                      className="relative group/cat"
                      onMouseLeave={() => setActiveCategoryMenu(null)}
                    >
                      <button
                        onClick={() => setSelectedJournalCategory(cat.name)}
                        className={`w-full flex items-center px-3 py-1.5 rounded-[4px] transition-colors text-sm ${selectedJournalCategory === cat.name ? 'bg-[#efefef] text-[#37352f] font-medium' : 'text-[#787774] hover:bg-[#efefef] hover:text-[#37352f]'}`}
                      >
                        <Hash size={14} className="mr-2.5 opacity-50" />
                        <span className="truncate flex-1 text-left">{cat.name}</span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCategoryMenu(activeCategoryMenu === cat.id ? null : cat.id);
                          }}
                          className="p-0.5 hover:bg-[#d9d9d8] rounded text-[#9b9a97] opacity-0 group-hover/cat:opacity-100 transition-all"
                        >
                          <MoreVertical size={12} />
                        </button>
                      </button>

                      {/* Category Action Menu */}
                      {activeCategoryMenu === cat.id && (
                        <div className="absolute left-full top-0 ml-1 w-32 bg-white border border-[#e9e9e8] rounded-lg shadow-xl py-1 z-[60] animate-in fade-in zoom-in-95 duration-200">
                          <button
                            onClick={() => {
                              setEditingCategoryId(cat.id);
                              setEditingCategoryName(cat.name);
                              setActiveCategoryMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#37352f] hover:bg-[#efefef] transition-colors text-left"
                          >
                            <Edit3 size={12} className="text-[#9b9a97]" /> 이름 변경
                          </button>
                          <button
                            onClick={() => {
                              deleteJournalCategory(cat.id);
                              setActiveCategoryMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#eb5757] hover:bg-[#fff0f0] transition-colors text-left"
                          >
                            <Trash2 size={12} /> 삭제
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {isAddingJournalCategory && (
                    <div className="px-2 mb-2">
                      <input
                        type="text"
                        placeholder="새 카테고리..."
                        value={journalCategoryInput}
                        onChange={e => setJournalCategoryInput(e.target.value)}
                        className="w-full bg-white border border-[#e9e9e8] rounded-[4px] py-1.5 px-3 text-sm outline-none shadow-sm"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            addJournalCategory(journalCategoryInput);
                            setJournalCategoryInput('');
                            setIsAddingJournalCategory(false);
                          }
                          if (e.key === 'Escape') setIsAddingJournalCategory(false);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Entry List */}
                <div className="space-y-0.5 overflow-hidden">
                  <div className="px-3 mb-1.5">
                    <span className="text-[11px] font-medium text-[#787774] uppercase tracking-wider">기록 목록</span>
                  </div>
                  <div className="max-h-[350px] overflow-y-auto custom-scrollbar space-y-0.5">
                    {entries
                      .filter(e => selectedJournalCategory === 'all' || e.category === selectedJournalCategory)
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(entry => (
                        <button
                          key={entry.id}
                          onClick={() => setSelectedJournalId(entry.id)}
                          className={`w-full text-left px-3 py-2 rounded-[4px] transition-colors group ${selectedJournalId === entry.id
                            ? 'bg-[#efefef] text-[#37352f] font-medium'
                            : 'text-[#9b9a97] hover:bg-[#efefef] hover:text-[#37352f]'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm truncate pr-2">
                              {entry.title || '제목 없음'}
                            </span>
                            <span className="text-[10px] opacity-60 font-medium flex-shrink-0">
                              {format(parseISO(entry.date), 'MM.dd')}
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )
          }

          {/* Divider */}
          <div className="mx-4 my-4 border-t border-[#e9e9e8]"></div>

          {/* Settings and User Info */}
          <div className="px-2">
            <div className="pt-4 space-y-0.5">
              <button
                onClick={() => setCurrentView('settings')}
                className={`w-full flex items-center gap-3 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${currentView === 'settings' ? 'bg-[#efefef] text-[#37352f]' : 'text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f]'}`}
              >
                <Settings2 size={16} />
                <span className="hidden lg:block">설정</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Section: Pro & Auth */}
        <div className="p-3 space-y-3">


          {currentUser ? (
            <div className="bg-white border border-[#e9e9e8] rounded-lg p-2 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-[#f1f1f0] flex items-center justify-center text-xs font-bold text-[#37352f] flex-shrink-0 overflow-hidden border border-[#e9e9e8]">
                  {currentUser?.avatar ? (
                    <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
                  ) : (
                    currentUser?.name?.[0] || 'U'
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#37352f] truncate">{currentUser?.name}</span>
                    <span className="text-[9px] text-[#9b9a97] font-medium leading-none">v2.6.0</span>
                  </div>
                  {!isDataLoaded && (
                    <span className="text-[9px] text-[#eb5757] font-semibold flex items-center gap-1 mt-0.5 animate-pulse">
                      <span className="w-1 h-1 rounded-full bg-[#eb5757]" />
                      데이터 로딩 중...
                    </span>
                  )}
                  {isDataLoaded && syncStatus === 'error' && (
                    <span className="text-[9px] text-[#eb5757] font-bold flex items-center gap-1 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#eb5757]" />
                      저장 오류 (RLS 고장)
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-1 px-2 py-1.5 hover:bg-[#efefef] rounded text-[#9b9a97] hover:text-[#eb5757] transition-colors flex-shrink-0 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                title="로그아웃"
              >
                <LogOut size={14} />
                <span>{isLoggingOut ? '처리 중...' : '로그아웃'}</span>
              </button>
            </div>
          ) : (
            <div className="px-1">
              <button
                onClick={() => {
                  setAuthMode('login');
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#37352f] text-white text-[11px] font-bold rounded-lg hover:bg-black transition-all shadow-sm"
              >
                <UserIcon size={14} strokeWidth={3} />
                로그인 / 가입하기
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-white pb-0">
        {/* Top Mobile Bar (Visible only on small screens) */}
        <header className="lg:hidden h-14 bg-white border-b border-[#e9e9e8] flex items-center justify-between px-4 font-semibold text-sm z-40 relative">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="w-8 h-8 flex items-center justify-center text-[#787774] hover:text-[#37352f] transition-colors"
              aria-label="전체 메뉴 열기"
            >
              <Menu size={20} />
            </button>
            <span className="text-[#37352f] truncate">{headerLabel}</span>
          </div>
          {currentUser ? (
            <div className="w-8 h-8 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[11px] font-bold text-[#37352f] overflow-hidden border border-[#e9e9e8]">
              {currentUser?.avatar ? (
                <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
              ) : (
                currentUser?.name?.[0] || 'U'
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                setAuthMode('login');
              }}
              className="text-[11px] font-semibold text-[#37352f] px-2.5 py-1 rounded-md border border-[#e9e9e8] bg-white"
            >
              로그인
            </button>
          )}
        </header>

        {/* Scrollable View Content */}
        <div className={`flex-1 relative scroll-smooth ${['todo', 'journal', 'calendar'].includes(currentView) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={`h-full mx-auto ${['todo', 'journal', 'calendar'].includes(currentView) ? 'max-w-none p-0' : 'max-w-[1200px] p-3 sm:p-4 lg:p-8 lg:pt-10'}`}>
            <ViewErrorBoundary view={currentView} onRecover={() => setCurrentView('chat')}>
              {renderView()}
            </ViewErrorBoundary>
          </div>
        </div>

        {undoToast && (
          <div className="fixed bottom-20 lg:bottom-6 right-3 lg:right-6 left-3 lg:left-auto z-50">
            <div className="bg-[#37352f] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
              <span className="text-sm">{undoToast.label}</span>
              <button
                onClick={handleUndo}
                className="text-xs font-semibold bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md transition-colors"
              >
                실행 취소
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Slide Menu */}
      <div className={`lg:hidden fixed inset-0 z-[80] transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div
          className="absolute inset-0 bg-black/30"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <aside className={`absolute inset-y-0 left-0 w-[78vw] max-w-[320px] bg-white border-r border-[#e9e9e8] shadow-xl transform transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-full flex flex-col">
            <div className="h-14 px-4 border-b border-[#e9e9e8] flex items-center justify-between">
              <span className="text-sm font-semibold text-[#37352f]">전체 메뉴</span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 rounded-md border border-[#e9e9e8] bg-white flex items-center justify-center text-[#787774] hover:text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                aria-label="메뉴 닫기"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <nav className="space-y-1">
                {mobileNavItems.map((item) => {
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleMobileNavigate(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive
                        ? 'bg-[#efefef] text-[#37352f] font-medium'
                        : 'text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f]'}`}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="border-t border-[#e9e9e8] pt-3">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[11px] font-semibold text-[#787774] uppercase tracking-wide">채팅 내역</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleNewChat();
                      setIsMobileMenuOpen(false);
                    }}
                    className="p-1 rounded-md border border-[#e9e9e8] text-[#787774] hover:text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                    aria-label="새 채팅"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {historySessions.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-[#9b9a97]">저장된 대화가 없습니다.</div>
                  ) : (
                    historySessions
                      .slice(0, 12)
                      .map((session) => (
                        <div key={session.id} className="group flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, activeChatAgentIds);
                              setActiveChatSessionId(session.id);
                              setActiveChatAgentIds(resolvedAgentIds);
                              const normalizedSessionIds = dedupeAgentIds([
                                ...(Array.isArray(session.agentIds) ? session.agentIds : []),
                                session.agentId,
                              ]);
                              if (session.agentId !== resolvedAgentIds[0] || !isSameAgentIdList(normalizedSessionIds, resolvedAgentIds)) {
                                setChatSessions(prev => prev.map(s => s.id === session.id
                                  ? { ...s, agentId: resolvedAgentIds[0], agentIds: resolvedAgentIds }
                                  : s));
                              }
                              setCurrentView('chat');
                              setIsMobileMenuOpen(false);
                            }}
                            className={`flex-1 text-left px-2.5 py-2 rounded-md text-sm transition-colors ${activeChatSessionId === session.id
                              ? 'bg-[#efefef] text-[#37352f] font-medium'
                              : 'text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f]'}`}
                          >
                            <span className="block truncate">{session.title}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('이 채팅을 삭제할까요?')) {
                                setChatSessions(prev => prev.filter(s => s.id !== session.id));
                                if (activeChatSessionId === session.id) {
                                  setActiveChatSessionId(null);
                                }
                              }
                            }}
                            className="shrink-0 p-1.5 rounded-md text-[#9b9a97] hover:bg-[#efefef] hover:text-[#eb5757] transition-colors"
                            aria-label="채팅 삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
            <div className="p-3 border-t border-[#e9e9e8]">
              {currentUser ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded-full bg-[#f1f1f0] flex items-center justify-center text-xs font-bold text-[#37352f] flex-shrink-0 overflow-hidden border border-[#e9e9e8]">
                      {currentUser?.avatar ? (
                        <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
                      ) : (
                        currentUser?.name?.[0] || 'U'
                      )}
                    </div>
                    <span className="text-xs font-semibold text-[#37352f] truncate">{currentUser?.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleLogout();
                    }}
                    disabled={isLoggingOut}
                    className="flex items-center gap-1 px-2 py-1.5 hover:bg-[#efefef] rounded text-[#9b9a97] hover:text-[#eb5757] transition-colors text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                    title="로그아웃"
                    aria-label="로그아웃"
                  >
                    <LogOut size={14} />
                    <span>{isLoggingOut ? '처리 중...' : '로그아웃'}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setAuthMode('login');
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#37352f] text-white text-[12px] font-semibold rounded-lg hover:bg-black transition-all"
                >
                  <UserIcon size={14} />
                  로그인 / 가입
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default App;

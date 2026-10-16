import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ViewState, CalendarEvent, Todo, JournalEntry, AIAgent, ActivityItem, AppSettings, TodoList, TodoTab, TodoStep, CalendarTag, JournalCategory, User, ChatSession, ChatMessage, PersonaMemory, PersonaMemoryType, RoutineProgress, AgentUsageStats, ThemeMode } from './types';
import { Calendar as CalendarIcon, Check, CheckSquare, BookOpen, MessageCircle, ChevronDown, Plus, Trash2, Search, Layout, MoreVertical, User as UserIcon, X, Users, Menu, PanelLeftClose, PanelLeftOpen, CircleHelp, History, Pencil } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from './utils/supabase';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { DEFAULT_AGENTS, migrateLegacyDefaultAgent } from './data/defaultAgents';
import { normalizeKoreanText } from './utils/encodingFix';
import { syncEvents, syncTodos, syncTodoLists, syncTodoTabs, syncTodoSteps, syncEntries, syncJournalCategories, syncAgents, syncChatSessions, syncPersonaMemories, syncUserData, setOnSyncError, seedSyncSnapshot, clearUserSyncState } from './services/syncService';
import { debugManualSync } from './utils/debugSync';
import { useAuthSession } from './hooks/useAuthSession';
import { clearChatSessionsCache, loadChatSessionsCache, saveChatSessionsCache } from './utils/chatSessionCache';
import { normalizePersistedImageSource } from './utils/imageAsset';
import { getAvatarImageStyle, sanitizeAvatarFrame } from './utils/avatarFrame';
import { getDarkAdaptiveColor } from './utils/colorPalette';

import { UserMenuPopover } from './components/UserMenuPopover';
import { CalendarTagModal } from './components/CalendarTagModal';
import { consumeBackLayerCleanupPop, useBackLayer } from './hooks/useBackLayer';
import type { SettingsTab } from './views/SettingsView';

const CalendarView = React.lazy(() => import('./views/CalendarView'));
const TodoView = React.lazy(() => import('./views/TodoView'));
const JournalView = React.lazy(() => import('./views/JournalView'));
const SettingsView = React.lazy(() => import('./views/SettingsView'));
const ChatView = React.lazy(() => import('./views/ChatView'));
const AuthView = React.lazy(() => import('./views/AuthView'));
const SupportView = React.lazy(() => import('./views/SupportView'));

type ChatObservation = {
  text: string;
  timestamp: string;
};

const PERSONA_MEMORY_SESSION_LIMIT = 4;
const PERSONA_MEMORY_LINE_LIMIT = 12;
const PERSONA_MEMORY_ITEM_CHAR_LIMIT = 120;
const PERSONA_MEMORY_TOTAL_CHAR_LIMIT = 1400;
const PERSONA_MEMORY_INSTRUCTION_LIMIT = 8;
const PERSONA_MEMORY_FACT_LIMIT = 6;
const PERSONA_MEMORY_PREFERENCE_LIMIT = 6;
const PERSONA_MEMORY_GOAL_LIMIT = 6;
const PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT = 3;
const PERSONA_MEMORY_MAX_CONTENT_CHARS = 180;
const PERSONA_MEMORY_DB_PER_AGENT_LIMIT = 24;

type PersonaMemoryBuckets = {
  pinned: string[];
  instructions: string[];
  facts: string[];
  preferences: string[];
  goals: string[];
};

type ManagedPersonaMemoryBucketKey = Exclude<keyof PersonaMemoryBuckets, 'pinned'>;

const EMPTY_PERSONA_MEMORY_BUCKETS: PersonaMemoryBuckets = {
  pinned: [],
  instructions: [],
  facts: [],
  preferences: [],
  goals: [],
};

const ViewLoadingFallback = () => (
  <div className="flex h-full min-h-[240px] items-center justify-center bg-white">
    <div
      className="h-6 w-6 animate-spin rounded-full border border-[#e9e9e8] border-t-[var(--color-primary)]"
      aria-label="화면 로딩 중"
    />
  </div>
);

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
  const availableAgentIds = new Set(agents.map(agent => agent.id));
  const keepAvailableIds = (ids: string[]) =>
    ids.filter(id => availableAgentIds.size === 0 || availableAgentIds.has(id));

  const explicitAgentIds = keepAvailableIds(
    dedupeAgentIds(Array.isArray(session.agentIds) ? session.agentIds : [])
  );
  if (explicitAgentIds.length > 0) return explicitAgentIds;

  const primaryAgentIds = keepAvailableIds(dedupeAgentIds([session.agentId]));
  if (primaryAgentIds.length > 0) return primaryAgentIds;

  const fromMessages = keepAvailableIds(extractAssistantAgentIds(session.messages || []));
  if (fromMessages.length > 0) return fromMessages;

  const inferred = inferAgentIdFromMessages(session.messages || [], agents);
  if (inferred) return [inferred];

  const fallback = keepAvailableIds(dedupeAgentIds(fallbackIds));
  if (fallback.length > 0) return fallback;

  return agents[0]?.id ? [agents[0].id] : [];
};

const isSameAgentIdList = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
};

const hasUserChatMessage = (session: ChatSession): boolean =>
  Array.isArray(session.messages) && session.messages.some((m: ChatMessage) => m.role === 'user');

const parseTimestampMs = (value?: string): number => {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getChatSessionActivityTime = (session: ChatSession): number => {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const lastMessage = messages[messages.length - 1];
  return Math.max(
    parseTimestampMs(session.lastMessageAt),
    parseTimestampMs(lastMessage?.timestamp),
    parseTimestampMs(session.createdAt),
  );
};

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
      left.agentId !== right.agentId ||
      left.imageUrl !== right.imageUrl ||
      left.videoUrl !== right.videoUrl ||
      left.provider !== right.provider ||
      left.modelName !== right.modelName ||
      left.connectionId !== right.connectionId
    ) {
      return false;
    }

    const leftAction = left.action;
    const rightAction = right.action;
    if (Boolean(leftAction) !== Boolean(rightAction)) return false;
    if (leftAction && rightAction) {
      if (JSON.stringify(leftAction) !== JSON.stringify(rightAction)) {
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

const normalizePersonaMemory = (memory: any, fallbackUserId?: string): PersonaMemory | null => {
  if (!memory?.agentId && !memory?.agent_id) return null;
  const content = truncateMemoryText(String(memory.content || ''), PERSONA_MEMORY_MAX_CONTENT_CHARS);
  if (!content) return null;
  const typeValue = memory.type || memory.memory_type;
  const now = new Date().toISOString();

  return {
    id: String(memory.id || crypto.randomUUID()),
    userId: String(memory.userId || memory.user_id || fallbackUserId || ''),
    agentId: String(memory.agentId || memory.agent_id),
    type: (typeValue === 'preference' || typeValue === 'goal') ? typeValue : 'fact',
    key: String(memory.key || memory.memory_key || normalizeMemoryKey(content) || crypto.randomUUID()),
    content,
    confidence: typeof memory.confidence === 'number' ? memory.confidence : 0.6,
    observationCount: typeof memory.observationCount === 'number'
      ? memory.observationCount
      : (typeof memory.observation_count === 'number' ? memory.observation_count : 1),
    firstObservedAt: typeof memory.firstObservedAt === 'string'
      ? memory.firstObservedAt
      : (typeof memory.first_observed_at === 'string' ? memory.first_observed_at : now),
    lastObservedAt: typeof memory.lastObservedAt === 'string'
      ? memory.lastObservedAt
      : (typeof memory.last_observed_at === 'string' ? memory.last_observed_at : now),
    createdAt: typeof memory.createdAt === 'string'
      ? memory.createdAt
      : (typeof memory.created_at === 'string' ? memory.created_at : now),
    updatedAt: typeof memory.updatedAt === 'string'
      ? memory.updatedAt
      : (typeof memory.updated_at === 'string' ? memory.updated_at : now),
  };
};

const collectMemorySignals = (text: string): {
  instructions: string[];
  facts: string[];
  preferences: string[];
  goals: string[];
} => {
  const instructions: string[] = [];
  const facts: string[] = [];
  const preferences: string[] = [];
  const goals: string[] = [];
  const sentences = memorySentenceCandidates(text);

  for (const sentence of sentences) {
    const compact = sentence.toLowerCase();
    const normalizedSentence = truncateMemoryText(sentence, PERSONA_MEMORY_ITEM_CHAR_LIMIT);
    if (!normalizedSentence) continue;

    if (
      /(말투|호칭|부르|답변\s*길이|짧게|길게|문단|문장|줄바꿈|이모지|하트|마침표|쉼표|존댓말|반말|기억|지침|규칙|프롬프트|이렇게\s*(말|답|대답)|하지\s*마|하지\s*말|하지\s*말아|쓰지\s*마|써줘|말해줘|답해줘|불러줘|유지해|따라줘)/.test(compact)
    ) {
      instructions.push(normalizedSentence);
    }

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

  return { instructions, facts, preferences, goals };
};

const extractExplicitMemoryText = (text: string): string => {
  const normalized = (text || '').trim();
  if (!normalized) return '';

  const suffixMatch = normalized.match(/^(.+?)\s*(?:이거|이건|이 내용|이 말)?\s*(?:기억해줘|기억해|메모해줘|메모해|저장해줘|저장해|잊지\s*마|잊지\s*말아줘)\.?$/i);
  if (suffixMatch?.[1]?.trim()) return suffixMatch[1].trim();

  const prefixMatch = normalized.match(/^(?:이거|이건|이 내용|이 말)?\s*(?:기억해줘|기억해|메모해줘|메모해|저장해줘|저장해)[:：,\s]+(.+)$/i);
  if (prefixMatch?.[1]?.trim()) return prefixMatch[1].trim();

  return '';
};

const inferMemoryBucketForText = (text: string): ManagedPersonaMemoryBucketKey => {
  const signals = collectMemorySignals(text);
  if (signals.instructions.length > 0) return 'instructions';
  if (signals.preferences.length > 0) return 'preferences';
  if (signals.goals.length > 0) return 'goals';
  return 'facts';
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

const memoryBucketKeyToType = (key: ManagedPersonaMemoryBucketKey): PersonaMemoryType => {
  if (key === 'facts') return 'fact';
  if (key === 'preferences' || key === 'instructions') return 'preference';
  return 'goal';
};

const memoryTypeToBucketKey = (type: PersonaMemoryType, key: string = ''): ManagedPersonaMemoryBucketKey => {
  if (key.startsWith('instruction:')) return 'instructions';
  if (type === 'fact') return 'facts';
  if (type === 'preference') return 'preferences';
  return 'goals';
};

const buildPersonaMemoryBuckets = (
  memories: PersonaMemory[],
  pinnedMemoryIds: Set<string> = new Set()
): Record<string, PersonaMemoryBuckets> => {
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
        pinned: [],
        instructions: [],
        facts: [],
        preferences: [],
        goals: [],
      };
    }
    if (pinnedMemoryIds.has(memory.id)) {
      if (output[memory.agentId].pinned.length < 6) {
        output[memory.agentId].pinned.push(memory.content);
      }
      continue;
    }
    const bucketKey = memoryTypeToBucketKey(memory.type, memory.key);
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
  void sessions;
  void activeSessionId;

  const pinned = dedupeMemoryItems(persistentMemory.pinned || [], 6);
  const instructions = dedupeMemoryItems(persistentMemory.instructions || [], PERSONA_MEMORY_INSTRUCTION_LIMIT);
  const facts = dedupeMemoryItems(persistentMemory.facts || [], PERSONA_MEMORY_FACT_LIMIT);
  const preferences = dedupeMemoryItems(persistentMemory.preferences || [], PERSONA_MEMORY_PREFERENCE_LIMIT);
  const goals = dedupeMemoryItems(persistentMemory.goals || [], PERSONA_MEMORY_GOAL_LIMIT);

  if (pinned.length === 0 && instructions.length === 0 && facts.length === 0 && preferences.length === 0 && goals.length === 0) return '';

  const blocks: string[] = [];
  if (pinned.length > 0) {
    blocks.push(
      '[Pinned Memory: Highest Priority]',
      ...pinned.map((item, index) => `${index + 1}. ${item}`),
    );
  }
  if (instructions.length > 0) {
    blocks.push(
      '[Standing Instructions: Follow These]',
      ...instructions.map((item, index) => `${index + 1}. ${item}`),
    );
  }
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

  return truncateMemoryText(blocks.join('\n'), PERSONA_MEMORY_TOTAL_CHAR_LIMIT);
};

const parseStoredTimestampParts = (value: unknown): { date: string; time: string } => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { date: '', time: '' };

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (match) {
    return {
      date: match[1],
      time: match[2],
    };
  }

  const [datePart = '', timePart = ''] = raw.split('T');
  return {
    date: datePart,
    time: timePart.replace(/([+-]\d{2}:\d{2}|Z)$/i, '').slice(0, 8),
  };
};

const normalizeCachedCalendarEvent = (event: CalendarEvent): CalendarEvent => {
  const hasExplicitStartTime = Boolean(event.startTime && event.startTime !== '00:00');
  const hasExplicitEndTime = Boolean(event.endTime && event.endTime !== '23:59');
  const inferredAllDay =
    Boolean(event.isAllDay) ||
    Boolean(event.description?.includes('[TODO_LINK:')) ||
    (!hasExplicitStartTime && !hasExplicitEndTime);

  if (!inferredAllDay) return event;

  return {
    ...event,
    startTime: undefined,
    endTime: undefined,
    isAllDay: true,
  };
};

const normalizeAIAgent = (rawAgent: any, fallbackOrder: number = 0): AIAgent => {
  const agent = migrateLegacyDefaultAgent(rawAgent || {});
  const avatar = typeof agent?.avatar === 'string' ? agent.avatar : undefined;
  const normalizeTone = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const normalized = normalizeKoreanText(value);
    return normalized.trim() === '따뜻하고 명확한 말투' ? '' : normalized;
  };
  return {
    id: String(agent?.id || crypto.randomUUID()),
    name: normalizeKoreanText(String(agent?.name || `페르소나 ${fallbackOrder + 1}`)),
    emoji: String(agent?.emoji || ':)'),
    role: normalizeKoreanText(String(agent?.role || '인공지능 비서')),
    personality: normalizeKoreanText(
      typeof agent?.personality === 'string'
        ? agent.personality
        : '도움이 되고 실용적인 비서 성격'
    ),
    tone: normalizeTone(agent?.tone),
    color: String(agent?.color || '#37352f'),
    avatar,
    avatarFrame: avatar ? sanitizeAvatarFrame(agent?.avatarFrame) : undefined,
    connectionId: typeof agent?.connection_id === 'string' ? agent.connection_id : (typeof agent?.connectionId === 'string' ? agent.connectionId : undefined),
    responseLength: agent?.response_length === 'short' || agent?.response_length === 'medium' || agent?.response_length === 'long'
      ? agent.response_length
      : (agent?.responseLength === 'short' || agent?.responseLength === 'medium' || agent?.responseLength === 'long' ? agent.responseLength : 'medium'),
  };
};

const getAgentProfileSettings = (agent: Partial<AIAgent>): Partial<AIAgent> => ({
  avatarFrame: agent.avatar ? sanitizeAvatarFrame(agent.avatarFrame) : undefined,
});

const isAgentProfileSettingsEmpty = (profile: Partial<AIAgent>): boolean =>
  !profile.avatarFrame;

const resolveAgentsWithProfiles = (agents: AIAgent[], settings: AppSettings): AIAgent[] =>
  (agents.length > 0 ? agents : DEFAULT_AGENTS).map((agent, index) =>
    normalizeAIAgent({
      ...agent,
      ...(settings.agentProfiles?.[agent.id] || {}),
    }, index)
  );

const normalizeAgentAvatarForSave = async (agent: AIAgent, previousAvatar?: string): Promise<AIAgent> => {
  const nextAvatar = typeof agent.avatar === 'string' ? agent.avatar.trim() : '';
  const prevAvatar = typeof previousAvatar === 'string' ? previousAvatar.trim() : '';
  if (!nextAvatar) {
    return { ...agent, avatar: undefined, avatarFrame: undefined };
  }
  const avatarFrame = sanitizeAvatarFrame(agent.avatarFrame);
  if (nextAvatar === prevAvatar) return { ...agent, avatar: nextAvatar, avatarFrame };
  const normalizedAvatar = await normalizePersistedImageSource(nextAvatar);
  return { ...agent, avatar: normalizedAvatar, avatarFrame };
};

const DEFAULT_TAGS: CalendarTag[] = [
  { id: 'tag_1', name: '일정', color: '#2563EB' },
  { id: 'tag_2', name: '할 일', color: '#F59E0B' },
  { id: 'tag_3', name: '생일', color: '#10B981' },
];

const LEGACY_DEFAULT_TAG_COLORS: Record<string, string> = {
  tag_1: '#4c2889',
  tag_2: '#DEB13B',
  tag_3: '#35B37E',
};

const normalizeDefaultCalendarTagColors = (tags: CalendarTag[]): CalendarTag[] => tags.map(tag => {
  const legacyColor = LEGACY_DEFAULT_TAG_COLORS[tag.id];
  const nextDefault = DEFAULT_TAGS.find(defaultTag => defaultTag.id === tag.id);
  return legacyColor && nextDefault && tag.color.toLowerCase() === legacyColor.toLowerCase()
    ? { ...tag, color: nextDefault.color }
    : tag;
});

const DEFAULT_TODO_TABS: TodoTab[] = [
  { id: 'tab_todo', name: '할 일', color: '#1a73e8', order: 0 },
  { id: 'tab_project', name: '프로젝트', color: '#9c27b0', order: 1 },
  { id: 'tab_routine', name: '루틴', color: '#34a853', order: 2 },
];

const DEFAULT_TODO_LIST_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_ROUTINE_LIST_ID = '00000000-0000-4000-8000-000000000002';
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

// Upsert rather than insert: the debounced background sync (syncTodos) may already have
// written this row while we were awaiting, and a plain insert would then hit todos_pkey.
const retryTodoInsertWithFallback = async (
  row: Record<string, any>,
): Promise<{ error: any; payload: Record<string, any> }> => {
  let payload = { ...row };
  let attempt = 0;

  while (attempt < TODO_OPTIONAL_DB_COLUMNS.length) {
    const result = await supabase.from('todos').upsert([payload], { onConflict: 'id' });
    const unsupportedColumns = getUnsupportedTodoColumns(result.error);
    if (!result.error || unsupportedColumns.length === 0) {
      return { error: result.error, payload };
    }
    payload = stripTodoOptionalColumns(payload, unsupportedColumns);
    attempt += 1;
  }

  const finalResult = await supabase.from('todos').upsert([payload], { onConflict: 'id' });
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

const DEFAULT_TODO_LISTS: TodoList[] = [
  { id: DEFAULT_TODO_LIST_ID, title: '해야 할 일', order: 1, tabId: 'tab_todo' },
  { id: DEFAULT_ROUTINE_LIST_ID, title: '루틴 목록', order: 2, tabId: 'tab_routine' },
];

const THEME_STORAGE_KEY = 'dayflow-theme';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dayflow-sidebar-collapsed';
const SIDEBAR_RAIL_LABELS: Partial<Record<ViewState, string>> = { chat: '채팅' };
const THEME_META_COLOR = {
  light: '#ffffff',
  dark: '#0a0a0a',
} as const;

const DEFAULT_THEME: ThemeMode = 'system';

const DEFAULT_SETTINGS: AppSettings = {
  chatActionConfirm: true,
  theme: DEFAULT_THEME,
  apiConnections: [],
  activeConnectionId: undefined,
  agentProfiles: {},
  agentUsageById: {},
  pinnedPersonaMemoryIds: [],
  lastRoutineResetDate: undefined,
  routineProgress: {},
};

const withoutLegacyAiAutomationSetting = (
  value: Partial<AppSettings> | null | undefined,
): Partial<AppSettings> => {
  if (!value) return {};
  const { autoAiReactions: _legacyAutoAiReactions, ...currentSettings } = value as Partial<AppSettings> & {
    autoAiReactions?: unknown;
  };
  return currentSettings;
};

const getSystemTheme = (): Exclude<ThemeMode, 'system'> => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const resolveThemeMode = (theme: ThemeMode | undefined): Exclude<ThemeMode, 'system'> =>
  theme === 'dark' || theme === 'light' ? theme : getSystemTheme();

const applyThemeToDocument = (theme: ThemeMode | undefined) => {
  if (typeof document === 'undefined') return;

  const resolvedTheme = resolveThemeMode(theme);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', THEME_META_COLOR[resolvedTheme]);
  }
};

const ROUTINE_DATE_FORMAT = 'yyyy-MM-dd';

const getTodayDate = (): string => format(new Date(), ROUTINE_DATE_FORMAT);

const isRoutineTab = (tab: TodoTab): boolean => {
  const normalizedName = (tab.name || '').toLowerCase();
  return tab.id === 'tab_routine' || tab.name.includes('루틴') || normalizedName.includes('routine');
};

const getRoutineListIds = (lists: TodoList[], tabs: TodoTab[]): Set<string> => {
  const routineTabIds = new Set(
    (Array.isArray(tabs) ? tabs : [])
      .filter(isRoutineTab)
      .map(tab => tab.id)
  );

  return new Set(
    (Array.isArray(lists) ? lists : [])
      .filter(list => {
        const normalizedTitle = (list.title || '').toLowerCase();
        return routineTabIds.has(list.tabId || '') || list.title.includes('루틴') || normalizedTitle.includes('routine');
      })
      .map(list => list.id)
  );
};

const isRoutineTodo = (todo: Pick<Todo, 'listId'>, routineListIds: Set<string>): boolean =>
  Boolean(todo.listId && routineListIds.has(todo.listId));

const clearTodoCompletionFlags = (todo: Todo): Todo => {
  const hasCompletedSubTask = Boolean(todo.subTasks?.some(subTask => subTask.completed));
  if (!todo.completed && !hasCompletedSubTask) return todo;

  return {
    ...todo,
    completed: false,
    subTasks: todo.subTasks?.map(subTask => ({ ...subTask, completed: false })),
  };
};

const pruneRoutineProgress = (
  progress: Record<string, RoutineProgress> | undefined,
): Record<string, RoutineProgress> | undefined => {
  if (!progress) return undefined;

  const entries = Object.entries(progress).flatMap(([todoId, value]) => {
    if (!value) return [];

    const nextSubTaskCompletedOn = Object.fromEntries(
      Object.entries(value.subTaskCompletedOn || {}).filter(([, completedOn]) => Boolean(completedOn))
    );

    const nextValue: RoutineProgress = {};
    if (value.completedOn) nextValue.completedOn = value.completedOn;
    if (Object.keys(nextSubTaskCompletedOn).length > 0) nextValue.subTaskCompletedOn = nextSubTaskCompletedOn;

    return nextValue.completedOn || nextValue.subTaskCompletedOn ? [[todoId, nextValue] as const] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const getTodoWithRoutineState = (
  todo: Todo,
  settings: AppSettings,
  routineListIds: Set<string>,
  today: string,
): Todo => {
  if (!isRoutineTodo(todo, routineListIds)) return todo;

  const progress = settings.routineProgress?.[todo.id];
  const subTaskCompletedOn = progress?.subTaskCompletedOn || {};

  return {
    ...todo,
    completed: progress?.completedOn === today,
    subTasks: todo.subTasks?.map(subTask => ({
      ...subTask,
      completed: subTaskCompletedOn[subTask.id] === today,
    })),
  };
};

const buildRoutineProgressFromDisplayedTodo = (todo: Todo, today: string): RoutineProgress | undefined => {
  const nextProgress: RoutineProgress = {};

  if (todo.completed) {
    nextProgress.completedOn = today;
  }

  const completedSubTaskEntries = (todo.subTasks || [])
    .filter(subTask => subTask.completed)
    .map(subTask => [subTask.id, today] as const);

  if (completedSubTaskEntries.length > 0) {
    nextProgress.subTaskCompletedOn = Object.fromEntries(completedSubTaskEntries);
  }

  return nextProgress.completedOn || nextProgress.subTaskCompletedOn ? nextProgress : undefined;
};

const getSupabaseErrorMessage = (error: any, fallback: string): string =>
  error?.message || fallback;

const areSettingsValuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const buildSettingsPatch = (previous: AppSettings, next: AppSettings): Partial<AppSettings> => {
  const patch: Partial<AppSettings> = {};
  const keys = new Set([
    ...Object.keys(previous || {}),
    ...Object.keys(next || {}),
  ]);

  keys.forEach((key) => {
    const previousValue = (previous as unknown as Record<string, unknown>)[key];
    const hasNextValue = Object.prototype.hasOwnProperty.call(next, key);
    const nextValue = hasNextValue
      ? (next as unknown as Record<string, unknown>)[key]
      : null;

    if (!areSettingsValuesEqual(previousValue, nextValue)) {
      (patch as Record<string, unknown>)[key] = nextValue ?? null;
    }
  });

  return patch;
};

const isMissingUserDataResourceError = (error: any): boolean =>
  error?.code === '42P01' || error?.code === '42703';

const CACHE_PREFIX = 'dayflow_cache';
const CACHE_VERSION = 'v2';
const CACHE_KEYS = [
  'events',
  'todoLists',
  'todoTabs',
  'todos',
  'todoSteps',
  'entries',
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
    .sort((left, right) => getChatSessionActivityTime(right) - getChatSessionActivityTime(left))
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
          action: message.action || undefined,
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

const VALID_VIEWS: ViewState[] = ['calendar', 'todo', 'journal', 'chat', 'support'];

const normalizeView = (rawView: string | null): ViewState => {
  if (!rawView) return 'chat';

  // Backward-compat aliases from older URLs.
  const aliased =
    rawView === 'dashboard' || rawView === 'board' ? 'chat'
      : rawView === 'settings' || rawView === 'api-settings' || rawView === 'personas' ? 'chat'
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
          <h2 className="text-lg font-medium text-[#37352f]">화면을 불러오는 중 오류가 발생했습니다.</h2>
          <p className="text-sm text-[#787774]">다른 섹션으로 이동하거나 채팅 화면으로 복구해 주세요.</p>
          <button
            type="button"
            onClick={this.props.onRecover}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-[#e9e9e8] bg-[#f7f7f7] text-[#171717] text-sm font-normal hover:bg-[#eeeeee] transition-colors"
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
  const todoMutationVersionRef = useRef(0);
  const settingsSyncBaselineRef = useRef<AppSettings>({ ...DEFAULT_SETTINGS });
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [currentView, setCurrentView] = useState<ViewState>(() => resolveViewFromUrl());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileAccountMenuOpen, setIsMobileAccountMenuOpen] = useState(false);
  useBackLayer(isMobileMenuOpen, () => setIsMobileMenuOpen(false));
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [isHideSettingsTabs, setIsHideSettingsTabs] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // null: closed, 'new': creating, otherwise the id of the tag being edited
  const [calendarTagModal, setCalendarTagModal] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const sidebarProfileButtonRef = useRef<HTMLButtonElement>(null);
  const [sidebarPanelSlot, setSidebarPanelSlot] = useState<HTMLDivElement | null>(null);
  const mobileAccountMenuButtonRef = useRef<HTMLButtonElement>(null);

  const openSettingsModal = useCallback((tab: SettingsTab = 'account', hideTabs: boolean = false) => {
    setSettingsTab(tab);
    setIsHideSettingsTabs(hideTabs);
    setIsSettingsModalOpen(true);
    setIsUserMenuOpen(false);
  }, []);

  useEffect(() => {
    console.log(`[App] v2.5 booting id=${bootId}...`);
    if (import.meta.env.DEV && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()))
        .catch(() => {
          // Ignore development-only service worker cleanup failures.
        });
    }
    // Remove legacy unscoped cache keys to prevent cross-account data bleed.
    CACHE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(`${CACHE_PREFIX}_${key}`);
      } catch {
        // Ignore storage failures.
      }
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSettingsModalOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsModalOpen]);

  useEffect(() => {
    if (!isAuthModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isAuthModalOpen]);

  useEffect(() => () => {
    if (fetchRetryTimerRef.current) {
      window.clearTimeout(fetchRetryTimerRef.current);
      fetchRetryTimerRef.current = null;
    }
    if (latestSessionUserIdRef.current) {
      clearUserSyncState(latestSessionUserIdRef.current);
    }
  }, []);

  const markTodoDataMutated = useCallback(() => {
    todoMutationVersionRef.current += 1;
  }, []);

  // App Data State
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todoLists, setTodoLists] = useState<TodoList[]>(DEFAULT_TODO_LISTS);
  const [todoTabs, setTodoTabs] = useState<TodoTab[]>(DEFAULT_TODO_TABS);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todoSteps, setTodoSteps] = useState<TodoStep[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [aiAgents, setAiAgents] = useState<AIAgent[]>(DEFAULT_AGENTS);

  // Activity Log & Settings
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [personaMemories, setPersonaMemories] = useState<PersonaMemory[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [activeChatAgentIds, setActiveChatAgentIds] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULT_SETTINGS }));
  const [todayDate, setTodayDate] = useState<string>(() => getTodayDate());
  const routineListIds = useMemo(() => getRoutineListIds(todoLists, todoTabs), [todoLists, todoTabs]);
  const effectiveTodos = useMemo(
    () => todos.map(todo => getTodoWithRoutineState(todo, settings, routineListIds, todayDate)),
    [todos, settings.routineProgress, routineListIds, todayDate]
  );

  const [calendarTags, setCalendarTags] = useState<CalendarTag[]>(DEFAULT_TAGS);
  const [visibleCalendarTagIds, setVisibleCalendarTagIds] = useState<string[]>(() => DEFAULT_TAGS.map(tag => tag.id));
  const [journalCategories, setJournalCategories] = useState<JournalCategory[]>([]);

  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedJournalCategory, setSelectedJournalCategory] = useState<string>('메모장');
  const [journalSearchQuery, setJournalSearchQuery] = useState('');
  const [isAddingJournalCategory, setIsAddingJournalCategory] = useState(false);
  const [journalCategoryInput, setJournalCategoryInput] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [activeCategoryMenu, setActiveCategoryMenu] = useState<string | null>(null);

  const primaryActiveChatAgentId = activeChatAgentIds[0] || aiAgents[0]?.id || 'ARIA';

  useEffect(() => {
    setVisibleCalendarTagIds(prev => {
      const availableIds = calendarTags.map(tag => tag.id);
      const availableSet = new Set(availableIds);
      const keptIds = prev.filter(id => availableSet.has(id));
      const addedIds = availableIds.filter(id => !prev.includes(id));
      const next = [...keptIds, ...addedIds];

      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }

      return next;
    });
  }, [calendarTags]);

  const visibleCalendarTagSet = useMemo(
    () => new Set(visibleCalendarTagIds),
    [visibleCalendarTagIds]
  );
  const filteredCalendarEvents = useMemo(
    () => events.filter(event => visibleCalendarTagSet.has(event.type)),
    [events, visibleCalendarTagSet]
  );
  const toggleCalendarTagFilter = useCallback((tagId: string) => {
    setVisibleCalendarTagIds(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  }, []);


  // Undo Toast
  const undoRef = useRef<null | (() => void)>(null);
  const [undoToast, setUndoToast] = useState<{ id: string; label: string } | null>(null);
  const recentChatObservationsRef = useRef<ChatObservation[]>([]);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const storedTheme = settings.theme || DEFAULT_THEME;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, storedTheme);
    } catch {
      // Ignore storage failures.
    }

    applyThemeToDocument(storedTheme);

    if (storedTheme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = () => applyThemeToDocument('system');

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleThemeChange);
      return () => media.removeEventListener('change', handleThemeChange);
    }

    media.addListener(handleThemeChange);
    return () => media.removeListener(handleThemeChange);
  }, [settings.theme]);

  useEffect(() => {
    const syncTodayDate = () => {
      const nextDate = getTodayDate();
      setTodayDate(prev => (prev === nextDate ? prev : nextDate));
    };

    syncTodayDate();

    let timeoutId: number | null = null;

    const scheduleNextSync = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 1, 0);
      const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

      timeoutId = window.setTimeout(() => {
        syncTodayDate();
        scheduleNextSync();
      }, delay);
    };

    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        syncTodayDate();
      }
    };

    scheduleNextSync();
    window.addEventListener('focus', syncTodayDate);
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('focus', syncTodayDate);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
  }, []);

  const appendChatObservation = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    recentChatObservationsRef.current = [
      ...recentChatObservationsRef.current,
      { text: trimmed.slice(0, 280), timestamp: new Date().toISOString() }
    ].slice(-30);
  };

  const capturePersonaMemoriesFromUserMessage = (text: string, targetAgentIds: string[]) => {
    if (!currentUser?.id) return;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const explicitMemoryText = extractExplicitMemoryText(trimmedText);
    if (!explicitMemoryText) return;

    const availableAgentIdSet = new Set(aiAgents.map((agent) => agent.id));
    const scopedAgentIds = dedupeAgentIds(targetAgentIds).filter((agentId) => availableAgentIdSet.has(agentId));
    if (scopedAgentIds.length === 0) return;

    const bucketCandidates: Record<ManagedPersonaMemoryBucketKey, string[]> = {
      instructions: [],
      facts: [],
      preferences: [],
      goals: [],
    };

    const explicitBucket = inferMemoryBucketForText(explicitMemoryText);
    bucketCandidates[explicitBucket] = dedupeMemoryItems(
      [explicitMemoryText],
      PERSONA_MEMORY_CAPTURE_PER_TYPE_LIMIT
    );

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

      const bucketEntries = Object.entries(bucketCandidates) as Array<[ManagedPersonaMemoryBucketKey, string[]]>;
      for (const agentId of scopedAgentIds) {
        for (const [bucketKey, items] of bucketEntries) {
          const memoryType = memoryBucketKeyToType(bucketKey);
          for (const sentence of items) {
            const normalizedContent = truncateMemoryText(sentence, PERSONA_MEMORY_MAX_CONTENT_CHARS);
            const normalizedKey = normalizeMemoryKey(normalizedContent);
            if (!normalizedContent || !normalizedKey) continue;
            const persistedKey = `${bucketKey === 'instructions' ? 'instruction' : memoryType}:${normalizedKey}`;
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
    setUndoToast(null);
    recentChatObservationsRef.current = [];
    settingsSyncBaselineRef.current = { ...DEFAULT_SETTINGS };
  };

  const hydrateFromLocalCache = (userId: string) => {
    const cachedEvents = readCacheState<CalendarEvent[]>(userId, 'events', []);
    const cachedTodoTabs = readCacheState<TodoTab[]>(userId, 'todoTabs', DEFAULT_TODO_TABS);
    const cachedTodoLists = readCacheState<TodoList[]>(userId, 'todoLists', DEFAULT_TODO_LISTS);
    const cachedTodoSteps = readCacheState<TodoStep[]>(userId, 'todoSteps', []);
    const cachedTodos = readCacheState<Todo[]>(userId, 'todos', []);
    const cachedEntries = readCacheState<JournalEntry[]>(userId, 'entries', []);
    const cachedAgentsRaw = readCacheState<AIAgent[]>(userId, 'aiAgents', DEFAULT_AGENTS);
    const normalizedAgents = (cachedAgentsRaw.length > 0 ? cachedAgentsRaw : DEFAULT_AGENTS).map((agent, idx) => normalizeAIAgent(agent, idx));
    const cachedActivityLog = readCacheState<ActivityItem[]>(userId, 'activityLog', []);
    const cachedSettings = readCacheState<AppSettings>(userId, 'settings', DEFAULT_SETTINGS);
    const cachedTags = readCacheState<CalendarTag[]>(userId, 'calendarTags', DEFAULT_TAGS);
    const cachedCategories = readCacheState<JournalCategory[]>(userId, 'journalCategories', []);
    const cachedPersonaMemories = readCacheState<PersonaMemory[]>(userId, 'personaMemories', []);

    setEvents(cachedEvents.map(normalizeCachedCalendarEvent));
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
    setAiAgents(normalizedAgents);
    setChatSessions([]);
    setPersonaMemories(
      Array.isArray(cachedPersonaMemories)
        ? cachedPersonaMemories
          .map((memory) => normalizePersonaMemory(memory, userId))
          .filter(Boolean) as PersonaMemory[]
        : []
    );
    setActivityLog(cachedActivityLog);
    setSettings({ ...DEFAULT_SETTINGS, ...withoutLegacyAiAutomationSetting(cachedSettings) });
    setCalendarTags(cachedTags.length > 0 ? normalizeDefaultCalendarTagColors(cachedTags) : DEFAULT_TAGS);
    setJournalCategories(cachedCategories);
  };

  const hydrateChatSessionsFromIndexedCache = async (userId: string) => {
    const cachedSessions = await loadChatSessionsCache(userId);
    // IndexedDB is only a fast, offline-friendly placeholder. Never let a
    // delayed cache read replace the authoritative chat state from Supabase.
    if (
      !cachedSessions ||
      latestSessionUserIdRef.current !== userId ||
      hasSuccessfulServerHydrationRef.current
    ) return;
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
        const previousUserId = latestSessionUserIdRef.current;
        const isDifferentUser = previousUserId !== user.id;
        latestSessionUserIdRef.current = user.id;
        skipSyncRef.current = true;
        hasSuccessfulServerHydrationRef.current = false;
        clearUserSyncState(user.id);
        if (previousUserId && previousUserId !== user.id) {
          clearUserSyncState(previousUserId);
        }
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
          resetRoutineCompletedStatus();
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
      if (previousUserId) clearUserSyncState(previousUserId);
      setIsDataLoaded(false);
      resetAppDataState();
    },
    onBeforeSignOut: () => {
      console.log('[App] onBeforeSignOut event');
      const activeUserId = latestSessionUserIdRef.current;
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
      if (activeUserId) clearUserSyncState(activeUserId);
    },
  });

  const openAuthModal = useCallback((mode: 'login' | 'signup' = 'login') => {
    setAuthMode(mode);
    setIsMobileMenuOpen(false);
    setIsAuthModalOpen(true);
  }, [setAuthMode]);

  const requireAuth = useCallback(() => {
    if (currentUser) return true;
    openAuthModal('login');
    return false;
  }, [currentUser, openAuthModal]);

  useEffect(() => {
    if (currentUser) setIsAuthModalOpen(false);
  }, [currentUser]);

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
      const settingsPatch = buildSettingsPatch(settingsSyncBaselineRef.current, settings);
      settingsSyncBaselineRef.current = settings;
      if (skipSyncRef.current) return;
      if (Object.keys(settingsPatch).length === 0) return;
      syncUserData(currentUser.id, {
        settingsPatch,
        settingsSnapshot: settings,
      });
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
      if (consumeBackLayerCleanupPop()) return;
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
    if (!isMobileMenuOpen) {
      setIsMobileAccountMenuOpen(false);
    }
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
    setPersonaMemories(prev => {
      const next = prev.filter((memory) => agentIdSet.has(memory.agentId));
      return next.length === prev.length ? prev : next;
    });
  }, [aiAgents]);
  useEffect(() => {
    const memoryIdSet = new Set(personaMemories.map((memory) => memory.id));
    setSettings((prev) => {
      const pinnedIds = prev.pinnedPersonaMemoryIds || [];
      const nextPinnedIds = pinnedIds.filter((memoryId) => memoryIdSet.has(memoryId));
      if (pinnedIds.length === nextPinnedIds.length) return prev;
      return {
        ...prev,
        pinnedPersonaMemoryIds: nextPinnedIds,
      };
    });
  }, [personaMemories]);
  useEffect(() => {
    const validAgentIds = new Set(aiAgents.map((agent) => agent.id));
    setSettings((prev) => {
      let changed = false;
      const nextProfiles = Object.fromEntries(
        Object.entries(prev.agentProfiles || {}).filter(([agentId]) => {
          const keep = validAgentIds.has(agentId);
          if (!keep) changed = true;
          return keep;
        })
      );
      const nextUsage = Object.fromEntries(
        Object.entries(prev.agentUsageById || {}).filter(([agentId]) => {
          const keep = validAgentIds.has(agentId);
          if (!keep) changed = true;
          return keep;
        })
      );
      if (!changed) return prev;
      return {
        ...prev,
        agentProfiles: nextProfiles,
        agentUsageById: nextUsage,
      };
    });
  }, [aiAgents]);
  useEffect(() => {
    const validConnectionIds = new Set((settings.apiConnections || []).map(connection => connection.id));
    setAiAgents(prev => {
      let changed = false;
      const next = prev.map(agent => {
        if (!agent.connectionId || validConnectionIds.has(agent.connectionId)) return agent;
        changed = true;
        return { ...agent, connectionId: undefined };
      });
      return changed ? next : prev;
    });
  }, [settings.apiConnections]);
  useEffect(() => {
    if (!activeChatSessionId) return;
    if (chatSessions.some(session => session.id === activeChatSessionId)) return;
    setActiveChatSessionId(null);
  }, [activeChatSessionId, chatSessions]);
  useEffect(() => {
    if (!activeChatSessionId) return;
    const activeSession = chatSessions.find(session => session.id === activeChatSessionId);
    if (!activeSession) return;

    const resolvedAgentIds = resolveSessionAgentIds(activeSession, aiAgents, activeChatAgentIds);
    if (resolvedAgentIds.length === 0) return;
    setActiveChatAgentIds(prev => (isSameAgentIdList(prev, resolvedAgentIds) ? prev : resolvedAgentIds));
  }, [activeChatSessionId, chatSessions, aiAgents]);
  const normalizeAgentCollection = (sourceAgents: AIAgent[]) =>
    (sourceAgents.length > 0 ? sourceAgents : DEFAULT_AGENTS).map((agent, index) =>
      normalizeAIAgent(agent, index)
    );

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
    let finalNormalizedTodos: Todo[] = [];
    let finalNormalizedLists: TodoList[] = [];
    let skipFetchedTodoStateApply = false;
    const todoMutationVersionAtFetchStart = todoMutationVersionRef.current;

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
      skipFetchedTodoStateApply = todoMutationVersionRef.current !== todoMutationVersionAtFetchStart;
      if (skipFetchedTodoStateApply) {
        console.warn('[App] Skipping stale fetched todo state because local todo data changed during fetch.');
      }

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
        isMissingUserDataResourceError(userDataRes?.error) ? null : userDataRes?.error,
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
      const dbUserData = isMissingUserDataResourceError(userDataRes?.error) ? null : userDataRes?.data;
      const isChatTableUnavailable = (errorCode?: string) => errorCode === '42P01' || errorCode === '42703';
      const chatSessionsTableUnavailable = isChatTableUnavailable(chatSessionsRes?.error?.code);
      const chatMessagesTableUnavailable = isChatTableUnavailable(chatMessagesRes?.error?.code);
      const canHydrateChatFromTables =
        !chatSessionsTableUnavailable &&
        !chatMessagesTableUnavailable &&
        !chatSessionsRes?.error &&
        !chatMessagesRes?.error;
      const dbChatSessions = chatSessionsTableUnavailable ? [] : chatSessionsRes?.data;
      const dbChatMessages = chatMessagesTableUnavailable ? [] : chatMessagesRes?.data;

      if (!skipFetchedTodoStateApply && dbTodoTabs && dbTodoTabs.length > 0) {
        setTodoTabs(dbTodoTabs.map((tab: any) => ({
          id: tab.id,
          name: normalizeKoreanText(tab.name),
          color: tab.color,
          order: tab.order
        })));
      } else if (!skipFetchedTodoStateApply && dbTodoTabs && dbTodoTabs.length === 0) {
        setTodoTabs(DEFAULT_TODO_TABS);
      }

      if (!skipFetchedTodoStateApply && dbTodoLists && dbTodoLists.length > 0) {
        finalNormalizedLists = normalizeTodoLists(dbTodoLists.map((list: any) => ({
          ...list,
          title: normalizeKoreanText(list.title),
          dueDate: list.due_date || undefined,
          tabId: list.tab_id || (list.type === 'project' ? 'tab_project' : 'tab_todo')
        })));
        setTodoLists(finalNormalizedLists);
      } else if (!skipFetchedTodoStateApply && dbTodoLists && dbTodoLists.length === 0) {
        finalNormalizedLists = DEFAULT_TODO_LISTS;
        setTodoLists(finalNormalizedLists);
      }

      if (!skipFetchedTodoStateApply && dbTodos) {
        finalNormalizedTodos = dbTodos.map((t: any) => {
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
        });
        setTodos(finalNormalizedTodos);
      }

      if (!skipFetchedTodoStateApply && dbTodoSteps) setTodoSteps(dbTodoSteps.map((s: any) => ({
        id: s.id,
        listId: normalizeTodoListId(s.list_id) || DEFAULT_TODO_LIST_ID,
        title: normalizeKoreanText(s.title),
        order: s.order
      } as TodoStep)));

      if (dbEvents) setEvents(dbEvents.map((e: any) => {
        const { date: startDate, time: startTimeRaw } = parseStoredTimestampParts(e.start_time);
        const { date: endDate, time: endTimeRaw } = parseStoredTimestampParts(e.end_time);
        const hasExplicitStartTime = Boolean(startTimeRaw && startTimeRaw !== '00:00:00');
        const hasExplicitEndTime = Boolean(endTimeRaw && endTimeRaw !== '23:59:59');
        return {
          id: e.id,
          title: normalizeKoreanText(e.title),
          date: startDate,
          endDate: endDate || startDate,
          startTime: hasExplicitStartTime ? startTimeRaw.substring(0, 5) : undefined,
          endTime: hasExplicitEndTime ? endTimeRaw.substring(0, 5) : undefined,
          isAllDay: !hasExplicitStartTime && !hasExplicitEndTime,
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
        if (Array.isArray(dbUserData.calendar_tags) && dbUserData.calendar_tags.length > 0) {
          setCalendarTags(normalizeDefaultCalendarTagColors(dbUserData.calendar_tags));
        }
        if (dbUserData.settings) {
          setSettings(prev => ({
            ...DEFAULT_SETTINGS,
            ...prev,
            ...withoutLegacyAiAutomationSetting(dbUserData.settings),
          }));
        }
      }

      if (canHydrateChatFromTables) {
        // An empty server result is authoritative too. Without this, an old
        // IndexedDB snapshot can survive a refresh and later overwrite sync.
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
      let dbPersonaMemories: any[] | null = null;

      try {
        const fetchSecondary = Promise.race([
          Promise.all([
            supabase.from('journal_categories').select('*').eq('user_id', userId),
            supabase.from('journal_entries').select('*').eq('user_id', userId).order('date', { ascending: false }),
            supabase.from('ai_agents').select('*').eq('user_id', userId).order('order'),
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
          personaMemoriesRes
        ] = secondaryResults;
        const isPersonaMemoryTableUnavailable = (errorCode?: string) => errorCode === '42P01' || errorCode === '42703';

        const secondaryErrors = [
          journalCategoriesRes?.error,
          journalEntriesRes?.error,
          aiAgentsRes?.error,
          isPersonaMemoryTableUnavailable(personaMemoriesRes?.error?.code) ? null : personaMemoriesRes?.error,
        ].filter(Boolean);
        if (secondaryErrors.length > 0) {
          console.warn('[App] fetchSecondary returned errors:', secondaryErrors);
        }

        dbJournalCategories = journalCategoriesRes?.data || null;
        dbJournalEntries = journalEntriesRes?.data || null;
        dbAiAgents = aiAgentsRes?.data || null;
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
        if (Array.isArray(dbPersonaMemories)) {
          const mappedMemories = (dbPersonaMemories
            .filter((row: any) => row?.agent_id && row?.memory_type && row?.memory_key && row?.content)
            .map((row: any) => normalizePersonaMemory(row, userId))
            .filter(Boolean) as PersonaMemory[])
            .slice(0, 500);
          setPersonaMemories(mappedMemories);
          seedSyncSnapshot('persona_memories', userId, mappedMemories.map((memory) => memory.id));
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
        if (!skipFetchedTodoStateApply) {
          resetRoutineCompletedStatus(finalNormalizedTodos, finalNormalizedLists, true);
        }
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

  useEffect(() => {
    if (!isDataLoaded) return;

    resetRoutineCompletedStatus();
  }, [isDataLoaded, todayDate, currentUser?.id, settings.lastRoutineResetDate, todos, todoLists, todoTabs]);

  const persistTodoTabsForUser = async (userId: string, tabsToPersist: TodoTab[]): Promise<any> => {
    if (tabsToPersist.length === 0) return null;
    const rows = tabsToPersist.map(tab => ({
      id: tab.id,
      user_id: userId,
      name: tab.name,
      color: tab.color,
      "order": tab.order,
    }));
    const { error } = await supabase.from('todo_tabs').upsert(rows, { onConflict: 'id' });
    if (error) {
      console.warn('[Todo] Failed to persist todo tabs before saving dependent data:', error);
    }
    return error;
  };

  const persistTodoListsForUser = async (userId: string, listsToPersist: TodoList[]): Promise<any> => {
    if (listsToPersist.length === 0) return null;
    const relatedTabIds = new Set(listsToPersist.map(list => list.tabId).filter(Boolean) as string[]);
    const tabsToPersist = [...relatedTabIds]
      .map(tabId => todoTabs.find(tab => tab.id === tabId) || DEFAULT_TODO_TABS.find(tab => tab.id === tabId))
      .filter(Boolean) as TodoTab[];

    await persistTodoTabsForUser(userId, tabsToPersist);

    const rows = listsToPersist.map(list => ({
      id: normalizeTodoListId(list.id) || DEFAULT_TODO_LIST_ID,
      user_id: userId,
      title: list.title,
      "order": list.order,
      tab_id: list.tabId || null,
      due_date: list.dueDate || null,
    }));
    const { error } = await retryTodoListUpsertWithFallback(rows);
    if (error) {
      console.warn('[Todo] Failed to persist todo lists before saving dependent data:', error);
    }
    return error;
  };

  const ensureTodoListPersisted = async (listId?: string): Promise<any> => {
    if (!currentUser) return null;
    const normalizedListId = normalizeTodoListId(listId) || DEFAULT_TODO_LIST_ID;
    const listToPersist =
      todoLists.find(list => normalizeTodoListId(list.id) === normalizedListId) ||
      DEFAULT_TODO_LISTS.find(list => list.id === normalizedListId) ||
      DEFAULT_TODO_LISTS[0];

    return persistTodoListsForUser(currentUser.id, [listToPersist]);
  };

  const addTodoList = async (title: string, tabId: string, dueDate?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    markTodoDataMutated();
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
      const tabToPersist = todoTabs.find(tab => tab.id === newList.tabId) || DEFAULT_TODO_TABS.find(tab => tab.id === newList.tabId);
      await persistTodoTabsForUser(currentUser.id, tabToPersist ? [tabToPersist] : []);
      const { error } = await retryTodoListUpsertWithFallback([{
        id: newList.id,
        user_id: currentUser.id,
        title: newList.title,
        "order": newList.order,
        tab_id: newList.tabId,
        due_date: newList.dueDate || null,
      }]);
      if (error) {
        setTodoLists(prev => prev.filter(list => list.id !== newList.id));
        alert(`목록을 저장하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
    }
  };

  const addTodoTab = async (name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    markTodoDataMutated();
    const nextOrder = Math.max(0, ...todoTabs.map(t => t.order)) + 1;
    const newTab: TodoTab = {
      id: crypto.randomUUID(),
      name: trimmed,
      color,
      order: nextOrder
    };
    setTodoTabs(prev => [...prev, newTab]);
    if (currentUser) {
      const { error } = await supabase.from('todo_tabs').insert([{
        id: newTab.id,
        user_id: currentUser.id,
        name: newTab.name,
        color: newTab.color,
        "order": newTab.order
      }]);
      if (error) {
        setTodoTabs(prev => prev.filter(tab => tab.id !== newTab.id));
        alert(`탭을 저장하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
    }
  };

  const updateTodoTab = async (id: string, updates: Partial<TodoTab>) => {
    markTodoDataMutated();
    const previousTabs = todoTabs;
    setTodoTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (currentUser) {
      const { error } = await supabase.from('todo_tabs').update(updates).eq('id', id);
      if (error) {
        setTodoTabs(previousTabs);
        alert(`탭을 수정하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
    }
  };

  const deleteTodoTab = async (id: string) => {
    if (window.confirm('이 탭을 삭제할까요? 관련 목록은 삭제되지 않지만 다른 탭으로 이동해야 할 수도 있습니다.')) {
      if (todoTabs.length <= 1) {
        alert('마지막 탭은 삭제할 수 없습니다.');
        return;
      }

      const previousTabs = todoTabs;
      const previousLists = todoLists;
      markTodoDataMutated();
      const fallbackTabId = todoTabs.find(tab => tab.id !== id)?.id;
      if (!fallbackTabId) {
        alert('이동할 다른 탭을 찾지 못했습니다.');
        return;
      }

      const affectedListIds = todoLists.filter(list => list.tabId === id).map(list => list.id);
      setTodoTabs(prev => prev.filter(t => t.id !== id));
      setTodoLists(prev => prev.map(list => (
        list.tabId === id ? { ...list, tabId: fallbackTabId } : list
      )));

      if (currentUser) {
        if (affectedListIds.length > 0) {
          const { error: listUpdateError } = await supabase
            .from('todo_lists')
            .update({ tab_id: fallbackTabId })
            .in('id', affectedListIds);
          if (listUpdateError) {
            setTodoTabs(previousTabs);
            setTodoLists(previousLists);
            alert(`탭 이동 처리를 완료하지 못했습니다: ${getSupabaseErrorMessage(listUpdateError, '알 수 없는 오류')}`);
            return;
          }
        }

        const { error } = await supabase.from('todo_tabs').delete().eq('id', id);
        if (error) {
          setTodoTabs(previousTabs);
          setTodoLists(previousLists);
          alert(`탭을 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        }
      }
    }
  };

  const addTodoStep = async (title: string, listId: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const normalizedListId = normalizeTodoListId(listId) || DEFAULT_TODO_LIST_ID;
    markTodoDataMutated();
    const nextOrder = Math.max(0, ...todoSteps.filter(s => s.listId === normalizedListId).map(s => s.order)) + 1;
    const newStep: TodoStep = {
      id: crypto.randomUUID(),
      listId: normalizedListId,
      title: trimmed,
      order: nextOrder
    };
    setTodoSteps(prev => [...prev, newStep]);
    if (currentUser) {
      const listError = await ensureTodoListPersisted(normalizedListId);
      if (listError) {
        setTodoSteps(prev => prev.filter(step => step.id !== newStep.id));
        alert(`단계를 저장하지 못했습니다: ${getSupabaseErrorMessage(listError, '목록 저장 오류')}`);
        return;
      }
      // Upsert: the background step sync may have saved this row while the list was being persisted.
      const { error } = await supabase.from('todo_steps').upsert([{
        id: newStep.id,
        user_id: currentUser.id,
        list_id: newStep.listId,
        title: newStep.title,
        "order": newStep.order
      }], { onConflict: 'id' });
      if (error) {
        setTodoSteps(prev => prev.filter(step => step.id !== newStep.id));
        alert(`단계를 저장하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
      }
    }
  };

  const updateTodoStep = async (id: string, updates: Partial<TodoStep>) => {
    markTodoDataMutated();
    const previousSteps = todoSteps;
    setTodoSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    if (currentUser) {
      const { error } = await supabase.from('todo_steps').update(updates).eq('id', id);
      if (error) {
        setTodoSteps(previousSteps);
        alert(`단계를 수정하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
    }
  };

  const deleteTodoStep = async (id: string) => {
    if (!window.confirm('이 단계를 삭제하시겠습니까? 관련 할 일들은 해제됩니다.')) return;
    const previousSteps = todoSteps;
    const previousTodos = todos;
    markTodoDataMutated();
    setTodoSteps(prev => prev.filter(s => s.id !== id));
    setTodos(prev => prev.map(t => t.stepId === id ? { ...t, stepId: undefined } : t));

    if (currentUser) {
      const { error: todoError } = await supabase.from('todos').update({ step_id: null }).eq('step_id', id);
      if (todoError) {
        setTodoSteps(previousSteps);
        setTodos(previousTodos);
        alert(`단계 연결을 해제하지 못했습니다: ${getSupabaseErrorMessage(todoError, '알 수 없는 오류')}`);
        return;
      }

      const { error } = await supabase.from('todo_steps').delete().eq('id', id);
      if (error) {
        setTodoSteps(previousSteps);
        setTodos(previousTodos);
        alert(`단계를 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
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

  const updateAiAgent = async (id: string, updates: Partial<AIAgent>) => {
    const currentAgent = aiAgents.find(a => a.id === id);
    if (!currentAgent) return;

    const mergedAgent = normalizeAIAgent({
      ...currentAgent,
      ...(settings.agentProfiles?.[id] || {}),
      ...updates,
    });
    const normalizedAgent = await normalizeAgentAvatarForSave(mergedAgent, currentAgent.avatar);
    const profileSettings = getAgentProfileSettings(normalizedAgent);
    setAiAgents(prev => normalizeAgentCollection(
      prev.map(agent => agent.id === id ? normalizedAgent : agent)
    ));
    setSettings(prev => {
      const nextProfiles = { ...(prev.agentProfiles || {}) };
      if (isAgentProfileSettingsEmpty(profileSettings)) delete nextProfiles[id];
      else nextProfiles[id] = profileSettings;
      return {
        ...prev,
        agentProfiles: nextProfiles,
      };
    });
  };

  const deleteAiAgent = async (id: string) => {
    const agent = aiAgents.find(a => a.id === id);
    if (!agent) return;
    if (aiAgents.length <= 1) {
      alert('최소 한 개의 페르소나는 유지해야 합니다.');
      return;
    }

    if (window.confirm(`'${agent.name}' 페르소나를 삭제하시겠습니까?`)) {
      const nextAgents = normalizeAgentCollection(aiAgents.filter(a => a.id !== id));
      setAiAgents(nextAgents);
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
    const previousLists = todoLists;
    const currentList = todoLists.find(list => list.id === id);
    if (!currentList) return;
    markTodoDataMutated();
    const nextList = { ...currentList, ...updates };
    setTodoLists(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    if (currentUser) {
      const tabToPersist = todoTabs.find(tab => tab.id === nextList.tabId) || DEFAULT_TODO_TABS.find(tab => tab.id === nextList.tabId);
      await persistTodoTabsForUser(currentUser.id, tabToPersist ? [tabToPersist] : []);
      const { error } = await retryTodoListUpsertWithFallback([{
        id: normalizeTodoListId(nextList.id) || DEFAULT_TODO_LIST_ID,
        user_id: currentUser.id,
        title: nextList.title,
        "order": nextList.order,
        tab_id: nextList.tabId || null,
        due_date: nextList.dueDate || null,
      }]);
      if (error) {
        setTodoLists(previousLists);
        alert(`목록을 수정하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
      }
    }
  };

  const updateTodoListOrder = (newLists: TodoList[]) => {
    markTodoDataMutated();
    setTodoLists(newLists);
  };

  const deleteTodoList = async (id: string) => {
    const list = todoLists.find(l => l.id === id);
    if (!list) return;

    if (window.confirm(`'${list.title}' 목록을 삭제하시겠습니까? 포함된 할 일도 모두 삭제됩니다.`)) {
      const previousLists = todoLists;
      const previousTodos = todos;
      const previousSteps = todoSteps;
      const previousRoutineProgress = settings.routineProgress;
      const removedTodoIds = todos.filter(todo => todo.listId === id).map(todo => todo.id);

      markTodoDataMutated();
      setTodoLists(prev => prev.filter(l => l.id !== id));
      setTodos(prev => prev.filter(t => t.listId !== id));
      setTodoSteps(prev => prev.filter(step => step.listId !== id));
      removeRoutineProgressForTodoIds(removedTodoIds);

      if (currentUser) {
        const { error: todoError } = await supabase.from('todos').delete().eq('list_id', id);
        if (todoError) {
          setTodoLists(previousLists);
          setTodos(previousTodos);
          setTodoSteps(previousSteps);
          setSettings(prev => ({ ...prev, routineProgress: previousRoutineProgress || {} }));
          alert(`목록의 할 일을 삭제하지 못했습니다: ${getSupabaseErrorMessage(todoError, '알 수 없는 오류')}`);
          return;
        }

        const { error } = await supabase.from('todo_lists').delete().eq('id', id);
        if (error) {
          setTodoLists(previousLists);
          setTodos(previousTodos);
          setTodoSteps(previousSteps);
          setSettings(prev => ({ ...prev, routineProgress: previousRoutineProgress || {} }));
          alert(`목록을 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        }
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
    a.download = `dayflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAllData = async () => {
    const confirmed = window.confirm('모든 기록을 삭제할까요? (일정/할 일/메모/채팅/활동 기록)\n이 작업은 되돌릴 수 없습니다.');
    if (!confirmed) return;

    if (currentUser) {
      try {
        const userId = currentUser.id;
        clearUserSyncState(userId);
        const safeDeleteByUser = async (table: string) => {
          const result = await supabase.from(table).delete().eq('user_id', userId);
          if (result.error && result.error.code !== '42P01') {
            throw result.error;
          }
        };

        await Promise.all([
          safeDeleteByUser('chat_messages'),
          safeDeleteByUser('chat_sessions'),
          safeDeleteByUser('persona_memories'),
          safeDeleteByUser('user_data'),
          safeDeleteByUser('ai_agents'),
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
    setAiAgents(DEFAULT_AGENTS);
    setChatSessions([]);
    setPersonaMemories([]);
    setActiveChatSessionId(null);
    setActiveChatAgentIds([]);
    setActivityLog([]);
    setCalendarTags(DEFAULT_TAGS);
    setSelectedJournalId(null);
    setSelectedJournalCategory('메모장');
    if (currentUser) {
      clearUserScopedCache(currentUser.id);
      void clearChatSessionsCache(currentUser.id);
      clearUserSyncState(currentUser.id);
    }
  };

  const handleClearActivity = () => {
    setActivityLog([]);
  };

  const handleClearEvents = () => {
    setEvents([]);
  };

  const handleClearTodos = () => {
    setTodos([]);
    setTodoSteps([]);
    setTodoLists(DEFAULT_TODO_LISTS);
    setSettings(prev => ({ ...prev, routineProgress: {} }));
  };

  const handleClearEntries = () => {
    setEntries([]);
  };

  const handleClearChat = () => {
    setChatSessions([]);
    setPersonaMemories([]);
    setActiveChatSessionId(null);
    setActiveChatAgentIds(aiAgents[0]?.id ? [aiAgents[0].id] : []);
    setSettings(prev => {
      if (!prev.pinnedPersonaMemoryIds?.length) return prev;
      return { ...prev, pinnedPersonaMemoryIds: [] };
    });
    if (currentUser) {
      const userId = currentUser.id;
      clearUserSyncState(currentUser.id);
      void clearChatSessionsCache(currentUser.id);
      const safeDeleteByUser = async (table: string) => {
        const { error } = await supabase.from(table).delete().eq('user_id', userId);
        if (error && error.code !== '42P01') throw error;
      };
      Promise.all([
        safeDeleteByUser('chat_messages'),
        safeDeleteByUser('chat_sessions'),
        safeDeleteByUser('persona_memories'),
      ]).catch((error) => {
        console.error('Failed to clear chat data:', error);
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
      const { error } = await supabase.from('calendar_events').insert([{
        id: event.id,
        user_id: currentUser.id,
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: endDate + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
        description: event.description,
        color: calendarTags.find(t => t.id === event.type)?.color || '#4c2889',
        tags: [event.type]
      }]);
      if (error) {
        setEvents(prev => prev.filter(existing => existing.id !== event.id));
        alert(`일정을 저장하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        return;
      }
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
    const previousEvents = events;
    setEvents(prev => prev.map(e => e.id === event.id ? event : e));
    const endDate = event.endDate || event.date;
    const previousEndDate = previous.endDate || previous.date;

    if (currentUser) {
      const { error } = await supabase.from('calendar_events').update({
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: endDate + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
        description: event.description,
        color: calendarTags.find(t => t.id === event.type)?.color || '#4c2889',
        tags: [event.type]
      }).eq('id', event.id);
      if (error) {
        setEvents(previousEvents);
        alert(`일정을 수정하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        return;
      }
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
    const previousEvents = events;

    setEvents(prev => prev.filter(e => e.id !== id));

    if (currentUser) {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id);
      if (error) {
        setEvents(previousEvents);
        alert(`일정을 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        return;
      }
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

  const updateRoutineProgressState = (
    todoId: string,
    updater: (current: RoutineProgress | undefined) => RoutineProgress | undefined,
  ) => {
    setSettings(prev => {
      const currentDate = getTodayDate();
      const nextProgress = { ...(prev.routineProgress || {}) };
      const nextValue = updater(nextProgress[todoId]);

      if (nextValue) nextProgress[todoId] = nextValue;
      else delete nextProgress[todoId];

      return {
        ...prev,
        lastRoutineResetDate: currentDate,
        routineProgress: pruneRoutineProgress(nextProgress) || {},
      };
    });
  };

  const removeRoutineProgressForTodoIds = (todoIds: string[]) => {
    if (todoIds.length === 0) return;

    const idSet = new Set(todoIds);
    setSettings(prev => {
      const nextProgress = { ...(prev.routineProgress || {}) };
      let changed = false;

      idSet.forEach(todoId => {
        if (nextProgress[todoId]) {
          delete nextProgress[todoId];
          changed = true;
        }
      });

      if (!changed) return prev;

      return {
        ...prev,
        routineProgress: pruneRoutineProgress(nextProgress) || {},
      };
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

    markTodoDataMutated();
    setTodos(prev => [...prev, newTodo]);

    if (currentUser) {
      const listError = await ensureTodoListPersisted(targetListId);
      if (listError) {
        setTodos(prev => prev.filter(t => t.id !== newTodo.id));
        alert(`할 일을 저장하지 못했습니다: ${getSupabaseErrorMessage(listError, '목록 저장 오류')}`);
        return;
      }
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
    const currentTodo = todos.find(t => t.id === id);
    if (!currentTodo) return;
    markTodoDataMutated();
    const currentDate = getTodayDate();

    const currentIsRoutine = isRoutineTodo(currentTodo, routineListIds);
    const displayedCurrentTodo = currentIsRoutine
      ? getTodoWithRoutineState(currentTodo, settings, routineListIds, currentDate)
      : currentTodo;
    const nextListId = updates.listId !== undefined
      ? normalizeTodoListId(updates.listId) || undefined
      : currentTodo.listId;
    const nextTodoDraft: Todo = {
      ...displayedCurrentTodo,
      ...updates,
      listId: nextListId,
    };
    const nextIsRoutine = isRoutineTodo({ listId: nextListId }, routineListIds);

    let nextTodo = nextTodoDraft;
    let nextRoutineProgress: RoutineProgress | undefined;

    if (nextIsRoutine) {
      const routineBaseTodo = currentIsRoutine
        ? displayedCurrentTodo
        : clearTodoCompletionFlags(currentTodo);
      const displayedTodo: Todo = {
        ...routineBaseTodo,
        ...updates,
        listId: nextListId,
      };
      nextRoutineProgress = buildRoutineProgressFromDisplayedTodo(displayedTodo, currentDate);
      nextTodo = clearTodoCompletionFlags(nextTodoDraft);
    }

    setTodos(prev => prev.map(todo => (
      todo.id === id
        ? nextTodo
        : todo
    )));

    if (currentIsRoutine || nextIsRoutine) {
      updateRoutineProgressState(id, () => nextRoutineProgress);
    }

    if (currentUser) {
      const dbUpdates: any = {};
      if (updates.text !== undefined) dbUpdates.text = updates.text;
      if (updates.completed !== undefined || currentIsRoutine || nextIsRoutine) dbUpdates.completed = nextTodo.completed;
      if (updates.listId !== undefined) dbUpdates.list_id = nextListId || null;
      if (updates.stepId !== undefined) dbUpdates.step_id = updates.stepId || null;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate || null;
      if (updates.subTasks !== undefined || currentIsRoutine || nextIsRoutine) dbUpdates.sub_tasks = nextTodo.subTasks || null;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await retryTodoUpdateWithFallback(id, dbUpdates);
        if (error) {
          alert(`할 일을 수정하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
        }
      }
    }
  };

  const resetRoutineCompletedStatus = (currentTodos?: Todo[], currentLists?: TodoList[], isServerData: boolean = false) => {
    const today = getTodayDate();
    const sourceTodos = currentTodos || todos;
    const sourceLists = currentLists || todoLists;

    if (!sourceLists.length) {
      if (settings.lastRoutineResetDate !== today) {
        setSettings(prev => (
          prev.lastRoutineResetDate === today
            ? prev
            : { ...prev, lastRoutineResetDate: today }
        ));
      }
      return;
    }

    const sourceRoutineListIds = getRoutineListIds(sourceLists, todoTabs);

    if (sourceRoutineListIds.size === 0) {
      if (settings.lastRoutineResetDate !== today) {
        setSettings(prev => (
          prev.lastRoutineResetDate === today
            ? prev
            : { ...prev, lastRoutineResetDate: today }
        ));
      }
      return;
    }

    const legacyRoutineTodos = sourceTodos.filter(todo =>
      isRoutineTodo(todo, sourceRoutineListIds) &&
      (todo.completed || Boolean(todo.subTasks?.some(subTask => subTask.completed)))
    );

    if (legacyRoutineTodos.length === 0) {
      if (settings.lastRoutineResetDate !== today) {
        setSettings(prev => (
          prev.lastRoutineResetDate === today
            ? prev
            : { ...prev, lastRoutineResetDate: today }
        ));
      }
      return;
    }

    console.log(`[Routine] Reconciling ${legacyRoutineTodos.length} legacy routine states for ${today}`);

    setTodos(prev => prev.map(todo => (
      isRoutineTodo(todo, sourceRoutineListIds)
        ? clearTodoCompletionFlags(todo)
        : todo
    )));

    setSettings(prev => {
      const nextProgress = { ...(prev.routineProgress || {}) };

      if (prev.lastRoutineResetDate === today) {
        legacyRoutineTodos.forEach(todo => {
          const legacyProgress = buildRoutineProgressFromDisplayedTodo(todo, today);
          if (!legacyProgress) return;

          const existing = nextProgress[todo.id];
          nextProgress[todo.id] = {
            completedOn: legacyProgress.completedOn || existing?.completedOn,
            subTaskCompletedOn: {
              ...(existing?.subTaskCompletedOn || {}),
              ...(legacyProgress.subTaskCompletedOn || {}),
            },
          };
        });
      }

      return {
        ...prev,
        lastRoutineResetDate: today,
        routineProgress: pruneRoutineProgress(nextProgress) || {},
      };
    });

    if (currentUser) {
      legacyRoutineTodos.forEach(todo => {
        const sanitizedTodo = clearTodoCompletionFlags(todo);
        retryTodoUpdateWithFallback(todo.id, {
          completed: false,
          sub_tasks: sanitizedTodo.subTasks || null,
        }).then(({ error }) => {
          if (error) {
            console.error('[Routine] Failed to reconcile legacy routine state:', error);
          }
        });
      });
    }
  };

  const toggleTodo = async (id: string) => {
    const storedTodo = todos.find(t => t.id === id);
    const todo = effectiveTodos.find(t => t.id === id);
    if (!storedTodo || !todo) return;
    markTodoDataMutated();
    const currentDate = getTodayDate();

    const routineTodo = isRoutineTodo(storedTodo, routineListIds);
    const previousRoutineProgress = settings.routineProgress?.[id];
    const wasCompleted = todo.completed;
    const newCompleted = !wasCompleted;

    if (routineTodo) {
      const sanitizedTodo = clearTodoCompletionFlags(storedTodo);
      setTodos(prev => prev.map(t => t.id === id ? sanitizedTodo : t));
      updateRoutineProgressState(id, current => {
        const nextValue: RoutineProgress = {
          ...(current || {}),
          subTaskCompletedOn: { ...(current?.subTaskCompletedOn || {}) },
        };

        if (newCompleted) nextValue.completedOn = currentDate;
        else delete nextValue.completedOn;

        return pruneRoutineProgress({ [id]: nextValue })?.[id];
      });

      if (currentUser) {
        const { error } = await retryTodoUpdateWithFallback(id, {
          completed: false,
          sub_tasks: sanitizedTodo.subTasks || null,
        });
        if (error) {
          setTodos(prev => prev.map(t => t.id === id ? storedTodo : t));
          updateRoutineProgressState(id, () => previousRoutineProgress);
          alert(`할 일을 수정하지 못했습니다: ${error.message || '알 수 없는 오류'}`);
          return;
        }
      }
    } else {
      setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: newCompleted } : t));

      if (currentUser) {
        const { error } = await supabase.from('todos').update({ completed: newCompleted }).eq('id', id);
        if (error) {
          setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: wasCompleted } : t));
          alert(`할 일을 수정하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
          return;
        }
      }
    }

    if (newCompleted) {
      logActivity({
        type: 'todo_completed',
        label: `할 일 완료: ${todo.text}`,
        meta: { id: todo.id },
      });

      // Automatically add to calendar when completed
      const eventDate = todo.dueDate || format(new Date(), 'yyyy-MM-dd');
      const newEvent: CalendarEvent = {
        id: crypto.randomUUID(),
        title: todo.text,
        date: eventDate,
        isAllDay: true,
        type: calendarTags.find(t => t.id === 'tag_2') ? 'tag_2' : (calendarTags[0]?.id || 'tag_1'),
        description: `할 일을 완료하여 자동으로 추가된 일정입니다. [TODO_LINK:${todo.id}:${eventDate}]`
      };
      
      setEvents(prev => [...prev, newEvent]);

      logActivity({
        type: 'event_added',
        label: `일정 자동 추가: ${newEvent.title}`,
        meta: { id: newEvent.id, date: newEvent.date },
      });

      showUndo('완료 처리됨 (캘린더 추가)', async () => {
        if (routineTodo) {
          const sanitizedTodo = clearTodoCompletionFlags(storedTodo);
          setTodos(prev => prev.map(t => t.id === id ? sanitizedTodo : t));
          updateRoutineProgressState(id, current => {
            const nextValue: RoutineProgress = {
              ...(current || {}),
              subTaskCompletedOn: { ...(current?.subTaskCompletedOn || {}) },
            };
            delete nextValue.completedOn;
            return pruneRoutineProgress({ [id]: nextValue })?.[id];
          });
          if (currentUser) {
            await retryTodoUpdateWithFallback(id, {
              completed: false,
              sub_tasks: sanitizedTodo.subTasks || null,
            });
          }
        } else {
          setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: false } : t));
          if (currentUser) {
            await supabase.from('todos').update({ completed: false }).eq('id', id);
          }
        }
        
        setEvents(prev => prev.filter(e => e.id !== newEvent.id));

        logActivity({
          type: 'todo_uncompleted',
          label: `완료 취소(Undo): ${todo.text}`,
          meta: { id: todo.id },
        });
      });
    } else {
      // If unchecked, remove any automatically added calendar events for this todo ON THE SPECIFIC DATE
      const eventDate = todo.dueDate || format(new Date(), 'yyyy-MM-dd');
      const linkTag = `[TODO_LINK:${todo.id}:${eventDate}]`;
      const eventsToRemove = events.filter(e => e.description?.includes(linkTag));
      
      if (eventsToRemove.length > 0) {
        setEvents(prev => prev.filter(e => !e.description?.includes(linkTag)));
        logActivity({
          type: 'todo_uncompleted',
          label: `할 일 완료 취소: ${todo.text}`,
          meta: { id: todo.id },
        });
      }
    }
  };

  // Moves a todo to the position of another one. Persisted by syncTodos, which writes
  // each todo's array index as its `order`.
  const reorderTodo = (activeId: string, overId: string) => {
    if (activeId === overId) return;
    markTodoDataMutated();
    setTodos(prev => {
      const fromIndex = prev.findIndex(todo => todo.id === activeId);
      const toIndex = prev.findIndex(todo => todo.id === overId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const deleteTodo = async (id: string) => {
    const removed = todos.find(t => t.id === id);
    if (!removed) return;
    const removedRoutineProgress = settings.routineProgress?.[id];
    const previousTodos = todos;

    markTodoDataMutated();
    setTodos(prev => prev.filter(t => t.id !== id));
    updateRoutineProgressState(id, () => undefined);

    if (currentUser) {
      const { error } = await supabase.from('todos').delete().eq('id', id);
      if (error) {
        setTodos(previousTodos);
        if (removedRoutineProgress) {
          updateRoutineProgressState(id, () => removedRoutineProgress);
        }
        alert(`할 일을 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        return;
      }
    }

    logActivity({
      type: 'todo_deleted',
      label: `할 일 삭제: ${removed.text}`,
      meta: { id },
    });
    showUndo('할 일이 삭제됨', async () => {
      setTodos(prev => [removed, ...prev]);
      if (removedRoutineProgress) {
        updateRoutineProgressState(id, () => removedRoutineProgress);
      }
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

  const addCalendarTag = (name: string, color: string) => {
    const newTag: CalendarTag = {
      id: crypto.randomUUID(),
      name,
      color
    };
    setCalendarTags(prev => [...prev, newTag]);
  };

  const updateCalendarTag = (id: string, updates: Partial<CalendarTag>) => {
    setCalendarTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  // Events of a deleted tag move to the first remaining tag so they stay visible.
  const deleteCalendarTag = async (id: string): Promise<boolean> => {
    const fallbackTag = calendarTags.find(tag => tag.id !== id);
    if (!fallbackTag) return false;

    const affectedEvents = events.filter(event => event.type === id);
    const message = affectedEvents.length > 0
      ? `이 태그를 삭제할까요? 이 태그의 일정 ${affectedEvents.length}개는 '${fallbackTag.name}' 태그로 옮겨집니다.`
      : '이 태그를 삭제할까요?';
    if (!window.confirm(message)) return false;

    const previousTags = calendarTags;
    const previousEvents = events;
    setCalendarTags(prev => prev.filter(tag => tag.id !== id));
    if (affectedEvents.length === 0) return true;

    setEvents(prev => prev.map(event => event.type === id ? { ...event, type: fallbackTag.id } : event));
    if (currentUser) {
      const { error } = await supabase
        .from('calendar_events')
        .update({ tags: [fallbackTag.id], color: fallbackTag.color })
        .in('id', affectedEvents.map(event => event.id));
      if (error) {
        setCalendarTags(previousTags);
        setEvents(previousEvents);
        alert(`태그를 삭제하지 못했습니다: ${getSupabaseErrorMessage(error, '알 수 없는 오류')}`);
        return false;
      }
    }
    return true;
  };

  const updateAgents = async (agents: AIAgent[]) => {
    const normalized = await Promise.all(
      normalizeAgentCollection(agents).map(async (agent) => {
        const previousAgent = aiAgents.find(currentAgent => currentAgent.id === agent.id);
        return normalizeAgentAvatarForSave(agent, previousAgent?.avatar);
      })
    );
    setAiAgents(normalized);
    setSettings(prev => {
      const nextProfiles = normalized.reduce((acc, agent) => {
        const profile = getAgentProfileSettings(agent);
        if (!isAgentProfileSettingsEmpty(profile)) {
          acc[agent.id] = profile;
        }
        return acc;
      }, {} as Record<string, Partial<AIAgent>>);

      return {
        ...prev,
        agentProfiles: nextProfiles,
      };
    });
  };

  const updateUser = async (updatedUser: User) => {
    const normalizedAvatar = await normalizePersistedImageSource(updatedUser.avatar);
    const nextUser = {
      ...updatedUser,
      avatar: normalizedAvatar,
    };
    setCurrentUser(nextUser);
    if (currentUser) {
      await supabase.from('profiles').update({
        name: nextUser.name,
        avatar_url: nextUser.avatar
      }).eq('id', updatedUser.id);
    }
  };

  const forgetPersonaMemory = (memoryId: string) => {
    setPersonaMemories(prev => prev.filter(memory => memory.id !== memoryId));
  };

  const addPersonaMemory = (agentId: string, type: PersonaMemoryType, content: string) => {
    if (!currentUser?.id) return;

    const normalizedContent = truncateMemoryText(content, PERSONA_MEMORY_MAX_CONTENT_CHARS);
    const normalizedKey = normalizeMemoryKey(normalizedContent);
    if (!agentId || !normalizedContent || !normalizedKey) return;

    const nowIso = new Date().toISOString();
    const inferredBucket = inferMemoryBucketForText(normalizedContent);
    const effectiveType = inferredBucket === 'instructions' ? 'preference' : type;
    const persistedKey = `${inferredBucket === 'instructions' ? 'instruction' : effectiveType}:${normalizedKey}`;
    const compoundKey = `${currentUser.id}:${agentId}:${persistedKey}`;

    setPersonaMemories(prev => {
      const existingIndex = prev.findIndex(memory =>
        `${memory.userId}:${memory.agentId}:${memory.key}` === compoundKey
      );

      if (existingIndex >= 0) {
        return prev.map((memory, index) => index === existingIndex
          ? {
            ...memory,
            content: normalizedContent,
            confidence: Math.max(memory.confidence || 0, 0.9),
            observationCount: (memory.observationCount || 0) + 1,
            lastObservedAt: nowIso,
            updatedAt: nowIso,
          }
          : memory
        );
      }

      const created: PersonaMemory = {
        id: crypto.randomUUID(),
        userId: currentUser.id,
        agentId,
        type: effectiveType,
        key: persistedKey,
        content: normalizedContent,
        confidence: 0.9,
        observationCount: 1,
        firstObservedAt: nowIso,
        lastObservedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      return [created, ...prev].slice(0, 800);
    });
  };

  const clearAgentPersonaMemories = (agentId: string) => {
    setPersonaMemories(prev => prev.filter(memory => memory.agentId !== agentId));
  };

  const handleUpdateChatMessages = useCallback((sessionId: string, messages: ChatMessage[]) => {
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
        const currentAgentIds = dedupeAgentIds(Array.isArray(s.agentIds) ? s.agentIds : []);
        const messageAgentIds = dedupeAgentIds(
          messages
            .filter((message: ChatMessage) => message.role === 'assistant')
            .map((message: ChatMessage) => message.agentId)
        );
        const nextAgentId = messageAgentIds.length > 0 ? messageAgentIds[0] : s.agentId;
        const nextAgentIds = currentAgentIds.length > 0
          ? currentAgentIds
          : (messageAgentIds.length > 0 ? messageAgentIds : dedupeAgentIds([s.agentId]));

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
  }, []);

  const resolvedAiAgents = resolveAgentsWithProfiles(aiAgents, settings);

  const navItems: { id: ViewState; label: string; icon: React.ElementType }[] = [
    { id: 'chat', label: '새 채팅', icon: MessageCircle },
    { id: 'calendar', label: '캘린더', icon: CalendarIcon },
    { id: 'todo', label: '할 일', icon: CheckSquare },
    { id: 'journal', label: '메모장', icon: BookOpen },
  ];
  const mobileNavItems: { id: ViewState; label: string; icon: React.ElementType }[] = [
    ...navItems,
  ];

  const renderSettingsView = () => (
    <SettingsView
      initialTab={settingsTab}
      hideTabs={isHideSettingsTabs}
      agents={resolvedAiAgents}
      onUpdateAgents={updateAgents}
      settings={settings}
      onUpdateSettings={setSettings}
      currentUser={currentUser}
      onUpdateUser={updateUser}
      onLogout={() => {
        setIsSettingsModalOpen(false);
        handleLogout();
      }}
      isLoggingOut={isLoggingOut}
      onExportData={handleExportData}
      onClearAllData={handleClearAllData}
      onClearActivity={handleClearActivity}
      onClearEvents={handleClearEvents}
      onClearTodos={handleClearTodos}
      onClearEntries={handleClearEntries}
      onClearChat={handleClearChat}
      personaMemories={personaMemories}
      onAddPersonaMemory={addPersonaMemory}
      onForgetPersonaMemory={forgetPersonaMemory}
      onClearAgentPersonaMemories={clearAgentPersonaMemories}
    />
  );

  const renderView = () => {
    switch (currentView) {
      case 'calendar':
        return (
          <CalendarView
            events={filteredCalendarEvents}
            tags={calendarTags}
            onAddEvent={(event) => requireAuth() ? addEvent(event) : undefined}
            onDeleteEvent={(id) => { if (requireAuth()) deleteEvent(id); }}
            onUpdateEvent={(event, previous) => { if (requireAuth()) updateEvent(event, previous); }}
          />
        );
      case 'todo':
        return (
          <TodoView
            todos={effectiveTodos}
            lists={todoLists}
            tabs={todoTabs}
            steps={todoSteps}
            onAddList={(...args) => requireAuth() ? addTodoList(...args) : undefined}
            onUpdateList={(...args) => { if (requireAuth()) updateTodoList(...args); }}
            onUpdateListOrder={(...args) => { if (requireAuth()) updateTodoListOrder(...args); }}
            onAddTodo={(...args) => requireAuth() ? addTodo(...args) : undefined}
            onUpdateTodo={(...args) => { if (requireAuth()) updateTodo(...args); }}
            onToggleTodo={(...args) => { if (requireAuth()) toggleTodo(...args); }}
            onDeleteTodo={(...args) => { if (requireAuth()) deleteTodo(...args); }}
            onReorderTodo={(...args) => { if (requireAuth()) reorderTodo(...args); }}
            onDeleteList={(...args) => { if (requireAuth()) deleteTodoList(...args); }}
            onAddTab={(...args) => requireAuth() ? addTodoTab(...args) : undefined}
            onUpdateTab={(...args) => { if (requireAuth()) updateTodoTab(...args); }}
            onDeleteTab={(...args) => { if (requireAuth()) deleteTodoTab(...args); }}
            onAddStep={(...args) => requireAuth() ? addTodoStep(...args) : undefined}
            onUpdateStep={(...args) => { if (requireAuth()) updateTodoStep(...args); }}
            onDeleteStep={(...args) => { if (requireAuth()) deleteTodoStep(...args); }}
            sidebarSlot={sidebarPanelSlot}
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
            onAddCategory={(...args) => requireAuth() ? addJournalCategory(...args) : undefined}
            onAddEntry={(...args) => requireAuth() ? addEntry(...args) : undefined}
            onUpdateEntry={(...args) => { if (requireAuth()) updateEntry(...args); }}
            onDeleteEntry={(...args) => { if (requireAuth()) deleteEntry(...args); }}
            sidebarSlot={sidebarPanelSlot}
          />
        );
      case 'chat':
      default: {
        const activeSession = chatSessions.find(s => s.id === activeChatSessionId);
        const activeAgentIdsForChat = dedupeAgentIds(activeChatAgentIds).filter(id =>
          resolvedAiAgents.some(agent => agent.id === id)
        );
        const sessionAgentIds =
          activeAgentIdsForChat.length > 0
            ? activeAgentIdsForChat
            : (resolvedAiAgents[0]?.id ? [resolvedAiAgents[0].id] : []);
        const selectedChatAgents = sessionAgentIds
          .map(id => resolvedAiAgents.find(agent => agent.id === id))
          .filter(Boolean) as AIAgent[];
        const personaMemoryBucketsByAgent = buildPersonaMemoryBuckets(
          personaMemories,
          new Set(settings.pinnedPersonaMemoryIds || [])
        );
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
            todos={effectiveTodos}
            entries={entries}
            todoLists={todoLists}
            onAddEvent={(event) => requireAuth() ? addEvent(event) : undefined}
            onDeleteEvent={(id) => { if (requireAuth()) deleteEvent(id); }}
            onAddTodo={(...args) => requireAuth() ? addTodo(...args) : undefined}
            onAddEntry={(...args) => requireAuth() ? addEntry(...args) : undefined}
            requireConfirm={settings.chatActionConfirm}
            settings={settings}
            onUpdateSettings={setSettings}
            agent={selectedChatAgents[0] || resolvedAiAgents[0]}
            agents={resolvedAiAgents}
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
            onUpdateAgent={(...args) => { if (requireAuth()) updateAiAgent(...args); }}
            onUserMessage={(text, context) => {
              const nextAgentIds = sessionAgentIds.length > 0
                ? sessionAgentIds
                : (aiAgents[0]?.id ? [aiAgents[0].id] : []);
              const addressedAgentIds = dedupeAgentIds(context?.addressedAgentIds || []);
              const memoryTargetIds = addressedAgentIds.length > 0 ? addressedAgentIds : nextAgentIds;
              const sessionStartedAt = context?.sessionStartedAt
                ? new Date(context.sessionStartedAt.replace(' ', 'T')).toISOString()
                : new Date().toISOString();
              if (!activeChatSessionId) {
                const newId = crypto.randomUUID();
                const newSession: ChatSession = {
                  id: newId,
                  title: text.slice(0, 20) + (text.length > 20 ? '...' : ''),
                  messages: [],
                  createdAt: sessionStartedAt,
                  lastMessageAt: sessionStartedAt,
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
            chatSessions={chatSessions}
            personaMemoryContextByAgent={personaMemoryContextByAgent}
            defaultUserName={currentUser?.name || ''}
            onUpdateMessages={handleUpdateChatMessages}
            isGuest={!currentUser}
            onRequestAuth={() => openAuthModal('login')}
          />
        );
      }
    }
  };

  const headerLabel =
    mobileNavItems.find(i => i.id === currentView)?.label ||
    'Dashboard';
  const historySessions = chatSessions
    .filter((session: ChatSession) => hasUserChatMessage(session))
    .sort((a, b) => getChatSessionActivityTime(b) - getChatSessionActivityTime(a));

  const handleNewChat = () => {
    setActiveChatSessionId(null);
    setActiveChatAgentIds(primaryActiveChatAgentId ? [primaryActiveChatAgentId] : []);
    setCurrentView('chat');
  };

  // Tag filter + tag management, shared by the desktop sidebar panel and the mobile menu.
  const renderCalendarTagPanel = () => (
    <>
      <button
        type="button"
        onClick={() => { if (requireAuth()) setCalendarTagModal('new'); }}
        className="w-full flex items-center gap-2.5 rounded-lg bg-[#f7f7f7] px-3 py-2.5 text-[15px] leading-5 font-medium text-[#37352f] transition-colors hover:bg-[#eeeeee]"
      >
        <Plus size={18} className="shrink-0" />
        <span>새 태그</span>
      </button>

      <div className="mt-6 mb-1 px-3">
        <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">태그 필터</span>
      </div>
      <div className="space-y-1">
        {calendarTags.map(tag => {
          const isVisible = visibleCalendarTagIds.includes(tag.id);

          return (
            <div key={tag.id} className="group relative">
            <button
              type="button"
              onClick={() => toggleCalendarTagFilter(tag.id)}
              className={`calendar-tag-filter-item w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                isVisible
                  ? 'is-active text-[#171717] hover:bg-[#f7f7f7]'
                  : 'text-[#8a8a8a] hover:bg-[#f7f7f7] hover:text-[#5f5f5f]'
              }`}
              style={{
                '--calendar-tag-color': tag.color,
                '--calendar-tag-dark-color': getDarkAdaptiveColor(tag.color),
                '--calendar-tag-muted': `${tag.color}66`,
              } as React.CSSProperties}
            >
              <span
                className={`calendar-tag-filter-indicator flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ${
                  isVisible ? 'is-active' : ''
                }`}
              >
                {isVisible && <Check size={12} className="text-white" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate pr-6 text-[15px] leading-5 font-normal">{tag.name}</span>
            </button>
            <button
              type="button"
              onClick={() => { if (requireAuth()) setCalendarTagModal(tag.id); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#8a8a8a] opacity-0 transition-all hover:bg-[#eeeeee] hover:text-[#171717] group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              aria-label={`${tag.name} 태그 수정`}
              title="태그 수정"
            >
              <Pencil size={13} />
            </button>
            </div>
          );
        })}
      </div>
    </>
  );

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

  if (currentView === 'support') {
    return (
      <React.Suspense fallback={<ViewLoadingFallback />}>
        <SupportView onBackToApp={() => setCurrentView('chat')} />
      </React.Suspense>
    );
  }



  return (
    <div className="flex h-[100dvh] bg-[#fbfbfa] font-sans selection:bg-black/10 relative overflow-x-hidden">
      {/* Full Page Loading Overlay Removed in v2.6 for "Instant" feel */}
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex h-full bg-white border-r border-[#e9e9e8] z-50 flex-shrink-0">
        {/* Icon Rail */}
        <div className="flex w-[72px] shrink-0 flex-col items-center bg-[#f7f7f7] py-3">
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(prev => !prev)}
            className="mb-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[#37352f]"
            aria-label={isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <nav className="flex w-full flex-col items-center gap-3 px-2">
            {navItems.map(item => {
              const isActive = currentView === item.id;
              const railLabel = SIDEBAR_RAIL_LABELS[item.id] ?? item.label;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => item.id === 'chat' ? handleNewChat() : setCurrentView(item.id)}
                  className="group flex w-full flex-col items-center gap-1"
                  aria-label={item.label}
                  title={item.label}
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${isActive
                      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'text-[#8a8a8a] group-hover:bg-[var(--app-surface-hover)] group-hover:text-[#37352f]'}`}
                  >
                    <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </span>
                  <span className={`text-[11px] leading-4 ${isActive ? 'font-medium text-[var(--color-primary)]' : 'font-normal text-[#5f5f5f]'}`}>
                    {railLabel}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Rail Bottom: Customer support and user profile */}
          <div className="relative mt-auto flex w-full flex-col items-center gap-3 px-2">
            <button
              type="button"
              onClick={() => setCurrentView('support')}
              className="group flex w-full flex-col items-center gap-1"
              aria-label="고객지원"
              title="고객지원"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a8a] transition-colors group-hover:bg-[var(--app-surface-hover)] group-hover:text-[#37352f]">
                <CircleHelp size={20} />
              </span>
              <span className="text-[11px] leading-4 font-normal text-[#5f5f5f]">고객지원</span>
            </button>
            {currentUser ? (
              <>
                <button
                  ref={sidebarProfileButtonRef}
                  type="button"
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  className="group flex w-full flex-col items-center gap-1"
                  title="프로필 및 설정 메뉴"
                  aria-label="프로필 및 설정 메뉴 열기"
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors group-hover:bg-[var(--app-surface-hover)] ${isUserMenuOpen ? 'bg-[var(--app-surface-hover)]' : ''}`}>
                    <span className="w-8 h-8 rounded-full bg-[#00a67d] text-white flex items-center justify-center text-[13px] leading-5 font-medium overflow-hidden shadow-xs">
                      {currentUser?.avatar ? (
                        <img src={currentUser.avatar} alt={currentUser.name} style={getAvatarImageStyle(currentUser.avatarFrame)} className="h-full w-full object-cover" />
                      ) : (
                        currentUser?.name?.[0]?.toUpperCase() || 'U'
                      )}
                    </span>
                  </span>
                  <span className="text-[11px] leading-4 font-normal text-[#5f5f5f]">내 정보</span>
                </button>

                <UserMenuPopover
                  isOpen={isUserMenuOpen}
                  onClose={() => setIsUserMenuOpen(false)}
                  currentUser={currentUser}
                  triggerRef={sidebarProfileButtonRef}
                  isSidebarCollapsed
                  onOpenTab={(tab, hideTabs = true) => openSettingsModal(tab, hideTabs)}
                  onOpenFullSettings={() => openSettingsModal('persona', false)}
                  onLogout={handleLogout}
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="group flex w-full flex-col items-center gap-1"
                aria-label="로그인 / 가입하기"
                title="로그인 / 가입하기"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a8a] transition-colors group-hover:bg-[var(--app-surface-hover)] group-hover:text-[#37352f]">
                  <UserIcon size={20} />
                </span>
                <span className="text-[11px] leading-4 font-normal text-[#5f5f5f]">로그인</span>
              </button>
            )}
          </div>
        </div>

        {/* Context Panel */}
        {!isSidebarCollapsed && (
          <div className="flex min-h-0 w-[248px] xl:w-[272px] flex-col">
            <div className="h-[72px] shrink-0 flex items-center px-5">
              <h2 className="truncate text-[18px] leading-6 font-semibold tracking-[-0.02em] text-[#37352f]">
                {SIDEBAR_RAIL_LABELS[currentView] ?? headerLabel}
              </h2>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 custom-scrollbar">
              {currentView === 'chat' && (
                <>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="w-full flex items-center gap-2.5 rounded-lg bg-[#f7f7f7] px-3 py-2.5 text-[15px] leading-5 font-medium text-[#37352f] transition-colors hover:bg-[#eeeeee]"
                  >
                    <Plus size={18} className="shrink-0" />
                    <span>새 대화</span>
                  </button>

                  <div className="mt-4 mb-1 flex items-center gap-2.5 px-3 py-2 text-[15px] leading-5 font-medium text-[#37352f]">
                    <History size={16} className="shrink-0" />
                    <span>최근 기록</span>
                  </div>
                  <div className="space-y-1">
                    {historySessions.length === 0 ? (
                      <div className="px-3 py-2 text-[13px] leading-5 text-[#8a8a8a]">
                        진행 중인 대화가 없습니다.
                      </div>
                    ) : (
                      historySessions
                        .slice(0, 10)
                        .map(session => (
                          <div key={session.id} className="group relative">
                            <div
                              onClick={() => {
                                const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, activeChatAgentIds);
                                setActiveChatSessionId(session.id);
                                setActiveChatAgentIds(resolvedAgentIds);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-colors text-[14px] leading-5 group ${activeChatSessionId === session.id
                                ? 'bg-[#f7f7f7] text-[#171717]'
                                : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'
                                }`}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  const resolvedAgentIds = resolveSessionAgentIds(session, aiAgents, activeChatAgentIds);
                                  setActiveChatSessionId(session.id);
                                  setActiveChatAgentIds(resolvedAgentIds);
                                }
                              }}
                            >
                              <div className="flex items-center">
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
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-[#eeeeee] z-10 rounded text-[#8a8a8a] opacity-0 group-hover:opacity-100 transition-all"
                              aria-label="채팅 삭제"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              )}

              {currentView === 'calendar' && renderCalendarTagPanel()}

              {(currentView === 'todo' || currentView === 'journal') && (
                <div ref={setSidebarPanelSlot} />
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-white pb-0">
        {/* Top Mobile Bar (Visible only on small screens) */}
        <header className="lg:hidden h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] bg-white border-b border-[#e9e9e8] flex items-center justify-between px-4 font-medium text-sm z-40 relative">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="-ml-1.5 w-10 h-10 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#37352f] transition-colors"
              aria-label="전체 메뉴 열기"
            >
              <Menu size={20} />
            </button>
            <span className="text-[#37352f] text-[17px] font-semibold truncate">{headerLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {currentUser ? (
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="w-8 h-8 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[13px] leading-5 font-medium text-[#5f5f5f] overflow-hidden"
                aria-label="계정 및 전체 메뉴 열기"
              >
                {currentUser?.avatar ? (
                  <img src={currentUser.avatar} alt={currentUser.name} style={getAvatarImageStyle(currentUser.avatarFrame)} className="w-full h-full object-cover" />
                ) : (
                  currentUser?.name?.[0] || 'U'
                )}
              </button>
            ) : (
              <button
                onClick={() => {
                  openAuthModal('login');
                }}
                className="text-[13px] leading-5 font-medium text-[#37352f] px-2.5 py-1 rounded-md border border-[#e9e9e8] bg-white"
              >
                로그인
              </button>
            )}
          </div>
        </header>

        {/* Scrollable View Content */}
        <div className={`flex-1 relative scroll-smooth ${['todo', 'journal', 'calendar'].includes(currentView) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={`h-full mx-auto ${['todo', 'journal', 'calendar'].includes(currentView) ? 'max-w-none p-0' : 'max-w-[1440px] p-3 sm:p-4 lg:p-8 lg:pt-10'}`}>
            <ViewErrorBoundary view={currentView} onRecover={() => setCurrentView('chat')}>
              <React.Suspense fallback={<ViewLoadingFallback />}>
                {renderView()}
              </React.Suspense>
            </ViewErrorBoundary>
          </div>
        </div>

        {needRefresh && (
          <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-24 right-3 lg:right-6 left-3 lg:left-auto z-50">
            <div className="bg-white border border-[#e9e9e8] text-[#37352f] px-4 py-3 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">새 버전이 준비됐어요.</div>
                <div className="text-[13px] leading-5 text-[#787774] mt-0.5">새로고침하면 최신 배포가 바로 적용됩니다.</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setNeedRefresh(false)}
                  className="text-[13px] leading-5 font-medium px-2.5 py-1 rounded-md border border-[#e9e9e8] text-[#787774] hover:bg-[#f7f7f7] transition-colors"
                >
                  나중에
                </button>
                <button
                  onClick={() => void updateServiceWorker(true)}
                  className="text-[13px] leading-5 font-normal px-2.5 py-1 rounded-md border border-[#e9e9e8] bg-[#f7f7f7] text-[#171717] hover:bg-[#eeeeee] transition-colors"
                >
                  지금 업데이트
                </button>
              </div>
            </div>
          </div>
        )}

        {undoToast && (
          <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:bottom-6 right-3 lg:right-6 left-3 lg:left-auto z-50">
            <div className="bg-white border border-[#e9e9e8] text-[#171717] px-4 py-3 rounded-xl flex items-center gap-3">
              <span className="text-sm">{undoToast.label}</span>
              <button
                onClick={handleUndo}
                    className="text-[13px] leading-5 font-normal bg-[#f7f7f7] hover:bg-[#eeeeee] px-2.5 py-1 rounded-md border border-[#e9e9e8] transition-colors"
              >
                실행 취소
              </button>
            </div>
          </div>
        )}
      </main>

      {calendarTagModal && (
        <CalendarTagModal
          key={calendarTagModal}
          tag={calendarTagModal === 'new' ? null : calendarTags.find(tag => tag.id === calendarTagModal)}
          canDelete={calendarTags.length > 1}
          onClose={() => setCalendarTagModal(null)}
          onSave={(name, color) => {
            if (calendarTagModal === 'new') addCalendarTag(name, color);
            else updateCalendarTag(calendarTagModal, { name, color });
          }}
          onDelete={calendarTagModal === 'new' ? undefined : () => deleteCalendarTag(calendarTagModal)}
        />
      )}

      {isSettingsModalOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="설정"
          onMouseDown={() => setIsSettingsModalOpen(false)}
        >
          <div
          className={`relative flex max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-48px)] w-full ${isHideSettingsTabs ? 'max-w-[560px]' : 'max-w-[960px] h-[90dvh] sm:h-[85vh]'} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-[#e9e9e8]`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsSettingsModalOpen(false)}
              className="absolute right-3.5 top-3.5 sm:right-5 sm:top-5 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-[#e8e8e6] sm:bg-[#f4f4f2] text-[#171717] sm:text-[#787774] transition-colors hover:bg-[#eaeaea] hover:text-[#171717] shadow-2xs"
              aria-label="설정 닫기"
            >
              <X size={16} />
            </button>
            <div className={`min-h-0 overflow-y-auto custom-scrollbar flex-1 ${isHideSettingsTabs ? 'px-4 pt-3 sm:px-6' : ''}`}>
              <React.Suspense fallback={<ViewLoadingFallback />}>
                {renderSettingsView()}
              </React.Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Slide Menu */}
      <div className={`lg:hidden fixed inset-0 z-[80] transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div
          className="absolute inset-0 bg-black/30"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <aside className={`absolute inset-y-0 left-0 w-[82vw] max-w-[340px] bg-white border-r border-[#e9e9e8] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transform transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-full flex flex-col">
            <div className="h-14 px-4 border-b border-[#e9e9e8] flex items-center justify-between">
              <span className="text-[14px] leading-5 font-medium text-[#37352f]">전체 메뉴</span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 rounded-md bg-white flex items-center justify-center text-[#787774] hover:text-[#37352f] hover:bg-[#f7f7f7] transition-colors"
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
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] leading-5 transition-colors ${isActive
                        ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                        : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
                    >
                      <item.icon size={18} className={isActive ? 'text-[var(--color-primary)]' : 'text-[#8a8a8a]'} strokeWidth={isActive ? 2.5 : 2} />
                      <span className={`text-[15px] leading-5 ${isActive ? 'font-medium' : 'font-normal'}`}>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {currentView === 'calendar' && (
                <div className="border-t border-[#e9e9e8] pt-3">
                  {renderCalendarTagPanel()}
                </div>
              )}

              <div className="border-t border-[#e9e9e8] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentView('support');
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] leading-5 text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
                >
                  <CircleHelp size={18} className="text-[#8a8a8a]" />
                  <span className="text-[15px] leading-5 font-normal">고객지원</span>
                </button>
              </div>

              <div className="border-t border-[#e9e9e8] pt-3">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">채팅 내역</span>
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {historySessions.length === 0 ? (
                    <div className="px-2 py-2 text-[13px] leading-5 text-[#9b9a97]">저장된 대화가 없습니다.</div>
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
                              setCurrentView('chat');
                              setIsMobileMenuOpen(false);
                            }}
                            className={`flex-1 text-left px-2.5 py-2 rounded-md text-[14px] leading-5 transition-colors ${activeChatSessionId === session.id
                              ? 'bg-[#f7f7f7] text-[#171717]'
                              : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
                          >
                            <span className="mobile-chat-history-title block truncate">{session.title}</span>
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
                            className="shrink-0 p-2 rounded-md text-[#8a8a8a] hover:bg-[#f3f3f3] hover:text-[#171717] transition-colors"
                            aria-label="채팅 삭제"
                          >
                            <Trash2 size={16} strokeWidth={1.8} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
            <div className="p-3 border-t border-[#e9e9e8]">
              {currentUser ? (
                <div className="relative">
                  <button
                    ref={mobileAccountMenuButtonRef}
                    type="button"
                    onClick={() => setIsMobileAccountMenuOpen((prev) => !prev)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-[#8a8a8a] transition-colors hover:bg-[#f3f3f3] hover:text-[#37352f]"
                    title="계정 메뉴"
                    aria-label="계정 메뉴"
                    aria-haspopup="menu"
                    aria-expanded={isMobileAccountMenuOpen}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[13px] leading-5 font-medium text-[#5f5f5f] flex-shrink-0 overflow-hidden">
                      {currentUser?.avatar ? (
                        <img src={currentUser.avatar} alt={currentUser.name} style={getAvatarImageStyle(currentUser.avatarFrame)} className="h-full w-full object-cover" />
                      ) : (
                        currentUser?.name?.[0] || 'U'
                      )}
                    </div>
                    <span className="min-w-0 flex-1 text-[14px] leading-5 font-normal text-[#37352f] truncate">{currentUser?.name}</span>
                    <span className="shrink-0">
                      <SettingsIcon size={17} />
                    </span>
                  </button>
                  <UserMenuPopover
                    isOpen={isMobileAccountMenuOpen}
                    onClose={() => setIsMobileAccountMenuOpen(false)}
                    currentUser={currentUser}
                    triggerRef={mobileAccountMenuButtonRef}
                    positionClassName="left-0 right-0 bottom-full mb-2 w-auto"
                    onOpenTab={(tab, hideTabs = true) => {
                      setIsMobileMenuOpen(false);
                      openSettingsModal(tab, hideTabs);
                    }}
                    onOpenFullSettings={() => {
                      setIsMobileMenuOpen(false);
                      openSettingsModal('account');
                    }}
                    onLogout={() => {
                      setIsMobileMenuOpen(false);
                      handleLogout();
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => {
                    openAuthModal('login');
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-[#e9e9e8] bg-[#f7f7f7] text-[#171717] text-[13px] leading-5 font-normal rounded-lg hover:bg-[#eeeeee] transition-all"
                >
                  <UserIcon size={14} />
                  로그인 / 가입
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
      {!currentUser && isAuthModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-3 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="로그인 또는 회원가입"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsAuthModalOpen(false);
          }}
        >
          <div className="max-h-[calc(100dvh-24px)] w-full max-w-[440px] overflow-y-auto rounded-[24px] border border-[#dededb] bg-white p-5 shadow-[0_24px_80px_rgba(15,15,15,0.18)] sm:max-h-[calc(100dvh-48px)] sm:p-8">
            <React.Suspense fallback={<ViewLoadingFallback />}>
              <AuthView
                variant="modal"
                initialMode={authMode}
                onClose={() => setIsAuthModalOpen(false)}
                onLogin={(user) => {
                  setCurrentUser(user);
                  setIsAuthModalOpen(false);
                }}
              />
            </React.Suspense>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

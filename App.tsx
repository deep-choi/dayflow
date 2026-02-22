import React, { useState, useEffect, useRef } from 'react';
import { ViewState, CalendarEvent, Todo, JournalEntry, AiPost, CommunityPost, AIAgent, ActivityItem, AppSettings, TodoList, TodoTab, TodoStep, CalendarTag, JournalCategory, Comment, User, ApiUsageStats, TriggerContext, ChatSession, ChatMessage } from './types';
import { Calendar as CalendarIcon, CheckSquare, BookOpen, MessageCircle, Sparkles, ChevronDown, Plus, Trash2, Settings2, Hash, Search, Layout, MoreVertical, Edit3, LogOut, User as UserIcon, X, Users, Menu } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale/ko';
import { supabase } from './utils/supabase';
import CalendarView from './views/CalendarView';
import TodoView from './views/TodoView';
import JournalView from './views/JournalView';
import CommunityBoardView from './views/CommunityBoardView';
import { DEFAULT_AGENTS } from './data/defaultAgents';
import SettingsView from './views/SettingsView';
import ChatView from './views/ChatView';
import AuthView from './views/AuthView';
import { DEFAULT_GEMINI_MODEL, getActiveGeminiConfig, getActiveAIConfig } from './utils/aiConfig';
import { normalizeKoreanText } from './utils/encodingFix';
import { syncEvents, syncTodos, syncTodoLists, syncTodoTabs, syncTodoSteps, syncEntries, syncJournalCategories, syncCommunityPosts, syncAgents, syncUserData, setOnSyncError } from './services/syncService';
import { debugManualSync } from './utils/debugSync';
import { useAuthSession } from './hooks/useAuthSession';

type ChatObservation = {
  text: string;
  timestamp: string;
};

const PERSONA_MEMORY_SESSION_LIMIT = 4;
const PERSONA_MEMORY_LINE_LIMIT = 12;
const PERSONA_MEMORY_ITEM_CHAR_LIMIT = 120;
const PERSONA_MEMORY_TOTAL_CHAR_LIMIT = 1400;

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

const buildPersonaMemoryContext = (
  sessions: ChatSession[],
  agentId: string,
  activeSessionId: string | null
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
    .slice(0, PERSONA_MEMORY_SESSION_LIMIT);

  if (related.length === 0) return '';

  const lines: string[] = [];
  for (const session of related) {
    const recentMessages = session.messages.slice(-8);
    for (const msg of recentMessages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = truncateMemoryText(msg.content || '', PERSONA_MEMORY_ITEM_CHAR_LIMIT);
      if (!content) continue;
      lines.push(`[${truncateMemoryText(session.title || 'Chat', 24)}] ${role}: ${content}`);
      if (lines.length >= PERSONA_MEMORY_LINE_LIMIT) break;
    }
    if (lines.length >= PERSONA_MEMORY_LINE_LIMIT) break;
  }

  if (lines.length === 0) return '';
  return truncateMemoryText(lines.join('\n'), PERSONA_MEMORY_TOTAL_CHAR_LIMIT);
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

const DEFAULT_TODO_LISTS: TodoList[] = [
  { id: 'default', title: '해야 할 일', order: 1, tabId: 'tab_todo' },
];

const VALID_VIEWS: ViewState[] = ['dashboard', 'calendar', 'todo', 'journal', 'board', 'chat', 'settings', 'api-settings', 'personas'];

const resolveViewFromUrl = (): ViewState => {
  if (typeof window === 'undefined') return 'chat';
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view && VALID_VIEWS.includes(view as ViewState) ? (view as ViewState) : 'chat';
};

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
  const [isDataLoaded, setIsDataLoaded] = useState(true); // v2.6: Start as true to show cache immediately
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [currentView, setCurrentView] = useState<ViewState>(() => resolveViewFromUrl());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    console.log(`[App] v2.5 booting id=${bootId}...`);
  }, []);

  // v2.5: Initialize from LocalStorage for instant refresh UX
  // Using <T,> syntax to avoid JSX ambiguity in .tsx files
  const getInitialState = <T,>(key: string, fallback: T): T => {
    try {
      const saved = localStorage.getItem(`lifesync_cache_${key}`);
      return saved ? JSON.parse(saved) : fallback;
    } catch { return fallback; }
  };

  // App Data State
  const [events, setEvents] = useState<CalendarEvent[]>(() => getInitialState('events', []));
  const [todoLists, setTodoLists] = useState<TodoList[]>(() => getInitialState('todoLists', DEFAULT_TODO_LISTS));
  const [todoTabs, setTodoTabs] = useState<TodoTab[]>(() => getInitialState('todoTabs', DEFAULT_TODO_TABS));
  const [todos, setTodos] = useState<Todo[]>(() => getInitialState('todos', []));
  const [todoSteps, setTodoSteps] = useState<TodoStep[]>(() => getInitialState('todoSteps', []));
  const [entries, setEntries] = useState<JournalEntry[]>(() => getInitialState('entries', []));
  const [posts, setPosts] = useState<AiPost[]>(() => getInitialState('posts', []));

  // Community Board State
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>(() => getInitialState('communityPosts', []));
  const [aiAgents, setAiAgents] = useState<AIAgent[]>(() => getInitialState('aiAgents', []));

  // Activity Log & Settings
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => getInitialState('chatSessions', []));
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [activeChatAgentIds, setActiveChatAgentIds] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityItem[]>(() => getInitialState('activityLog', []));
  const [settings, setSettings] = useState<AppSettings>(() => getInitialState('settings', {
    autoAiReactions: false,
    chatActionConfirm: true,
    apiConnections: [],
    activeConnectionId: undefined
  }));

  const [calendarTags, setCalendarTags] = useState<CalendarTag[]>(() => getInitialState('calendarTags', []));
  const [journalCategories, setJournalCategories] = useState<JournalCategory[]>(() => getInitialState('journalCategories', []));

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
  const activeGeminiConfig = getActiveGeminiConfig(settings);
  const activeAIConfig = getActiveAIConfig(settings);
  const primaryActiveChatAgentId = activeChatAgentIds[0] || aiAgents[0]?.id || 'ARIA';


  // Undo Toast
  const undoRef = useRef<null | (() => void)>(null);
  const [undoToast, setUndoToast] = useState<{ id: string; label: string } | null>(null);
  const scheduledPostKeyRef = useRef<string | null>(null);
  const recentChatObservationsRef = useRef<ChatObservation[]>([]);
  const pendingJournalAiCommentIdsRef = useRef<Set<string>>(new Set());
  const lastSyncedProfileAIFingerprintRef = useRef<string | null>(null);

  const appendChatObservation = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    recentChatObservationsRef.current = [
      ...recentChatObservationsRef.current,
      { text: trimmed.slice(0, 280), timestamp: new Date().toISOString() }
    ].slice(-30);
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
        // v2.6: Do NOT set isDataLoaded(false). Keep UI interactive with cached data.
        console.log(`[App] v2.6 background fetchUserData for user: ${user.id}`);
        fetchUserData(user.id);
      }
    },
    onSignedOut: () => {
      console.log('[App] onSignedOut event');
      setIsDataLoaded(false);
    },
    onBeforeSignOut: () => {
      console.log('[App] onBeforeSignOut event');
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
      localStorage.setItem('lifesync_cache_events', JSON.stringify(events));
      if (skipSyncRef.current) return;
      syncEvents(currentUser.id, events);
    }
  }, [events, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_todos', JSON.stringify(todos));
      if (skipSyncRef.current) return;
      syncTodos(currentUser.id, todos);
    }
  }, [todos, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_entries', JSON.stringify(entries));
      if (skipSyncRef.current) return;
      syncEntries(currentUser.id, entries);
    }
  }, [entries, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_communityPosts', JSON.stringify(communityPosts));
      if (skipSyncRef.current) return;
      syncCommunityPosts(currentUser.id, communityPosts);
    }
  }, [communityPosts, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_aiAgents', JSON.stringify(aiAgents));
      if (skipSyncRef.current) return;
      syncAgents(currentUser.id, aiAgents);
    }
  }, [aiAgents, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_todoLists', JSON.stringify(todoLists));
      if (skipSyncRef.current) return;
      syncTodoLists(currentUser.id, todoLists);
    }
  }, [todoLists, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_todoTabs', JSON.stringify(todoTabs));
      if (skipSyncRef.current) return;
      syncTodoTabs(currentUser.id, todoTabs);
    }
  }, [todoTabs, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_todoSteps', JSON.stringify(todoSteps));
      if (skipSyncRef.current) return;
      syncTodoSteps(currentUser.id, todoSteps);
    }
  }, [todoSteps, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_activityLog', JSON.stringify(activityLog));
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { activityLog });
    }
  }, [activityLog, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_settings', JSON.stringify(settings));
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { settings });
    }
  }, [settings, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_calendarTags', JSON.stringify(calendarTags));
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { calendarTags });
    }
  }, [calendarTags, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_journalCategories', JSON.stringify(journalCategories));
      if (skipSyncRef.current) return;
      syncJournalCategories(currentUser.id, journalCategories);
    }
  }, [journalCategories, currentUser?.id, isDataLoaded]);

  useEffect(() => {
    if (currentUser && isDataLoaded) {
      localStorage.setItem('lifesync_cache_chatSessions', JSON.stringify(chatSessions));
      if (skipSyncRef.current) return;
      syncUserData(currentUser.id, { chatSessions });
    }
  }, [chatSessions, currentUser?.id, isDataLoaded]);
  useEffect(() => {
    if (!currentUser || !isDataLoaded) return;

    const payload = {
      gemini_api_key: settings.geminiApiKey ?? '',
      auto_ai_reactions: settings.autoAiReactions,
      active_gemini_model: activeGeminiConfig?.modelName || DEFAULT_GEMINI_MODEL,
    };

    const fingerprint = JSON.stringify(payload);
    if (lastSyncedProfileAIFingerprintRef.current === fingerprint) return;
    lastSyncedProfileAIFingerprintRef.current = fingerprint;

    supabase
      .from('profiles')
      .update(payload)
      .eq('id', currentUser.id)
      .then(({ error }) => {
        if (error) {
          console.error('Failed to sync AI profile settings:', error);
          // If DB migration is not applied yet, avoid retry loops.
          if (error.code !== '42703' && error.code !== '42P01') {
            lastSyncedProfileAIFingerprintRef.current = null;
          }
        }
      });
  }, [
    currentUser?.id,
    settings.geminiApiKey,
    settings.autoAiReactions,
    activeGeminiConfig?.modelName,
  ]);
  useEffect(() => {
    lastSyncedProfileAIFingerprintRef.current = null;
  }, [currentUser?.id]);
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

  const isFetchingRef = useRef(false);
  const fetchUserData = async (userId: string) => {
    if (isFetchingRef.current) {
      console.log('[App] fetchUserData already in progress, skipping duplicate call.');
      return;
    }
    isFetchingRef.current = true;
    // v2.6: Do NOT set isDataLoaded(false) here to maintain "Instant UI" feel.

    // --- Stage 1: Critical UI Data (Settings, Todos, Events) ---
    const fetchCritical = Promise.race([
      Promise.all([
        supabase.from('todo_tabs').select('*').eq('user_id', userId).order('order'),
        supabase.from('todo_lists').select('*').eq('user_id', userId).order('order'),
        supabase.from('todo_steps').select('*').eq('user_id', userId).order('order'),
        supabase.from('todos').select('*').eq('user_id', userId).order('order'),
        supabase.from('calendar_events').select('*').eq('user_id', userId),
        supabase.from('user_data').select('*').eq('user_id', userId).maybeSingle()
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Critical fetch timeout')), 10000))
    ]);

    let criticalResults;
    try {
      criticalResults = await fetchCritical;
    } catch (err: any) {
      console.warn('[App] fetchCritical failed or timed out:', err.message);
      isFetchingRef.current = false;
      setIsDataLoaded(true);
      return;
    }

    const [
      { data: dbTodoTabs },
      { data: dbTodoLists },
      { data: dbTodoSteps },
      { data: dbTodos },
      { data: dbEvents },
      { data: dbUserData }
    ] = criticalResults;

    // Apply Stage 1 data
    if (dbTodoTabs && dbTodoTabs.length > 0) {
      setTodoTabs(dbTodoTabs.map((tab: any) => ({
        id: tab.id,
        name: normalizeKoreanText(tab.name),
        color: tab.color,
        order: tab.order
      })));
    } else if (dbTodoTabs && dbTodoTabs.length === 0) {
      // If user has NO tabs, but maybe has lists, we should provide default tabs
      setTodoTabs(DEFAULT_TODO_TABS);
    }
    if (dbTodoLists) setTodoLists(dbTodoLists.map((list: any) => ({
      ...list,
      title: normalizeKoreanText(list.title),
      dueDate: list.due_date || undefined,
      tabId: list.tab_id || (list.type === 'project' ? 'tab_project' : 'tab_todo')
    })));
    if (dbTodos) setTodos(dbTodos.map((t: any) => ({
      id: t.id,
      listId: t.list_id || undefined,
      text: normalizeKoreanText(t.text),
      completed: t.completed,
      date: new Date().toISOString(),
      startDate: t.start_date || undefined,
      dueDate: t.due_date || undefined,
      subTasks: t.sub_tasks ? (typeof t.sub_tasks === 'string' ? JSON.parse(t.sub_tasks) : t.sub_tasks) : undefined,
      stepId: t.step_id || undefined
    } as Todo)));
    if (dbTodoSteps) setTodoSteps(dbTodoSteps.map((s: any) => ({
      id: s.id,
      listId: s.list_id,
      title: normalizeKoreanText(s.title),
      order: s.order
    } as TodoStep)));
    if (dbEvents) setEvents(dbEvents.map((e: any) => {
      const [startDate, startTime] = e.start_time ? e.start_time.split('T') : ['', ''];
      const [endDate, endTime] = e.end_time ? e.end_time.split('T') : ['', ''];
      return { id: e.id, title: normalizeKoreanText(e.title), date: startDate, startTime: startTime && startTime !== '00:00:00' ? startTime.substring(0, 5) : undefined, endTime: endTime && endTime !== '23:59:59' ? endTime.substring(0, 5) : undefined, description: e.description ? normalizeKoreanText(e.description) : undefined, type: (e.tags && e.tags.length > 0) ? e.tags[0] : 'tag_1' } as CalendarEvent;
    }));
    if (dbUserData) {
      if (Array.isArray(dbUserData.chat_sessions)) setChatSessions(dbUserData.chat_sessions);
      if (Array.isArray(dbUserData.activity_log)) setActivityLog(dbUserData.activity_log);
      if (Array.isArray(dbUserData.calendar_tags)) setCalendarTags(dbUserData.calendar_tags);
      if (dbUserData.settings) setSettings(prev => ({ ...prev, ...dbUserData.settings }));
    }

    // --- Stage 2: Secondary Data (Journals, Agents, Posts) ---
    const fetchSecondary = Promise.all([
      supabase.from('journal_categories').select('*').eq('user_id', userId),
      supabase.from('journal_entries').select('*').eq('user_id', userId).order('date', { ascending: false }),
      supabase.from('ai_agents').select('*').eq('user_id', userId).order('order'),
      supabase.from('community_posts').select('*').eq('user_id', userId).order('timestamp', { ascending: false })
    ]);

    const secondaryResults = await fetchSecondary;
    const [
      { data: dbJournalCategories },
      { data: dbJournalEntries },
      { data: dbAiAgents },
      { data: dbPosts }
    ] = secondaryResults;

    // Secondary updates
    if (dbJournalCategories) setJournalCategories(dbJournalCategories.map((category: any) => ({ ...category, name: normalizeKoreanText(category.name) })));
    if (dbJournalEntries) {
      const catMap = new Map((dbJournalCategories || []).map((c: any) => [c.id, normalizeKoreanText(c.name)]));
      setEntries(dbJournalEntries.map((e: any) => ({ id: e.id, title: normalizeKoreanText(e.title || ''), content: normalizeKoreanText(e.content || ''), date: e.date, mood: e.mood, category: e.category_id ? catMap.get(e.category_id) || '메모장' : '메모장', order: e.order || 0 } as JournalEntry)));
    }
    if (dbAiAgents) setAiAgents(dbAiAgents.map((a: any, i: number) => normalizeAIAgent(a, i)));
    if (dbPosts) setCommunityPosts((dbPosts || []).map(normalizeCommunityPost).filter(p => !!p.id).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

    console.log(`[App] Data load complete for user ${userId}. Enabling sync hooks.`);
    setIsDataLoaded(true);
    isFetchingRef.current = false;
    // v2.5: Wait a short delay after load to ensure effects don't catch the initial state change as a user-edit
    setTimeout(() => {
      skipSyncRef.current = false;
    }, 1000);
  };

  const handleLogout = logout;

  useEffect(() => {
    const listIds = new Set(todoLists.map(l => l.id));
    const fallbackId = todoLists[0]?.id ?? 'routine';
    setTodos(prev => prev.map(t => (t.listId && listIds.has(t.listId)) ? t : { ...t, listId: fallbackId }));
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

  const addJournalComment = (entryId: string, comment: Omit<Comment, 'id' | 'timestamp'>) => {
    const newComment: Comment = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...comment,
    };
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, comments: [...(e.comments || []), newComment] } : e
    ));
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

  // Trigger helper
  const triggerAI = (context: TriggerContext) => {
    // Signed-in users use server-side queue processing to avoid duplicate calls.
    if (currentUser) return;
    if (!settings.autoAiReactions) return;
    const recentChats = recentChatObservationsRef.current.slice(-8);

    const enrichedContext: TriggerContext = {
      ...context,
      data: {
        ...context.data,
        pendingTodos: todos.filter(t => !t.completed).length,
        completedTodos: todos.filter(t => t.completed).length,
        totalEvents: events.length,
        recentJournal: entries.slice(0, 3).map(entry => ({
          title: entry.title || '',
          content: (entry.content || '').slice(0, 280),
          mood: entry.mood,
          date: entry.date,
        })),
        recentChats,
      },
    };

    const updateUsage = (stats: ApiUsageStats) => {
      setSettings(prev => ({
        ...prev,
        apiUsage: {
          totalRequests: (prev.apiUsage?.totalRequests || 0) + stats.totalRequests,
          totalTokens: (prev.apiUsage?.totalTokens || 0) + stats.totalTokens,
          lastRequestDate: stats.lastRequestDate,
        }
      }));
    };

    import('./utils/triggerEngine')
      .then(({ generateCommunityPosts }) =>
        generateCommunityPosts(
          enrichedContext,
          aiAgents,
          addCommunityPost,
          activeGeminiConfig?.apiKey,
          updateUsage,
          activeGeminiConfig?.modelName
        )
      )
      .catch((error) => {
        console.error('Failed to load triggerEngine for AI reactions:', error);
      });
  };

  useEffect(() => {
    // Signed-in users use server scheduler (Edge Function + queue).
    if (currentUser) return;

    const FOUR_HOURS = 4;
    const RECENT_ACTIVITY_WINDOW_MS = FOUR_HOURS * 60 * 60 * 1000;

    const getLocalBucketKey = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const bucketHour = Math.floor(date.getHours() / FOUR_HOURS) * FOUR_HOURS;
      const hour = String(bucketHour).padStart(2, '0');
      return `${year}-${month}-${day}T${hour}`;
    };

    const hasRecentActivity = (now: Date): boolean => {
      const nowMs = now.getTime();
      return activityLog.slice(-50).some(item => {
        const ts = new Date(item.timestamp).getTime();
        return Number.isFinite(ts) && nowMs - ts <= RECENT_ACTIVITY_WINDOW_MS;
      });
    };

    const maybeTriggerScheduledDigest = () => {
      if (!settings.autoAiReactions || !activeGeminiConfig?.apiKey) return;

      const now = new Date();
      if (!hasRecentActivity(now)) return;

      const key = getLocalBucketKey(now);
      if (scheduledPostKeyRef.current === key) return;

      scheduledPostKeyRef.current = key;

      triggerAI({
        trigger: 'scheduled_digest',
        data: {
          slot: `every_${FOUR_HOURS}_hours`,
          date: now.toISOString(),
        },
      });
    };

    const tick = () => {
      maybeTriggerScheduledDigest();
    };

    tick();
    const intervalId = setInterval(tick, 60_000);
    return () => clearInterval(intervalId);
  }, [currentUser, settings.autoAiReactions, activeGeminiConfig?.apiKey, entries, events, todos, aiAgents, activityLog]);

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
    const nextOrder = Math.max(0, ...todoSteps.filter(s => s.listId === listId).map(s => s.order)) + 1;
    const newStep: TodoStep = {
      id: crypto.randomUUID(),
      listId,
      title: trimmed,
      order: nextOrder
    };
    setTodoSteps(prev => [...prev, newStep]);
    if (currentUser) {
      await supabase.from('todo_steps').insert([{
        id: newStep.id,
        user_id: currentUser.id,
        list_id: newStep.listId,
        title: newStep.title,
        "order": newStep.order
      }]);
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
    const confirmed = window.confirm('모든 기록을 삭제할까요? (일정/할 일/일기/AI 보드/활동 기록)\n이 작업은 되돌릴 수 없습니다.');
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
          safeDeleteByUser('ai_agents'),
          safeDeleteByUser('community_posts'),
          safeDeleteByUser('calendar_events'),
          safeDeleteByUser('journal_entries'),
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
    setTodoLists(DEFAULT_TODO_LISTS);
    setEntries([]);
    setPosts([]);
    setCommunityPosts([]);
    setAiAgents(DEFAULT_AGENTS);
    setActivityLog([]);
    setSelectedJournalId(null);
    setSelectedAiPostId(null);
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

    if (currentUser) {
      await supabase.from('calendar_events').insert([{
        id: event.id,
        user_id: currentUser.id,
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: event.date + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
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
    // Trigger AI community posts
    triggerAI({
      trigger: 'event_added',
      data: {
        title: event.title,
        date: event.date,
        weekCount: events.filter(e => {
          const d = new Date(e.date);
          const now = new Date();
          return d >= now && d <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }).length + 1,
      },
    });
  };

  const updateEvent = async (event: CalendarEvent, previous: CalendarEvent) => {
    setEvents(prev => prev.map(e => e.id === event.id ? event : e));

    if (currentUser) {
      await supabase.from('calendar_events').update({
        title: event.title,
        start_time: event.date + (event.startTime ? `T${event.startTime}:00` : 'T00:00:00'),
        end_time: event.date + (event.endTime ? `T${event.endTime}:00` : 'T23:59:59'),
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
          end_time: previous.date + (previous.endTime ? `T${previous.endTime}:00` : 'T23:59:59'),
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
          end_time: removed.date + (removed.endTime ? `T${removed.endTime}:00` : 'T23:59:59'),
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
    const targetListId = listId || todoLists[0]?.id || 'routine';
    const listLabel = todoLists.find(l => l.id === targetListId)?.title || '목록';
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      date: new Date().toISOString(),
      category,
      listId: targetListId,
      stepId,
      dueDate,
      subTasks: [],
    };

    setTodos(prev => [...prev, newTodo]);

    if (currentUser) {
      await supabase.from('todos').insert([{
        id: newTodo.id,
        user_id: currentUser.id,
        list_id: targetListId,
        step_id: stepId || null,
        text: newTodo.text,
        completed: newTodo.completed,
        "order": todos.length,
        due_date: newTodo.dueDate || null,
        sub_tasks: newTodo.subTasks || null
      }]);
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

    // Trigger AI
    triggerAI({
      trigger: 'todo_added',
      data: {
        text,
        total: todos.length + 1,
        pending: todos.filter(t => !t.completed).length + 1,
      },
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
        await supabase.from('todos').update(dbUpdates).eq('id', id);
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

      triggerAI({
        trigger: 'todo_completed',
        data: {
          text: todo.text,
          completed: todos.filter(t => t.completed).length + 1,
          pending: todos.filter(t => !t.completed).length - 1,
          completionRate: Math.round(((todos.filter(t => t.completed).length + 1) / todos.length) * 100),
          nextTodo: todos.find(t => !t.completed && t.id !== id)?.text || '없음',
        },
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
        await supabase.from('todos').insert([{
          id: removed.id,
          user_id: currentUser.id,
          list_id: removed.listId,
          text: removed.text,
          completed: removed.completed,
          "order": todos.length,
          due_date: removed.dueDate || null,
          sub_tasks: removed.subTasks || null
        }]);
      }
      logActivity({
        type: 'todo_added',
        label: `할 일 복원(Undo): ${removed.text}`,
        meta: { id: removed.id },
      });
    });
  };

  const requestAiCommentForEntry = (entry: Pick<JournalEntry, 'id' | 'title' | 'content' | 'mood'>) => {
    if (!settings.autoAiReactions || !activeGeminiConfig?.apiKey) return;
    if (pendingJournalAiCommentIdsRef.current.has(entry.id)) return;

    const existingEntry = entries.find(e => e.id === entry.id);
    if (existingEntry?.comments && existingEntry.comments.length > 0) return;

    pendingJournalAiCommentIdsRef.current.add(entry.id);
    import('./utils/triggerEngine')
      .then(({ generateJournalComment }) =>
        generateJournalComment(
          { title: entry.title, content: entry.content, mood: entry.mood },
          events,
          todos,
          aiAgents,
          (comment) => addJournalComment(entry.id, comment),
          activeGeminiConfig.apiKey,
          (stats) => setSettings(prev => ({
            ...prev,
            apiUsage: {
              totalRequests: (prev.apiUsage?.totalRequests || 0) + stats.totalRequests,
              totalTokens: (prev.apiUsage?.totalTokens || 0) + stats.totalTokens,
              lastRequestDate: stats.lastRequestDate,
            }
          })),
          activeGeminiConfig.modelName
        )
      )
      .catch((error) => {
        console.error('Failed to load triggerEngine for AI comment:', error);
      })
      .finally(() => {
        pendingJournalAiCommentIdsRef.current.delete(entry.id);
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

    // AI 트리거 (비차단형으로 실행)
    triggerAI({
      trigger: 'journal_added',
      data: {
        mood: mood === 'good' ? '좋음' : mood === 'bad' ? '나쁨' : '보통',
      },
    });

    // AI 댓글 요청 (상태 업데이트 전 데이터 직접 전달)
    requestAiCommentForEntry({
      id: newEntry.id,
      title: newEntry.title,
      content: newEntry.content,
      mood: newEntry.mood,
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

  const handleRequestAiComment = (entryId: string) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    requestAiCommentForEntry({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      mood: entry.mood,
    });
  };

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
    { id: 'board', label: 'AI 일기장', icon: Sparkles },
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
            onAddComment={addJournalComment}
            onRequestAiComment={handleRequestAiComment}
            agents={aiAgents}
          />
        );
      case 'board':
        return (
          <CommunityBoardView
            agents={aiAgents}
            posts={communityPosts}
            selectedId={selectedAiPostId}
            onSelectId={setSelectedAiPostId}
            selectedAgentId={selectedAiAgentId}
            onUpdatePost={updateCommunityPost}
            onDeletePost={deleteCommunityPost}
            onAddComment={addCommunityComment}
            onUpdateOrder={(newPosts) => setCommunityPosts(newPosts)}
            onSelectAgent={setSelectedAiAgentId}
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
        const personaMemoryContextByAgent = sessionAgentIds.reduce((acc, agentId) => {
          const memory = buildPersonaMemoryContext(chatSessions, agentId, activeChatSessionId);
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
            onUserMessage={(text) => {
              const nextAgentIds = sessionAgentIds.length > 0
                ? sessionAgentIds
                : (aiAgents[0]?.id ? [aiAgents[0].id] : []);
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
        <div className={`flex-1 relative scroll-smooth ${['todo', 'journal', 'board', 'calendar'].includes(currentView) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={`h-full mx-auto ${['todo', 'journal', 'board', 'calendar'].includes(currentView) ? 'max-w-none p-0' : 'max-w-[1200px] p-3 sm:p-4 lg:p-8 lg:pt-10'}`}>
            {renderView()}
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

export interface SubTask {
  id: string;
  text: string;
  completed: boolean;
}

export interface TodoStep {
  id: string;
  listId: string;
  title: string;
  order: number;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  date: string; // ISO date string YYYY-MM-DD
  category?: 'work' | 'personal' | 'shopping' | 'health';
  listId?: string;
  stepId?: string; // Optional reference to TodoStep
  startDate?: string; // ISO date string YYYY-MM-DD
  dueDate?: string; // ISO date string YYYY-MM-DD
  subTasks?: SubTask[];
}

export interface TodoTab {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface TodoList {
  id: string;
  title: string;
  order: number;
  importance?: 'high' | 'medium' | 'low';
  dueDate?: string;
  tabId?: string; // Reference to TodoTab
}

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  date: string; // ISO date string
  mood: 'good' | 'neutral' | 'bad';
  category?: string;
  order?: number;
  comments?: Comment[];
}

export interface JournalCategory {
  id: string;
  name: string;
}

export interface CalendarTag {
  id: string;
  name: string;
  color: string; // Hex color
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date string YYYY-MM-DD
  endDate?: string; // ISO date string YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  isAllDay?: boolean;
  description?: string;
  type: string; // CalendarTag id
}

export interface AiPost {
  id: string;
  title: string;
  content: string; // Markdown supported
  date: string; // ISO date string
  tags: string[];
  type: 'analysis' | 'suggestion';
}

export interface Comment {
  id: string;
  authorId: string; // 'USER' or AI agent id
  authorName: string;
  authorEmoji?: string;
  content: string;
  timestamp: string;
}

export interface AvatarFrame {
  zoom: number;
  x: number;
  y: number;
}

// AI Community Board Types
export type ChatResponseLength = 'short' | 'medium' | 'long';

export interface AIAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  personality: string;
  tone: string;
  color: string;
  avatar?: string;
  avatarFrame?: AvatarFrame;
  connectionId?: string; // Optional: per-persona API connection override
  responseLength?: ChatResponseLength;
}

export interface CommunityPost {
  id: string;
  author: string;
  content: string;
  timestamp: string;
  replyTo?: string;
  trigger?: string;
  reactions?: { emoji: string; count: number }[];
  order?: number;
  comments?: Comment[];
}

export interface ActivityItem {
  id: string;
  type:
  | 'event_added'
  | 'event_deleted'
  | 'event_updated'
  | 'todo_added'
  | 'todo_completed'
  | 'todo_uncompleted'
  | 'todo_deleted'
  | 'journal_added'
  | 'journal_deleted';
  label: string;
  timestamp: string;
  meta?: Record<string, any>;
}

export interface ApiConnection {
  id: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'xai' | 'ollama' | 'custom';
  modelName: string; // e.g. "gemini-3-flash-preview", "gpt-4"
  apiKey: string;
  baseUrl?: string;
  isActive: boolean;
}

export interface AgentUsageStats extends ApiUsageStats {
  textResponses: number;
  lastProvider?: ApiConnection['provider'];
  lastModelName?: string;
}

export interface RoutineProgress {
  completedOn?: string;
  subTaskCompletedOn?: Record<string, string>;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppSettings {
  autoAiReactions: boolean;
  chatActionConfirm: boolean;
  theme: ThemeMode;
  preferredDayflowModel?: string;
  geminiApiKey?: string; // @deprecated use apiConnections
  apiConnections: ApiConnection[];
  activeConnectionId?: string;
  apiUsage?: ApiUsageStats;
  agentProfiles?: Record<string, Partial<AIAgent>>;
  agentUsageById?: Record<string, AgentUsageStats>;
  pinnedPersonaMemoryIds?: string[];
  lastRoutineResetDate?: string; // YYYY-MM-DD
  routineProgress?: Record<string, RoutineProgress>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  isAdmin?: boolean;
}

export interface ApiUsageStats {
  totalRequests: number;
  totalTokens: number;
  lastRequestDate?: string;
}

export type ChatActionStatus = 'pending' | 'completed' | 'cancelled' | 'failed';

export interface ChatAddEventActionData {
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  isAllDay?: boolean;
  description?: string;
  type?: string;
}

export interface ChatAddTodoActionData {
  text: string;
  dueDate?: string; // YYYY-MM-DD
  category?: Todo['category'];
  listName?: string;
}

export interface ChatAddJournalEntryActionData {
  title: string;
  content: string;
  category?: string;
  mood?: JournalEntry['mood'];
}

export interface ChatActionState {
  executed?: boolean;
  status?: ChatActionStatus;
  error?: string;
}

export type ChatSingleGeneratedAction =
  | ({ type: 'add_event'; data: ChatAddEventActionData } & ChatActionState)
  | ({ type: 'add_todo'; data: ChatAddTodoActionData } & ChatActionState)
  | ({ type: 'add_journal_entry'; data: ChatAddJournalEntryActionData } & ChatActionState);

export type ChatGeneratedAction =
  | { type: 'none' }
  | ChatSingleGeneratedAction
  | ({ type: 'batch'; actions: ChatSingleGeneratedAction[] } & ChatActionState);

export type ChatMessageAction =
  | ({ type: 'onboarding'; data?: any } & ChatActionState)
  | ChatSingleGeneratedAction
  | ({ type: 'batch'; actions: ChatSingleGeneratedAction[] } & ChatActionState);

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  agentId?: string; // assistant persona id for multi-persona chat
  provider?: ApiConnection['provider'];
  modelName?: string;
  connectionId?: string;
  imageUrl?: string;
  videoUrl?: string;
  action?: ChatMessageAction;
  quickReplies?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  lastMessageAt: string;
  agentId?: string; // ID of the AI agent for this session
  agentIds?: string[]; // selected AI agent ids for this session (group chat)
}

export type PersonaMemoryType = 'fact' | 'preference' | 'goal';

export interface PersonaMemory {
  id: string;
  userId: string;
  agentId: string;
  type: PersonaMemoryType;
  key: string;
  content: string;
  confidence: number;
  observationCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ViewState = 'dashboard' | 'calendar' | 'todo' | 'journal' | 'board' | 'chat' | 'support' | 'admin' | 'settings' | 'api-settings' | 'personas';

export interface TriggerContext {
  trigger: 'todo_completed' | 'todo_added' | 'event_added' | 'journal_added' | 'scheduled_digest';
  data: {
    text?: string;
    title?: string;
    date?: string;
    mood?: string;
    slot?: string;
    completed?: number;
    pending?: number;
    total?: number;
    completionRate?: number;
    nextTodo?: string;
    weekCount?: number;
    pendingTodos?: number;
    completedTodos?: number;
    totalEvents?: number;
    recentJournal?: { title: string; content: string; mood: string; date: string }[];
    recentChats?: { text: string; timestamp: string }[];
  };
}

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

// AI Community Board Types
export interface AIAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  personality: string;
  tone: string;
  color: string;
  avatar?: string;
  connectionId?: string; // Optional: per-persona API connection override
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
  provider: 'gemini' | 'openai' | 'anthropic' | 'xai' | 'custom';
  modelName: string; // e.g. "gemini-3-flash-preview", "gpt-4"
  apiKey: string;
  isActive: boolean;
}

export interface AppSettings {
  autoAiReactions: boolean;
  chatActionConfirm: boolean;
  geminiApiKey?: string; // @deprecated use apiConnections
  apiConnections: ApiConnection[];
  activeConnectionId?: string;
  apiUsage?: ApiUsageStats;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  geminiApiKey?: string;
}

export interface ApiUsageStats {
  totalRequests: number;
  totalTokens: number;
  lastRequestDate?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  agentId?: string; // assistant persona id for multi-persona chat
  provider?: ApiConnection['provider'];
  modelName?: string;
  connectionId?: string;
  action?: {
    type: 'add_event' | 'delete_event' | 'add_todo' | 'add_journal' | 'generate_insight' | 'onboarding';
    data?: any;
    executed?: boolean;
  };
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

export type ChatMode = 'basic' | 'learning';

export type ViewState = 'dashboard' | 'calendar' | 'todo' | 'journal' | 'board' | 'chat' | 'settings' | 'api-settings' | 'personas';

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

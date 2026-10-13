import React, { useState, useRef, useEffect } from 'react';
import {
    CalendarEvent,
    Todo,
    JournalEntry,
    TodoList,
    AppSettings,
    AIAgent,
    ApiConnection,
    ChatMessage,
    ChatSession,
    ChatGeneratedAction,
    ChatMessageAction,
    ChatSingleGeneratedAction,
} from '../types';
import { generateChatResponse, ChatActionResult } from '../services/geminiService';
import { Sparkles, Plus, Check } from '../components/Icons';
import { ArrowUp, Edit3, Save, X, FlaskConical, Zap, ChevronDown, ChevronUp, CheckCircle2, Settings, Users, Cpu } from 'lucide-react';
import { ReasoningEffortPopover } from '../components/ReasoningEffortPopover';
import {
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OLLAMA_BASE_URL,
    DEFAULT_REASONING_EFFORT,
    REASONING_EFFORT_OPTIONS,
    supportsReasoningEffort,
    CHAT_PROVIDERS as DEFAULT_CHAT_PROVIDERS,
    getActiveAIConfig,
    getAgentAIConfig,
    getDefaultModelForProvider,
    getModelOptionsForProvider,
    getProviderDefaultBaseUrl,
    getProviderDisplayName as getConfiguredProviderDisplayName,
    hasUsableAIConnection,
    isChatSupportedProvider,
    isHostedOpenAICompatibleProvider,
    normalizeProviderModelName,
} from '../utils/aiConfig';
import { ApiUsageStats } from '../types';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { testOpenAIConnection } from '../services/openaiService';
import { testAnthropicConnection } from '../services/anthropicService';
import { testOpenAICompatibleConnection } from '../services/openAICompatibleService';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaService';
import { DEFAULT_LOCAL_SERVER_BASE_URL, listLocalServerModels, testLocalServerConnection } from '../services/localServerService';
import {
    DAYFLOW_TRIAL_API_KEY,
    DAYFLOW_TRIAL_MODEL,
    isTrialExhaustedError,
} from '../services/trialChatService';
import { readImageFileAsDataUrl } from '../utils/imageAsset';
import { getAvatarImageStyle } from '../utils/avatarFrame';
import AvatarCropperModal from '../components/AvatarCropperModal';
import { submitAppSupport } from '../services/appSupportService';

interface ChatViewProps {
    events: CalendarEvent[];
    todos: Todo[];
    entries: JournalEntry[];
    todoLists: TodoList[];
    onAddEvent: (event: CalendarEvent) => void | Promise<void>;
    onDeleteEvent: (id: string) => void;
    onAddTodo: (text: string, listId?: string, dueDate?: string, stepId?: string, category?: Todo['category']) => void | Promise<void>;
    onAddEntry: (title: string, content: string, category?: string, mood?: JournalEntry['mood']) => void | Promise<void>;
    requireConfirm?: boolean;
    settings: AppSettings;
    onUpdateSettings?: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
    agent?: AIAgent;
    agents?: AIAgent[];
    selectedAgentIds?: string[];
    selectedAgents?: AIAgent[];
    onSelectAgents?: (ids: string[]) => void;
    onUpdateAgent?: (agentId: string, updates: Partial<AIAgent>) => void;
    onUserMessage?: (
        text: string,
        context?: {
            activeAgentIds: string[];
            addressedAgentIds: string[];
            isNewSession?: boolean;
            sessionStartedAt?: string;
            sessionTimePeriod?: string;
            sessionTimezone?: string;
        }
    ) => void;
    initialMessages?: ChatMessage[];
    onUpdateMessages?: (sessionId: string, messages: ChatMessage[]) => void;
    chatSessions?: ChatSession[];
    currentSessionId?: string | null;
    isGuest?: boolean;
    onRequestAuth?: () => void;
    personaMemoryContext?: string;
    personaMemoryContextByAgent?: Record<string, string>;
    defaultUserName?: string;
}

const CHAT_HISTORY_LIMIT = 12;
const MAX_GROUP_AGENTS = 4;
const SHARED_SCENE_MESSAGE_LIMIT = 16;
const SHARED_SCENE_CHAR_LIMIT = 2400;
const LEGACY_MODEL_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
    [/페르소나 설정에서\s*Gemini\/xAI를\s*지정해 주세요/g, '페르소나 설정에서 모델을 지정해 주세요'],
    [/페르소나 설정에서\s*Gemini를\s*연결해 주세요/g, '페르소나 설정에서 채팅용 모델을 지정해 주세요'],
    [/Gemini\/xAI만\s*선택 가능/g, '지원되는 모델만 선택 가능'],
    [/Gemini API Key/g, 'API Key'],
];
type PersonaEditorTab = 'profile' | 'api';
type ApiSelection = '__default__' | '__new__' | string;

const CHAT_PROVIDERS = DEFAULT_CHAT_PROVIDERS;

const getProviderDisplayName = (provider: ApiConnection['provider']): string => {
    return getConfiguredProviderDisplayName(provider);
};

const getApiKeyPlaceholder = (provider?: ApiConnection['provider']): string => {
    if (provider === 'xai') return 'xai-...';
    if (provider === 'openai') return 'sk-...';
    if (provider === 'anthropic') return 'sk-ant-...';
    if (provider === 'gemini') return 'AIza...';
    if (provider === 'deepseek') return 'sk-...';
    if (provider === 'qwen') return 'sk-...';
    if (provider === 'kimi') return 'sk-...';
    if (provider === 'glm') return 'API Key...';
    if (provider === 'custom') return '선택 사항';
    return 'API Key';
};

const createEmptyConnectionDraft = (): Partial<ApiConnection> => ({
    provider: 'gemini',
    modelName: DEFAULT_GEMINI_MODEL,
    apiKey: '',
    isActive: true,
});

const RESPONSE_LENGTH_OPTIONS = [
    { value: 'short', label: '짧게' },
    { value: 'medium', label: '보통' },
    { value: 'long', label: '길게' },
] as const;

const isInitialGreetingMessage = (message?: ChatMessage): boolean => {
    if (!message || message.role !== 'assistant') return false;
    return (
        message.id === 'welcome' ||
        message.id === 'onboarding-1' ||
        message.id.startsWith('welcome-') ||
        message.id.startsWith('onboarding-')
    );
};

type UsageContext = {
    agentId?: string;
    provider?: AppSettings['apiConnections'][number]['provider'];
    modelName?: string;
    mediaType?: 'text';
};

const formatSessionTimestamp = (date: Date): string => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const getSessionTimePeriod = (date: Date): string => {
    const hour = date.getHours();
    if (hour < 6) return 'late night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
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

        if (JSON.stringify(left.action ?? null) !== JSON.stringify(right.action ?? null)) {
            return false;
        }

        if (JSON.stringify(left.quickReplies ?? null) !== JSON.stringify(right.quickReplies ?? null)) {
            return false;
        }
    }

    return true;
};

const normalizeAssistantContent = (text: string): string => {
    let normalized = text || '';
    for (const [pattern, replacement] of LEGACY_MODEL_COPY_REPLACEMENTS) {
        normalized = normalized.replace(pattern, replacement);
    }
    return normalized;
};

const normalizeAssistantMessageContent = (message: ChatMessage): ChatMessage => {
    if (message.role !== 'assistant' || !message.content) return message;
    const nextContent = normalizeAssistantContent(message.content);
    return nextContent === message.content ? message : { ...message, content: nextContent };
};

const normalizeAssistantMessagesContent = (messages: ChatMessage[]): ChatMessage[] =>
    (Array.isArray(messages) ? messages : []).map(normalizeAssistantMessageContent);

const renderInlineRichText = (text: string, keyPrefix: string): React.ReactNode => {
    const chunks = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
    return chunks.map((chunk, idx) => {
        const boldMatch = chunk.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) return <strong key={`${keyPrefix}-${idx}`} className="font-medium">{boldMatch[1]}</strong>;

        const mutedMatch = chunk.match(/^\*([^*]+)\*$/);
        if (mutedMatch) {
            return (
                <span key={`${keyPrefix}-${idx}`} className="italic text-[#9b9a97]">
                    {mutedMatch[1]}
                </span>
            );
        }

        return <React.Fragment key={`${keyPrefix}-${idx}`}>{chunk}</React.Fragment>;
    });
};

const renderRichMessage = (content: string): React.ReactNode => {
    const lines = (content || '').split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    const pushParagraph = (paragraphLines: string[]) => {
        const text = paragraphLines.join('\n').trim();
        if (!text) return;
        const mutedBlock = text.match(/^\*([^*\n]+)\*$/);
        if (mutedBlock) {
            nodes.push(
                <p key={`p-${key++}`} className="whitespace-pre-line leading-relaxed italic text-[#9b9a97]">
                    {mutedBlock[1]}
                </p>
            );
            return;
        }
        nodes.push(
            <p key={`p-${key++}`} className="whitespace-pre-line leading-relaxed">
                {renderInlineRichText(text, `p-${key}`)}
            </p>
        );
    };

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            nodes.push(<div key={`sp-${key++}`} className="h-2" />);
            i += 1;
            continue;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            const level = heading[1].length;
            const headingClass =
                level === 1 ? 'text-base font-medium' : level === 2 ? 'text-[15px] font-medium' : 'text-sm font-medium';
            nodes.push(
                <div key={`h-${key++}`} className={headingClass}>
                    {renderInlineRichText(heading[2], `h-${key}`)}
                </div>
            );
            i += 1;
            continue;
        }

        if (/^[-*]\s+/.test(trimmed)) {
            const items: string[] = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
                i += 1;
            }
            nodes.push(
                <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1">
                    {items.map((item, idx) => (
                        <li key={`uli-${key}-${idx}`}>{renderInlineRichText(item, `uli-${key}-${idx}`)}</li>
                    ))}
                </ul>
            );
            continue;
        }

        if (/^\d+\.\s+/.test(trimmed)) {
            const items: Array<{ number: number; text: string }> = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                const match = lines[i].trim().match(/^(\d+)\.\s+(.+)$/);
                if (match) {
                    items.push({ number: Number(match[1]), text: match[2] });
                }
                i += 1;
            }
            const startNumber = items[0]?.number || 1;
            nodes.push(
                <ol key={`ol-${key++}`} start={startNumber} className="list-decimal pl-5 space-y-1">
                    {items.map((item, idx) => (
                        <li key={`oli-${key}-${idx}`}>{renderInlineRichText(item.text, `oli-${key}-${idx}`)}</li>
                    ))}
                </ol>
            );
            continue;
        }

        const paragraphLines: string[] = [];
        while (i < lines.length) {
            const current = lines[i].trim();
            if (!current || /^(#{1,3})\s+/.test(current) || /^[-*]\s+/.test(current) || /^\d+\.\s+/.test(current)) {
                break;
            }
            paragraphLines.push(lines[i]);
            i += 1;
        }
        pushParagraph(paragraphLines);
    }

    return <div className="space-y-1">{nodes}</div>;
};

const isExecutableAction = (action?: ChatMessageAction | null): action is Exclude<ChatMessageAction, { type: 'onboarding' }> =>
    Boolean(action && action.type !== 'onboarding');

const toPendingMessageAction = (action: ChatGeneratedAction | null | undefined): ChatMessageAction | null => {
    if (!action || action.type === 'none') return null;
    if (action.type === 'batch') {
        const actions = action.actions.filter(Boolean).slice(0, 5).map((item) => ({
            ...item,
            status: item.status || 'pending',
            executed: Boolean(item.executed),
        })) as ChatSingleGeneratedAction[];
        if (actions.length === 0) return null;
        if (actions.length === 1) return { ...actions[0], status: 'pending', executed: false };
        return { type: 'batch', actions, status: 'pending', executed: false };
    }
    return { ...action, status: action.status || 'pending', executed: Boolean(action.executed) };
};

const getActionItems = (action: ChatMessageAction): ChatSingleGeneratedAction[] => {
    if (action.type === 'batch') return action.actions || [];
    if (action.type === 'add_event' || action.type === 'add_todo' || action.type === 'add_journal_entry') return [action];
    return [];
};

const getActionKindLabel = (action: ChatSingleGeneratedAction): string => {
    if (action.type === 'add_event') return '일정';
    if (action.type === 'add_todo') return '할 일';
    return '메모';
};

const formatDateTimeSummary = (action: ChatSingleGeneratedAction): string => {
    if (action.type === 'add_event') {
        const { date, endDate, startTime, endTime, isAllDay } = action.data;
        const dateText = endDate && endDate !== date ? `${date} ~ ${endDate}` : date;
        if (isAllDay || !startTime) return `${dateText} · 종일`;
        return `${dateText} · ${startTime}${endTime ? `-${endTime}` : ''}`;
    }
    if (action.type === 'add_todo') {
        return action.data.dueDate ? `마감 ${action.data.dueDate}` : '마감일 없음';
    }
    return action.data.category || '메모장';
};

const getActionPrimaryText = (action: ChatSingleGeneratedAction): string => {
    if (action.type === 'add_event') return action.data.title;
    if (action.type === 'add_todo') return action.data.text;
    return action.data.title;
};

const getActionSecondaryText = (action: ChatSingleGeneratedAction): string => {
    if (action.type === 'add_event') return action.data.description || '';
    if (action.type === 'add_todo') {
        const parts = [action.data.category, action.data.listName].filter(Boolean);
        return parts.join(' · ');
    }
    return action.data.content;
};

const getActionStatusLabel = (action: ChatMessageAction): string => {
    if (action.status === 'completed') return '추가 완료';
    if (action.status === 'cancelled') return '취소됨';
    if (action.status === 'failed') return '실패';
    return '확인 대기';
};

// Helper: Get time-based greeting
const getTimeBasedGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 6) return '새벽에도 깨어계시네요!';
    if (hour < 12) return '좋은 아침이에요! ☀️';
    if (hour < 14) return '점심시간이네요! 🍚';
    if (hour < 18) return '좋은 오후예요! 🌤️';
    if (hour < 22) return '오늘 하루 어떠셨나요? ❤️';
    return '늦은 밤이네요. 오늘도 수고하셨어요 ❤️';
};

const ChatView: React.FC<ChatViewProps> = ({
    events,
    todos,
    entries,
    todoLists,
    onAddEvent,
    onDeleteEvent,
    onAddTodo,
    onAddEntry,
    requireConfirm = true,
    settings,
    onUpdateSettings,
    agent,
    agents = [],
    selectedAgentIds = [],
    selectedAgents = [],
    onSelectAgents,
    onUpdateAgent,
    onUserMessage,
    isGuest = false,
    onRequestAuth,
    initialMessages,
    onUpdateMessages,
    chatSessions = [],
    currentSessionId,
    personaMemoryContext,
    personaMemoryContextByAgent = {},
    defaultUserName = '',
}) => {
    // Check if this is first visit (onboarding flow)
    const [userName, setUserName] = useState<string>(defaultUserName);
    const [onboardingStep, setOnboardingStep] = useState<number>(() => defaultUserName ? -1 : 0);

    const getWelcomeMessage = (): ChatMessage => {
        if (onboardingStep === 0 && !userName) {
            // First time user - start onboarding
            return {
                id: `onboarding-${crypto.randomUUID()}`,
                role: 'assistant',
                content: `${getTimeBasedGreeting()}\n\n처음 오셨네요! 저는 ${agent?.name || 'Dayflow'}예요. ${agent?.emoji || '💬'}\n당신의 일상을 함께 정리하고 더 나은 하루를 만들어 드릴게요.\n\n먼저, 뭐라고 불러드리면 될까요?`,
                timestamp: new Date().toISOString(),
                agentId: agent?.id,
                action: { type: 'onboarding' },
            };
        }

        // Returning user - personalized greeting
        return {
            id: `welcome-${crypto.randomUUID()}`,
            role: 'assistant',
            content: `${userName ? `${userName}님, ` : ''}무엇부터 함께 해볼까요? ❤️\n\n일정과 할 일을 정리하거나 머릿속 생각을 편하게 나눠주세요.\n필요한 내용은 제가 차근차근 정리해드릴게요.`,
            timestamp: new Date().toISOString(),
            agentId: agent?.id,
            quickReplies: ['오늘 일정 정리', '할 일 정리', '생각 정리', '편하게 대화'],
        };
    };

    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        if (initialMessages && initialMessages.length > 0) return normalizeAssistantMessagesContent(initialMessages);
        return [getWelcomeMessage()];
    });
    const [inputValue, setInputValue] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showToolbar, setShowToolbar] = useState(false);
    const [isReasoningPopoverOpen, setIsReasoningPopoverOpen] = useState(false);
    const reasoningControlRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isReasoningPopoverOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (reasoningControlRef.current && !reasoningControlRef.current.contains(event.target as Node)) {
                setIsReasoningPopoverOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsReasoningPopoverOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isReasoningPopoverOpen]);
    const [activeModalType, setActiveModalType] = useState<'model' | 'persona' | null>(null);
    const [selectedModalProvider, setSelectedModalProvider] = useState<ApiConnection['provider']>('gemini');
    const [selectedModalModel, setSelectedModalModel] = useState<string>(DEFAULT_GEMINI_MODEL);
    const [selectedModalApiKey, setSelectedModalApiKey] = useState('');
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

    const handleSelectQuickModel = (provider: ApiConnection['provider'], modelName: string, apiKey: string) => {
        if (!onUpdateSettings) return;
        onUpdateSettings((prev) => {
            const currentConnections = prev.apiConnections || [];
            const existing = currentConnections.find(c => c.provider === provider);
            const trimmedApiKey = apiKey.trim();

            let updated: ApiConnection[];
            let targetId: string;

            if (existing) {
                targetId = existing.id;
                updated = currentConnections.map(c =>
                    c.id === existing.id
                        ? {
                            ...c,
                            apiKey: trimmedApiKey || c.apiKey,
                            modelName: normalizeProviderModelName(provider, modelName),
                            isActive: true,
                        }
                        : { ...c, isActive: false }
                );
            } else {
                const newConn: ApiConnection = {
                    id: crypto.randomUUID(),
                    provider,
                    apiKey: trimmedApiKey,
                    modelName: normalizeProviderModelName(provider, modelName),
                    baseUrl: getProviderDefaultBaseUrl(provider),
                    isActive: true,
                };
                targetId = newConn.id;
                updated = [...currentConnections.map(c => ({ ...c, isActive: false })), newConn];
            }

            return {
                ...prev,
                apiConnections: updated,
                activeConnectionId: targetId,
            };
        });
        setShowModelPicker(false);
    };
    const [agentDraft, setAgentDraft] = useState<AIAgent | null>(null);
    const [agentEditorTab, setAgentEditorTab] = useState<PersonaEditorTab>('profile');
    const [isSavingAgent, setIsSavingAgent] = useState(false);
    const [isAvatarCropOpen, setIsAvatarCropOpen] = useState(false);
    const [agentApiSelection, setAgentApiSelection] = useState<ApiSelection>('__default__');
    const [agentApiDraft, setAgentApiDraft] = useState<Partial<ApiConnection>>(createEmptyConnectionDraft);
    const [isAgentApiDirty, setIsAgentApiDirty] = useState(false);
    const [isTestingAgentApi, setIsTestingAgentApi] = useState(false);
    const [agentLocalModels, setAgentLocalModels] = useState<string[]>([]);
    const [isLoadingAgentLocalModels, setIsLoadingAgentLocalModels] = useState(false);
    const [executingActionMessageId, setExecutingActionMessageId] = useState<string | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const modelPickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showModelPicker) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
                setShowModelPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showModelPicker]);
    const pendingSessionHydrationRef = useRef(false);
    const hydratingSessionIdRef = useRef<string | null>(null);
    const previousSessionIdRef = useRef<string | null>(currentSessionId ?? null);
    const suppressAutoScrollRef = useRef(false);
    const lastSyncedSignatureRef = useRef<string>('');
    const onUpdateMessagesRef = useRef(onUpdateMessages);

    const availableAgents = agents.length > 0 ? agents : (agent ? [agent] : []);
    const selectedAgentPool = selectedAgents.length > 0
        ? selectedAgents
        : (selectedAgentIds.length > 0
            ? selectedAgentIds
                .map((id) => availableAgents.find((availableAgent) => availableAgent.id === id))
                .filter(Boolean) as AIAgent[]
            : (agent ? [agent] : availableAgents.slice(0, 1)));
    const dedupedSelectedAgentPool = selectedAgentPool.filter((candidate, index, list) =>
        candidate?.id && list.findIndex((item) => item?.id === candidate.id) === index
    );
    const activeAgents = dedupedSelectedAgentPool.length > 0
        ? dedupedSelectedAgentPool.slice(0, MAX_GROUP_AGENTS)
        : (availableAgents.length > 0 ? [availableAgents[0]] : []);
    const primaryAgent = activeAgents[0] || agent || availableAgents[0];
    const supportedChatConnections = (settings.apiConnections || []).filter(
        (connection) => isChatSupportedProvider(connection.provider)
    );
    const activeConnection = supportedChatConnections.find(connection => connection.id === settings.activeConnectionId)
        || supportedChatConnections[0];

    useEffect(() => {
        if (activeModalType === 'model') {
            const currentProvider = activeConnection?.provider || 'gemini';
            const currentModel = activeConnection?.modelName || getDefaultModelForProvider(currentProvider);
            setSelectedModalProvider(currentProvider);
            setSelectedModalModel(currentModel);
            setSelectedModalApiKey(activeConnection?.apiKey || '');
        }
    }, [activeModalType, activeConnection]);
    const modalProviderNeedsApiKey = selectedModalProvider !== 'ollama' && selectedModalProvider !== 'custom';
    const agentApiModelOptions = agentApiDraft.provider
        ? getModelOptionsForProvider(agentApiDraft.provider)
        : [];

    useEffect(() => {
        if (!editingAgentId) return;
        const provider = agentApiDraft.provider;
        if (provider !== 'ollama' && provider !== 'custom') {
            setAgentLocalModels([]);
            return;
        }

        let cancelled = false;
        const restoreLocalModels = async () => {
            try {
                const models = provider === 'ollama'
                    ? await listOllamaModels(agentApiDraft.baseUrl || DEFAULT_OLLAMA_BASE_URL)
                    : await listLocalServerModels(agentApiDraft.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, agentApiDraft.apiKey);
                if (!cancelled) setAgentLocalModels(models);
            } catch {
                if (!cancelled) setAgentLocalModels([]);
            }
        };
        void restoreLocalModels();
        return () => { cancelled = true; };
    }, [editingAgentId, agentApiDraft.provider, agentApiDraft.baseUrl]);

    const updateApiUsage = (stats?: Partial<ApiUsageStats>, context?: UsageContext) => {
        if (!stats || !onUpdateSettings) return;

        onUpdateSettings((prev) => {
            const previousUsage = prev.apiUsage || {
                totalRequests: 0,
                totalTokens: 0,
            };
            const agentId = context?.agentId;
            const previousAgentUsage = agentId
                ? (prev.agentUsageById?.[agentId] || {
                    totalRequests: 0,
                    totalTokens: 0,
                    textResponses: 0,
                })
                : null;

            return {
                ...prev,
                apiUsage: {
                    totalRequests: (previousUsage.totalRequests || 0) + (stats.totalRequests || 0),
                    totalTokens: (previousUsage.totalTokens || 0) + (stats.totalTokens || 0),
                    lastRequestDate: stats.lastRequestDate || new Date().toISOString(),
                },
                agentUsageById: agentId
                    ? {
                        ...(prev.agentUsageById || {}),
                        [agentId]: {
                            totalRequests: (previousAgentUsage?.totalRequests || 0) + (stats.totalRequests || 0),
                            totalTokens: (previousAgentUsage?.totalTokens || 0) + (stats.totalTokens || 0),
                            textResponses: (previousAgentUsage?.textResponses || 0) + (context?.mediaType === 'text' ? 1 : 0),
                            lastRequestDate: stats.lastRequestDate || new Date().toISOString(),
                            lastProvider: context?.provider || previousAgentUsage?.lastProvider,
                            lastModelName: context?.modelName || previousAgentUsage?.lastModelName,
                        },
                    }
                    : prev.agentUsageById,
            };
        });
    };

    const openAgentEditor = (target?: AIAgent) => {
        if (!target || !onUpdateAgent) return;
        if (isGuest) {
            onRequestAuth?.();
            return;
        }
        const selectedConnection = supportedChatConnections.find(connection => connection.id === target.connectionId);
        const initialConnection = selectedConnection || activeConnection;
        setIsAvatarCropOpen(false);
        setAgentEditorTab('profile');
        setEditingAgentId(target.id);
        setAgentDraft({ ...target });
        setAgentApiSelection(selectedConnection ? selectedConnection.id : '__default__');
        setAgentApiDraft(initialConnection ? { ...initialConnection } : createEmptyConnectionDraft());
        setAgentLocalModels([]);
        setIsAgentApiDirty(false);
    };

    const closeAgentEditor = (force = false) => {
        if (isSavingAgent && !force) return;
        setIsAvatarCropOpen(false);
        setEditingAgentId(null);
        setAgentDraft(null);
        setIsAgentApiDirty(false);
    };

    const updateAgentApiDraft = (updates: Partial<ApiConnection>) => {
        setAgentApiDraft(prev => ({ ...prev, ...updates }));
        setIsAgentApiDirty(true);
    };

    const handleAgentApiSelectionChange = (selection: ApiSelection) => {
        setAgentApiSelection(selection);
        setAgentLocalModels([]);
        if (selection === '__new__') {
            setAgentApiDraft(createEmptyConnectionDraft());
            setIsAgentApiDirty(true);
            return;
        }
        const connection = selection === '__default__'
            ? activeConnection
            : supportedChatConnections.find(candidate => candidate.id === selection);
        setAgentApiDraft(connection ? { ...connection } : createEmptyConnectionDraft());
        setIsAgentApiDirty(false);
    };

    const validateAgentApiDraft = (): string | null => {
        const provider = agentApiDraft.provider || 'gemini';
        if (!(agentApiDraft.modelName || '').trim()) return '사용할 모델을 선택하거나 입력해 주세요.';
        if (provider === 'ollama' || provider === 'custom') {
            if (!(agentApiDraft.baseUrl || '').trim()) return '로컬 서버 주소를 입력해 주세요.';
            return null;
        }
        if (isHostedOpenAICompatibleProvider(provider) && !(agentApiDraft.baseUrl || getProviderDefaultBaseUrl(provider) || '').trim()) {
            return '해당 서비스의 연결 주소를 확인해 주세요.';
        }
        if (!(agentApiDraft.apiKey || '').trim()) return 'API Key를 입력해 주세요.';
        return null;
    };

    const loadAgentLocalModels = async () => {
        const provider = agentApiDraft.provider;
        if (provider !== 'ollama' && provider !== 'custom') return;
        setIsLoadingAgentLocalModels(true);
        try {
            const models = provider === 'ollama'
                ? await listOllamaModels(agentApiDraft.baseUrl || DEFAULT_OLLAMA_BASE_URL)
                : await listLocalServerModels(agentApiDraft.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, agentApiDraft.apiKey);
            setAgentLocalModels(models);
            if (models.length > 0) {
                updateAgentApiDraft({ modelName: models.includes(agentApiDraft.modelName || '') ? agentApiDraft.modelName : models[0] });
            } else {
                alert('서버에서 불러올 수 있는 모델이 없습니다. 모델 이름을 직접 입력해 주세요.');
            }
        } catch (error: any) {
            alert(`로컬 모델을 불러오지 못했습니다: ${error?.message || '알 수 없는 오류'}`);
        } finally {
            setIsLoadingAgentLocalModels(false);
        }
    };

    const testAgentApiDraft = async () => {
        const validationError = validateAgentApiDraft();
        if (validationError) {
            alert(validationError);
            return;
        }
        const provider = agentApiDraft.provider || 'gemini';
        const modelName = normalizeProviderModelName(provider, agentApiDraft.modelName || '');
        const apiKey = (agentApiDraft.apiKey || '').trim();
        setIsTestingAgentApi(true);
        try {
            if (provider === 'ollama') {
                await testOllamaConnection(agentApiDraft.baseUrl, modelName);
            } else if (provider === 'custom') {
                await testLocalServerConnection(agentApiDraft.baseUrl, apiKey, modelName);
            } else if (provider === 'xai') {
                await testXaiConnection(apiKey, modelName);
            } else if (provider === 'openai') {
                await testOpenAIConnection(apiKey, modelName);
            } else if (provider === 'anthropic') {
                await testAnthropicConnection(apiKey, modelName);
            } else if (isHostedOpenAICompatibleProvider(provider)) {
                await testOpenAICompatibleConnection(apiKey, agentApiDraft.baseUrl || getProviderDefaultBaseUrl(provider) || '', modelName);
            } else {
                await callGeminiAPI(apiKey, '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.', undefined, modelName);
            }
            alert(`연결 성공: ${modelName}`);
        } catch (error: any) {
            alert(`연결 실패: ${error?.message || '알 수 없는 오류'}`);
        } finally {
            setIsTestingAgentApi(false);
        }
    };

    const handleAgentImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기가 너무 큽니다 (최대 5MB).');
            return;
        }

        try {
            const imageUrl = await readImageFileAsDataUrl(file);
            setAgentDraft((prev) => (prev ? { ...prev, avatar: imageUrl, avatarFrame: undefined } : prev));
            setIsAvatarCropOpen(true);
        } catch (error) {
            alert((error as Error).message || '이미지를 불러오지 못했습니다.');
        }
    };

    const updateAgentDraftAvatarFrame = (avatarFrame?: AIAgent['avatarFrame']) => {
        setAgentDraft(prev => prev ? { ...prev, avatarFrame } : prev);
    };

    const handleSaveAgent = async () => {
        if (!editingAgentId || !agentDraft || !onUpdateAgent) return;

        let nextConnectionId = agentApiSelection === '__default__' ? undefined : agentDraft.connectionId;
        let connectionToPersist: ApiConnection | null = null;
        if (isAgentApiDirty || agentApiSelection === '__new__') {
            const validationError = validateAgentApiDraft();
            if (validationError) {
                setAgentEditorTab('api');
                alert(validationError);
                return;
            }
            if (!onUpdateSettings) {
                alert('API 연결을 저장할 수 없습니다. 설정에서 다시 시도해 주세요.');
                return;
            }
            const provider = agentApiDraft.provider || 'gemini';
            const connectionId = agentApiSelection === '__new__'
                ? crypto.randomUUID()
                : (agentApiDraft.id || crypto.randomUUID());
            connectionToPersist = {
                id: connectionId,
                provider,
                modelName: normalizeProviderModelName(provider, agentApiDraft.modelName || ''),
                apiKey: provider === 'ollama' ? '' : (agentApiDraft.apiKey || '').trim(),
                baseUrl: provider === 'ollama' || provider === 'custom' || isHostedOpenAICompatibleProvider(provider)
                    ? (agentApiDraft.baseUrl || (provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : getProviderDefaultBaseUrl(provider) || '')).trim()
                    : undefined,
                isActive: true,
            };
            nextConnectionId = agentApiSelection === '__default__' ? undefined : connectionId;
        } else if (agentApiSelection !== '__default__') {
            nextConnectionId = agentApiSelection;
        }

        setIsSavingAgent(true);
        try {
            if (connectionToPersist && onUpdateSettings) {
                const savedConnection = connectionToPersist;
                onUpdateSettings(prev => {
                    const currentConnections = prev.apiConnections || [];
                    const exists = currentConnections.some(connection => connection.id === savedConnection.id);
                    const nextConnections = exists
                        ? currentConnections.map(connection => connection.id === savedConnection.id ? savedConnection : connection)
                        : [...currentConnections, savedConnection];
                    const hasCurrentDefault = nextConnections.some(connection => connection.id === prev.activeConnectionId);
                    const activeConnectionId = agentApiSelection === '__default__' || !hasCurrentDefault
                        ? savedConnection.id
                        : prev.activeConnectionId;
                    const activeGemini = nextConnections.find(connection => connection.id === activeConnectionId && connection.provider === 'gemini')
                        || nextConnections.find(connection => connection.provider === 'gemini');
                    return {
                        ...prev,
                        apiConnections: nextConnections.map(connection => ({ ...connection, isActive: true })),
                        activeConnectionId,
                        geminiApiKey: activeGemini?.apiKey || '',
                    };
                });
            }
            await Promise.resolve(onUpdateAgent(editingAgentId, {
                name: agentDraft.name,
                role: agentDraft.role,
                tone: agentDraft.tone,
                personality: agentDraft.personality,
                avatar: (agentDraft.avatar || '').trim() || undefined,
                avatarFrame: agentDraft.avatar ? agentDraft.avatarFrame : undefined,
                connectionId: nextConnectionId,
                responseLength: agentDraft.responseLength || 'medium',
            }));
            closeAgentEditor(true);
        } catch (error) {
            console.error(error);
            alert('페르소나 저장 중 오류가 발생했어요.');
        } finally {
            setIsSavingAgent(false);
        }
    };

    const getAgentForMessage = (message: ChatMessage): AIAgent | undefined => {
        if (message.role !== 'assistant') return undefined;
        if (message.agentId) {
            return availableAgents.find((availableAgent) => availableAgent.id === message.agentId) || primaryAgent;
        }
        return primaryAgent;
    };

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
        const container = messagesContainerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
    };

    useEffect(() => {
        if (suppressAutoScrollRef.current) {
            suppressAutoScrollRef.current = false;
            return;
        }

        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        onUpdateMessagesRef.current = onUpdateMessages;
    }, [onUpdateMessages]);

    useEffect(() => {
        const normalizedMessages = normalizeAssistantMessagesContent(messages);
        if (isSameChatMessageList(messages, normalizedMessages)) return;
        setMessages(normalizedMessages);
    }, [messages]);

    // Update messages when switching sessions
    useEffect(() => {
        const nextSessionId = currentSessionId ?? null;
        const sessionChanged = previousSessionIdRef.current !== nextSessionId;
        previousSessionIdRef.current = nextSessionId;

        if (currentSessionId) {
            if (sessionChanged) {
                suppressAutoScrollRef.current = true;
            }
            // When the very first user message creates a new session in parent state,
            // keep local messages instead of resetting to welcome text.
            if (pendingSessionHydrationRef.current && (!initialMessages || initialMessages.length === 0)) {
                pendingSessionHydrationRef.current = false;
                hydratingSessionIdRef.current = null;
                return;
            }

            if (initialMessages && initialMessages.length > 0) {
                const normalizedInitialMessages = normalizeAssistantMessagesContent(initialMessages);
                if (sessionChanged) {
                    hydratingSessionIdRef.current = currentSessionId;
                }
                setMessages(prev => {
                    if (isSameChatMessageList(prev, normalizedInitialMessages)) return prev;
                    return normalizedInitialMessages;
                });
            } else {
                // If it's an existing session ID but no messages yet, it might be loading.
                // Only reset if we are sure it's meant to be an empty new session.
                const isNewSession = !chatSessions.find(s => s.id === currentSessionId);
                
                if (isNewSession) {
                    setMessages(prev => {
                        const isAlreadyWelcome = prev.length === 1 && isInitialGreetingMessage(prev[0]);
                        return isAlreadyWelcome ? prev : [getWelcomeMessage()];
                    });
                }
            }
        } else {
            hydratingSessionIdRef.current = null;
            // No session - reset to welcome
            setMessages(prev => {
                const isAlreadyWelcome = prev.length === 1 && isInitialGreetingMessage(prev[0]);
                return isAlreadyWelcome ? prev : [getWelcomeMessage()];
            });
        }
    }, [currentSessionId, initialMessages]);

    // Notify parent of message updates
    useEffect(() => {
        const updateMessages = onUpdateMessagesRef.current;
        if (!currentSessionId || !updateMessages || messages.length <= 1) return;
        const normalizedMessages = normalizeAssistantMessagesContent(messages);

        if (hydratingSessionIdRef.current === currentSessionId) {
            const normalizedInitialMessages = initialMessages ? normalizeAssistantMessagesContent(initialMessages) : null;
            if (!normalizedInitialMessages || !isSameChatMessageList(normalizedMessages, normalizedInitialMessages)) return;
            hydratingSessionIdRef.current = null;
        }

        // Session switch hydration should not immediately write back identical payloads,
        // unless the persisted payload still contains legacy copy that needs cleanup.
        if (initialMessages) {
            const normalizedInitialMessages = normalizeAssistantMessagesContent(initialMessages);
            const initialMessagesAlreadyNormalized = isSameChatMessageList(initialMessages, normalizedInitialMessages);
            if (initialMessagesAlreadyNormalized && isSameChatMessageList(normalizedMessages, normalizedInitialMessages)) return;
        }

        const signature = `${currentSessionId}:${normalizedMessages.map(m => `${m.id}:${m.timestamp}:${m.content}`).join('|')}`;
        if (lastSyncedSignatureRef.current === signature) return;
        lastSyncedSignatureRef.current = signature;

        // Ensure we defer the parent state update to avoid rendering loops
        const timeoutId = window.setTimeout(() => {
            if (!isSameChatMessageList(messages, normalizedMessages)) {
                setMessages(normalizedMessages);
            }
            updateMessages(currentSessionId, normalizedMessages);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [messages, currentSessionId, initialMessages]);

    useEffect(() => {
        if (!userName && defaultUserName) {
            setUserName(defaultUserName);
            setOnboardingStep(-1);
        }
    }, [defaultUserName, userName]);

    const parseOnboardingIntent = (text: string): ChatMessage['action'] | null => {
        if (onboardingStep === 0 && !userName) {
            const cleaned = text
                .trim()
                .replace(/^(hi|hello|hey|안녕|안녕하세요)\s*/i, '')
                .trim();
            return { type: 'onboarding', data: { step: 1, name: (cleaned || text.trim()).slice(0, 20) } };
        }
        if (onboardingStep === 1) {
            return { type: 'onboarding', data: { step: 2, preference: text } };
        }

        return null;
    };

    const mapGeminiActionToChatAction = (action: ChatActionResult['action'] | null | undefined): ChatMessage['action'] | null =>
        toPendingMessageAction(action);

    const resolveTodoListId = (listName?: string): string | undefined => {
        const normalized = (listName || '').trim().toLowerCase();
        if (!normalized) return todoLists[0]?.id;
        const matched = todoLists.find((list) => {
            const title = (list.title || '').trim().toLowerCase();
            return Boolean(title) && (title === normalized || title.includes(normalized) || normalized.includes(title));
        });
        return matched?.id || todoLists[0]?.id;
    };

    const executeSingleAction = async (action: ChatSingleGeneratedAction): Promise<ChatSingleGeneratedAction> => {
        try {
            if (action.type === 'add_event') {
                const event: CalendarEvent = {
                    id: crypto.randomUUID(),
                    title: action.data.title,
                    date: action.data.date,
                    endDate: action.data.endDate,
                    startTime: action.data.isAllDay ? undefined : action.data.startTime,
                    endTime: action.data.isAllDay ? undefined : action.data.endTime,
                    isAllDay: action.data.isAllDay ?? !action.data.startTime,
                    description: action.data.description,
                    type: action.data.type || 'tag_1',
                };
                await onAddEvent(event);
                return { ...action, status: 'completed', executed: true };
            }

            if (action.type === 'add_todo') {
                await onAddTodo(
                    action.data.text,
                    resolveTodoListId(action.data.listName),
                    action.data.dueDate,
                    undefined,
                    action.data.category || 'personal'
                );
                return { ...action, status: 'completed', executed: true };
            }

            await onAddEntry(
                action.data.title,
                action.data.content,
                action.data.category || '메모장',
                action.data.mood || 'neutral'
            );
            return { ...action, status: 'completed', executed: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : '알 수 없는 오류';
            return { ...action, status: 'failed', executed: false, error: message };
        }
    };

    const executeAction = async (action: ChatMessage['action']): Promise<ChatMessage['action']> => {
        if (!action) return action;

        if (action.type === 'onboarding') {
            if (action.data?.step === 1) {
                setUserName(action.data.name);
                setOnboardingStep(1);
            } else if (action.data?.step === 2) {
                setOnboardingStep(-1); // Onboarding complete
            }
            return { ...action, status: 'completed', executed: true };
        }

        if (action.type === 'batch') {
            const executedActions = [];
            for (const item of action.actions || []) {
                executedActions.push(await executeSingleAction(item));
            }
            const hasFailure = executedActions.some((item) => item.status === 'failed');
            return {
                ...action,
                actions: executedActions,
                status: hasFailure ? 'failed' : 'completed',
                executed: !hasFailure,
                error: hasFailure ? '일부 항목을 추가하지 못했어요.' : undefined,
            };
        }

        return executeSingleAction(action);
    };

    const handleConfirmMessageAction = async (messageId: string, action: ChatMessageAction) => {
        if (!isExecutableAction(action) || executingActionMessageId) return;
        setExecutingActionMessageId(messageId);
        try {
            const updatedAction = await executeAction(action);
            setMessages((prev) => prev.map((message) =>
                message.id === messageId ? { ...message, action: updatedAction || undefined } : message
            ));
        } finally {
            setExecutingActionMessageId(null);
        }
    };

    const handleCancelMessageAction = (messageId: string, action: ChatMessageAction) => {
        if (!isExecutableAction(action)) return;
        const cancelledAction: ChatMessageAction = {
            ...action,
            status: 'cancelled',
            executed: false,
        };
        setMessages((prev) => prev.map((message) =>
            message.id === messageId ? { ...message, action: cancelledAction } : message
        ));
    };

    const getResponseForAction = (action: ChatMessage['action'] | null, userText: string): { content: string; quickReplies?: string[] } => {
        // Onboarding responses
        if (action?.type === 'onboarding') {
            if (action.data?.step === 1) {
                return {
                    content: `사용자님 반가워요! 🎉\n\n저와 어떤 이야기를 나누고 싶으세요?\n\n편하게 선택해주시거나 자유롭게 말씀해주세요!`,
                    quickReplies: ['그냥 이야기하고 싶어', '아이디어를 정리하고 싶어', '기억해둘 내용이 있어', '고민 상담을 받고 싶어'],
                };
            }
            if (action.data?.step === 2) {
                return {
                    content: `좋아요! 이제 준비가 됐어요. ✨\n\n사용자님의 하루를 더 나은 방향으로 이끌어 드릴게요.\n\n그럼 바로 시작해볼까요? 무엇이든 편하게 말씀해주세요!`,
                    quickReplies: ['오늘 기분 이야기', '아이디어 정리', '이거 기억해줘'],
                };
            }
        }

        if (!action) {
            if (userText.length < 10 && !userText.includes('?')) {
                return {
                    content: `네 사용자님! 더 말씀해주세요. 듣고 있어요. 😊`,
                    quickReplies: ['계속 이야기할게', '아이디어 더 말할게', '이거 기억해줘'],
                };
            }

            return {
                content: `음, 요청을 정확히 이해하지 못했어요. 😅\n\n혹시 이런 걸 원하셨나요?`,
                quickReplies: ['대화 이어가기', '아이디어 정리', '기억에 저장하기', '다르게 말해볼게'],
            };
        }

        return { content: '처리 완료!' };
    };

    const resolveAgentConfig = (targetAgent?: AIAgent) => {
        return getAgentAIConfig(settings, targetAgent?.connectionId) || {
            provider: 'gemini' as const,
            apiKey: DAYFLOW_TRIAL_API_KEY,
            modelName: DAYFLOW_TRIAL_MODEL,
        };
    };

    const reasoningEffort = settings.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    // The trial key goes through a server proxy that doesn't forward thinking settings.
    const isReasoningEffortSupported = activeAgents.some((activeAgent) => {
        const config = resolveAgentConfig(activeAgent);
        return config.apiKey !== DAYFLOW_TRIAL_API_KEY && supportsReasoningEffort(config.provider, config.modelName);
    });
    const selectedReasoningOption = REASONING_EFFORT_OPTIONS.find(option => option.id === reasoningEffort) || REASONING_EFFORT_OPTIONS[0];
    const primaryAgentConfig = resolveAgentConfig(primaryAgent);
    const primaryModelLabel = primaryAgentConfig.apiKey === DAYFLOW_TRIAL_API_KEY
        ? '체험 모델'
        : (getModelOptionsForProvider(primaryAgentConfig.provider).find(option => option.id === primaryAgentConfig.modelName)?.label
            || primaryAgentConfig.modelName
            || getConfiguredProviderDisplayName(primaryAgentConfig.provider));
    const handleReasoningEffortChange = (nextEffort: typeof reasoningEffort) => {
        onUpdateSettings?.((prev) => ({ ...prev, reasoningEffort: nextEffort }));
    };

    const getAgentConnectionWarning = (targetAgent?: AIAgent): string => {
        if (!targetAgent) return '사용 가능한 AI 연결을 찾지 못했어요. 설정에서 API 연결을 확인해 주세요.';
        if (!targetAgent.connectionId && !getActiveAIConfig(settings)) return '사용 가능한 기본 API 연결이 없어요. 설정이나 페르소나 편집에서 API를 연결해 주세요.';

        const conn = (settings.apiConnections || []).find(c => c.id === targetAgent.connectionId);
        if (!conn) {
            return `${targetAgent.name}에 지정된 API 연결을 찾지 못했어요. 페르소나 설정에서 다시 연결해 주세요.`;
        }
        if ((conn.provider === 'ollama' || conn.provider === 'custom') && !conn.baseUrl?.trim()) {
            return `${targetAgent.name}의 로컬 서버 주소가 비어 있어 응답할 수 없어요.`;
        }
        if (conn.provider !== 'ollama' && conn.provider !== 'custom' && !conn.apiKey?.trim()) {
            return `${targetAgent.name}의 API Key가 비어 있어 응답할 수 없어요.`;
        }
        if (!isChatSupportedProvider(conn.provider)) {
            return `${targetAgent.name}에 연결된 모델은 현재 채팅에서 지원되지 않아요. 페르소나 설정에서 채팅용 모델을 지정해 주세요.`;
        }
        return `${targetAgent.name}의 AI 연결을 사용할 수 없어요. 연결 상태를 확인해 주세요.`;
    };

    const withConfigMeta = (
        message: ChatMessage,
        config?: { provider: string; modelName: string; connectionId?: string }
    ): ChatMessage => {
        if (!config) return message;
        return {
            ...message,
            provider: config.provider as ChatMessage['provider'],
            modelName: config.modelName,
            connectionId: config.connectionId,
        };
    };

    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const normalizeMentionText = (value: string): string =>
        (value || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[.,!?~`"'“”‘’_\-:/\\|()[\]{}<>]/g, '');

    const resolveDirectAddressedAgentIds = (text: string, candidates: AIAgent[]): string[] => {
        if (!text.trim() || candidates.length === 0) return [];

        const lowered = text.toLowerCase();
        const normalized = normalizeMentionText(text);
        const mentionsAll = /(?:^|\s)@all\b|모두|다들|전체|everyone|all of you/i.test(text);
        if (mentionsAll) return candidates.map((candidate) => candidate.id);

        const matchedIds = new Set<string>();
        for (const candidate of candidates) {
            const name = (candidate.name || '').trim();
            if (!name) continue;

            const loweredName = name.toLowerCase();
            const normalizedName = normalizeMentionText(name);
            const atMention = new RegExp(`@\\s*${escapeRegExp(loweredName)}(?:\\b|님)?`, 'i');

            if (atMention.test(lowered)) {
                matchedIds.add(candidate.id);
                continue;
            }

            if (normalizedName.length >= 2 && normalized.includes(normalizedName)) {
                matchedIds.add(candidate.id);
            }
        }

        return Array.from(matchedIds);
    };

    const buildHistoryForAgent = (
        allMessages: ChatMessage[],
        targetAgent?: AIAgent,
        options: { allowUntypedAssistant?: boolean; includePeerPersonaContext?: boolean } = {}
    ) => {
        const allowUntypedAssistant = options.allowUntypedAssistant ?? false;
        const includePeerPersonaContext = options.includePeerPersonaContext ?? false;
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        for (const message of allMessages) {
            const content = (message.content || '').trim();
            if (!content) continue;

            if (message.role === 'user') {
                history.push({ role: 'user', content });
                continue;
            }

            if (message.role !== 'assistant') continue;
            if (!targetAgent?.id) continue;

            const isSelfMessage = message.agentId === targetAgent.id || (allowUntypedAssistant && !message.agentId);
            if (isSelfMessage) {
                history.push({ role: 'assistant', content });
                continue;
            }

            if (includePeerPersonaContext && message.agentId) {
                const peerName = availableAgents.find((availableAgent) => availableAgent.id === message.agentId)?.name || '다른 페르소나';
                history.push({
                    role: 'user',
                    content: `[${peerName}의 발화] ${content}`,
                });
            }
        }

        return history.slice(-CHAT_HISTORY_LIMIT);
    };

    const buildSharedSceneContext = (allMessages: ChatMessage[]): string => {
        const lines = allMessages
            .slice(-SHARED_SCENE_MESSAGE_LIMIT)
            .map((message) => {
                const content = (message.content || '').trim();
                if (!content) return '';
                if (message.role === 'user') return `${userName || '사용자'}: ${content}`;
                const speaker = availableAgents.find((candidate) => candidate.id === message.agentId)?.name || '페르소나';
                return `${speaker}: ${content}`;
            })
            .filter(Boolean);
        const joined = lines.join('\n');
        return joined.length > SHARED_SCENE_CHAR_LIMIT
            ? joined.slice(-SHARED_SCENE_CHAR_LIMIT)
            : joined;
    };

    const handleSend = async (text?: string) => {
        const messageText = text || inputValue;
        if (!messageText.trim() || isProcessing) return;
        if (isGuest) {
            onRequestAuth?.();
            return;
        }

        const trimmedMessage = messageText.trim();
        const addressedAgentIdsForInput = resolveDirectAddressedAgentIds(trimmedMessage, activeAgents);
        const hasPriorUserMessages = messages.some((message) => message.role === 'user');
        const sessionRecord = currentSessionId ? chatSessions.find((session) => session.id === currentSessionId) : undefined;
        const sessionStartDate = sessionRecord?.createdAt ? new Date(sessionRecord.createdAt) : new Date();
        const sessionStartedAt = formatSessionTimestamp(sessionStartDate);
        const sessionTimePeriod = getSessionTimePeriod(sessionStartDate);
        const sessionTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
        const isNewSession = !hasPriorUserMessages;
        const trialTurnId = crypto.randomUUID();
        if (!currentSessionId) {
            pendingSessionHydrationRef.current = true;
        }
        try {
            onUserMessage?.(trimmedMessage, {
                activeAgentIds: activeAgents.map((activeAgent) => activeAgent.id),
                addressedAgentIds: addressedAgentIdsForInput,
                isNewSession,
                sessionStartedAt,
                sessionTimePeriod,
                sessionTimezone,
            });
        } catch (error) {
            pendingSessionHydrationRef.current = false;
            console.error('onUserMessage callback failed:', error);
        }

        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: messageText,
            timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInputValue('');
        setIsProcessing(true);

        const messageTimeline = [...messages, userMessage];

        const hasAnyAgentConfig = activeAgents.some((activeAgent) => hasUsableAIConnection(resolveAgentConfig(activeAgent)));
        const onboardingAction = parseOnboardingIntent(messageText);
        if (onboardingAction) {
            await executeAction(onboardingAction);
            const response = getResponseForAction(onboardingAction, messageText);
            const assistantMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: response.content,
                timestamp: new Date().toISOString(),
                agentId: primaryAgent?.id,
                action: { ...onboardingAction, executed: true },
                quickReplies: response.quickReplies,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setIsProcessing(false);
            return;
        }

        if (hasAnyAgentConfig) {
            try {
                if (activeAgents.length > 1) {
                    const addressedAgentIds = addressedAgentIdsForInput;
                    const hasDirectAddress = addressedAgentIds.length > 0 && addressedAgentIds.length < activeAgents.length;
                    const respondingAgents = hasDirectAddress
                        ? activeAgents.filter((candidate) => addressedAgentIds.includes(candidate.id))
                        : activeAgents;
                    const addressedPersonaNames = hasDirectAddress
                        ? activeAgents
                            .filter((candidate) => addressedAgentIds.includes(candidate.id))
                            .map((candidate) => candidate.name)
                            .filter((name) => Boolean(name && name.trim()))
                        : [];

                    const agentResults: Array<{ message: ChatMessage; config: ReturnType<typeof resolveAgentConfig> }> = [];
                    const peerTurnReplies: Array<{ name: string; content: string }> = [];
                    const sharedSceneContext = buildSharedSceneContext(messageTimeline);

                    for (let index = 0; index < respondingAgents.length; index += 1) {
                        const currentAgent = respondingAgents[index];
                        const currentMemory =
                            personaMemoryContextByAgent?.[currentAgent.id]
                            || (currentAgent.id === primaryAgent?.id ? personaMemoryContext : '');
                        const agentHistory = buildHistoryForAgent(messageTimeline, currentAgent, { includePeerPersonaContext: true });
                        const otherPersonaNames = activeAgents
                            .filter((activeAgent) => activeAgent.id !== currentAgent.id)
                            .map((activeAgent) => activeAgent.name)
                            .filter((name) => Boolean(name && name.trim()));

                        const agentConfig = resolveAgentConfig(currentAgent);
                        if (agentConfig) {
                            console.log(`[ChatView] Generating for ${currentAgent.name} using:`, agentConfig.provider, agentConfig.modelName);
                        }
                        if (!hasUsableAIConnection(agentConfig)) {
                            const warningMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: getAgentConnectionWarning(currentAgent),
                                timestamp: new Date().toISOString(),
                                agentId: currentAgent.id,
                            };
                            agentResults.push({ message: warningMessage, config: agentConfig });
                            continue;
                        }

                        const result = await generateChatResponse(
                            agentConfig.apiKey,
                            agentHistory,
                            events,
                            todos,
                            entries,
                            userName,
                            agentConfig.modelName,
                            currentAgent,
                            currentMemory,
                            agentConfig.provider,
                            {
                                otherPersonaNames,
                                addressedPersonaNames,
                                peerTurnReplies,
                                sharedSceneContext,
                                isNewSession,
                                sessionStartedAt,
                                sessionTimePeriod,
                                sessionTimezone,
                                ollamaBaseUrl: agentConfig.baseUrl,
                                trialTurnId,
                                reasoningEffort,
                            }
                        );

                        let chatAction = index === 0 ? mapGeminiActionToChatAction(result.action) : null;
                        if (chatAction && !requireConfirm) {
                            chatAction = await executeAction(chatAction);
                        }
                        updateApiUsage({
                            totalRequests: 1,
                            totalTokens: 0,
                            lastRequestDate: new Date().toISOString(),
                        }, {
                            agentId: currentAgent.id,
                            provider: agentConfig.provider,
                            modelName: agentConfig.modelName,
                            mediaType: 'text',
                        });

                        const assistantMessage: ChatMessage = {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content: result.reply || (index === 0 ? '도와드릴게요 사용자님.' : `${currentAgent.name}입니다. 이어서 도와드릴게요.`),
                            timestamp: new Date().toISOString(),
                            agentId: currentAgent.id,
                            action: chatAction || undefined,
                        };

                        const finalizedMessage = withConfigMeta(assistantMessage, agentConfig);
                        agentResults.push({ message: finalizedMessage, config: agentConfig });
                        peerTurnReplies.push({ name: currentAgent.name, content: finalizedMessage.content });
                    }

                    setMessages((prev) => [...prev, ...agentResults.map((result) => result.message)]);
                } else {
                    const singleAgent = activeAgents[0] || primaryAgent;
                    const singlePersonaMemory = singleAgent
                        ? (personaMemoryContextByAgent?.[singleAgent.id] || personaMemoryContext || '')
                        : (personaMemoryContext || '');
                    const singleHistory = buildHistoryForAgent(messageTimeline, singleAgent, { allowUntypedAssistant: true });

                    const singleAgentConfig = resolveAgentConfig(singleAgent);
                    if (!hasUsableAIConnection(singleAgentConfig)) {
                        const warningMessage: ChatMessage = {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content: getAgentConnectionWarning(singleAgent),
                            timestamp: new Date().toISOString(),
                            agentId: singleAgent?.id,
                        };
                        setMessages((prev) => [...prev, warningMessage]);
                        setIsProcessing(false);
                        return;
                    }

                    const result = await generateChatResponse(
                        singleAgentConfig.apiKey,
                        singleHistory,
                        events,
                        todos,
                        entries,
                        userName,
                        singleAgentConfig.modelName,
                        singleAgent,
                        singlePersonaMemory,
                        singleAgentConfig.provider,
                        {
                            otherPersonaNames: [],
                            isNewSession,
                            sessionStartedAt,
                            sessionTimePeriod,
                            sessionTimezone,
                            ollamaBaseUrl: singleAgentConfig.baseUrl,
                            trialTurnId,
                            reasoningEffort,
                        }
                    );

                    let chatAction = mapGeminiActionToChatAction(result.action);
                    if (chatAction && !requireConfirm) {
                        chatAction = await executeAction(chatAction);
                    }
                    updateApiUsage({
                        totalRequests: 1,
                        totalTokens: 0,
                        lastRequestDate: new Date().toISOString(),
                    }, {
                        agentId: singleAgent?.id,
                        provider: singleAgentConfig.provider,
                        modelName: singleAgentConfig.modelName,
                        mediaType: 'text',
                    });

                    const assistantMessage: ChatMessage = {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: result.reply || '도와드릴게요 사용자님.',
                        timestamp: new Date().toISOString(),
                        agentId: singleAgent?.id,
                        action: chatAction || undefined,
                    };
                    setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                }
            } catch (error) {
                console.error(error);
                const assistantMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: isTrialExhaustedError(error)
                        ? '무료 체험 10회를 모두 사용했어요. 계속 대화하려면 설정이나 페르소나 편집에서 개인 API를 연결해 주세요.'
                        : '죄송해요 대화 중 오류가 발생했어요. 다시 말씀해 주시겠어요?',
                    timestamp: new Date().toISOString(),
                    agentId: primaryAgent?.id,
                };
                setMessages((prev) => [...prev, assistantMessage]);
            }
        } else {
            const assistantMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: getAgentConnectionWarning(primaryAgent),
                timestamp: new Date().toISOString(),
                agentId: primaryAgent?.id,
                quickReplies: ['페르소나 설정 열기', 'API 연결 확인하기'],
            };
            setMessages((prev) => [...prev, assistantMessage]);
        }

        setIsProcessing(false);
    };


    const handleQuickReply = (reply: string) => {
        handleSend(reply);
    };

    const renderActionCard = (msg: ChatMessage): React.ReactNode => {
        const action = msg.action;
        if (!isExecutableAction(action)) return null;

        const items = getActionItems(action);
        if (items.length === 0) return null;

        const isPending = !action.status || action.status === 'pending';
        const isBusy = executingActionMessageId === msg.id;
        const statusLabel = getActionStatusLabel(action);

        return (
            <div className="w-full max-w-full rounded-2xl border border-[#e9e9e8] bg-[#fbfbfa] p-3.5 shadow-[0_4px_12px_rgba(15,23,42,0.035)]">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-[#37352f]">
                            {items.length > 1 ? `${items.length}개 항목 추가` : `${getActionKindLabel(items[0])} 추가`}
                        </div>
                        <div className="mt-0.5 text-xs text-[#9b9a97]">{statusLabel}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${action.status === 'completed'
                        ? 'bg-[#edf7f1] text-[#2f7d4f]'
                        : action.status === 'failed'
                            ? 'bg-[#fff1f0] text-[#b42318]'
                            : action.status === 'cancelled'
                                ? 'bg-[#f1f1f0] text-[#787774]'
                                : 'bg-white text-[#787774] border border-[#e9e9e8]'}`}
                    >
                        {statusLabel}
                    </span>
                </div>

                <div className="mt-3 space-y-2">
                    {items.map((item, idx) => {
                        const secondary = getActionSecondaryText(item);
                        return (
                            <div key={`${item.type}-${idx}`} className="rounded-xl border border-[#eeeeec] bg-white px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[#9b9a97]">
                                    <span>{getActionKindLabel(item)}</span>
                                    <span>·</span>
                                    <span>{formatDateTimeSummary(item)}</span>
                                </div>
                                <div className="mt-1 text-sm font-medium text-[#37352f] break-words">
                                    {getActionPrimaryText(item)}
                                </div>
                                {secondary && (
                                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#787774] break-words">
                                        {secondary}
                                    </div>
                                )}
                                {item.status === 'failed' && item.error && (
                                    <div className="mt-1 text-xs text-[#b42318]">{item.error}</div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {action.status === 'failed' && action.error && (
                    <div className="mt-2 text-xs text-[#b42318]">{action.error}</div>
                )}

                {isPending && (
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => handleCancelMessageAction(msg.id, action)}
                            disabled={isBusy}
                            className="px-3 py-1.5 rounded-lg border border-[#dcdcd9] bg-white text-sm text-[#37352f] hover:bg-[#f7f7f5] transition-colors disabled:opacity-60"
                        >
                            취소
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleConfirmMessageAction(msg.id, action)}
                            disabled={isBusy}
                            className="px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-60"
                        >
                            {isBusy ? '추가 중...' : '추가하기'}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="w-full max-w-[820px] mx-auto text-[#37352f] h-full flex flex-col font-sans overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none px-2 py-6 space-y-6 scrollbar-hide" style={{ touchAction: 'pan-y' }}>
                {messages.map((msg, index) => {
                    const messageAgent = getAgentForMessage(msg);
                    return (
                        <div key={msg.id} className={`flex w-full mb-6 min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start items-start gap-3'}`}>
                            {msg.role === 'assistant' && (
                                <button
                                    type="button"
                                    onClick={() => openAgentEditor(messageAgent)}
                                    disabled={!onUpdateAgent || !messageAgent}
                                    title={onUpdateAgent && messageAgent ? `${messageAgent.name} 편집` : undefined}
                                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#5f5f5f] flex-shrink-0 overflow-hidden mt-1 transition-transform ${onUpdateAgent && messageAgent ? 'hover:scale-[1.03] cursor-pointer' : 'cursor-default'}`}
                                >
                                    {messageAgent?.avatar ? (
                                        <img src={messageAgent.avatar} alt={messageAgent.name} style={getAvatarImageStyle(messageAgent.avatarFrame)} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-[#f3f3f3]" />
                                    )}
                                </button>
                            )}

                            <div className={`flex flex-col min-w-0 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-2`}>
                                {msg.role === 'assistant' && (
                                    <span className="text-[13px] font-medium text-[#5f5f5f] mb-0 ml-1">
                                        {messageAgent?.name || 'Dayflow'}
                                    </span>
                                )}

                                {msg.content && (
                                    <div
                                        className={`
                                            p-3.5 rounded-2xl text-[16px] leading-7 font-normal break-words [word-break:normal] [overflow-wrap:anywhere]
                                            ${msg.role === 'user'
                                                ? 'bg-[var(--color-primary)] text-white'
                                                : 'bg-white border border-[#e9e9e8] text-[#37352f]'}
                                        `}
                                    >
                                        {renderRichMessage(msg.content)}
                                    </div>
                                )}

                                {msg.imageUrl && (
                                    <div className="w-full rounded-2xl overflow-hidden border border-[#e9e9e8] bg-white transition-transform active:scale-[0.99]">
                                        <img
                                            src={msg.imageUrl}
                                            alt="Generated"
                                            className="w-full h-auto block cursor-pointer hover:opacity-95 transition-opacity"
                                            onClick={() => window.open(msg.imageUrl, '_blank')}
                                        />
                                    </div>
                                )}

                                {msg.videoUrl && (
                                    <div className="w-full rounded-2xl overflow-hidden border border-[#e9e9e8] bg-white">
                                        <video
                                            src={msg.videoUrl}
                                            controls
                                            autoPlay
                                            muted
                                            loop
                                            className="w-full h-auto block"
                                        />
                                    </div>
                                )}

                                {msg.role === 'assistant' && renderActionCard(msg)}
                                {msg.role === 'assistant' && !isGuest && <button type="button" className="text-xs text-[#787774] hover:text-rose-600" onClick={async (event) => {
                                    const button = event.currentTarget;
                                    const reason = window.prompt('문제가 되는 이유를 입력해 주세요. 이 응답과 사유를 운영자에게 보냅니다.');
                                    if (!reason?.trim()) return;
                                    button.disabled = true;
                                    try { window.alert(await submitAppSupport('ai-report', msg.content.slice(0, 4500), reason.trim().slice(0, 500))); }
                                    catch (error) { window.alert(error instanceof Error ? error.message : '신고를 접수하지 못했습니다.'); }
                                    finally { button.disabled = false; }
                                }}>응답 신고</button>}

                                {/* Quick Replies - Only for the first message */}
                                {msg.role === 'assistant' && index === 0 && msg.quickReplies && msg.quickReplies.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-1 max-w-full">
                                        {msg.quickReplies.map((reply, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handleQuickReply(reply)}
                                                className="max-w-full px-3 py-1.5 text-xs font-medium bg-white border border-[#e9e9e8] text-[#787774] rounded-lg hover:bg-[#f7f7f5] hover:text-[#37352f] transition-all whitespace-normal break-words text-left"
                                            >
                                                {reply}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}

                {isProcessing && (
                    <div className="flex w-full mb-6 justify-start items-start gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={() => openAgentEditor(primaryAgent)}
                            disabled={!onUpdateAgent || !primaryAgent}
                            title={onUpdateAgent && primaryAgent ? `${primaryAgent.name} 편집` : undefined}
                            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#5f5f5f] flex-shrink-0 overflow-hidden mt-1 transition-transform ${onUpdateAgent && primaryAgent ? 'hover:scale-[1.03] cursor-pointer' : 'cursor-default'}`}
                        >
                            {primaryAgent?.avatar ? (
                                <img src={primaryAgent.avatar} alt={primaryAgent.name} style={getAvatarImageStyle(primaryAgent.avatarFrame)} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-[#f3f3f3]" />
                            )}
                        </button>
                        <div className="flex flex-col items-start">
                            <span className="text-[13px] font-medium text-[#5f5f5f] mb-1.5 ml-1">
                                {activeAgents.length > 1
                                    ? `${activeAgents.length}명 페르소나 응답 생성 중`
                                    : (primaryAgent?.name || 'Dayflow')}
                            </span>
                            <div className="bg-white text-[#9b9a97] p-4 rounded-2xl border border-[#e9e9e8] flex items-center gap-2">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="px-2 py-3 bg-white relative z-20">
                <div className="space-y-3">
                    {/* Plus Button Action Popup Menu (Identical design to left sidebar UserMenuPopover) */}
                    {showToolbar && (
                        <div
                            id="chat-plus-menu"
                            className="w-52 sm:w-60 bg-white rounded-2xl border border-[#e9e9e8] shadow-xl shadow-black/10 py-1.5 z-[70] font-sans text-left relative mb-2 animate-in fade-in slide-in-from-bottom-2 duration-150"
                        >
                            <div className="px-1 space-y-0.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowToolbar(false);
                                        setActiveModalType('model');
                                    }}
                                    className="w-full px-3 py-2.5 flex items-center gap-3 rounded-xl text-[14px] leading-5 font-medium text-[#37352f] hover:bg-[#f7f7f7] transition-colors text-left cursor-pointer"
                                >
                                    <Cpu size={18} className="text-[#37352f] shrink-0" />
                                    <span>AI 모델 선택</span>
                                </button>
                            </div>

                            <div className="my-1 border-b border-[#e9e9e8]" />

                            <div className="px-1 space-y-0.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowToolbar(false);
                                        setActiveModalType('persona');
                                    }}
                                    className="w-full px-3 py-2.5 flex items-center gap-3 rounded-xl text-[14px] leading-5 font-medium text-[#37352f] hover:bg-[#f7f7f7] transition-colors text-left cursor-pointer"
                                >
                                    <Users size={18} className="text-[#37352f] shrink-0" />
                                    <span>참여 페르소나 설정</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div ref={reasoningControlRef} className="relative">
                        {isReasoningPopoverOpen && (
                            <div className="absolute bottom-full right-0 z-[70] mb-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                <ReasoningEffortPopover
                                    value={reasoningEffort}
                                    onChange={handleReasoningEffortChange}
                                    isSupported={isReasoningEffortSupported}
                                    modelLabel={primaryModelLabel}
                                    onOpenModelPicker={() => {
                                        setIsReasoningPopoverOpen(false);
                                        setActiveModalType('model');
                                    }}
                                />
                            </div>
                        )}

                        <div className="chat-input-shell min-w-0 rounded-[28px] border border-[#e9e9e8] bg-white shadow-none focus-within:border-[#d4d4d4] transition-all px-2.5 pt-2 pb-2">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                placeholder={isGuest ? "로그인하고 Dayflow와 대화해보세요..." : (onboardingStep === 0 ? "이름을 입력해주세요..." : "무엇이든 말씀해주세요...")}
                                className="chat-input-field w-full min-w-0 h-11 px-2.5 bg-transparent text-base placeholder-[#b8b8b8] focus:outline-none"
                                disabled={isProcessing}
                            />

                            <div className="flex items-center justify-between gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsReasoningPopoverOpen(false);
                                        setShowToolbar(prev => !prev);
                                    }}
                                    className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${showToolbar ? 'bg-blue-600 text-white shadow-xs' : 'text-[#787774] hover:text-[#37352f] hover:bg-[#f4f4f2]'}`}
                                    aria-label={showToolbar ? "도구 닫기" : "도구 열기"}
                                    aria-expanded={showToolbar}
                                    title={showToolbar ? "닫기" : "페르소나 / 모델 선택"}
                                >
                                    <span className={`flex items-center justify-center transition-transform duration-200 ease-out ${showToolbar ? 'rotate-45' : 'rotate-0'}`}>
                                        <Plus size={20} />
                                    </span>
                                </button>

                                <div className="flex min-w-0 items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowToolbar(false);
                                            setIsReasoningPopoverOpen(prev => !prev);
                                        }}
                                        className={`flex min-w-0 items-center gap-1 rounded-full px-3 h-9 text-[14px] leading-5 transition-colors ${isReasoningPopoverOpen ? 'bg-[#f4f4f2]' : 'hover:bg-[#f4f4f2]'}`}
                                        aria-haspopup="dialog"
                                        aria-expanded={isReasoningPopoverOpen}
                                        title="모델 및 추론 강도"
                                    >
                                        <span className="truncate font-medium text-[#37352f]">{primaryModelLabel}</span>
                                        {isReasoningEffortSupported && (
                                            <span className="shrink-0 font-normal text-[#8a8a8a]">{selectedReasoningOption.label}</span>
                                        )}
                                        <ChevronDown size={14} className="shrink-0 text-[#8a8a8a]" />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleSend()}
                                        disabled={!inputValue.trim() || isProcessing}
                                        className="chat-send-button shrink-0 w-9 h-9 rounded-[9999px] flex items-center justify-center transition-all disabled:cursor-not-allowed"
                                        aria-label="메시지 전송"
                                        title="메시지 전송"
                                    >
                                        <ArrowUp size={18} strokeWidth={2.4} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Dedicated AI Model Selection Modal (Step 2: Dropdown format) */}
            {activeModalType === 'model' && (
                <div className="fixed inset-0 z-[95] bg-black/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md h-auto bg-white rounded-2xl border border-[#e9e9e8] shadow-2xl flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-[#efefef] flex items-center justify-between shrink-0 bg-white">
                            <h3 className="text-base font-medium text-[#37352f]">AI 모델 선택</h3>
                            <button
                                type="button"
                                onClick={() => setActiveModalType(null)}
                                className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors"
                                aria-label="닫기"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-[#787774] uppercase ml-1">API 공급자</label>
                                <select
                                    value={selectedModalProvider}
                                    onChange={(e) => {
                                        const p = e.target.value as ApiConnection['provider'];
                                        const existingConnection = (settings.apiConnections || []).find(connection => connection.provider === p);
                                        setSelectedModalProvider(p);
                                        const options = getModelOptionsForProvider(p);
                                        const firstOpt = options.length > 0 ? (typeof options[0] === 'string' ? options[0] : options[0].id) : getDefaultModelForProvider(p);
                                        setSelectedModalModel(existingConnection?.modelName || firstOpt);
                                        setSelectedModalApiKey(existingConnection?.apiKey || '');
                                    }}
                                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#dcdcd9] bg-white text-sm font-medium text-[#37352f] outline-none focus:border-[#d4d4d4] transition-all"
                                >
                                    {CHAT_PROVIDERS.map(p => (
                                        <option key={p} value={p}>{getProviderDisplayName(p)}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-[#787774] uppercase ml-1">대화 모델</label>
                                <select
                                    value={selectedModalModel}
                                    onChange={(e) => setSelectedModalModel(e.target.value)}
                                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#dcdcd9] bg-white text-sm font-medium text-[#37352f] outline-none focus:border-[#d4d4d4] transition-all"
                                >
                                    {getModelOptionsForProvider(selectedModalProvider).map(opt => {
                                        const id = typeof opt === 'string' ? opt : opt.id;
                                        const label = typeof opt === 'string' ? opt : opt.label;
                                        return <option key={id} value={id}>{label}</option>;
                                    })}
                                </select>
                            </div>

                            {modalProviderNeedsApiKey && (
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-[#787774] uppercase ml-1" htmlFor="quick-model-api-key">API Key</label>
                                    <input
                                        id="quick-model-api-key"
                                        type="password"
                                        value={selectedModalApiKey}
                                        onChange={(e) => setSelectedModalApiKey(e.target.value)}
                                        placeholder="API 키를 입력하세요"
                                        autoComplete="off"
                                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#dcdcd9] bg-white text-sm font-medium text-[#37352f] outline-none focus:border-[#d4d4d4] transition-all"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-3.5 border-t border-[#efefef] flex justify-end gap-2 shrink-0 bg-white">
                            <button
                                type="button"
                                onClick={() => setActiveModalType(null)}
                                className="px-4 py-2 rounded-xl border border-[#dcdcd9] text-sm font-medium text-[#5f5f5f] hover:bg-[#f7f7f5] transition-colors"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    handleSelectQuickModel(selectedModalProvider, selectedModalModel, selectedModalApiKey);
                                    setActiveModalType(null);
                                }}
                                disabled={modalProviderNeedsApiKey && !selectedModalApiKey.trim()}
                                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-all active:scale-95 shadow-md disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                적용하기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dedicated Persona Selection Modal (Step 2: Compact List format) */}
            {activeModalType === 'persona' && (
                <div className="fixed inset-0 z-[95] bg-black/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md h-auto bg-white rounded-2xl border border-[#e9e9e8] shadow-2xl flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-[#efefef] flex items-center justify-between shrink-0 bg-white">
                            <div>
                                <h3 className="text-base font-medium text-[#37352f]">참여 페르소나 설정</h3>
                                <p className="text-sm text-[#8a8a8a] mt-0.5">최대 {MAX_GROUP_AGENTS}명까지 선택할 수 있습니다.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveModalType(null)}
                                className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors"
                                aria-label="닫기"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-1.5">
                            {availableAgents.map((availableAgent) => {
                                const isActive = activeAgents.some((a) => a.id === availableAgent.id);
                                const currentIds = activeAgents.map((a) => a.id);
                                const canRemoveFromGroup = isActive && currentIds.length > 1;
                                const toggleAgent = () => {
                                    if (isActive) {
                                        if (!canRemoveFromGroup) return;
                                        onSelectAgents?.(currentIds.filter((id) => id !== availableAgent.id));
                                        return;
                                    }
                                    if (currentIds.length >= MAX_GROUP_AGENTS) return;
                                    onSelectAgents?.([...currentIds, availableAgent.id]);
                                };
                                return (
                                    <div
                                        key={availableAgent.id}
                                        onClick={toggleAgent}
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                            isActive ? 'border-[#dcdcd9] bg-blue-50/60' : 'border-[#e9e9e8] bg-white hover:bg-[#fcfcfb]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-[#e9e9e8]">
                                                {availableAgent.avatar ? (
                                                    <img src={availableAgent.avatar} alt="" style={getAvatarImageStyle(availableAgent.avatarFrame)} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full bg-[#f3f3f3]" />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-[#37352f] truncate">{availableAgent.name}</div>
                                                <div className="text-sm text-[#8a8a8a] truncate">{availableAgent.role}</div>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            disabled={isActive && !canRemoveFromGroup}
                                            className={`w-6 h-6 rounded-full text-sm font-medium flex items-center justify-center shrink-0 ${
                                                isActive ? 'bg-blue-600 text-white' : 'bg-[#f1f1ef] text-[#787774]'
                                            }`}
                                        >
                                            {isActive ? <Check size={14} strokeWidth={2.6} /> : <Plus size={14} strokeWidth={2.2} />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="px-5 py-3.5 border-t border-[#efefef] flex justify-end shrink-0 bg-white">
                            <button
                                type="button"
                                onClick={() => setActiveModalType(null)}
                                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-all active:scale-95 shadow-md"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {editingAgentId && agentDraft && (
                <div className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
                    <div className="w-full max-w-[calc(100vw-24px)] sm:max-w-lg h-auto max-h-[92dvh] sm:max-h-[88vh] bg-white rounded-2xl border border-[#e9e9e8] flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-[#efefef] flex items-center justify-between shrink-0 bg-white">
                            <div>
                                <h4 className="text-[#37352f] font-medium">페르소나 편집</h4>
                                <p className="text-xs text-[#9b9a97] mt-1">채팅 중에도 이미지와 페르소나 설정을 바로 바꿀 수 있어요.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => closeAgentEditor()}
                                className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0">
                            <div className="p-6 flex flex-col items-center border-b border-[#efefef] bg-[#fbfbfa]">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (agentDraft.avatar) {
                                            setIsAvatarCropOpen(true);
                                            return;
                                        }
                                        document.getElementById(`agent-avatar-upload-${editingAgentId}`)?.click();
                                    }}
                                    className="relative w-24 h-24 rounded-full overflow-hidden flex items-center justify-center text-4xl text-white mb-3 transition-transform hover:scale-[1.02]"
                                    style={{ backgroundColor: agentDraft.color || '#37352f' }}
                                >
                                    {agentDraft.avatar ? (
                                        <img src={agentDraft.avatar} alt={agentDraft.name} style={getAvatarImageStyle(agentDraft.avatarFrame)} className="w-full h-full object-cover" />
                                    ) : (
                                        <span>{agentDraft.emoji || '🤖'}</span>
                                    )}
                                    <span className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-white/90 border border-[#e9e9e8] text-[#37352f] flex items-center justify-center">
                                        <Edit3 size={14} />
                                    </span>
                                </button>
                                <input
                                    id={`agent-avatar-upload-${editingAgentId}`}
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleAgentImageUpload}
                                />
                                <div className="text-sm font-normal text-[#37352f]">{agentDraft.name || '페르소나'}</div>
                                <div className="text-xs text-[#9b9a97]">{agentDraft.role || '역할을 입력하세요'}</div>
                            </div>

                            <div className="p-5 space-y-4">
                                <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#e9e9e8] bg-[#f7f7f5] p-1">
                                    {([
                                        ['profile', '프로필'],
                                        ['api', 'API'],
                                    ] as Array<[PersonaEditorTab, string]>).map(([tab, label]) => (
                                        <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setAgentEditorTab(tab)}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${agentEditorTab === tab
                                                ? 'bg-white text-[#37352f]'
                                                : 'text-[#787774] hover:text-[#37352f]'}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                {agentEditorTab === 'profile' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <label className="block">
                                                <span className="text-xs font-normal text-[#787774] ml-1">이름</span>
                                                <input
                                                    value={agentDraft.name}
                                                    onChange={(e) => setAgentDraft({ ...agentDraft, name: e.target.value })}
                                                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-normal text-[#787774] ml-1">역할</span>
                                                <input
                                                    value={agentDraft.role}
                                                    onChange={(e) => setAgentDraft({ ...agentDraft, role: e.target.value })}
                                                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                                                />
                                            </label>
                                        </div>

                                        <label className="block">
                                            <span className="text-xs font-normal text-[#787774] ml-1">말투</span>
                                            <input
                                                value={agentDraft.tone || ''}
                                                onChange={(e) => setAgentDraft({ ...agentDraft, tone: e.target.value })}
                                                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                                                placeholder="예: 다정하고 자연스러운 존댓말"
                                            />
                                        </label>

                                        <label className="block">
                                            <span className="text-xs font-normal text-[#787774] ml-1">채팅 응답 길이</span>
                                            <select
                                                value={agentDraft.responseLength || 'medium'}
                                                onChange={(e) => setAgentDraft({ ...agentDraft, responseLength: e.target.value as AIAgent['responseLength'] })}
                                                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none bg-white"
                                            >
                                                {RESPONSE_LENGTH_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="block">
                                            <span className="text-xs font-normal text-[#787774] ml-1">성격과 행동 방식</span>
                                            <textarea
                                                value={agentDraft.personality || ''}
                                                onChange={(e) => setAgentDraft({ ...agentDraft, personality: e.target.value })}
                                                rows={7}
                                                className="mt-1 w-full px-3 py-3 rounded-lg border border-[#dcdcd9] text-sm leading-relaxed focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none resize-y min-h-[170px]"
                                                placeholder="성격, 행동 방식, 대화 규칙을 자유롭게 적어주세요."
                                            />
                                            <span className="mt-1 block text-xs text-[#9b9a97]">이제 첫 줄부터 전부 성격/지침으로 저장됩니다.</span>
                                        </label>
                                    </div>
                                )}

                                {agentEditorTab === 'api' && (
                                    <div className="space-y-4">
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <label className="block">
                                                    <span className="text-xs font-normal text-[#787774] ml-1">API 공급자</span>
                                                    <select
                                                        value={agentApiDraft.provider || 'gemini'}
                                                        onChange={(e) => {
                                                            const provider = e.target.value as ApiConnection['provider'];
                                                            setAgentLocalModels([]);
                                                            updateAgentApiDraft({
                                                                provider,
                                                                modelName: getDefaultModelForProvider(provider),
                                                                apiKey: '',
                                                                 baseUrl: provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : getProviderDefaultBaseUrl(provider),
                                                            });
                                                        }}
                                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[var(--color-primary)]"
                                                    >
                                                        {CHAT_PROVIDERS.map(provider => (
                                                            <option key={provider} value={provider}>{getProviderDisplayName(provider)}</option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className="block">
                                                    <span className="text-xs font-normal text-[#787774] ml-1">모델</span>
                                                    {(agentApiDraft.provider === 'ollama' || agentApiDraft.provider === 'custom') && agentLocalModels.length > 0 ? (
                                                        <select
                                                            title={agentApiDraft.modelName || ''}
                                                            value={agentApiDraft.modelName || ''}
                                                            onChange={(e) => updateAgentApiDraft({ modelName: e.target.value })}
                                                            className="mt-1 w-full px-3 pr-10 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4] truncate"
                                                        >
                                                            {agentLocalModels.map(model => <option key={model} value={model}>{model}</option>)}
                                                        </select>
                                                    ) : agentApiModelOptions.length > 0 ? (
                                                        <select
                                                            value={agentApiDraft.modelName || getDefaultModelForProvider(agentApiDraft.provider || 'gemini')}
                                                            onChange={(e) => updateAgentApiDraft({ modelName: e.target.value })}
                                                            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4]"
                                                        >
                                                            {agentApiModelOptions.map(model => (
                                                                <option key={model.id} value={model.id}>{model.label}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            value={agentApiDraft.modelName || ''}
                                                            onChange={(e) => updateAgentApiDraft({ modelName: e.target.value })}
                                                            placeholder={agentApiDraft.provider === 'ollama' || agentApiDraft.provider === 'custom' ? '모델 목록을 불러오거나 직접 입력' : '모델 이름'}
                                                            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[var(--color-primary)]"
                                                        />
                                                    )}
                                                </label>
                                            </div>

                                            {(agentApiDraft.provider === 'ollama' || agentApiDraft.provider === 'custom') && (
                                                <label className="block">
                                                    <span className="text-xs font-normal text-[#787774] ml-1">{agentApiDraft.provider === 'ollama' ? 'Ollama 서버 주소' : '로컬 서버 주소'}</span>
                                                    <input
                                                        value={agentApiDraft.baseUrl || (agentApiDraft.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL)}
                                                        onChange={(e) => updateAgentApiDraft({ baseUrl: e.target.value })}
                                                        placeholder={agentApiDraft.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL}
                                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm font-mono outline-none bg-white focus:border-[var(--color-primary)]"
                                                    />
                                                </label>
                                            )}

                                            {(agentApiDraft.provider === 'ollama' || agentApiDraft.provider === 'custom') && (
                                                <button
                                                    type="button"
                                                    onClick={() => void loadAgentLocalModels()}
                                                    disabled={isLoadingAgentLocalModels}
                                                    className="w-full rounded-lg border border-[#dcdcd9] bg-white px-3 py-2 text-sm text-[#37352f] hover:bg-[#f3f3f3] disabled:opacity-60"
                                                >
                                                    {isLoadingAgentLocalModels ? '로컬 모델 불러오는 중...' : '설치된 모델 불러오기'}
                                                </button>
                                            )}

                                            {agentApiDraft.provider !== 'ollama' && (
                                                <label className="block">
                                                    <span className="text-xs font-normal text-[#787774] ml-1">API Key{agentApiDraft.provider === 'custom' ? ' (선택 사항)' : ''}</span>
                                                    <input
                                                        type="password"
                                                        value={agentApiDraft.apiKey || ''}
                                                        onChange={(e) => updateAgentApiDraft({ apiKey: e.target.value })}
                                                        placeholder={getApiKeyPlaceholder(agentApiDraft.provider)}
                                                        className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm font-mono outline-none bg-white focus:border-[var(--color-primary)]"
                                                    />
                                                </label>
                                            )}

                                            <div className="flex items-center justify-between gap-3 border-t border-[#e9e9e8] pt-3">
                                                <p className="text-[12px] leading-5 text-[#9b9a97]">
                                                    {agentApiSelection === '__default__'
                                                        ? '이 연결은 모든 페르소나의 기본값으로 사용됩니다.'
                                                        : '이 연결은 현재 페르소나에만 지정됩니다.'}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => void testAgentApiDraft()}
                                                    disabled={isTestingAgentApi}
                                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#dcdcd9] bg-white px-3 py-2 text-sm text-[#37352f] transition-colors hover:bg-[#f3f3f3] disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <FlaskConical size={14} />
                                                    {isTestingAgentApi ? '연결 중...' : '연결 테스트'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-[#efefef] flex justify-end gap-2 shrink-0 bg-white">
                            <button
                                type="button"
                                onClick={() => closeAgentEditor()}
                                disabled={isSavingAgent}
                                className="px-4 py-2 rounded-lg border border-[#dcdcd9] text-sm text-[#37352f] hover:bg-[#f7f7f5] transition-colors disabled:opacity-60"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveAgent()}
                                disabled={isSavingAgent || !agentDraft.name.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] transition-all active:scale-95 disabled:opacity-60 shadow-sm"
                            >
                                <Save size={16} />
                                <span>{isSavingAgent ? '저장 중...' : '저장하기'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {editingAgentId && agentDraft?.avatar && (
                <AvatarCropperModal
                    isOpen={isAvatarCropOpen}
                    avatar={agentDraft.avatar}
                    frame={agentDraft.avatarFrame}
                    title={`${agentDraft.name || '페르소나'} 이미지 편집`}
                    name={agentDraft.name}
                    onAvatarChange={(avatar) => setAgentDraft(prev => prev ? { ...prev, avatar, avatarFrame: undefined } : prev)}
                    onFrameChange={updateAgentDraftAvatarFrame}
                    onClose={() => setIsAvatarCropOpen(false)}
                />
            )}
        </div >
    );
};

export default ChatView;

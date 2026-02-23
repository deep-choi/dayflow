import React, { useState, useRef, useEffect } from 'react';
import { CalendarEvent, Todo, JournalEntry, AiPost, TodoList, AppSettings, AIAgent, ChatMessage, ChatMode } from '../types';
import { generateLifeInsight, generateChatResponse, ChatActionResult, callGeminiImageGeneration } from '../services/geminiService';
import { Sparkles, ChevronRight, Plus } from '../components/Icons';
import { format, parseISO, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { getAgentAIConfig, isChatSupportedProvider, isImageGenerationModel, isVideoGenerationModel, findMediaConnection } from '../utils/aiConfig';
import { callXaiImageGeneration, callXaiVideoGeneration } from '../services/xaiService';
import { ApiUsageStats } from '../types';

interface ChatViewProps {
    events: CalendarEvent[];
    todos: Todo[];
    entries: JournalEntry[];
    posts: AiPost[];
    todoLists: TodoList[];
    onAddEvent: (event: CalendarEvent) => void;
    onDeleteEvent: (id: string) => void;
    onAddTodo: (text: string, listId?: string, dueDate?: string, category?: Todo['category']) => void;
    onAddEntry: (title: string, content: string, category?: string, mood?: JournalEntry['mood']) => void;
    onAddPost: (post: AiPost) => void;
    requireConfirm?: boolean;
    settings: AppSettings;
    onUpdateSettings?: (settings: AppSettings) => void;
    agent?: AIAgent;
    agents?: AIAgent[];
    selectedAgentIds?: string[];
    selectedAgents?: AIAgent[];
    onSelectAgents?: (ids: string[]) => void;
    onUpdateAgent?: (agentId: string, updates: Partial<AIAgent>) => void;
    onUserMessage?: (text: string) => void;
    initialMessages?: ChatMessage[];
    onUpdateMessages?: (sessionId: string, messages: ChatMessage[]) => void;
    currentSessionId?: string | null;
    personaMemoryContext?: string;
    personaMemoryContextByAgent?: Record<string, string>;
    defaultUserName?: string;
}

const CHAT_HISTORY_LIMIT = 12;
const MAX_GROUP_AGENTS = 4;

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
    }

    return true;
};

const renderInlineBold = (text: string, keyPrefix: string): React.ReactNode => {
    const chunks = text.split(/(\*\*[^*]+\*\*)/g);
    return chunks.map((chunk, idx) => {
        const match = chunk.match(/^\*\*(.+)\*\*$/);
        if (!match) return <React.Fragment key={`${keyPrefix}-${idx}`}>{chunk}</React.Fragment>;
        return <strong key={`${keyPrefix}-${idx}`} className="font-semibold">{match[1]}</strong>;
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
        nodes.push(
            <p key={`p-${key++}`} className="whitespace-pre-wrap leading-relaxed">
                {renderInlineBold(text, `p-${key}`)}
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
                level === 1 ? 'text-base font-bold' : level === 2 ? 'text-[15px] font-semibold' : 'text-sm font-semibold';
            nodes.push(
                <div key={`h-${key++}`} className={headingClass}>
                    {renderInlineBold(heading[2], `h-${key}`)}
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
                        <li key={`uli-${key}-${idx}`}>{renderInlineBold(item, `uli-${key}-${idx}`)}</li>
                    ))}
                </ul>
            );
            continue;
        }

        if (/^\d+\.\s+/.test(trimmed)) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
                i += 1;
            }
            nodes.push(
                <ol key={`ol-${key++}`} className="list-decimal pl-5 space-y-1">
                    {items.map((item, idx) => (
                        <li key={`oli-${key}-${idx}`}>{renderInlineBold(item, `oli-${key}-${idx}`)}</li>
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

// Helper: Get time-based greeting
const getTimeBasedGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 6) return '새벽에도 깨어계시네요!';
    if (hour < 12) return '좋은 아침이에요! ☀️';
    if (hour < 14) return '점심시간이네요! 🍚';
    if (hour < 18) return '좋은 오후예요! 🌤️';
    if (hour < 22) return '오늘 하루 어떠셨나요? 🌙';
    return '늦은 밤이네요. 오늘도 수고하셨어요 🌃';
};

// Helper: Get today's summary
const getTodaySummary = (events: CalendarEvent[], todos: Todo[]): string => {
    const pendingTodos = todos.filter(t => !t.completed).length;
    const today = new Date();
    const todayEvents = events.filter(e => {
        if (!e.date) return false;
        try {
            return isSameDay(parseISO(e.date), today);
        } catch {
            return false;
        }
    }).length;

    if (todayEvents === 0 && pendingTodos === 0) {
        return '오늘은 예정된 일정이나 할 일이 없어요. 여유로운 하루를 보내세요!';
    }

    let summary = '';
    if (todayEvents > 0) summary += `오늘 **${todayEvents}개의 일정**이 있고, `;
    if (pendingTodos > 0) summary += `**${pendingTodos}개의 할 일**이 남아있어요.`;
    return summary.replace(/, $/, '.');
};

const ChatView: React.FC<ChatViewProps> = ({
    events,
    todos,
    entries,
    posts,
    todoLists,
    onAddEvent,
    onDeleteEvent,
    onAddTodo,
    onAddEntry,
    onAddPost,
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
    initialMessages,
    onUpdateMessages,
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
                id: 'onboarding-1',
                role: 'assistant',
                content: `${getTimeBasedGreeting()}\n\n처음 오셨네요! 저는 ${agent?.name || 'LifeSync AI'}예요. ${agent?.emoji || '💬'}\n당신의 일상을 함께 정리하고 더 나은 하루를 만들어 드릴게요.\n\n먼저, 뭐라고 불러드리면 될까요?`,
                timestamp: new Date().toISOString(),
                agentId: agent?.id,
                action: { type: 'onboarding' },
            };
        }

        // Returning user - personalized greeting
        return {
            id: 'welcome',
            role: 'assistant',
            content: `주인님, ${getTimeBasedGreeting()}\n\n${getTodaySummary(events, todos)}\n\n무엇을 도와드릴까요?`,
            timestamp: new Date().toISOString(),
            agentId: agent?.id,
            quickReplies: ['오늘 일정 알려줘', '할 일 추가', '오늘 기분 기록', '주간 분석해줘'],
        };
    };

    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        if (initialMessages && initialMessages.length > 0) return initialMessages;
        return [getWelcomeMessage()];
    });
    const [inputValue, setInputValue] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [chatMode, setChatMode] = useState<ChatMode>('basic');
    const [showToolbar, setShowToolbar] = useState(false);
    const [isMultiSelectEnabled, setIsMultiSelectEnabled] = useState(false);
    const [conversationContext, setConversationContext] = useState<string[]>([]); // For context awareness
    const [pendingAction, setPendingAction] = useState<ChatMessage['action'] | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pendingSessionHydrationRef = useRef(false);
    const lastSyncedSignatureRef = useRef<string>('');
    const availableAgents = agents.length > 0 ? agents : (agent ? [agent] : []);
    const selectedAgentPool = selectedAgents.length > 0
        ? selectedAgents
        : (selectedAgentIds.length > 0
            ? selectedAgentIds
                .map((id) => availableAgents.find((availableAgent) => availableAgent.id === id))
                .filter(Boolean) as AIAgent[]
            : (agent ? [agent] : availableAgents.slice(0, 1)));
    const activeAgents = selectedAgentPool.length > 0
        ? selectedAgentPool.slice(0, MAX_GROUP_AGENTS)
        : (availableAgents.length > 0 ? [availableAgents[0]] : []);
    const primaryAgent = activeAgents[0] || agent || availableAgents[0];
    const chatModeLabels: Record<ChatMode, string> = {
        basic: '기본',
        learning: '학습',
    };

    useEffect(() => {
        setIsMultiSelectEnabled(selectedAgentIds.length > 1);
    }, [selectedAgentIds]);
    const getAgentForMessage = (message: ChatMessage): AIAgent | undefined => {
        if (message.role !== 'assistant') return undefined;
        if (message.agentId) {
            return availableAgents.find((availableAgent) => availableAgent.id === message.agentId) || primaryAgent;
        }
        return primaryAgent;
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Update messages when switching sessions
    useEffect(() => {
        if (currentSessionId) {
            // When the very first user message creates a new session in parent state,
            // keep local messages instead of resetting to welcome text.
            if (pendingSessionHydrationRef.current && (!initialMessages || initialMessages.length === 0)) {
                pendingSessionHydrationRef.current = false;
                return;
            }

            if (initialMessages && initialMessages.length > 0) {
                setMessages(prev => {
                    if (isSameChatMessageList(prev, initialMessages)) return prev;
                    return initialMessages;
                });
            } else {
                // New empty session should start from a fresh welcome message.
                setMessages(prev => {
                    const isAlreadyWelcome =
                        prev.length === 1 &&
                        prev[0].role === 'assistant' &&
                        (prev[0].id === 'welcome' || prev[0].id === 'onboarding-1');
                    return isAlreadyWelcome ? prev : [getWelcomeMessage()];
                });
            }
        } else {
            // No session - reset to welcome
            setMessages(prev => {
                const isAlreadyWelcome =
                    prev.length === 1 &&
                    prev[0].role === 'assistant' &&
                    (prev[0].id === 'welcome' || prev[0].id === 'onboarding-1');
                return isAlreadyWelcome ? prev : [getWelcomeMessage()];
            });
        }
    }, [currentSessionId, initialMessages]);

    // Notify parent of message updates
    useEffect(() => {
        if (!currentSessionId || !onUpdateMessages || messages.length <= 1) return;

        // Session switch hydration should not immediately write back identical payloads.
        if (initialMessages && isSameChatMessageList(messages, initialMessages)) return;

        const signature = `${currentSessionId}:${messages.map(m => `${m.id}:${m.timestamp}`).join('|')}`;
        if (lastSyncedSignatureRef.current === signature) return;
        lastSyncedSignatureRef.current = signature;

        // Ensure we defer the parent state update to avoid rendering loops
        const timeoutId = window.setTimeout(() => {
            onUpdateMessages(currentSessionId, messages);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [messages, currentSessionId]);

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

    const mapGeminiActionToChatAction = (action: ChatActionResult['action'] | null | undefined): ChatMessage['action'] | null => {
        if (!action || action.type === 'none') return null;

        const normalizeText = (value?: string) => (value || '').toLowerCase().replace(/\s+/g, '').trim();
        const resolveDeleteTarget = (payload: ChatActionResult['action']['deleteEvent']) => {
            if (!payload) return null;

            if (payload.id) {
                const targetById = events.find(event => event.id === payload.id);
                if (targetById) return targetById;
            }

            let candidates = [...events];
            if (payload.date) {
                candidates = candidates.filter(event => event.date === payload.date);
            }
            if (payload.startTime) {
                candidates = candidates.filter(event => event.startTime === payload.startTime);
            }
            if (payload.title) {
                const targetTitle = normalizeText(payload.title);
                candidates = candidates.filter(event => {
                    const eventTitle = normalizeText(event.title);
                    return eventTitle.includes(targetTitle) || targetTitle.includes(eventTitle);
                });
            }

            if (candidates.length === 0) return null;
            if (candidates.length === 1) return candidates[0];

            const sorted = candidates.sort((a, b) => {
                const aTs = new Date(`${a.date}T${a.startTime || '00:00'}:00`).getTime();
                const bTs = new Date(`${b.date}T${b.startTime || '00:00'}:00`).getTime();
                return aTs - bTs;
            });
            return sorted[0];
        };

        if (action.type === 'add_event' && action.event) {
            return {
                type: 'add_event',
                data: {
                    id: crypto.randomUUID(),
                    title: action.event.title,
                    date: action.event.date,
                    startTime: action.event.startTime,
                    endTime: action.event.endTime,
                    type: action.event.type || 'tag_1',
                } as CalendarEvent,
            };
        }

        if (action.type === 'add_todo' && action.todo) {
            const allowedCategories: Todo['category'][] = ['personal', 'work', 'health', 'shopping'];
            const category = allowedCategories.includes(action.todo.category as Todo['category'])
                ? (action.todo.category as Todo['category'])
                : 'personal';

            return {
                type: 'add_todo',
                data: {
                    text: action.todo.text,
                    dueDate: action.todo.dueDate,
                    category,
                },
            };
        }

        if (action.type === 'add_journal' && action.journal) {
            const mood = (['good', 'neutral', 'bad'] as const).includes(action.journal.mood as JournalEntry['mood'])
                ? (action.journal.mood as JournalEntry['mood'])
                : 'neutral';

            return {
                type: 'add_journal',
                data: {
                    title: action.journal.title,
                    content: action.journal.content,
                    category: '메모장',
                    mood,
                },
            };
        }

        if (action.type === 'generate_insight') {
            return { type: 'generate_insight' };
        }

        if (action.type === 'generate_image') {
            return { type: 'generate_image', data: { prompt: action.prompt } };
        }

        if (action.type === 'generate_video') {
            return { type: 'generate_video', data: { prompt: action.prompt } };
        }

        if (action.type === 'delete_event' && action.deleteEvent) {
            const target = resolveDeleteTarget(action.deleteEvent);
            if (!target) return null;

            return {
                type: 'delete_event',
                data: {
                    id: target.id,
                    title: target.title,
                    date: target.date,
                    startTime: target.startTime,
                },
            };
        }

        return null;
    };

    const executeAction = async (action: ChatMessage['action']) => {
        if (!action) return;

        switch (action.type) {
            case 'onboarding':
                if (action.data?.step === 1) {
                    setUserName(action.data.name);
                    setOnboardingStep(1);
                } else if (action.data?.step === 2) {
                    setOnboardingStep(-1); // Onboarding complete
                }
                break;
            case 'add_event':
                onAddEvent(action.data);
                break;
            case 'delete_event':
                if (action.data?.id) {
                    onDeleteEvent(action.data.id);
                }
                break;
            case 'add_todo':
                {
                    const todoData = typeof action.data === 'string'
                        ? { text: action.data, category: 'personal' }
                        : action.data;
                    onAddTodo(todoData.text, todoData.listId, todoData.dueDate, todoData.category);
                }
                break;
            case 'add_journal':
                onAddEntry(
                    action.data?.title || '채팅 메모',
                    action.data?.content || '',
                    action.data?.category || '메모장',
                    action.data?.mood || 'neutral'
                );
                break;
            case 'generate_insight':
                try {
                    const insightAgent = primaryAgent;
                    const insightConfig = getAgentAIConfig(settings, insightAgent?.connectionId);
                    if (!insightConfig?.apiKey) {
                        throw new Error('API Key가 필요해요.');
                    }
                    const newPost = await generateLifeInsight(
                        insightConfig.apiKey,
                        events,
                        todos,
                        entries,
                        insightConfig.modelName,
                        insightConfig.provider
                    );
                    onAddPost(newPost);

                    // Update Usage Stats (Approximate token count based on input/output length)
                    if (onUpdateSettings) {
                        const estimatedTokens = (JSON.stringify({ events, todos, entries }).length / 4) + (newPost.content.length / 4);
                        onUpdateSettings({
                            ...settings,
                            apiUsage: {
                                totalRequests: (settings.apiUsage?.totalRequests || 0) + 1,
                                totalTokens: (settings.apiUsage?.totalTokens || 0) + Math.ceil(estimatedTokens),
                                lastRequestDate: new Date().toISOString(),
                            }
                        });
                    }
                } catch (error) {
                    // console.error(error); // Error handling is done in getResponseForAction via executed flag or message content
                    // But here we need to inform the user if it failed.
                    // For now, let the error propagate to the response handler or handle it here by adding a system message
                    const errorMessage: ChatMessage = {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: `${primaryAgent?.name || '선택한 페르소나'}에 연결된 API가 없거나 유효하지 않아 AI 분석을 진행할 수 없어요. 페르소나 설정에서 Gemini/xAI 연결을 지정해 주세요.`,
                        timestamp: new Date().toISOString(),
                        agentId: primaryAgent?.id,
                        quickReplies: ['설정하러 갈래', '괜찮아']
                    };
                    setMessages(prev => [...prev, errorMessage]);
                    return; // Stop further processing
                }
                break;
        }
    };

    const getResponseForAction = (action: ChatMessage['action'] | null, userText: string): { content: string; quickReplies?: string[] } => {
        // Onboarding responses
        if (action?.type === 'onboarding') {
            if (action.data?.step === 1) {
                return {
                    content: `주인님, 반가워요! 🎉\n\n저와 어떤 이야기를 나누고 싶으세요?\n\n편하게 선택해주시거나, 자유롭게 말씀해주세요!`,
                    quickReplies: ['일정 관리가 필요해', '할 일을 정리하고 싶어', '오늘 기분을 기록하고 싶어', '그냥 이야기하고 싶어'],
                };
            }
            if (action.data?.step === 2) {
                return {
                    content: `좋아요! 이제 준비가 됐어요. ✨\n\n주인님의 하루를 더 나은 방향으로 이끌어 드릴게요.\n\n그럼 바로 시작해볼까요? 무엇이든 편하게 말씀해주세요!`,
                    quickReplies: ['오늘 일정 알려줘', '할 일 추가', '오늘 기분 기록'],
                };
            }
        }

        if (!action) {
            // Context-aware fallback - check recent conversation
            const recentContext = conversationContext.slice(-3).join(' ');

            // Check if user is just chatting
            if (userText.length < 10 && !userText.includes('?')) {
                return {
                    content: `네, 주인님! 더 말씀해주세요. 듣고 있어요. 😊`,
                    quickReplies: ['일정 추가하고 싶어', '할 일 정리해줘', '오늘 하루 어땠는지 기록할래'],
                };
            }

            return {
                content: `음, 요청을 정확히 이해하지 못했어요. 😅\n\n혹시 이런 걸 원하셨나요?`,
                quickReplies: ['일정 추가', '할 일 추가', '오늘 기분 기록', '분석해줘'],
            };
        }

        switch (action.type) {
            case 'add_event':
                return {
                    content: `✅ 캘린더에 일정을 등록했어요!\n\n📅 **${action.data.title}**\n📆 ${format(parseISO(action.data.date), 'M월 d일 (EEEE)', { locale: ko })}${action.data.startTime ? `\n⏰ ${action.data.startTime}` : ''}\n\n캘린더에서 확인해보세요!`,
                    quickReplies: ['다른 일정 추가', '오늘 할 일 보여줘', '고마워'],
                };
            case 'add_todo':
                return {
                    content: `✅ 할 일 목록에 추가했어요!\n\n☑️ **${action.data.text ?? action.data}**\n🏷️ ${getListLabel(action.data.listId)}\n\n완료하면 체크해주세요! 화이팅! 💪`,
                    quickReplies: ['다른 할 일 추가', '지금 할 일 뭐야?', '고마워'],
                };
            case 'delete_event':
                return {
                    content: `🗑️ 일정을 삭제했어요.\n\n📅 **${action.data.title || '선택한 일정'}**${action.data.date ? `\n📆 ${format(parseISO(action.data.date), 'M월 d일 (EEEE)', { locale: ko })}` : ''}${action.data.startTime ? `\n⏰ ${action.data.startTime}` : ''}`,
                    quickReplies: ['다른 일정도 삭제', '오늘 일정 알려줘', '고마워'],
                };
            case 'add_journal': {
                const moodEmoji = action.data.mood === 'good' ? '😊' : action.data.mood === 'bad' ? '😔' : '😐';

                // Emotional Dialogue Flow - Enhanced empathetic response
                if (action.data.mood === 'bad') {
                    return {
                        content: `${moodEmoji} 그랬군요... 정말 힘드셨겠어요.\n\n일기장에 오늘의 이야기를 기록해뒀어요.\n\n혹시 조금 더 이야기하고 싶으시면, 무슨 일이 있었는지 말씀해주세요. 함께 정리해볼게요. 🌿`,
                        quickReplies: ['조금 더 이야기하고 싶어', '괜찮아, 그냥 기록만', '오늘은 일찍 쉴래'],
                    };
                } else if (action.data.mood === 'good') {
                    return {
                        content: `${moodEmoji} 오, 좋은 하루였나봐요! 저도 기분이 좋아지네요.\n\n일기장에 오늘의 기분을 기록해뒀어요.\n\n무슨 좋은 일이 있었는지 더 들려주실래요?`,
                        quickReplies: ['응, 좋은 일 있었어!', '그냥 기분이 좋아', '내일도 이랬으면'],
                    };
                }
                return {
                    content: `${moodEmoji} 오늘의 이야기를 일기장에 기록했어요.\n\n내일은 더 좋은 하루가 되길 바래요!`,
                    quickReplies: ['고마워', '내일 할 일 알려줘', '이제 쉴래'],
                };
            }
            case 'generate_insight':
                return {
                    content: `✅ AI 인사이트를 생성했어요!\n\n**AI 보드** 탭에서 주인님의 라이프 분석 리포트를 확인해보세요. 📊\n\n더 많은 데이터가 쌓일수록 더 정확한 분석이 가능해요!`,
                    quickReplies: ['분석 더 해줘', '오늘 할 일 뭐야?', '고마워'],
                };
            case 'generate_image':
                return { content: '이미지를 생성했어요!' };
            case 'generate_video':
                return { content: '영상을 생성했어요!' };
            default:
                return { content: '처리 완료!' };
        }
    };

    const getMoodLabel = (mood: JournalEntry['mood']) => {
        if (mood === 'good') return '좋음';
        if (mood === 'bad') return '안좋음';
        return '보통';
    };

    const getListLabel = (listId?: string) => {
        if (!listId) return '기본 목록';
        return todoLists.find(l => l.id === listId)?.title ?? '기본 목록';
    };

    const requiresConfirmation = (action: ChatMessage['action'] | null) => {
        if (!requireConfirm) return false;
        return action?.type === 'delete_event' || action?.type === 'add_todo' || action?.type === 'add_journal';
    };

    const buildConfirmationPrompt = (action: ChatMessage['action']): { content: string; quickReplies: string[] } => {
        let summary = '';
        if (action.type === 'add_event') {
            const eventDate = format(parseISO(action.data.date), 'M월 d일 (EEEE)', { locale: ko });
            summary = `📅 일정: **${action.data.title}**\n📆 ${eventDate}${action.data.startTime ? `\n⏰ ${action.data.startTime}` : ''}`;
        } else if (action.type === 'delete_event') {
            summary = `🗑️ 삭제 일정: **${action.data.title || '선택한 일정'}**${action.data.date ? `\n📆 ${format(parseISO(action.data.date), 'M월 d일 (EEEE)', { locale: ko })}` : ''}${action.data.startTime ? `\n⏰ ${action.data.startTime}` : ''}`;
        } else if (action.type === 'add_todo') {
            const text = action.data.text ?? action.data;
            summary = `☑️ 할 일: **${text}**\n🏷️ 목록: ${getListLabel(action.data.listId)}`;
        } else if (action.type === 'add_journal') {
            const snippet = (action.data.content || '').slice(0, 60);
            summary = `📝 일기: "${snippet}${action.data.content?.length > 60 ? '…' : ''}"\n🙂 기분: ${getMoodLabel(action.data.mood)}`;
        }

        return {
            content: `요청을 이렇게 이해했어요.\n\n${summary}\n\n이대로 실행할까요?`,
            quickReplies: ['실행', '취소'],
        };
    };

    const resolveAgentConfig = (targetAgent?: AIAgent) => {
        return getAgentAIConfig(settings, targetAgent?.connectionId);
    };

    const getAgentConnectionWarning = (targetAgent?: AIAgent): string => {
        if (!targetAgent) return '사용 가능한 AI 연결을 찾지 못했어요. 설정에서 API 연결을 확인해 주세요.';
        if (!targetAgent.connectionId) return `${targetAgent.name}에 API 연결이 지정되지 않았어요. 전역 기본 연결은 사용하지 않으니 페르소나 설정에서 Gemini/xAI를 지정해 주세요.`;

        const conn = (settings.apiConnections || []).find(c => c.id === targetAgent.connectionId);
        if (!conn) {
            return `${targetAgent.name}에 지정된 API 연결을 찾지 못했어요. 페르소나 설정에서 다시 연결해 주세요.`;
        }
        if (!conn.apiKey?.trim()) {
            return `${targetAgent.name}의 API Key가 비어 있어 응답할 수 없어요.`;
        }
        if (!isChatSupportedProvider(conn.provider)) {
            return `${targetAgent.name}에 연결된 ${conn.provider.toUpperCase()}는 현재 채팅에서 지원되지 않아요. Gemini 또는 xAI를 연결해 주세요.`;
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

    const buildHistoryForAgent = (allMessages: ChatMessage[], targetAgent?: AIAgent, allowUntypedAssistant = false) => {
        return allMessages
            .filter((message) => {
                if (message.role === 'user') return true;
                if (message.role !== 'assistant') return false;
                if (!targetAgent?.id) return false;
                if (message.agentId === targetAgent.id) return true;
                return allowUntypedAssistant && !message.agentId;
            })
            .map((message) => ({ role: message.role, content: message.content }))
            .slice(-CHAT_HISTORY_LIMIT);
    };

    const handleSend = async (text?: string) => {
        const messageText = text || inputValue;
        if (!messageText.trim() || isProcessing) return;

        const trimmedMessage = messageText.trim();
        const normalizedMessage = trimmedMessage.toLowerCase().replace(/[.!?]/g, '');
        const confirmKeywords = ['실행', '확인', '네', '응', '좋아', '그래', 'ㅇㅋ', 'ok', '오케이'];
        const cancelKeywords = ['취소', '아니', '그만', '나중에', 'no'];
        const isConfirm = Boolean(pendingAction) && confirmKeywords.includes(normalizedMessage);
        const isCancel = Boolean(pendingAction) && cancelKeywords.includes(normalizedMessage);

        if (!isConfirm && !isCancel) {
            if (!currentSessionId) {
                pendingSessionHydrationRef.current = true;
            }
            try {
                onUserMessage?.(trimmedMessage);
            } catch (error) {
                pendingSessionHydrationRef.current = false;
                console.error('onUserMessage callback failed:', error);
            }
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

        // Update conversation context for awareness
        setConversationContext(prev => [...prev.slice(-4), messageText]);
        const messageTimeline = [...messages, userMessage];

        const hasAnyAgentConfig = activeAgents.some((activeAgent) => Boolean(resolveAgentConfig(activeAgent)?.apiKey));
        // Keep artificial delay minimal when API is available.
        const delayMs = hasAnyAgentConfig ? 80 : 350;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        if (pendingAction && (isConfirm || isCancel)) {
            if (isCancel) {
                setPendingAction(null);
                const assistantMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: '알겠어요. 요청은 취소했어요.',
                    timestamp: new Date().toISOString(),
                    agentId: primaryAgent?.id,
                    quickReplies: ['다른 요청 하기', '오늘 일정 알려줘', '할 일 추가'],
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setIsProcessing(false);
                return;
            }

            await executeAction(pendingAction);
            const confirmedResponse = getResponseForAction(pendingAction, messageText);
            const assistantMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: confirmedResponse.content,
                timestamp: new Date().toISOString(),
                agentId: primaryAgent?.id,
                action: { ...pendingAction, executed: true },
                quickReplies: confirmedResponse.quickReplies,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setPendingAction(null);
            setIsProcessing(false);
            return;
        }

        if (pendingAction && !isConfirm && !isCancel) {
            const assistantMessage: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '확인을 기다리고 있어요. `실행` 또는 `취소` 중 하나로 답해주세요.',
                timestamp: new Date().toISOString(),
                agentId: primaryAgent?.id,
                quickReplies: ['실행', '취소'],
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setIsProcessing(false);
            return;
        }

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
                    for (let index = 0; index < activeAgents.length; index += 1) {
                        const currentAgent = activeAgents[index];
                        const currentMemory =
                            personaMemoryContextByAgent?.[currentAgent.id]
                            || (currentAgent.id === primaryAgent?.id ? personaMemoryContext : '');
                        const agentHistory = buildHistoryForAgent(messageTimeline, currentAgent, false);
                        const otherPersonaNames = activeAgents
                            .filter((activeAgent) => activeAgent.id !== currentAgent.id)
                            .map((activeAgent) => activeAgent.name)
                            .filter((name) => Boolean(name && name.trim()));

                        const agentConfig = resolveAgentConfig(currentAgent);
                        if (agentConfig) {
                            console.log(`[ChatView] Generating for ${currentAgent.name} using:`, agentConfig.provider, agentConfig.modelName);
                        }
                        if (!agentConfig?.apiKey) {
                            const warningMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: getAgentConnectionWarning(currentAgent),
                                timestamp: new Date().toISOString(),
                                agentId: currentAgent.id,
                            };
                            setMessages((prev) => [...prev, warningMessage]);
                            continue;
                        }

                        let assistantMessage: ChatMessage;

                        if (isImageGenerationModel(agentConfig.modelName)) {
                            try {
                                const imageUrl = agentConfig.provider === 'xai'
                                    ? await callXaiImageGeneration(
                                        agentConfig.apiKey,
                                        messageText,
                                        agentConfig.modelName,
                                        (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                    )
                                    : await callGeminiImageGeneration(
                                        agentConfig.apiKey,
                                        messageText,
                                        agentConfig.modelName
                                    );
                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: '이미지를 생성했어요!',
                                    imageUrl,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };
                            } catch (err) {
                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: `이미지 생성에 실패했어요: ${(err as Error).message}`,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };
                            }
                        } else if (isVideoGenerationModel(agentConfig.modelName)) {
                            try {
                                const videoUrl = await callXaiVideoGeneration(
                                    agentConfig.apiKey,
                                    messageText,
                                    agentConfig.modelName,
                                    (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                );
                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: '영상을 생성했어요!',
                                    videoUrl,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };
                            } catch (err) {
                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: `영상 생성에 실패했어요: ${(err as Error).message}`,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };
                            }
                        } else {
                            const result = await generateChatResponse(
                                agentConfig.apiKey,
                                agentHistory,
                                events,
                                todos,
                                entries,
                                userName,
                                agentConfig.modelName,
                                currentAgent,
                                chatMode,
                                currentMemory,
                                agentConfig.provider,
                                otherPersonaNames
                            );

                            const fallbackAction = mapGeminiActionToChatAction(result.action);

                            if (fallbackAction?.type === 'generate_image' || fallbackAction?.type === 'generate_video') {
                                const mediaType = fallbackAction.type === 'generate_image' ? 'image' : 'video';
                                const mediaConfig = findMediaConnection(settings, mediaType);
                                const prompt = fallbackAction.data?.prompt || messageText;

                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: result.reply || `${mediaType === 'image' ? '이미지' : '영상'}를 생성했어요!`,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };

                                if (mediaConfig) {
                                    try {
                                        if (mediaType === 'image') {
                                            const imageUrl = mediaConfig.provider === 'xai'
                                                ? await callXaiImageGeneration(mediaConfig.apiKey, prompt, mediaConfig.modelName, (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats }))
                                                : await callGeminiImageGeneration(mediaConfig.apiKey, prompt, mediaConfig.modelName, (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats }));
                                            assistantMessage.imageUrl = imageUrl;
                                        } else {
                                            const videoUrl = await callXaiVideoGeneration(mediaConfig.apiKey, prompt, mediaConfig.modelName, (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats }));
                                            assistantMessage.videoUrl = videoUrl;
                                        }
                                        assistantMessage.content = result.reply || `${mediaType === 'image' ? '이미지' : '영상'}를 생성했어요!`;
                                    } catch (err) {
                                        assistantMessage.content = (result.reply ? result.reply + "\n\n" : "") + `생성 실패: ${(err as Error).message}`;
                                    }
                                } else {
                                    assistantMessage.content = (result.reply ? result.reply + "\n\n" : "") + `연결된 ${mediaType === 'image' ? '이미지' : '비디오'} 생성 모델이 없어 생성할 수 없어요.`;
                                }
                            } else if (index === 0) {
                                if (!fallbackAction && result.action?.type === 'delete_event') {
                                    assistantMessage = {
                                        id: crypto.randomUUID(),
                                        role: 'assistant',
                                        content: '삭제할 일정을 찾지 못했어요. 일정 제목이나 날짜를 조금 더 구체적으로 말해 주세요.',
                                        timestamp: new Date().toISOString(),
                                        agentId: currentAgent.id,
                                        quickReplies: ['오늘 일정 보여줘', '내일 일정 보여줘'],
                                    };
                                } else if (fallbackAction) {
                                    if (requiresConfirmation(fallbackAction)) {
                                        setPendingAction(fallbackAction);
                                        const prompt = buildConfirmationPrompt(fallbackAction);
                                        assistantMessage = {
                                            id: crypto.randomUUID(),
                                            role: 'assistant',
                                            content: prompt.content,
                                            timestamp: new Date().toISOString(),
                                            agentId: currentAgent.id,
                                            action: fallbackAction,
                                            quickReplies: prompt.quickReplies,
                                        };
                                    } else {
                                        await executeAction(fallbackAction);
                                        const response = getResponseForAction(fallbackAction, messageText);
                                        assistantMessage = {
                                            id: crypto.randomUUID(),
                                            role: 'assistant',
                                            content: response.content,
                                            timestamp: new Date().toISOString(),
                                            agentId: currentAgent.id,
                                            action: { ...fallbackAction, executed: true },
                                            quickReplies: response.quickReplies,
                                        };
                                    }
                                } else {
                                    assistantMessage = {
                                        id: crypto.randomUUID(),
                                        role: 'assistant',
                                        content: result.reply || '도와드릴게요, 주인님.',
                                        timestamp: new Date().toISOString(),
                                        agentId: currentAgent.id,
                                    };
                                }
                            } else {
                                assistantMessage = {
                                    id: crypto.randomUUID(),
                                    role: 'assistant',
                                    content: result.reply || `${currentAgent.name}입니다. 이어서 도와드릴게요.`,
                                    timestamp: new Date().toISOString(),
                                    agentId: currentAgent.id,
                                };
                            }
                        }

                        const assistantMessageWithMeta = withConfigMeta(assistantMessage, agentConfig);
                        setMessages((prev) => [...prev, assistantMessageWithMeta]);

                        if (index < activeAgents.length - 1) {
                            await new Promise((resolve) => setTimeout(resolve, 180));
                        }
                    }
                } else {
                    const singleAgent = activeAgents[0] || primaryAgent;
                    const singlePersonaMemory = singleAgent
                        ? (personaMemoryContextByAgent?.[singleAgent.id] || personaMemoryContext || '')
                        : (personaMemoryContext || '');
                    const singleHistory = buildHistoryForAgent(messageTimeline, singleAgent, true);

                    const singleAgentConfig = resolveAgentConfig(singleAgent);
                    if (!singleAgentConfig?.apiKey) {
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

                    if (isImageGenerationModel(singleAgentConfig.modelName)) {
                        try {
                            const imageUrl = singleAgentConfig.provider === 'xai'
                                ? await callXaiImageGeneration(
                                    singleAgentConfig.apiKey,
                                    messageText,
                                    singleAgentConfig.modelName,
                                    (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                )
                                : await callGeminiImageGeneration(
                                    singleAgentConfig.apiKey,
                                    messageText,
                                    singleAgentConfig.modelName
                                );
                            const assistantMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: '이미지를 생성했어요!',
                                imageUrl,
                                timestamp: new Date().toISOString(),
                                agentId: singleAgent?.id,
                            };
                            setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                        } catch (err) {
                            const assistantMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: `이미지 생성에 실패했어요: ${(err as Error).message}`,
                                timestamp: new Date().toISOString(),
                                agentId: singleAgent?.id,
                            };
                            setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                        }
                    } else if (isVideoGenerationModel(singleAgentConfig.modelName)) {
                        try {
                            const videoUrl = await callXaiVideoGeneration(
                                singleAgentConfig.apiKey,
                                messageText,
                                singleAgentConfig.modelName,
                                (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                            );
                            const assistantMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: '영상을 생성했어요!',
                                videoUrl,
                                timestamp: new Date().toISOString(),
                                agentId: singleAgent?.id,
                            };
                            setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                        } catch (err) {
                            const assistantMessage: ChatMessage = {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: `영상 생성에 실패했어요: ${(err as Error).message}`,
                                timestamp: new Date().toISOString(),
                                agentId: singleAgent?.id,
                            };
                            setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                        }
                    } else {
                        const result = await generateChatResponse(
                            singleAgentConfig.apiKey,
                            singleHistory,
                            events,
                            todos,
                            entries,
                            userName,
                            singleAgentConfig.modelName,
                            singleAgent,
                            chatMode,
                            singlePersonaMemory,
                            singleAgentConfig.provider,
                            []
                        );

                        const fallbackAction = mapGeminiActionToChatAction(result.action);

                        const assistantMessage: ChatMessage = {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content: result.reply,
                            timestamp: new Date().toISOString(),
                            agentId: singleAgent?.id,
                        };

                        // Dynamic Media Generation Check
                        if (fallbackAction?.type === 'generate_image' || fallbackAction?.type === 'generate_video') {
                            const mediaType = fallbackAction.type === 'generate_image' ? 'image' : 'video';
                            const mediaConfig = findMediaConnection(settings, mediaType);
                            const prompt = fallbackAction.data?.prompt || messageText;

                            if (mediaConfig) {
                                try {
                                    if (mediaType === 'image') {
                                        const imageUrl = mediaConfig.provider === 'xai'
                                            ? await callXaiImageGeneration(
                                                mediaConfig.apiKey,
                                                prompt,
                                                mediaConfig.modelName,
                                                (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                            )
                                            : await callGeminiImageGeneration(
                                                mediaConfig.apiKey,
                                                prompt,
                                                mediaConfig.modelName,
                                                (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                            );
                                        assistantMessage.imageUrl = imageUrl;
                                    } else {
                                        const videoUrl = await callXaiVideoGeneration(
                                            mediaConfig.apiKey,
                                            prompt,
                                            mediaConfig.modelName,
                                            (stats) => onUpdateSettings?.({ ...settings, apiUsage: { ...settings.apiUsage, ...stats } as ApiUsageStats })
                                        );
                                        assistantMessage.videoUrl = videoUrl;
                                    }
                                    assistantMessage.content = result.reply || `${mediaType === 'image' ? '이미지' : '영상'}를 생성했어요!`;
                                } catch (err) {
                                    assistantMessage.content = (result.reply ? result.reply + "\n\n" : "") + `생성 실패: ${(err as Error).message}`;
                                }
                            } else {
                                assistantMessage.content = (result.reply ? result.reply + "\n\n" : "") + `연결된 ${mediaType === 'image' ? '이미지' : '비디오'} 생성 모델이 없어 생성할 수 없어요.`;
                            }
                            setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                        } else {
                            if (!fallbackAction && result.action?.type === 'delete_event') {
                                assistantMessage.content = '삭제할 일정을 찾지 못했어요. 일정 제목이나 날짜를 조금 더 구체적으로 말해 주세요.';
                                assistantMessage.quickReplies = ['오늘 일정 보여줘', '내일 일정 보여줘'];
                                setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                                setIsProcessing(false);
                                return;
                            }

                            if (fallbackAction) {
                                if (requiresConfirmation(fallbackAction)) {
                                    setPendingAction(fallbackAction);
                                    const prompt = buildConfirmationPrompt(fallbackAction);
                                    assistantMessage.content = prompt.content;
                                    assistantMessage.action = fallbackAction;
                                    assistantMessage.quickReplies = prompt.quickReplies;
                                    setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                                } else {
                                    await executeAction(fallbackAction);
                                    const response = getResponseForAction(fallbackAction, messageText);
                                    assistantMessage.content = response.content;
                                    assistantMessage.action = { ...fallbackAction, executed: true };
                                    assistantMessage.quickReplies = response.quickReplies;
                                    setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                                }
                            } else {
                                setMessages((prev) => [...prev, withConfigMeta(assistantMessage, singleAgentConfig)]);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(error);
                const assistantMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: "죄송해요, 대화 중 오류가 발생했어요. 다시 말씀해 주시겠어요?",
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

    return (
        <div className="w-full max-w-[800px] mx-auto text-[#37352f] h-full flex flex-col font-sans overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
            <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none px-2 py-6 space-y-6 scrollbar-hide" style={{ touchAction: 'pan-y' }}>
                {messages.map((msg, index) => {
                    const messageAgent = getAgentForMessage(msg);
                    return (
                        <div key={msg.id} className={`flex w-full mb-6 min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start items-start gap-3'}`}>
                            {msg.role === 'assistant' && (
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#37352f] flex items-center justify-center text-white shadow-sm flex-shrink-0 overflow-hidden mt-1">
                                    {messageAgent?.avatar ? (
                                        <img src={messageAgent.avatar} alt={messageAgent.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-[#37352f]" />
                                    )}
                                </div>
                            )}

                            <div className={`flex flex-col min-w-0 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-2`}>
                                {msg.role === 'assistant' && (
                                    <span className="text-xs text-[#9b9a97] mb-0 ml-1">
                                        {messageAgent?.name || 'LifeSync AI'}
                                        {msg.provider && msg.modelName ? ` · ${msg.provider.toUpperCase()} · ${msg.modelName}` : ''}
                                    </span>
                                )}

                                {msg.content && (
                                    <div
                                        className={`
                                            p-3.5 rounded-2xl leading-relaxed shadow-sm text-[14px] sm:text-[15px] break-words [overflow-wrap:anywhere]
                                            ${msg.role === 'user'
                                                ? 'bg-[#37352f] text-white rounded-br-sm'
                                                : 'bg-white border border-[#e9e9e8] text-[#37352f] rounded-bl-sm'}
                                        `}
                                    >
                                        {renderRichMessage(msg.content)}
                                    </div>
                                )}

                                {msg.imageUrl && (
                                    <div className="w-full rounded-2xl overflow-hidden border border-[#e9e9e8] bg-white shadow-sm transition-transform active:scale-[0.99]">
                                        <img
                                            src={msg.imageUrl}
                                            alt="Generated"
                                            className="w-full h-auto block cursor-pointer hover:opacity-95 transition-opacity"
                                            onClick={() => window.open(msg.imageUrl, '_blank')}
                                        />
                                    </div>
                                )}

                                {msg.videoUrl && (
                                    <div className="w-full rounded-2xl overflow-hidden border border-[#e9e9e8] bg-white shadow-sm">
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
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[#37352f] flex items-center justify-center text-white shadow-sm flex-shrink-0 overflow-hidden mt-1">
                            {primaryAgent?.avatar ? (
                                <img src={primaryAgent.avatar} alt={primaryAgent.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-[#37352f]" />
                            )}
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-xs text-[#9b9a97] mb-1.5 ml-1">
                                {activeAgents.length > 1
                                    ? `${activeAgents.length}명 페르소나 응답 생성 중`
                                    : (primaryAgent?.name || 'LifeSync AI')}
                            </span>
                            <div className="bg-white text-[#9b9a97] p-4 rounded-2xl rounded-bl-sm border border-[#e9e9e8] flex items-center gap-2 shadow-sm">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-[#d3d1cb] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-2 py-3 bg-white overflow-x-hidden">
                <div className="space-y-3">
                    {showToolbar && (
                        <div className="p-4 rounded-2xl border border-[#e9e9e8] bg-white shadow-sm space-y-5 relative">
                            {/* Header: Selection Mode */}
                            <div className="flex items-center justify-between pb-3 border-b border-[#f1f1f0]">
                                <div className="flex flex-col">
                                    <span className="text-sm font-semibold text-[#37352f]">대화 참여자 설정</span>
                                    <span className="text-[11px] text-[#9b9a97] mt-0.5">누구와 대화할지 선택해주세요</span>
                                </div>
                                <div className="flex items-center gap-1.5 p-1 bg-[#f7f7f5] rounded-lg border border-[#e9e9e8]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isMultiSelectEnabled) {
                                                setIsMultiSelectEnabled(false);
                                                if (activeAgents.length > 1 && primaryAgent?.id) {
                                                    onSelectAgents?.([primaryAgent.id]);
                                                }
                                            }
                                        }}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!isMultiSelectEnabled
                                            ? 'bg-white text-[#37352f] shadow-sm ring-1 ring-[#e9e9e8]'
                                            : 'text-[#9b9a97] hover:text-[#37352f]'}`}
                                    >
                                        1:1 대화
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsMultiSelectEnabled(true)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all gap-1.5 flex items-center ${isMultiSelectEnabled
                                            ? 'bg-[#37352f] text-white shadow-sm'
                                            : 'text-[#9b9a97] hover:text-[#37352f]'}`}
                                    >
                                        그룹 대화
                                    </button>
                                </div>
                            </div>

                            {/* Persona Grid */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-[#787774]">페르소나 선택</span>
                                    {isMultiSelectEnabled && (
                                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#f7f7f5] text-[#9b9a97] border border-[#e9e9e8]">
                                            {activeAgents.length} / {MAX_GROUP_AGENTS}명
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {availableAgents.map((availableAgent) => {
                                        const isActive = activeAgents.some((a) => a.id === availableAgent.id);
                                        return (
                                            <button
                                                key={availableAgent.id}
                                                type="button"
                                                onClick={() => {
                                                    if (!isMultiSelectEnabled) {
                                                        onSelectAgents?.([availableAgent.id]);
                                                        setShowToolbar(false);
                                                        return;
                                                    }

                                                    const currentIds = activeAgents.map((a) => a.id);
                                                    const isSelected = currentIds.includes(availableAgent.id);
                                                    let nextIds = isSelected
                                                        ? currentIds.filter((id) => id !== availableAgent.id)
                                                        : [...currentIds, availableAgent.id];

                                                    if (nextIds.length === 0) nextIds = [availableAgent.id];
                                                    if (!isSelected && nextIds.length > MAX_GROUP_AGENTS) return;

                                                    onSelectAgents?.(nextIds);
                                                }}
                                                className={`relative flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all overflow-hidden ${isActive
                                                    ? 'border-[#37352f] bg-[#f7f7f5] ring-1 ring-[#37352f] ring-offset-[-1px]'
                                                    : 'border-[#e9e9e8] bg-white hover:border-[#d3d1cb] hover:bg-[#fcfcfb]'}`}
                                            >
                                                <div className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center border transition-colors ${isActive ? 'border-[#37352f]' : 'border-[#e9e9e8]'}`}>
                                                    {availableAgent.avatar ? (
                                                        <img src={availableAgent.avatar} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className={`w-full h-full ${isActive ? 'bg-[#37352f]' : 'bg-[#f7f7f5]'}`} />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className={`text-sm font-semibold truncate ${isActive ? 'text-[#37352f]' : 'text-[#787774]'}`}>
                                                        {availableAgent.name}
                                                    </div>
                                                </div>
                                                {isActive && isMultiSelectEnabled && (
                                                    <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#37352f]" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Chat Mode Settings */}
                            <div className="pt-3 border-t border-[#f1f1f0] space-y-3">
                                <div className="flex flex-col">
                                    <span className="text-xs font-medium text-[#787774]">대화 방식</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(['basic', 'learning'] as ChatMode[]).map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => setChatMode(mode)}
                                            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${chatMode === mode
                                                ? 'border-[#37352f] bg-[#37352f] text-white shadow-sm'
                                                : 'border-[#e9e9e8] bg-white text-[#787774] hover:bg-[#f7f7f5] hover:text-[#37352f]'}`}
                                        >
                                            {chatModeLabels[mode]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2 items-stretch min-w-0">
                        <button
                            type="button"
                            onClick={() => setShowToolbar(prev => !prev)}
                            className="shrink-0 w-12 h-12 rounded-xl border border-[#e9e9e8] bg-white flex items-center justify-center text-[#787774] hover:text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                            aria-label="대화 도구 열기"
                            title={`${activeAgents.map((activeAgent) => activeAgent.name).join(', ') || 'LifeSync AI'} · ${chatModeLabels[chatMode]}`}
                        >
                            <Plus size={16} />
                        </button>
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={onboardingStep === 0 ? "이름을 입력해주세요..." : "무엇이든 말씀해주세요..."}
                            className="flex-1 min-w-0 h-12 px-4 bg-[#f7f7f5] border border-[#e9e9e8] rounded-xl text-base placeholder-[#d3d1cb] focus:outline-none focus:border-[#37352f] focus:bg-white transition-all"
                            disabled={isProcessing}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!inputValue.trim() || isProcessing}
                            className="shrink-0 w-12 h-12 bg-[#37352f] text-white rounded-xl hover:bg-[#2f2d28] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default ChatView;

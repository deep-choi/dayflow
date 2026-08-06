import React, { useState, useMemo, useEffect } from 'react';
import { AIAgent, AppSettings, ApiConnection, PersonaMemory, ThemeMode, User } from '../types';
import { Plus, Trash2, Save, RotateCcw, Download, Trash, Edit3, X, CheckCircle2, Circle, FlaskConical, Upload, Image as ImageIcon, SunMedium, Moon, Monitor, LogOut, Camera, Lock, Mail, Link, User as UserIcon, Users, Cpu, Palette, Database, Eye, EyeOff } from 'lucide-react';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { testOpenAIConnection } from '../services/openaiService';
import { testAnthropicConnection } from '../services/anthropicService';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaService';
import { DEFAULT_LOCAL_SERVER_BASE_URL, listLocalServerModels, testLocalServerConnection } from '../services/localServerService';
import { DEFAULT_GEMINI_MODEL, DEFAULT_OLLAMA_BASE_URL, getDefaultModelForProvider, getModelOptionsForProvider, hasProviderModelOptions, isChatSupportedProvider, normalizeProviderModelName } from '../utils/aiConfig';
import PersonaSettingsView from './PersonaSettingsView';
import AvatarCropperModal from '../components/AvatarCropperModal';
import { getAvatarImageStyle } from '../utils/avatarFrame';

export type SettingsTab = 'account' | 'theme' | 'api' | 'persona' | 'data';

interface SettingsViewProps {
    initialTab?: SettingsTab;
    hideTabs?: boolean;
    agents: AIAgent[];
    onUpdateAgents: (agents: AIAgent[]) => void;
    settings: AppSettings;
    onUpdateSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
    currentUser: User | null;
    onUpdateUser: (user: User) => void;
    onLogout: () => void;
    isLoggingOut?: boolean;
    onExportData: () => void;
    onClearAllData: () => void;
    onClearActivity: () => void;
    onClearPosts: () => void;
    onClearEvents: () => void;
    onClearTodos: () => void;
    onClearEntries: () => void;
    onClearChat: () => void;
    personaMemories: PersonaMemory[];
    onAddPersonaMemory: (agentId: string, type: PersonaMemory['type'], content: string) => void;
    onForgetPersonaMemory: (memoryId: string) => void;
    onClearAgentPersonaMemories: (agentId: string) => void;
}

const maskApiKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 10) return `${key.slice(0, 3)}...`;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
};

const THEME_OPTIONS: { id: ThemeMode; label: string; description: string; icon: React.ElementType }[] = [
    { id: 'system', label: '시스템', description: 'OS 설정을 따릅니다.', icon: Monitor },
    { id: 'light', label: '라이트', description: '밝은 테마를 사용합니다.', icon: SunMedium },
    { id: 'dark', label: '다크', description: '어두운 테마를 사용합니다.', icon: Moon },
];

const normalizeConnectionModelName = (provider: ApiConnection['provider'], modelName: string): string => {
    return normalizeProviderModelName(provider, modelName);
};

const getProviderDisplayName = (provider: ApiConnection['provider']): string => {
    if (provider === 'xai') return 'xAI';
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'gemini') return 'Gemini';
    if (provider === 'ollama') return 'Ollama';
    return '기타 로컬 서버';
};

const getApiKeyPlaceholder = (provider?: ApiConnection['provider']): string => {
    if (provider === 'xai') return 'xai-...';
    if (provider === 'openai') return 'sk-...';
    if (provider === 'anthropic') return 'sk-ant-...';
    if (provider === 'gemini') return 'AIza...';
    if (provider === 'custom') return '선택 사항';
    return 'API Key';
};

const SettingsView: React.FC<SettingsViewProps> = ({
    initialTab = 'account',
    hideTabs = false,
    agents,
    onUpdateAgents,
    settings,
    onUpdateSettings,
    currentUser,
    onUpdateUser,
    onLogout,
    isLoggingOut = false,
    onExportData,
    onClearAllData,
    onClearActivity,
    onClearPosts,
    onClearEvents,
    onClearTodos,
    onClearEntries,
    onClearChat,
    personaMemories,
    onAddPersonaMemory,
    onForgetPersonaMemory,
    onClearAgentPersonaMemories,
}) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
        }
    }, [initialTab]);

    const getHeaderInfo = () => {
        if (!hideTabs) {
            return {
                title: '설정',
                description: '페르소나 설정, API 모델 연동 및 테마를 관리합니다.',
            };
        }
        switch (activeTab) {
            case 'account':
                return {
                    title: '프로필 설정',
                    description: '사용자 이름, 프로필 사진 및 계정 정보를 관리합니다.',
                };
            case 'persona':
                return {
                    title: '페르소나 설정',
                    description: 'AI 페르소나 아바타와 개인화 지침 및 기억을 관리합니다.',
                };
            case 'api':
                return {
                    title: 'API & AI 모델 설정',
                    description: 'Gemini, OpenAI, Anthropic, Ollama 등 AI 연동 Key를 설정합니다.',
                };
            case 'theme':
                return {
                    title: '테마 설정',
                    description: '화면 테마(시스템, 라이트, 다크)를 설정합니다.',
                };
            case 'data':
                return {
                    title: '데이터 관리',
                    description: '앱 데이터 내보내기 및 데이터 초기화를 관리합니다.',
                };
            default:
                return {
                    title: '설정',
                    description: '설정을 관리합니다.',
                };
        }
    };

    const headerInfo = getHeaderInfo();

    // API states
    const [isAdding, setIsAdding] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [newConnection, setNewConnection] = useState<Partial<ApiConnection>>({
        provider: 'gemini',
        isActive: true,
        modelName: DEFAULT_GEMINI_MODEL,
        apiKey: '',
    });

    const [showUrlInput, setShowUrlInput] = useState(false);
    const [saveSuccessToast, setSaveSuccessToast] = useState(false);
    const [isAvatarCropOpen, setIsAvatarCropOpen] = useState(false);
    const [editingApiKeyMap, setEditingApiKeyMap] = useState<Record<string, string>>({});
    const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});

    const [userDraft, setUserDraft] = useState<User | null>(currentUser);
    useEffect(() => {
        if (currentUser) setUserDraft(currentUser);
    }, [currentUser]);

    const connections = settings.apiConnections || [];
    const selectedConnection = useMemo(() => {
        const byId = connections.find(c => c.id === settings.activeConnectionId);
        if (byId) return byId;
        return connections.find(c => c.isActive);
    }, [connections, settings.activeConnectionId]);

    // --- API helpers ---
    const persistConnections = (nextConnections: ApiConnection[], preferredId?: string) => {
        const normalizedConnections = nextConnections.map(connection => ({
            ...connection,
            modelName: normalizeConnectionModelName(connection.provider, connection.modelName),
        }));

        onUpdateSettings((prev) => {
            const resolvedId =
                preferredId && normalizedConnections.some(c => c.id === preferredId)
                    ? preferredId
                    : prev.activeConnectionId && normalizedConnections.some(c => c.id === prev.activeConnectionId)
                        ? prev.activeConnectionId
                        : normalizedConnections[0]?.id;
            // Keep ALL connections isActive:true — activeConnectionId tracks the global default
            const normalized = normalizedConnections.map(c => ({ ...c, isActive: true }));
            const activeGemini = normalized.find(c => c.id === resolvedId && c.provider === 'gemini') || normalized.find(c => c.provider === 'gemini');
            return {
                ...prev,
                apiConnections: normalized,
                activeConnectionId: resolvedId,
                geminiApiKey: activeGemini?.apiKey || '',
            };
        });
    };
    const updateConnectionModel = (connectionId: string, modelName: string) => {
        const updated = connections.map(conn => {
            if (conn.id !== connectionId) return conn;
            const normalized = normalizeConnectionModelName(conn.provider, modelName);
            return { ...conn, modelName: normalized };
        });
        persistConnections(updated);
    };

    const updateConnectionApiKey = (connectionId: string, apiKey: string) => {
        const updated = connections.map(conn => {
            if (conn.id !== connectionId) return conn;
            return { ...conn, apiKey: apiKey.trim() };
        });
        persistConnections(updated);
    };

    const isSelectableProvider = (provider: ApiConnection['provider']) => isChatSupportedProvider(provider);
    const loadLocalModels = async () => {
        setIsLoadingOllamaModels(true);
        try {
            const models = newConnection.provider === 'custom'
                ? await listLocalServerModels(newConnection.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, newConnection.apiKey)
                : await listOllamaModels(newConnection.baseUrl || DEFAULT_OLLAMA_BASE_URL);
            setOllamaModels(models);
            if (models.length > 0) {
                setNewConnection(prev => ({ ...prev, modelName: models.includes(prev.modelName || '') ? prev.modelName : models[0] }));
            } else {
                alert('서버에서 불러올 수 있는 모델이 없습니다. 모델 이름을 직접 입력해 주세요.');
            }
        } catch (error: any) {
            alert(`로컬 모델을 불러오지 못했습니다: ${error?.message || '알 수 없는 오류'}`);
        } finally {
            setIsLoadingOllamaModels(false);
        }
    };
    const addConnection = () => {
        const provider = (newConnection.provider as ApiConnection['provider']) || 'gemini';
        const modelName = (newConnection.modelName || '').trim();
        const apiKey = (newConnection.apiKey || '').trim();
        const isLocalProvider = provider === 'ollama' || provider === 'custom';
        const baseUrl = (newConnection.baseUrl || (provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL)).trim();
        if (!modelName || (!isLocalProvider && !apiKey) || (isLocalProvider && !baseUrl)) return;
        const connection: ApiConnection = {
            id: crypto.randomUUID(),
            provider,
            modelName: normalizeConnectionModelName(provider, modelName),
            apiKey,
            baseUrl: isLocalProvider ? baseUrl : undefined,
            isActive: true
        };
        persistConnections([...connections, connection], connection.id);
        setIsAdding(false);
        setNewConnection({ provider: 'gemini', isActive: true, modelName: DEFAULT_GEMINI_MODEL, apiKey: '', baseUrl: undefined });
    };
    const deleteConnection = (id: string) => {
        if (!window.confirm('이 API 연결을 삭제할까요?')) return;
        persistConnections(connections.filter(c => c.id !== id));
    };
    const selectModelConnection = (conn: ApiConnection) => {
        if (!isSelectableProvider(conn.provider)) { alert('현재 앱은 지원되는 채팅용 모델 연결만 AI 기능에 사용합니다.'); return; }
        persistConnections(connections, conn.id);
    };
    const testConnection = async (conn: ApiConnection) => {
        if (!isSelectableProvider(conn.provider)) { alert('지원되는 채팅용 모델만 연결할 수 있습니다.'); return; }
        setTestingId(conn.id);
        try {
            if (conn.provider === 'ollama') {
                await testOllamaConnection(conn.baseUrl, conn.modelName);
            } else if (conn.provider === 'custom') {
                await testLocalServerConnection(conn.baseUrl, conn.apiKey, conn.modelName);
            } else if (conn.provider === 'xai') {
                await testXaiConnection(conn.apiKey, conn.modelName);
            } else if (conn.provider === 'openai') {
                await testOpenAIConnection(conn.apiKey, conn.modelName);
            } else if (conn.provider === 'anthropic') {
                await testAnthropicConnection(conn.apiKey, conn.modelName);
            } else {
                await callGeminiAPI(conn.apiKey, '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.', undefined, conn.modelName);
            }
            alert(`연결 성공: ${conn.modelName}`);
        } catch (error: any) {
            alert(`연결 실패: ${error?.message || '알 수 없는 오류'}`);
        } finally { setTestingId(null); }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (url: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기가 너무 큽니다 (최대 5MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                callback(event.target.result as string);
            }
        };
        reader.readAsDataURL(file);
    };

    const SIDEBAR_GROUPS = [
        {
            title: '내 계정',
            items: [
                { id: 'account', label: '프로필', icon: UserIcon }
            ]
        },
        {
            title: '설정',
            items: [
                { id: 'persona', label: '페르소나 설정', icon: Users },
                { id: 'api', label: 'API & AI 모델', icon: Cpu },
                { id: 'theme', label: '테마', icon: Palette }
            ]
        },
        {
            title: '데이터',
            items: [
                { id: 'data', label: '데이터 관리', icon: Database }
            ]
        }
    ];

    return (
        <div className={`flex w-full h-full font-sans ${hideTabs ? 'flex-col max-w-[560px] mx-auto px-4 sm:px-6 pt-3 pb-20 overflow-y-auto custom-scrollbar' : 'flex-col sm:flex-row overflow-hidden'}`}>
            {/* Sidebar Navigation */}
            {!hideTabs && (
                <div className="sm:w-[260px] shrink-0 sm:border-r border-b sm:border-b-0 border-[#e9e9e8] bg-[#f7f7f5] sm:overflow-y-auto pt-3.5 sm:pt-7 pb-2.5 sm:pb-6 px-3.5 sm:px-4 flex flex-col sm:block gap-2 sm:gap-6 shrink-0">
                    <div className="flex sm:block overflow-x-auto scrollbar-hide space-x-1.5 sm:space-x-0 sm:space-y-7 pb-1 sm:pb-0">
                        {SIDEBAR_GROUPS.map((group, idx) => (
                            <div key={idx} className="flex sm:block shrink-0 sm:shrink gap-1 sm:gap-0">
                                <h3 className="hidden sm:block px-3.5 text-xs sm:text-sm font-medium text-[#787774] tracking-wide uppercase mb-2.5">{group.title}</h3>
                                <div className="flex sm:block space-x-1 sm:space-x-0 sm:space-y-2">
                                    {group.items.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id as SettingsTab)}
                                            className={`flex items-center gap-3.5 px-4 py-2.5 rounded-xl text-sm sm:text-base transition-all whitespace-nowrap ${activeTab === item.id ? 'bg-[#e8e8e6] text-[#37352f] font-medium shadow-2xs' : 'text-[#787774] hover:bg-[#efefed] hover:text-[#37352f] font-medium'}`}
                                        >
                                            <item.icon size={20} className={`w-5 h-5 ${activeTab === item.id ? 'text-[#37352f]' : 'text-[#787774]'}`} />
                                            <span>{item.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div className={`flex-1 overflow-y-auto custom-scrollbar ${hideTabs ? '' : 'bg-white px-4 sm:px-10 pt-5 sm:pt-12 pb-16 sm:pb-24'}`}>
                {/* Header for standalone modal */}
                {hideTabs && (
                    <div className="mb-6">
                        <h1 className="text-base font-semibold text-[#37352f] tracking-normal">{headerInfo.title}</h1>
                        <p className="text-sm text-[#9b9a97] mt-1">{headerInfo.description}</p>
                    </div>
                )}
                
                {/* ===== 테마 탭 ===== */}
            {activeTab === 'theme' && (
                <div className="space-y-6">
                    <div className="pb-4 border-b border-[#f0f0ee]">
                        <h3 className="text-xl font-medium text-[#37352f]">테마 설정</h3>
                        <p className="text-sm text-[#787774] mt-1">시스템 설정을 따르거나 라이트/다크 모드를 선택하세요.</p>
                    </div>
                    <div className="divide-y divide-[#f0f0ee]">
                        {THEME_OPTIONS.map((option) => {
                            const isActive = settings.theme === option.id;
                            const Icon = option.icon;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => onUpdateSettings(prev => ({ ...prev, theme: option.id }))}
                                    className={`w-full flex items-center justify-between py-4 text-left transition-colors ${isActive ? 'text-[#37352f]' : 'text-[#787774] hover:text-[#37352f]'}`}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-all ${isActive ? 'bg-blue-600 text-white shadow-xs' : 'bg-[#f4f4f2] text-[#787774]'}`}>
                                            <Icon size={24} />
                                        </span>
                                        <div>
                                            <span className="block text-base font-medium text-[#37352f]">{option.label}</span>
                                            <span className="block text-sm text-[#8a8a8a] mt-0.5">{option.description}</span>
                                        </div>
                                    </div>
                                    {isActive && <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium">선택됨</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ===== 계정 탭 (프로필) ===== */}
            {activeTab === 'account' && (
                <div className="space-y-6 max-w-xl mx-auto pt-1 pb-4">
                    {/* Profile Header & Avatar Direct Upload */}
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 pb-6 border-b border-[#e9e9e8]">
                        <div className="relative group shrink-0">
                            <button
                                type="button"
                                onClick={() => {
                                    if (userDraft?.avatar) {
                                        setIsAvatarCropOpen(true);
                                    } else {
                                        document.getElementById('profile-avatar-upload')?.click();
                                    }
                                }}
                                className="cursor-pointer block relative rounded-full overflow-hidden group"
                            >
                                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#00a67d] text-white flex items-center justify-center text-3xl font-bold overflow-hidden shadow-md border-2 border-white">
                                    {userDraft?.avatar ? (
                                        <img src={userDraft.avatar} alt={userDraft.name} style={getAvatarImageStyle(userDraft.avatarFrame)} className="w-full h-full object-cover" />
                                    ) : (
                                        userDraft?.name?.[0]?.toUpperCase() || 'U'
                                    )}
                                </div>
                                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-full backdrop-blur-xs">
                                    <Camera size={22} />
                                    <span className="text-[11px] font-medium mt-1">사진 편집</span>
                                </div>
                            </button>
                            <input
                                id="profile-avatar-upload"
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) => {
                                    handleImageUpload(e, (url) => {
                                        if (userDraft) {
                                            setUserDraft({ ...userDraft, avatar: url, avatarFrame: undefined });
                                            setIsAvatarCropOpen(true);
                                        }
                                    });
                                }}
                            />
                        </div>

                        <div className="flex-1 text-center sm:text-left space-y-2 pt-2 sm:pt-4">
                            <div>
                                <h3 className="text-xl font-medium text-[#37352f]">{userDraft?.name || 'JNMED'}</h3>
                                <p className="text-sm text-[#787774] flex items-center justify-center sm:justify-start gap-1.5 mt-1 font-medium">
                                    <Mail size={15} className="text-[#8a8a8a]" />
                                    {userDraft?.email || 'jnmed5672@gmail.com'}
                                </p>
                            </div>
                            
                            {showUrlInput && (
                                <div className="pt-2 animate-in fade-in duration-150 relative">
                                    <input
                                        type="text"
                                        value={userDraft?.avatar || ''}
                                        onChange={(e) => userDraft && setUserDraft({ ...userDraft, avatar: e.target.value })}
                                        className="w-full px-3 py-2 pr-8 rounded-lg border border-[#e9e9e8] bg-white text-[#37352f] text-xs font-mono outline-none focus:border-[#171717]"
                                        placeholder="https://example.com/avatar.jpg"
                                    />
                                    <button 
                                        type="button" 
                                        onClick={() => setShowUrlInput(false)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#171717]"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Form Fields */}
                    <div className="space-y-5 pt-2">
                        <div className="space-y-1.5">
                            <label className="text-[13px] font-semibold text-[#37352f]">사용자 이름</label>
                            <input
                                type="text"
                                value={userDraft?.name || ''}
                                onChange={(e) => userDraft && setUserDraft({ ...userDraft, name: e.target.value })}
                                className="w-full px-0 py-2 border-b border-[#e9e9e8] focus:border-[#171717] bg-transparent text-[#171717] text-sm font-medium outline-none transition-all"
                                placeholder="이름을 입력하세요"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[13px] font-semibold text-[#37352f]">이메일 계정</label>
                                <span className="text-[12px] font-normal text-[#8a8a8a] flex items-center gap-1">
                                    <Lock size={12} /> 변경 불가
                                </span>
                            </div>
                            <div className="w-full py-2 border-b border-[#f0f0ee] text-[#787774] text-sm font-medium flex items-center justify-between select-none">
                                <span>{userDraft?.email || 'jnmed5672@gmail.com'}</span>
                                <span className="text-[11px] text-[#9b9a97]">Google 연동</span>
                            </div>
                        </div>

                        {/* Save Action Bar */}
                        <div className="pt-4 flex items-center justify-end gap-3">
                            {saveSuccessToast && (
                                <span className="text-xs font-medium text-emerald-600 flex items-center gap-1.5 animate-in fade-in duration-150 mr-2">
                                    <CheckCircle2 size={15} /> 프로필 변경사항이 저장되었습니다.
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    if (userDraft) {
                                        onUpdateUser(userDraft);
                                        setSaveSuccessToast(true);
                                        setTimeout(() => setSaveSuccessToast(false), 3000);
                                    }
                                }}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-all font-medium text-sm shadow-xs cursor-pointer"
                            >
                                <Save size={16} />
                                변경사항 저장
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'account' && userDraft?.avatar && (
                <AvatarCropperModal
                    isOpen={isAvatarCropOpen}
                    avatar={userDraft.avatar}
                    frame={userDraft.avatarFrame}
                    title="프로필 이미지 편집"
                    name={userDraft.name}
                    onAvatarChange={(avatar) => {
                        setUserDraft({ ...userDraft, avatar, avatarFrame: undefined });
                    }}
                    onFrameChange={(frame) => {
                        setUserDraft(prev => prev ? { ...prev, avatarFrame: frame } : null);
                    }}
                    onClose={() => setIsAvatarCropOpen(false)}
                />
            )}

            {/* ===== API 연결 탭 ===== */}
            {activeTab === 'api' && (
                <div className="space-y-7">
                    <div className="pb-4 border-b border-[#f0f0ee]">
                        <h3 className="text-xl font-medium text-[#37352f]">API 및 AI 모델</h3>
                        <p className="text-sm text-[#787774] mt-1">대화에 활용할 AI 서비스 공급자 및 연동 키를 관리합니다.</p>
                    </div>

                    {/* API Connections List */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="font-medium text-base text-[#37352f]">연결된 API 목록 ({connections.length})</h4>
                            <button onClick={() => setIsAdding(true)} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-sm font-medium shadow-xs">
                                <Plus size={15} /> 새 연결 추가
                            </button>
                        </div>

                        {connections.length === 0 && (
                            <div className="py-12 text-center text-sm text-[#787774]">
                                등록된 API 연결이 없습니다. 위 [+ 새 연결 추가] 버튼을 눌러 시작하세요.
                            </div>
                        )}

                        <div className="space-y-3">
                            {connections.map(conn => {
                                const isSelected = conn.id === selectedConnection?.id;
                                const isSelectable = isSelectableProvider(conn.provider);
                                const modelOptions = getModelOptionsForProvider(conn.provider);
                                const hasModelDropdown = modelOptions.length > 0;
                                return (
                                    <div 
                                        key={conn.id} 
                                        onClick={() => selectModelConnection(conn)}
                                        className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer bg-white space-y-4 ${isSelected ? 'border-[#dcdcd9] bg-blue-50/20 shadow-2xs' : 'border-[#e9e9e8] hover:border-[#dcdcd9]'}`}
                                    >
                                        {/* Top Row: Provider, Badge, Model & Actions */}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center gap-2.5 flex-wrap">
                                                    <span className="text-base font-medium text-[#37352f]">{conn.provider.toUpperCase()}</span>
                                                    {isSelected && <span className="text-xs font-medium text-blue-600 bg-blue-50 border border-[#d0e1fd] px-2.5 py-0.5 rounded-lg">기본 사용 중</span>}
                                                    {(conn.provider === 'gemini' || conn.provider === 'openai' || conn.provider === 'anthropic' || conn.provider === 'xai') && !conn.apiKey?.trim() && (
                                                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-lg">API Key 미등록</span>
                                                    )}
                                                </div>
                                                <div className="pt-0.5">
                                                    {hasModelDropdown ? (
                                                        <select 
                                                            value={conn.modelName} 
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                updateConnectionModel(conn.id, e.target.value);
                                                            }} 
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="text-sm font-medium text-[#787774] bg-transparent border-0 outline-none cursor-pointer hover:text-[#37352f] p-0"
                                                        >
                                                            {modelOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                                        </select>
                                                    ) : (
                                                        <span className="text-sm text-[#787774] font-medium">{conn.modelName}</span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 self-start sm:self-center" onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    onClick={() => testConnection(conn)} 
                                                    disabled={!isSelectable || testingId === conn.id} 
                                                    className="px-3.5 py-1.5 rounded-xl text-sm font-medium bg-[#f4f4f2] text-[#37352f] hover:bg-[#eaeaea] transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
                                                >
                                                    <FlaskConical size={14} className="text-[#787774]" />
                                                    {testingId === conn.id ? '테스트 중...' : '연결 테스트'}
                                                </button>
                                                <button 
                                                    onClick={() => deleteConnection(conn.id)} 
                                                    className="p-2 text-[#9b9a97] hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                                    title="삭제"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* API Key Direct Input Field */}
                                        {(conn.provider === 'gemini' || conn.provider === 'openai' || conn.provider === 'anthropic' || conn.provider === 'xai' || conn.provider === 'custom') && (
                                            <div className="pt-3 border-t border-[#f0f0ee] flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <div className="relative flex-1 flex items-center rounded-xl border border-[#e9e9e8] bg-[#fbfbfb] focus-within:bg-white focus-within:border-[#d4d4d4] transition-all px-3.5 py-2">
                                                    <input
                                                        type={showKeyMap[conn.id] ? 'text' : 'password'}
                                                        placeholder={`${conn.provider.toUpperCase()} API Key 입력...`}
                                                        value={editingApiKeyMap[conn.id] !== undefined ? editingApiKeyMap[conn.id] : (conn.apiKey || '')}
                                                        onChange={(e) => setEditingApiKeyMap(prev => ({ ...prev, [conn.id]: e.target.value }))}
                                                        className="w-full bg-transparent text-sm font-mono text-[#37352f] outline-none placeholder-[#b8b8b8]"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowKeyMap(prev => ({ ...prev, [conn.id]: !prev[conn.id] }))}
                                                        className="text-[#9b9a97] hover:text-[#37352f] ml-2 transition-colors"
                                                        title={showKeyMap[conn.id] ? "API Key 숨기기" : "API Key 보기"}
                                                    >
                                                        {showKeyMap[conn.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newKey = editingApiKeyMap[conn.id] !== undefined ? editingApiKeyMap[conn.id] : (conn.apiKey || '');
                                                        updateConnectionApiKey(conn.id, newKey);
                                                        alert(`${conn.provider.toUpperCase()} API Key가 저장되었습니다.`);
                                                    }}
                                                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shrink-0 shadow-2xs"
                                                >
                                                    저장
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Add Connection Modal */}
                    {isAdding && (
                        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-base font-medium">새 API 연결 추가</h3>
                                    <button onClick={() => setIsAdding(false)} className="p-1 hover:bg-[#f1f1f0] rounded-full"><X size={20} className="text-[#9b9a97]" /></button>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">Provider</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['gemini', 'xai', 'openai', 'anthropic', 'ollama', 'custom'] as const).map(provider => {
                                            return (
                                                <button key={provider} onClick={() => {
                                                    setOllamaModels([]);
                                                    setNewConnection({
                                                        ...newConnection,
                                                        provider,
                                                        modelName: getDefaultModelForProvider(provider),
                                                        apiKey: '',
                                                        baseUrl: provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : undefined,
                                                    });
                                                }}
                                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${newConnection.provider === provider ? 'bg-[#eeeeee] text-[#171717]' : 'bg-[#f7f7f7] text-[#787774] hover:bg-[#eeeeee]'}`}>
                                                    {getProviderDisplayName(provider)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                {(newConnection.provider === 'ollama' || newConnection.provider === 'custom') && (
                                    <div>
                                        <label className="block text-sm font-medium mb-2">{newConnection.provider === 'ollama' ? 'Ollama 서버 주소' : '로컬 서버 주소'}</label>
                                        <input
                                            type="url"
                                            placeholder={newConnection.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL}
                                            value={newConnection.baseUrl || (newConnection.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL)}
                                            onChange={e => setNewConnection({ ...newConnection, baseUrl: e.target.value })}
                                            className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] font-mono text-sm"
                                        />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium mb-2">모델</label>
                                    {(newConnection.provider === 'ollama' || newConnection.provider === 'custom') && ollamaModels.length > 0 ? (
                                        <select title={newConnection.modelName || ''} value={newConnection.modelName || ''} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 pr-10 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] truncate">
                                            {ollamaModels.map(model => <option key={model} value={model}>{model}</option>)}
                                        </select>
                                    ) : newConnection.provider && hasProviderModelOptions(newConnection.provider) ? (
                                        <select value={newConnection.modelName || getDefaultModelForProvider(newConnection.provider)} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4]">
                                            {getModelOptionsForProvider(newConnection.provider).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                    ) : (
                                        <input type="text" placeholder={newConnection.provider === 'ollama' || newConnection.provider === 'custom' ? '모델 목록을 불러오거나 직접 입력' : '예: gpt-4o'} value={newConnection.modelName || ''} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4]" />
                                    )}
                                </div>
                                {(newConnection.provider === 'ollama' || newConnection.provider === 'custom') && (
                                    <button type="button" onClick={() => void loadLocalModels()} disabled={isLoadingOllamaModels} className="w-full py-2.5 border border-[#e9e9e8] rounded-xl text-sm text-[#37352f] hover:bg-[#f7f7f7] transition-colors disabled:opacity-50">
                                        {isLoadingOllamaModels ? '로컬 모델 불러오는 중...' : '로컬 모델 목록 불러오기'}
                                    </button>
                                )}
                                {newConnection.provider !== 'ollama' && <div>
                                    <label className="block text-sm font-medium mb-2">API Key{newConnection.provider === 'custom' ? ' (선택 사항)' : ''}</label>
                                    <input type="password" placeholder={getApiKeyPlaceholder(newConnection.provider)} value={newConnection.apiKey || ''} onChange={e => setNewConnection({ ...newConnection, apiKey: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] font-mono text-sm" />
                                </div>}
                                <button onClick={addConnection} disabled={!newConnection.modelName || (!['ollama', 'custom'].includes(newConnection.provider || '') && !newConnection.apiKey)} className="w-full py-3.5 bg-[#f7f7f7] text-[#171717] rounded-xl hover:bg-[#eeeeee] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2">
                                    연결 추가하기
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ===== 페르소나 탭 ===== */}
            {activeTab === 'persona' && (
                <PersonaSettingsView
                    agents={agents}
                    onUpdateAgents={onUpdateAgents}
                    settings={settings}
                    onUpdateSettings={onUpdateSettings}
                    personaMemories={personaMemories}
                    onAddPersonaMemory={onAddPersonaMemory}
                    onForgetPersonaMemory={onForgetPersonaMemory}
                    onClearAgentPersonaMemories={onClearAgentPersonaMemories}
                />
            )}

            {/* ===== 데이터 관리 탭 ===== */}
            {activeTab === 'data' && (
                <div className="space-y-6">
                    <div className="pb-4 border-b border-[#f0f0ee]">
                        <h3 className="text-xl font-medium text-[#37352f]">데이터 관리</h3>
                        <p className="text-sm text-[#787774] mt-1">각 항목별 데이터를 선택하여 초기화하거나 백업하세요.</p>
                    </div>

                    <div className="divide-y divide-[#f0f0ee]">
                        {[
                            { label: '레거시 AI 게시글', desc: '이전 버전에서 생성된 AI 게시글 데이터를 정리합니다.', action: onClearPosts },
                            { label: '캘린더', desc: '저장된 일정 데이터를 모두 삭제합니다.', action: onClearEvents },
                            { label: '할 일', desc: '할 일 목록과 항목을 모두 삭제합니다.', action: onClearTodos },
                            { label: '메모장', desc: '작성한 메모/일기를 모두 삭제합니다.', action: onClearEntries },
                            { label: 'AI 대화', desc: 'AI 채팅 기록과 페르소나 메모리를 모두 삭제합니다.', action: onClearChat },
                            { label: '활동 로그', desc: '활동 기록만 삭제합니다.', action: onClearActivity },
                        ].map(item => (
                            <div key={item.label} className="flex items-center justify-between gap-4 py-3.5">
                                <div className="min-w-0">
                                    <div className="text-base font-medium text-[#37352f]">{item.label}</div>
                                    <div className="text-sm text-[#787774] mt-0.5">{item.desc}</div>
                                </div>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`${item.label} 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) {
                                            item.action();
                                        }
                                    }}
                                    className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 transition-all shrink-0"
                                >
                                    초기화
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="pt-5 border-t border-[#f0f0ee] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[#787774]">전체 데이터 관리</span>
                        <div className="flex gap-2.5">
                            <button onClick={onExportData} className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-[#f4f4f2] text-sm font-medium text-[#37352f] hover:bg-[#eaeaea] transition-all">
                                내보내기
                            </button>
                            <button onClick={onClearAllData} className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-rose-600 text-sm font-semibold text-white hover:bg-rose-700 shadow-xs transition-all">
                                전체 초기화
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

export default SettingsView;

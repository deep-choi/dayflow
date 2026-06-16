import React, { useState, useMemo, useEffect } from 'react';
import { AIAgent, AppSettings, ApiConnection, PersonaMemory, ThemeMode, User } from '../types';
import { Plus, Trash2, Save, RotateCcw, Download, Trash, Edit3, X, CheckCircle2, Circle, FlaskConical, Upload, Image as ImageIcon, SunMedium, Moon, Monitor, LogOut } from 'lucide-react';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { DEFAULT_GEMINI_MODEL, DEFAULT_XAI_MODEL, GEMINI_MODEL_OPTIONS, XAI_MODEL_OPTIONS, normalizeGeminiModelName } from '../utils/aiConfig';
import PersonaSettingsView from './PersonaSettingsView';

type SettingsTab = 'account' | 'theme' | 'api' | 'persona' | 'data';

interface SettingsViewProps {
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
    const normalized = provider === 'gemini' ? normalizeGeminiModelName(modelName) : modelName.trim();
    return /image|video|imagine/i.test(normalized)
        ? (provider === 'xai' ? DEFAULT_XAI_MODEL : DEFAULT_GEMINI_MODEL)
        : normalized;
};

const SettingsView: React.FC<SettingsViewProps> = ({
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
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');

    // API states
    const [isAdding, setIsAdding] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [newConnection, setNewConnection] = useState<Partial<ApiConnection>>({
        provider: 'gemini',
        isActive: true,
        modelName: DEFAULT_GEMINI_MODEL,
        apiKey: '',
    });

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

    const isSelectableProvider = (provider: string) => provider === 'gemini' || provider === 'xai';
    const addConnection = () => {
        const provider = (newConnection.provider as ApiConnection['provider']) || 'gemini';
        const modelName = (newConnection.modelName || '').trim();
        const apiKey = (newConnection.apiKey || '').trim();
        if (!modelName || !apiKey) return;
        const connection: ApiConnection = {
            id: crypto.randomUUID(),
            provider,
            modelName: normalizeConnectionModelName(provider, modelName),
            apiKey,
            isActive: true
        };
        persistConnections([...connections, connection], connection.id);
        setIsAdding(false);
        setNewConnection({ provider: 'gemini', isActive: true, modelName: DEFAULT_GEMINI_MODEL, apiKey: '' });
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
            if (conn.provider === 'xai') {
                await testXaiConnection(conn.apiKey, conn.modelName);
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

    const tabs: { id: SettingsTab; label: string }[] = [
        { id: 'account', label: '계정' },
        { id: 'theme', label: '테마' },
        { id: 'api', label: 'API 연결' },
        { id: 'persona', label: '페르소나' },
        { id: 'data', label: '데이터 관리' },
    ];

    return (
        <div className="max-w-[1080px] w-full mx-auto px-2 pb-20 font-sans overflow-x-hidden">
            {/* Header */}
            <div className="pt-4 mb-6">
                <h1 className="text-base font-medium text-[#37352f] tracking-normal">설정</h1>
                <p className="text-sm text-[#9b9a97] mt-1">AI 연결, 페르소나, 데이터를 관리합니다.</p>
            </div>

            {/* Tab Navigation */}
            <div className="mb-6 overflow-x-auto scrollbar-hide">
                <div className="inline-flex min-w-max gap-1 bg-[#f7f7f5] p-1 rounded-lg">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === tab.id
                                ? 'bg-white text-[#37352f]'
                                : 'text-[#9b9a97] hover:text-[#37352f]'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ===== 테마 탭 ===== */}
            {activeTab === 'theme' && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 sm:p-6 space-y-4">
                        <div>
                            <h3 className="text-base font-medium text-[#37352f]">테마</h3>
                            <p className="text-sm text-[#9b9a97] mt-1">시스템 설정을 따르거나 라이트/다크 모드를 직접 고정할 수 있습니다.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {THEME_OPTIONS.map((option) => {
                                const isActive = settings.theme === option.id;
                                const Icon = option.icon;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => onUpdateSettings(prev => ({ ...prev, theme: option.id }))}
                                        className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${isActive
                                            ? 'bg-[#eeeeee]'
                                            : 'bg-[#f7f7f7] hover:bg-[#eeeeee]'
                                            }`}
                                    >
                                        <span className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg ${isActive ? 'bg-white text-[#171717]' : 'bg-[#f1f1f0] text-[#787774]'}`}>
                                            <Icon size={18} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium text-[#37352f]">{option.label}</span>
                                            <span className="block text-[13px] leading-5 text-[#9b9a97] mt-0.5">{option.description}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== 계정 탭 ===== */}
            {activeTab === 'account' && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-6 sm:p-8 space-y-8">
                        <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-[#f1f1f0]">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full bg-[#f1f1f0] flex items-center justify-center text-lg font-medium text-[#37352f] overflow-hidden">
                                    {userDraft?.avatar ? (
                                        <img src={userDraft.avatar} alt={userDraft.name} className="w-full h-full object-cover" />
                                    ) : (
                                        userDraft?.name?.[0] || 'U'
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 text-center sm:text-left">
                                <h3 className="text-base font-medium text-[#37352f]">{userDraft?.name || '사용자'}</h3>
                                <p className="text-sm text-[#9b9a97]">{userDraft?.email}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 max-w-lg">
                            <div className="space-y-2">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] px-1">이름</label>
                                <input
                                    type="text"
                                    value={userDraft?.name || ''}
                                    onChange={(e) => userDraft && setUserDraft({ ...userDraft, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[var(--color-primary)] focus:bg-white transition-colors"
                                    placeholder="이름을 입력하세요"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] px-1">프로필 이미지</label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={userDraft?.avatar || ''}
                                        onChange={(e) => userDraft && setUserDraft({ ...userDraft, avatar: e.target.value })}
                                        className="flex-1 px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[var(--color-primary)] focus:bg-white transition-colors font-mono text-sm"
                                        placeholder="이미지 URL을 입력하거나 파일을 업로드하세요"
                                    />
                                    <label className="flex items-center justify-center gap-2 px-4 py-3 bg-[#f7f7f7] rounded-xl hover:bg-[#eeeeee] transition-colors cursor-pointer text-[#37352f] w-full sm:w-auto">
                                        <Upload size={18} />
                                        <span className="text-sm font-medium whitespace-nowrap">파일 선택</span>
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={(e) => handleImageUpload(e, (url) => userDraft && setUserDraft({ ...userDraft, avatar: url }))}
                                        />
                                    </label>
                                </div>
                                <p className="text-[13px] leading-5 text-[#9b9a97] px-1">내 PC에서 사진을 직접 선택하거나 외부 이미지 링크를 입력할 수 있습니다.</p>
                            </div>

                            <div className="flex flex-col gap-2 pt-4 sm:flex-row">
                                <button
                                    onClick={() => userDraft && onUpdateUser(userDraft)}
                                    className="flex items-center justify-center gap-2 px-6 py-3 bg-[#f7f7f7] text-[#171717] rounded-xl hover:bg-[#eeeeee] transition-colors font-medium disabled:opacity-50"
                                    disabled={!userDraft?.name}
                                >
                                    <Save size={18} />
                                    프로필 저장하기
                                </button>
                                <button
                                    type="button"
                                    onClick={onLogout}
                                    disabled={isLoggingOut}
                                    className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-[#787774] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <LogOut size={17} />
                                    {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== API 연결 탭 ===== */}
            {activeTab === 'api' && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5">
                        <p className="text-sm text-[#787774]">현재 선택된 API 연결</p>
                        <p className="text-base font-medium mt-1 text-[#37352f]">
                            {selectedConnection ? `${selectedConnection.modelName} (${selectedConnection.provider})` : '선택된 모델 없음'}
                        </p>
                        <p className="text-[13px] leading-5 text-[#9b9a97] mt-2">채팅 페르소나는 각자 지정된 연결을 사용합니다. 페르소나 설정에서 연결을 지정하세요.</p>
                    </div>

                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-1 gap-2">
                            <h3 className="font-medium text-base text-[#37352f]">연결된 API ({connections.length})</h3>
                            <button onClick={() => setIsAdding(true)} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#f7f7f7] text-[#171717] rounded-lg hover:bg-[#eeeeee] transition-colors text-sm font-medium w-full sm:w-auto justify-center">
                                <Plus size={14} /> API 연결 추가
                            </button>
                        </div>

                        {connections.length === 0 && (
                            <div className="bg-[#fbfbfa] rounded-xl p-8 text-center text-[#9b9a97]">
                                연결된 API가 없습니다. API Key를 추가하고 모델을 선택해주세요.
                            </div>
                        )}

                        {connections.map(conn => {
                            const isSelected = conn.id === selectedConnection?.id;
                            const isGemini = conn.provider === 'gemini';
                            const isXai = conn.provider === 'xai';
                            const isSelectable = isGemini || isXai;
                            const hasModelDropdown = isGemini || isXai;
                            return (
                                <div key={conn.id} className={`rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${isSelected ? 'border-[var(--color-primary)] bg-[#f7f7f7]' : 'border-[#e9e9e8] bg-white'}`}>
                                    <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                                        <button onClick={() => selectModelConnection(conn)} className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected ? 'text-[#27c93f]' : 'text-[#d3d1cb]'}`}>
                                            {isSelected ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[13px] leading-5 font-medium px-1.5 py-0.5 bg-[#f1f1f0] text-[#787774] rounded">{conn.provider}</span>
                                                {hasModelDropdown ? (
                                                    <select value={conn.modelName} onChange={(e) => updateConnectionModel(conn.id, e.target.value)} className="text-sm font-medium border border-[#e9e9e8] rounded-lg px-2 py-1 bg-white w-full sm:w-auto min-w-0 outline-none focus:border-[var(--color-primary)]">
                                                        {(isGemini ? GEMINI_MODEL_OPTIONS : XAI_MODEL_OPTIONS).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                                    </select>
                                                ) : <span className="font-medium text-sm">{conn.modelName}</span>}
                                            </div>
                                            <p className="text-sm text-[#9b9a97] font-mono mt-1 break-all">{maskApiKey(conn.apiKey)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                                        <button onClick={() => selectModelConnection(conn)} disabled={!isSelectable} className={`px-3 py-1.5 rounded-lg text-[13px] leading-5 font-medium transition-colors ${isSelected ? 'bg-white text-[#171717]' : isSelectable ? 'bg-[#f1f1f0] text-[#37352f] hover:bg-[#e9e9e8]' : 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed'}`}>
                                            {isSelected ? '선택됨' : isSelectable ? '선택' : '준비중'}
                                        </button>
                                        <button onClick={() => testConnection(conn)} disabled={!isSelectable || testingId === conn.id} className={`px-3 py-1.5 rounded-lg text-[13px] leading-5 font-medium transition-colors ${!isSelectable ? 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed' : 'bg-[#f3f3f3] text-[#171717] hover:bg-[#e9e9e9]'}`}>
                                            <span className="inline-flex items-center gap-1.5"><FlaskConical size={13} />{testingId === conn.id ? '연결 중...' : '연결하기'}</span>
                                        </button>
                                        <button onClick={() => deleteConnection(conn.id)} className="p-2 text-[#9b9a97] hover:text-[#eb5757] hover:bg-[#fff0f0] rounded-lg transition-colors"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="rounded-xl border border-[#e9e9e8] bg-white p-6">
                            <h3 className="font-medium mb-1 text-[#37352f]">보안 안내</h3>
                            <p className="text-sm text-[#787774] leading-relaxed">API Key는 브라우저와 앱 데이터 동기화 저장소에 보관될 수 있습니다. 개인용 키 사용을 권장합니다.</p>
                        </div>
                        <div className="rounded-xl border border-[#e9e9e8] bg-white p-6">
                            <h3 className="font-medium mb-1 text-[#37352f]">사용량 안내</h3>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-sm text-[#787774]">전체 요청 수</span>
                                <span className="font-medium">{settings.apiUsage?.totalRequests || 0}회</span>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-sm text-[#787774]">누적 토큰</span>
                                <span className="font-medium">{(settings.apiUsage?.totalTokens || 0).toLocaleString()}</span>
                            </div>
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
                                        {(['gemini', 'xai', 'openai', 'anthropic', 'custom'] as const).map(provider => {
                                            const displayName = provider === 'xai' ? 'xAI' : provider.charAt(0).toUpperCase() + provider.slice(1);
                                            return (
                                                <button key={provider} onClick={() => setNewConnection({ ...newConnection, provider, modelName: provider === 'gemini' ? DEFAULT_GEMINI_MODEL : provider === 'xai' ? DEFAULT_XAI_MODEL : '' })}
                                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${newConnection.provider === provider ? 'bg-[#eeeeee] text-[#171717]' : 'bg-[#f7f7f7] text-[#787774] hover:bg-[#eeeeee]'}`}>
                                                    {displayName}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">모델</label>
                                    {newConnection.provider === 'gemini' ? (
                                        <select value={newConnection.modelName || DEFAULT_GEMINI_MODEL} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[var(--color-primary)]">
                                            {GEMINI_MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                    ) : newConnection.provider === 'xai' ? (
                                        <select value={newConnection.modelName || DEFAULT_XAI_MODEL} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[var(--color-primary)]">
                                            {XAI_MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                    ) : (
                                        <input type="text" placeholder="예: gpt-4o" value={newConnection.modelName || ''} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[var(--color-primary)]" />
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">API Key</label>
                                    <input type="password" placeholder={newConnection.provider === 'xai' ? 'xai-...' : 'AIza... / sk-...'} value={newConnection.apiKey || ''} onChange={e => setNewConnection({ ...newConnection, apiKey: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[var(--color-primary)] font-mono text-sm" />
                                </div>
                                <button onClick={addConnection} disabled={!newConnection.modelName || !newConnection.apiKey} className="w-full py-3.5 bg-[#f7f7f7] text-[#171717] rounded-xl hover:bg-[#eeeeee] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2">
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
                    {/* Individual Reset */}
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 space-y-1">
                        <h3 className="text-base font-medium text-[#37352f] mb-3">개별 초기화</h3>
                        {[
                            { label: '레거시 AI 게시글', desc: '이전 버전에서 생성된 AI 게시글 데이터를 정리합니다.', action: onClearPosts },
                            { label: '캘린더', desc: '저장된 일정 데이터를 모두 삭제합니다.', action: onClearEvents },
                            { label: '할 일', desc: '할 일 목록과 항목을 모두 삭제합니다.', action: onClearTodos },
                            { label: '메모장', desc: '작성한 메모/일기를 모두 삭제합니다.', action: onClearEntries },
                            { label: 'AI 대화', desc: 'AI 채팅 기록과 페르소나 메모리를 모두 삭제합니다.', action: onClearChat },
                            { label: '활동 로그', desc: '활동 기록만 삭제합니다.', action: onClearActivity },
                        ].map(item => (
                            <div key={item.label} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-[#f2f2f0] last:border-b-0">
                                <div className="min-w-0">
                                    <div className="text-sm text-[#37352f] font-medium">{item.label}</div>
                                    <div className="text-[13px] leading-5 text-[#9b9a97]">{item.desc}</div>
                                </div>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`${item.label} 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) {
                                            item.action();
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f7f7f7] text-[13px] leading-5 text-[#787774] hover:bg-[#fff0f0] hover:text-[#d94848] transition-colors"
                                >
                                    <Trash size={12} /> 초기화
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Export & Full Reset */}
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 space-y-4">
                        <h3 className="text-base font-medium text-[#37352f]">데이터 내보내기 및 전체 초기화</h3>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={onExportData} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f7f7f7] text-sm text-[#37352f] hover:bg-[#eeeeee]">
                                <Download size={14} /> 내보내기
                            </button>
                            <button onClick={onClearAllData} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#d94848] text-sm text-white hover:bg-[#c33f3f]">
                                <Trash2 size={14} /> 전체 데이터 초기화
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;

import React, { useState, useMemo, useEffect } from 'react';
import { AIAgent, AppSettings, ApiConnection, User } from '../types';
import { Plus, Trash2, Save, RotateCcw, Download, Trash, Edit3, X, CheckCircle2, Circle, FlaskConical, Upload, Image as ImageIcon } from 'lucide-react';
import { callGeminiAPI } from '../utils/gemini';
import { callGeminiImageGeneration } from '../services/geminiService';
import { testXaiConnection } from '../services/xaiService';
import { DEFAULT_GEMINI_MODEL, DEFAULT_XAI_MODEL, GEMINI_MODEL_OPTIONS, XAI_MODEL_OPTIONS, normalizeGeminiModelName, isImageGenerationModel, isVideoGenerationModel } from '../utils/aiConfig';
import PersonaSettingsView from './PersonaSettingsView';

type SettingsTab = 'account' | 'api' | 'persona' | 'data';

interface SettingsViewProps {
    agents: AIAgent[];
    onUpdateAgents: (agents: AIAgent[]) => void;
    settings: AppSettings;
    onUpdateSettings: (settings: AppSettings) => void;
    currentUser: User | null;
    onUpdateUser: (user: User) => void;
    onExportData: () => void;
    onClearAllData: () => void;
    onClearActivity: () => void;
    onClearPosts: () => void;
    onClearEvents: () => void;
    onClearTodos: () => void;
    onClearEntries: () => void;
    onClearChat: () => void;
}

const maskApiKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 10) return `${key.slice(0, 3)}...`;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
};

const SettingsView: React.FC<SettingsViewProps> = ({
    agents,
    onUpdateAgents,
    settings,
    onUpdateSettings,
    currentUser,
    onUpdateUser,
    onExportData,
    onClearAllData,
    onClearActivity,
    onClearPosts,
    onClearEvents,
    onClearTodos,
    onClearEntries,
    onClearChat,
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
        const normalizedConnections = nextConnections.map(connection =>
            connection.provider === 'gemini'
                ? { ...connection, modelName: normalizeGeminiModelName(connection.modelName) }
                : connection
        );

        const resolvedId =
            preferredId && normalizedConnections.some(c => c.id === preferredId)
                ? preferredId
                : settings.activeConnectionId && normalizedConnections.some(c => c.id === settings.activeConnectionId)
                    ? settings.activeConnectionId
                    : normalizedConnections[0]?.id;
        // Keep ALL connections isActive:true — activeConnectionId tracks the global default
        const normalized = normalizedConnections.map(c => ({ ...c, isActive: true }));
        const activeGemini = normalized.find(c => c.id === resolvedId && c.provider === 'gemini') || normalized.find(c => c.provider === 'gemini');
        onUpdateSettings({ ...settings, apiConnections: normalized, activeConnectionId: resolvedId, geminiApiKey: activeGemini?.apiKey || settings.geminiApiKey });
    };
    const updateConnectionModel = (connectionId: string, modelName: string) => {
        const updated = connections.map(conn => {
            if (conn.id !== connectionId) return conn;
            const normalized = conn.provider === 'gemini' ? normalizeGeminiModelName(modelName) : modelName;
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
            modelName: provider === 'gemini' ? normalizeGeminiModelName(modelName) : modelName,
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
        if (!isSelectableProvider(conn.provider)) { alert('현재 앱은 Gemini 또는 xAI 연결만 AI 기능에 사용합니다.'); return; }
        persistConnections(connections, conn.id);
    };
    const testConnection = async (conn: ApiConnection) => {
        if (!isSelectableProvider(conn.provider)) { alert('연결 테스트는 Gemini 또는 xAI만 지원합니다.'); return; }
        setTestingId(conn.id);
        try {
            if (conn.provider === 'xai') {
                await testXaiConnection(conn.apiKey, conn.modelName);
            } else {
                if (isImageGenerationModel(conn.modelName)) {
                    await callGeminiImageGeneration(conn.apiKey, 'A simple test image of a star.', conn.modelName);
                } else {
                    await callGeminiAPI(conn.apiKey, '간단한 연결 테스트입니다. "연결 성공"이라고만 답해주세요.', undefined, conn.modelName);
                }
            }
            alert(`테스트 성공: ${conn.modelName}`);
        } catch (error: any) {
            alert(`테스트 실패: ${error?.message || '알 수 없는 오류'}`);
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
        { id: 'api', label: 'API 연결' },
        { id: 'persona', label: '페르소나' },
        { id: 'data', label: '데이터 관리' },
    ];

    return (
        <div className="max-w-[900px] w-full mx-auto px-2 pb-20 font-sans overflow-x-hidden">
            {/* Header */}
            <div className="pt-4 mb-6">
                <h1 className="text-2xl font-normal text-[#37352f] tracking-tight">설정</h1>
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
                                ? 'bg-white text-[#37352f] shadow-sm'
                                : 'text-[#9b9a97] hover:text-[#37352f]'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ===== 계정 탭 ===== */}
            {activeTab === 'account' && (
                <div className="space-y-6">
                    <div className="bg-white border border-[#e9e9e8] rounded-xl p-6 sm:p-8 space-y-8">
                        <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-[#f1f1f0]">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full bg-[#f1f1f0] border-2 border-white shadow-md flex items-center justify-center text-3xl font-bold text-[#37352f] overflow-hidden">
                                    {userDraft?.avatar ? (
                                        <img src={userDraft.avatar} alt={userDraft.name} className="w-full h-full object-cover" />
                                    ) : (
                                        userDraft?.name?.[0] || 'U'
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 text-center sm:text-left">
                                <h3 className="text-xl font-bold text-[#37352f]">{userDraft?.name || '사용자'}</h3>
                                <p className="text-sm text-[#9b9a97]">{userDraft?.email}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 max-w-lg">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-[#787774] uppercase tracking-wider px-1">이름</label>
                                <input
                                    type="text"
                                    value={userDraft?.name || ''}
                                    onChange={(e) => userDraft && setUserDraft({ ...userDraft, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[#37352f] focus:bg-white transition-all"
                                    placeholder="이름을 입력하세요"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-[#787774] uppercase tracking-wider px-1">프로필 이미지</label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={userDraft?.avatar || ''}
                                        onChange={(e) => userDraft && setUserDraft({ ...userDraft, avatar: e.target.value })}
                                        className="flex-1 px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[#37352f] focus:bg-white transition-all font-mono text-sm"
                                        placeholder="이미지 URL을 입력하거나 파일을 업로드하세요"
                                    />
                                    <label className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e9e9e8] rounded-xl hover:bg-[#f7f7f5] transition-all cursor-pointer text-[#37352f] shadow-sm w-full sm:w-auto">
                                        <Upload size={18} />
                                        <span className="text-sm font-bold whitespace-nowrap">파일 선택</span>
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={(e) => handleImageUpload(e, (url) => userDraft && setUserDraft({ ...userDraft, avatar: url }))}
                                        />
                                    </label>
                                </div>
                                <p className="text-[11px] text-[#9b9a97] px-1">내 PC에서 사진을 직접 선택하거나 외부 이미지 링크를 입력할 수 있습니다.</p>
                            </div>

                            <div className="pt-4">
                                <button
                                    onClick={() => userDraft && onUpdateUser(userDraft)}
                                    className="flex items-center justify-center gap-2 px-6 py-3 bg-[#37352f] text-white rounded-xl hover:bg-[#2f2d28] transition-all font-bold shadow-md active:scale-95 disabled:opacity-50"
                                    disabled={!userDraft?.name}
                                >
                                    <Save size={18} />
                                    프로필 저장하기
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== API 연결 탭 ===== */}
            {activeTab === 'api' && (
                <div className="space-y-6">
                    <div className="bg-white border border-[#e9e9e8] rounded-xl p-5">
                        <p className="text-sm text-[#787774]">현재 선택된 API 연결</p>
                        <p className="text-lg font-bold mt-1 text-[#37352f]">
                            {selectedConnection ? `${selectedConnection.modelName} (${selectedConnection.provider})` : '선택된 모델 없음'}
                        </p>
                        <p className="text-xs text-[#9b9a97] mt-2">채팅 페르소나는 각자 지정된 연결을 사용합니다. 페르소나 설정에서 연결을 지정하세요.</p>
                    </div>

                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-1 gap-2">
                            <h3 className="font-bold text-lg text-[#37352f]">연결된 API ({connections.length})</h3>
                            <button onClick={() => setIsAdding(true)} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#37352f] text-white rounded-lg hover:bg-[#2f2d28] transition-colors text-sm font-bold shadow-sm w-full sm:w-auto justify-center">
                                <Plus size={14} /> API 연결 추가
                            </button>
                        </div>

                        {connections.length === 0 && (
                            <div className="bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl p-8 text-center text-[#9b9a97]">
                                연결된 API가 없습니다. Gemini API Key를 추가하고 모델을 선택해주세요.
                            </div>
                        )}

                        {connections.map(conn => {
                            const isSelected = conn.id === selectedConnection?.id;
                            const isGemini = conn.provider === 'gemini';
                            const isXai = conn.provider === 'xai';
                            const isSelectable = isGemini || isXai;
                            const hasModelDropdown = isGemini || isXai;
                            return (
                                <div key={conn.id} className={`bg-white border rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all ${isSelected ? 'border-[#37352f] shadow-sm' : 'border-[#e9e9e8]'}`}>
                                    <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                                        <button onClick={() => selectModelConnection(conn)} className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected ? 'text-[#27c93f]' : 'text-[#d3d1cb]'}`}>
                                            {isSelected ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 bg-[#f1f1f0] text-[#787774] rounded">{conn.provider}</span>
                                                {hasModelDropdown ? (
                                                    <select value={conn.modelName} onChange={(e) => updateConnectionModel(conn.id, e.target.value)} className="text-sm font-semibold border border-[#e9e9e8] rounded-lg px-2 py-1 bg-white w-full sm:w-auto min-w-0">
                                                        {(isGemini ? GEMINI_MODEL_OPTIONS : XAI_MODEL_OPTIONS).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                                    </select>
                                                ) : <span className="font-bold text-sm">{conn.modelName}</span>}
                                            </div>
                                            <p className="text-sm text-[#9b9a97] font-mono mt-1 break-all">{maskApiKey(conn.apiKey)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                                        <button onClick={() => selectModelConnection(conn)} disabled={!isSelectable} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isSelected ? 'bg-[#e5f9e7] text-[#27c93f]' : isSelectable ? 'bg-[#f1f1f0] text-[#37352f] hover:bg-[#e9e9e8]' : 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed'}`}>
                                            {isSelected ? '선택됨' : isSelectable ? '선택' : '준비중'}
                                        </button>
                                        <button onClick={() => testConnection(conn)} disabled={!isSelectable || testingId === conn.id} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!isSelectable ? 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed' : 'bg-[#eef5ff] text-[#2b6de9] hover:bg-[#e0ecff]'}`}>
                                            <span className="inline-flex items-center gap-1.5"><FlaskConical size={13} />{testingId === conn.id ? '테스트 중...' : '연결 테스트'}</span>
                                        </button>
                                        <button onClick={() => deleteConnection(conn.id)} className="p-2 text-[#9b9a97] hover:text-[#eb5757] hover:bg-[#fff0f0] rounded-lg transition-colors"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl p-6">
                            <h3 className="font-bold mb-1 text-[#37352f]">보안 안내</h3>
                            <p className="text-sm text-[#787774] leading-relaxed">API Key는 서버로 전송되지 않고 브라우저 로컬 스토리지에만 저장됩니다.</p>
                        </div>
                        <div className="bg-white border border-[#e9e9e8] rounded-xl p-6">
                            <h3 className="font-bold mb-1 text-[#37352f]">사용량 안내</h3>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-sm text-[#787774]">전체 요청 수</span>
                                <span className="font-bold">{settings.apiUsage?.totalRequests || 0}회</span>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <span className="text-sm text-[#787774]">누적 토큰</span>
                                <span className="font-bold">{(settings.apiUsage?.totalTokens || 0).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    {/* Add Connection Modal */}
                    {isAdding && (
                        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-xl font-bold">새 API 연결 추가</h3>
                                    <button onClick={() => setIsAdding(false)} className="p-1 hover:bg-[#f1f1f0] rounded-full"><X size={20} className="text-[#9b9a97]" /></button>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">Provider</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['gemini', 'xai', 'openai', 'anthropic', 'custom'] as const).map(provider => {
                                            const displayName = provider === 'xai' ? 'xAI' : provider.charAt(0).toUpperCase() + provider.slice(1);
                                            return (
                                                <button key={provider} onClick={() => setNewConnection({ ...newConnection, provider, modelName: provider === 'gemini' ? DEFAULT_GEMINI_MODEL : provider === 'xai' ? DEFAULT_XAI_MODEL : '' })}
                                                    className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${newConnection.provider === provider ? 'border-[#37352f] bg-[#37352f] text-white shadow-md' : 'border-[#e9e9e8] bg-white text-[#787774] hover:bg-[#fbfbfa]'}`}>
                                                    {displayName}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">모델</label>
                                    {newConnection.provider === 'gemini' ? (
                                        <select value={newConnection.modelName || DEFAULT_GEMINI_MODEL} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#37352f]">
                                            {GEMINI_MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                    ) : newConnection.provider === 'xai' ? (
                                        <select value={newConnection.modelName || DEFAULT_XAI_MODEL} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#37352f]">
                                            {XAI_MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                    ) : (
                                        <input type="text" placeholder="예: gpt-4o" value={newConnection.modelName || ''} onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#37352f]" />
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold mb-2">API Key</label>
                                    <input type="password" placeholder={newConnection.provider === 'xai' ? 'xai-...' : 'AIza... / sk-...'} value={newConnection.apiKey || ''} onChange={e => setNewConnection({ ...newConnection, apiKey: e.target.value })} className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#37352f] font-mono text-sm" />
                                </div>
                                <button onClick={addConnection} disabled={!newConnection.modelName || !newConnection.apiKey} className="w-full py-3.5 bg-[#37352f] text-white rounded-xl hover:bg-[#2f2d28] transition-colors font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed mt-2">
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
                />
            )}

            {/* ===== 데이터 관리 탭 ===== */}
            {activeTab === 'data' && (
                <div className="space-y-6">
                    {/* Individual Reset */}
                    <div className="bg-white border border-[#e9e9e8] rounded-xl p-5 space-y-1">
                        <h3 className="text-lg text-[#37352f] mb-3">개별 초기화</h3>
                        {[
                            { label: 'AI 일기장', desc: 'AI가 작성한 일기 게시글을 모두 삭제합니다.', action: onClearPosts },
                            { label: '캘린더', desc: '저장된 일정 데이터를 모두 삭제합니다.', action: onClearEvents },
                            { label: '할 일', desc: '할 일 목록과 항목을 모두 삭제합니다.', action: onClearTodos },
                            { label: '메모장', desc: '작성한 메모/일기를 모두 삭제합니다.', action: onClearEntries },
                            { label: 'AI 대화', desc: 'AI 채팅 기록을 모두 삭제합니다.', action: onClearChat },
                            { label: '활동 로그', desc: '활동 기록만 삭제합니다.', action: onClearActivity },
                        ].map(item => (
                            <div key={item.label} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-[#f2f2f0] last:border-b-0">
                                <div className="min-w-0">
                                    <div className="text-sm text-[#37352f] font-medium">{item.label}</div>
                                    <div className="text-xs text-[#9b9a97]">{item.desc}</div>
                                </div>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`${item.label} 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) {
                                            item.action();
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#d9d9d7] text-xs text-[#787774] hover:bg-[#fff0f0] hover:text-[#d94848] hover:border-[#e8b4b4] transition-all"
                                >
                                    <Trash size={12} /> 초기화
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Export & Full Reset */}
                    <div className="bg-white border border-[#e9e9e8] rounded-xl p-5 space-y-4">
                        <h3 className="text-lg text-[#37352f]">데이터 내보내기 및 전체 초기화</h3>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={onExportData} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#d9d9d7] text-sm text-[#37352f] hover:bg-[#f7f7f5]">
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

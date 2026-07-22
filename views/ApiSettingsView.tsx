import React, { useMemo, useState } from 'react';
import { AppSettings, ApiConnection } from '../types';
import { Trash2, Plus, X, CheckCircle2, Circle, FlaskConical } from 'lucide-react';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { testOpenAIConnection } from '../services/openaiService';
import { testAnthropicConnection } from '../services/anthropicService';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaService';
import { DEFAULT_LOCAL_SERVER_BASE_URL, listLocalServerModels, testLocalServerConnection } from '../services/localServerService';
import { DEFAULT_GEMINI_MODEL, DEFAULT_OLLAMA_BASE_URL, getDefaultModelForProvider, getModelOptionsForProvider, hasProviderModelOptions, isChatSupportedProvider, normalizeProviderModelName } from '../utils/aiConfig';

interface ApiSettingsViewProps {
    settings: AppSettings;
    onUpdateSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
}

const maskApiKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 10) return `${key.slice(0, 3)}...`;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
};

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
    return 'API Key';
};

const ApiSettingsView: React.FC<ApiSettingsViewProps> = ({ settings, onUpdateSettings }) => {
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

    const connections = settings.apiConnections || [];

    const selectedConnection = useMemo(() => {
        const byId = connections.find(c => c.id === settings.activeConnectionId);
        if (byId) return byId;
        return connections.find(c => c.isActive);
    }, [connections, settings.activeConnectionId]);

    const isSelectableProvider = (provider: ApiConnection['provider']) => isChatSupportedProvider(provider);

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
                        : normalizedConnections.find(c => c.isActive)?.id || normalizedConnections[0]?.id;

            const normalized = normalizedConnections.map(c => ({
                ...c,
                isActive: c.id === resolvedId,
            }));

            const activeGemini =
                normalized.find(c => c.id === resolvedId && c.provider === 'gemini') ||
                normalized.find(c => c.provider === 'gemini' && c.isActive);

            return {
                ...prev,
                apiConnections: normalized,
                activeConnectionId: resolvedId,
                geminiApiKey: activeGemini?.apiKey || prev.geminiApiKey,
            };
        });
    };

    const updateConnectionModel = (connectionId: string, modelName: string) => {
        const updated = connections.map(conn => {
            if (conn.id !== connectionId) return conn;
            const normalizedModel = normalizeConnectionModelName(conn.provider, modelName);
            return { ...conn, modelName: normalizedModel };
        });
        persistConnections(updated);
    };

    const loadOllamaModels = async () => {
        setIsLoadingOllamaModels(true);
        try {
            const models = newConnection.provider === 'custom'
                ? await listLocalServerModels(newConnection.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, newConnection.apiKey)
                : await listOllamaModels(newConnection.baseUrl || DEFAULT_OLLAMA_BASE_URL);
            setOllamaModels(models);
            if (models.length > 0) {
                setNewConnection(prev => ({ ...prev, modelName: models.includes(prev.modelName || '') ? prev.modelName : models[0] }));
            } else {
                alert('Ollama에 설치된 모델이 없습니다.');
            }
        } catch (error: any) {
            alert(`Ollama 모델을 불러오지 못했습니다: ${error?.message || '알 수 없는 오류'}`);
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
            isActive: true,
        };

        persistConnections([...connections, connection], connection.id);
        setIsAdding(false);
        setNewConnection({
            provider: 'gemini',
            isActive: true,
            modelName: DEFAULT_GEMINI_MODEL,
            apiKey: '',
            baseUrl: undefined,
        });
    };

    const deleteConnection = (id: string) => {
        if (!window.confirm('이 API 연결을 삭제할까요?')) return;
        const filtered = connections.filter(c => c.id !== id);
        persistConnections(filtered);
    };

    const selectModelConnection = (connection: ApiConnection) => {
        if (!isSelectableProvider(connection.provider)) {
            alert('현재 앱은 지원되는 채팅용 모델 연결만 AI 기능에 사용합니다.');
            return;
        }
        persistConnections(connections, connection.id);
    };

    const testConnection = async (connection: ApiConnection) => {
        if (!isSelectableProvider(connection.provider)) {
            alert('지원되는 채팅용 모델만 연결할 수 있습니다.');
            return;
        }

        setTestingId(connection.id);
        try {
            if (connection.provider === 'ollama') {
                await testOllamaConnection(connection.baseUrl, connection.modelName);
            } else if (connection.provider === 'custom') {
                await testLocalServerConnection(connection.baseUrl, connection.apiKey, connection.modelName);
            } else if (connection.provider === 'xai') {
                await testXaiConnection(connection.apiKey, connection.modelName);
            } else if (connection.provider === 'openai') {
                await testOpenAIConnection(connection.apiKey, connection.modelName);
            } else if (connection.provider === 'anthropic') {
                await testAnthropicConnection(connection.apiKey, connection.modelName);
            } else {
                await callGeminiAPI(
                    connection.apiKey,
                    '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.',
                    undefined,
                    connection.modelName
                );
            }
            alert(`연결 성공: ${connection.modelName}`);
        } catch (error: any) {
            alert(`연결 실패: ${error?.message || '알 수 없는 오류'}`);
        } finally {
            setTestingId(null);
        }
    };

    return (
        <div className="max-w-[1080px] mx-auto text-[#37352f] px-2 font-sans pb-20">
            <div className="flex items-start mb-8 pt-4">
                <div>
                    <h1 className="text-2xl font-medium mb-2 tracking-tight flex items-center gap-3">
                        API 연결 설정
                    </h1>
                    <p className="text-[#9b9a97] text-base font-normal">
                        사용할 모델을 목록에서 선택하면 채팅/인사이트/AI 코멘트가 해당 모델로 실행됩니다.
                    </p>
                </div>
            </div>

            <div className="bg-white border border-[#e9e9e8] rounded-xl p-5 mb-6">
                <p className="text-sm text-[#787774]">현재 사용 모델</p>
                <p className="text-base font-medium mt-1">
                    {selectedConnection
                        ? `${selectedConnection.modelName} (${selectedConnection.provider})`
                        : '선택된 모델 없음'}
                </p>
            </div>

            <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between mb-2 px-1">
                    <h3 className="font-medium text-base">연결된 API ({connections.length})</h3>
                    <button
                        onClick={() => setIsAdding(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-lg hover:bg-[#eeeeee] transition-colors text-sm font-medium"
                    >
                        <Plus size={14} /> API 연결 추가
                    </button>
                </div>

                {connections.length === 0 && (
                    <div className="bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl p-8 text-center text-[#9b9a97]">
                        연결된 API가 없습니다. API Key를 추가하고 모델을 선택해주세요.
                    </div>
                )}

                {connections.map(conn => {
                    const isSelected = conn.id === selectedConnection?.id;
                    const isSelectable = isSelectableProvider(conn.provider);
                    const modelOptions = getModelOptionsForProvider(conn.provider);
                    const hasModelDropdown = modelOptions.length > 0;

                    return (
                        <div
                            key={conn.id}
                            className={`bg-white border rounded-xl p-5 flex items-center justify-between transition-all ${isSelected ? 'border-[#d4d4d4]' : 'border-[#e9e9e8]'}`}
                        >
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => selectModelConnection(conn)}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected ? 'text-[#27c93f]' : 'text-[#d3d1cb]'}`}
                                    title={isSelectable ? '이 모델 사용' : '지원되는 모델만 선택 가능'}
                                >
                                    {isSelected ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                                </button>

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium px-1.5 py-0.5 bg-[#f1f1f0] text-[#787774] rounded">
                                            {conn.provider}
                                        </span>
                                        {hasModelDropdown ? (
                                            <select
                                                value={conn.modelName}
                                                onChange={(e) => updateConnectionModel(conn.id, e.target.value)}
                                                className="text-sm font-medium border border-[#e9e9e8] rounded-lg px-2 py-1 bg-white"
                                            >
                                                {modelOptions.map(model => (
                                                    <option key={model.id} value={model.id}>
                                                        {model.label}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span className="font-medium text-sm">{conn.modelName}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-[#9b9a97] font-mono mt-1">{conn.provider === 'ollama' || conn.provider === 'custom' ? conn.baseUrl : maskApiKey(conn.apiKey)}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => selectModelConnection(conn)}
                                    disabled={!isSelectable}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isSelected
                                        ? 'bg-[#e5f9e7] text-[#27c93f]'
                                        : isSelectable
                                            ? 'bg-[#f1f1f0] text-[#37352f] hover:bg-[#e9e9e8]'
                                            : 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed'
                                        }`}
                                >
                                    {isSelected ? '사용 중' : isSelectable ? '사용하기' : '준비중'}
                                </button>

                                <button
                                    onClick={() => testConnection(conn)}
                                    disabled={!isSelectable || testingId === conn.id}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!isSelectable
                                        ? 'bg-[#f7f7f5] text-[#b4b3af] cursor-not-allowed'
                                        : 'bg-[#f3f3f3] text-[#171717] hover:bg-[#e9e9e9]'
                                        }`}
                                >
                                    <span className="inline-flex items-center gap-1.5">
                                        <FlaskConical size={13} />
                                        {testingId === conn.id ? '연결 중...' : '연결하기'}
                                    </span>
                                </button>

                                <button
                                    onClick={() => deleteConnection(conn.id)}
                                    className="p-2 text-[#9b9a97] hover:text-[#eb5757] hover:bg-[#fff0f0] rounded-lg transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {isAdding && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-medium">새 API 연결 추가</h3>
                            <button onClick={() => setIsAdding(false)} className="p-1 hover:bg-[#f1f1f0] rounded-full">
                                <X size={20} className="text-[#9b9a97]" />
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">Provider</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['gemini', 'xai', 'openai', 'anthropic', 'ollama', 'custom'] as const).map(provider => {
                                    return (
                                        <button
                                            key={provider}
                                            onClick={() => {
                                                setOllamaModels([]);
                                                setNewConnection({
                                                    ...newConnection,
                                                    provider,
                                                    modelName: getDefaultModelForProvider(provider),
                                                    apiKey: '',
                                                    baseUrl: provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : undefined,
                                                });
                                            }}
                                            className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${newConnection.provider === provider
                                                ? 'border-[#d4d4d4] bg-[#f3f3f3] text-[#171717]'
                                                : 'border-[#e9e9e8] bg-white text-[#787774] hover:bg-[#fbfbfa]'
                                                }`}
                                        >
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
                                    className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] focus:ring-2 focus:ring-[#d4d4d4]/10 font-mono text-sm"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-2">모델</label>
                            {(newConnection.provider === 'ollama' || newConnection.provider === 'custom') && ollamaModels.length > 0 ? (
                                <select
                                    value={newConnection.modelName || ''}
                                    onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })}
                                    className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] focus:ring-2 focus:ring-[#d4d4d4]/10"
                                >
                                    {ollamaModels.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            ) : newConnection.provider && hasProviderModelOptions(newConnection.provider) ? (
                                <select
                                    value={newConnection.modelName || getDefaultModelForProvider(newConnection.provider)}
                                    onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })}
                                    className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] focus:ring-2 focus:ring-[#d4d4d4]/10"
                                >
                                    {getModelOptionsForProvider(newConnection.provider).map(model => (
                                        <option key={model.id} value={model.id}>
                                            {model.label}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    placeholder={newConnection.provider === 'ollama' || newConnection.provider === 'custom' ? '모델 목록 불러오기 또는 직접 입력' : '예: gpt-4o'}
                                    value={newConnection.modelName || ''}
                                    onChange={e => setNewConnection({ ...newConnection, modelName: e.target.value })}
                                    className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] focus:ring-2 focus:ring-[#d4d4d4]/10"
                                />
                            )}
                        </div>

                        {(newConnection.provider === 'ollama' || newConnection.provider === 'custom') && (
                            <button
                                type="button"
                                onClick={() => void loadOllamaModels()}
                                disabled={isLoadingOllamaModels}
                                className="w-full py-2.5 border border-[#e9e9e8] rounded-xl text-sm text-[#37352f] hover:bg-[#f7f7f7] transition-colors disabled:opacity-50"
                            >
                                {isLoadingOllamaModels ? '로컬 모델 불러오는 중...' : '로컬 모델 목록 불러오기'}
                            </button>
                        )}

                        {newConnection.provider !== 'ollama' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">API Key{newConnection.provider === 'custom' ? ' (선택 사항)' : ''}</label>
                            <input
                                type="password"
                                placeholder={getApiKeyPlaceholder(newConnection.provider)}
                                value={newConnection.apiKey || ''}
                                onChange={e => setNewConnection({ ...newConnection, apiKey: e.target.value })}
                                className="w-full p-3 border border-[#e9e9e8] rounded-xl focus:outline-none focus:border-[#d4d4d4] focus:ring-2 focus:ring-[#d4d4d4]/10 font-mono text-sm"
                            />
                        </div>
                        )}

                        <button
                            onClick={addConnection}
                            disabled={!newConnection.modelName || (!['ollama', 'custom'].includes(newConnection.provider || '') && !newConnection.apiKey)}
                            className="w-full py-3.5 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-xl hover:bg-[#eeeeee] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                        >
                            연결 추가하기
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl p-6">
                    <h3 className="font-medium mb-1 text-[#37352f]">보안 안내</h3>
                    <p className="text-sm text-[#787774] leading-relaxed">
                        API Key는 브라우저와 앱 동기화 저장소에 보관될 수 있습니다. 개인용 키 사용을 권장합니다.
                    </p>
                </div>

                <div className="bg-white border border-[#e9e9e8] rounded-xl p-6">
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
        </div>
    );
};

export default ApiSettingsView;

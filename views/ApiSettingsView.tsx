import React, { useState } from 'react';
import { AppSettings, ApiConnection } from '../types';
import { CheckCircle2, Circle, Key, RefreshCw, Zap, ShieldCheck, Server, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { testOpenAIConnection } from '../services/openaiService';
import { testAnthropicConnection } from '../services/anthropicService';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaService';
import { DEFAULT_LOCAL_SERVER_BASE_URL, listLocalServerModels, testLocalServerConnection } from '../services/localServerService';
import {
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OPENAI_MODEL,
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_XAI_MODEL,
    DEFAULT_OLLAMA_BASE_URL,
    getModelOptionsForProvider,
    normalizeProviderModelName
} from '../utils/aiConfig';

interface ApiSettingsViewProps {
    settings: AppSettings;
    onUpdateSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
}

type ProviderType = ApiConnection['provider'];

interface ProviderCardInfo {
    provider: ProviderType;
    name: string;
    description: string;
    badgeColor: string;
    defaultModel: string;
    placeholder: string;
    isLocal?: boolean;
}

const PROVIDER_LIST: ProviderCardInfo[] = [
    {
        provider: 'gemini',
        name: 'Google Gemini',
        description: 'Google의 차세대 AI 모델 계열 (추천)',
        badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
        defaultModel: DEFAULT_GEMINI_MODEL,
        placeholder: 'AIzaSy...',
    },
    {
        provider: 'openai',
        name: 'OpenAI',
        description: 'GPT-4o, GPT-4o-mini 등 플래그십 AI',
        badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        defaultModel: DEFAULT_OPENAI_MODEL,
        placeholder: 'sk-proj-...',
    },
    {
        provider: 'anthropic',
        name: 'Anthropic Claude',
        description: 'Claude 3.5 Sonnet 등 뛰어난 글쓰기 및 추론 AI',
        badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
        defaultModel: DEFAULT_ANTHROPIC_MODEL,
        placeholder: 'sk-ant-api...',
    },
    {
        provider: 'xai',
        name: 'xAI (Grok)',
        description: 'xAI의 Grok 2 고성능 모델 계열',
        badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
        defaultModel: DEFAULT_XAI_MODEL,
        placeholder: 'xai-...',
    },
    {
        provider: 'ollama',
        name: 'Ollama (로컬 LLM)',
        description: '내 컴퓨터에서 직접 실행되는 오프라인 오프그리드 AI',
        badgeColor: 'bg-gray-100 text-gray-800 border-gray-300',
        defaultModel: 'llama3',
        placeholder: 'API Key 불필요',
        isLocal: true,
    },
    {
        provider: 'custom',
        name: 'Custom Local Server',
        description: 'LM Studio, vLLM 등 OpenAI 호환 커스텀 서버',
        badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        defaultModel: 'local-model',
        placeholder: 'Optional API Key',
        isLocal: true,
    },
];

const ApiSettingsView: React.FC<ApiSettingsViewProps> = ({ settings, onUpdateSettings }) => {
    const connections = settings.apiConnections || [];

    const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
    const [testStatusMap, setTestStatusMap] = useState<Record<string, { loading: boolean; success?: boolean; message?: string }>>({});
    const [localModelsMap, setLocalModelsMap] = useState<Record<string, string[]>>({});
    const [loadingLocalModels, setLoadingLocalModels] = useState<Record<string, boolean>>({});

    const getExistingConnection = (provider: ProviderType): ApiConnection | undefined => {
        return connections.find(c => c.provider === provider);
    };

    const activeConnection = connections.find(c => c.id === settings.activeConnectionId) || connections.find(c => c.isActive);

    const toggleShowKey = (provider: string) => {
        setShowKeyMap(prev => ({ ...prev, [provider]: !prev[provider] }));
    };

    const updateProviderKeyAndModel = (
        provider: ProviderType,
        apiKey: string,
        modelName: string,
        baseUrl?: string,
        makeActive: boolean = false
    ) => {
        const normalizedModel = normalizeProviderModelName(provider, modelName);
        const existing = getExistingConnection(provider);

        let nextConnections: ApiConnection[];

        if (existing) {
            nextConnections = connections.map(conn => {
                if (conn.provider === provider) {
                    return {
                        ...conn,
                        apiKey: apiKey.trim(),
                        modelName: normalizedModel,
                        baseUrl: baseUrl !== undefined ? baseUrl.trim() : conn.baseUrl,
                    };
                }
                return conn;
            });
        } else {
            const newConn: ApiConnection = {
                id: crypto.randomUUID(),
                provider,
                apiKey: apiKey.trim(),
                modelName: normalizedModel,
                baseUrl: baseUrl !== undefined ? baseUrl.trim() : (provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL),
                isActive: false,
            };
            nextConnections = [...connections, newConn];
        }

        const targetConn = nextConnections.find(c => c.provider === provider);
        const targetId = makeActive ? targetConn?.id : settings.activeConnectionId;

        const resolvedId = targetId && nextConnections.some(c => c.id === targetId)
            ? targetId
            : activeConnection?.id || nextConnections[0]?.id;

        const updated = nextConnections.map(c => ({
            ...c,
            isActive: c.id === resolvedId,
        }));

        const activeGemini = updated.find(c => c.id === resolvedId && c.provider === 'gemini') || updated.find(c => c.provider === 'gemini');

        onUpdateSettings(prev => ({
            ...prev,
            apiConnections: updated,
            activeConnectionId: resolvedId,
            geminiApiKey: activeGemini?.apiKey || prev.geminiApiKey,
        }));
    };

    const setActiveProvider = (provider: ProviderType) => {
        const conn = getExistingConnection(provider);
        if (conn) {
            updateProviderKeyAndModel(provider, conn.apiKey, conn.modelName, conn.baseUrl, true);
        } else {
            const defaultInfo = PROVIDER_LIST.find(p => p.provider === provider);
            updateProviderKeyAndModel(
                provider,
                '',
                defaultInfo?.defaultModel || '',
                provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : undefined,
                true
            );
        }
    };

    const handleTestConnection = async (providerInfo: ProviderCardInfo) => {
        const conn = getExistingConnection(providerInfo.provider);
        const apiKey = conn?.apiKey || '';
        const modelName = conn?.modelName || providerInfo.defaultModel;
        const baseUrl = conn?.baseUrl || (providerInfo.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL);

        setTestStatusMap(prev => ({ ...prev, [providerInfo.provider]: { loading: true } }));

        const startTime = Date.now();
        try {
            if (providerInfo.provider === 'ollama') {
                await testOllamaConnection(baseUrl, modelName);
            } else if (providerInfo.provider === 'custom') {
                await testLocalServerConnection(baseUrl, apiKey, modelName);
            } else if (providerInfo.provider === 'xai') {
                await testXaiConnection(apiKey, modelName);
            } else if (providerInfo.provider === 'openai') {
                await testOpenAIConnection(apiKey, modelName);
            } else if (providerInfo.provider === 'anthropic') {
                await testAnthropicConnection(apiKey, modelName);
            } else {
                await callGeminiAPI(apiKey, '연결 테스트입니다. "성공"이라고만 답변해주세요.', undefined, modelName);
            }
            const elapsed = Date.now() - startTime;
            setTestStatusMap(prev => ({
                ...prev,
                [providerInfo.provider]: {
                    loading: false,
                    success: true,
                    message: `연결 성공! 응답시간 ${elapsed}ms (${modelName})`,
                },
            }));
        } catch (error: any) {
            setTestStatusMap(prev => ({
                ...prev,
                [providerInfo.provider]: {
                    loading: false,
                    success: false,
                    message: error?.message || 'API 키 또는 네트워크 연결을 확인해주세요.',
                },
            }));
        }
    };

    const handleFetchLocalModels = async (provider: ProviderType, currentBaseUrl?: string, currentApiKey?: string) => {
        setLoadingLocalModels(prev => ({ ...prev, [provider]: true }));
        try {
            const models = provider === 'custom'
                ? await listLocalServerModels(currentBaseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, currentApiKey)
                : await listOllamaModels(currentBaseUrl || DEFAULT_OLLAMA_BASE_URL);

            setLocalModelsMap(prev => ({ ...prev, [provider]: models }));

            if (models.length > 0) {
                const conn = getExistingConnection(provider);
                const nextModel = models.includes(conn?.modelName || '') ? conn?.modelName! : models[0];
                updateProviderKeyAndModel(provider, conn?.apiKey || '', nextModel, currentBaseUrl);
            }
        } catch (err: any) {
            setTestStatusMap(prev => ({
                ...prev,
                [provider]: { loading: false, success: false, message: `로컬 모델을 가져오지 못함: ${err?.message}` },
            }));
        } finally {
            setLoadingLocalModels(prev => ({ ...prev, [provider]: false }));
        }
    };

    return (
        <div className="max-w-[960px] mx-auto text-[#37352f] px-4 font-sans pb-24">
            {/* Header Section */}
            <div className="mb-8 pt-6">
                <h1 className="text-2xl font-semibold tracking-tight text-[#171717] flex items-center gap-2.5 mb-2">
                    <ShieldCheck className="text-emerald-600" size={26} /> API 키 & AI 프로바이더 설정
                </h1>
                <p className="text-[#787774] text-sm font-normal">
                    기업별 API 키를 한 번만 등록해두면, 채팅 및 일기 분석 등 앱 전체에서 해당 기업의 모델을 자유롭게 선택하여 이용할 수 있습니다.
                </p>
            </div>

            {/* Currently Active Banner */}
            <div className="bg-white border border-[#e9e9e8] shadow-xs rounded-2xl p-5 mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                        <Zap size={20} />
                    </div>
                    <div>
                        <span className="text-xs font-semibold text-[#9b9a97] uppercase tracking-wider">현재 메인 활성 AI 서비스</span>
                        <p className="text-base font-semibold text-[#171717] mt-0.5">
                            {activeConnection
                                ? `${PROVIDER_LIST.find(p => p.provider === activeConnection.provider)?.name || activeConnection.provider} · ${activeConnection.modelName}`
                                : '선택된 메인 AI 없음 (기본 체험판 적용)'}
                        </p>
                    </div>
                </div>

                {activeConnection && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        정상 작동 중
                    </span>
                )}
            </div>

            {/* Company Provider Cards List */}
            <div className="space-y-5">
                {PROVIDER_LIST.map(providerInfo => {
                    const conn = getExistingConnection(providerInfo.provider);
                    const isActive = activeConnection?.provider === providerInfo.provider;
                    const hasKey = providerInfo.isLocal ? true : Boolean(conn?.apiKey?.trim());
                    const currentKey = conn?.apiKey || '';
                    const currentModel = conn?.modelName || providerInfo.defaultModel;
                    const currentBaseUrl = conn?.baseUrl || (providerInfo.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL);
                    const modelOptions = providerInfo.isLocal
                        ? (localModelsMap[providerInfo.provider] || [currentModel])
                        : getModelOptionsForProvider(providerInfo.provider);

                    const isShowingKey = showKeyMap[providerInfo.provider] || false;
                    const testStatus = testStatusMap[providerInfo.provider];

                    return (
                        <div
                            key={providerInfo.provider}
                            className={`bg-white border rounded-2xl p-6 transition-all duration-200 ${
                                isActive
                                    ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20'
                                    : 'border-[#e9e9e8] shadow-xs hover:border-[#d3d3d0]'
                            }`}
                        >
                            {/* Card Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setActiveProvider(providerInfo.provider)}
                                        className="text-left flex items-center gap-2 group cursor-pointer"
                                        title="기본 활성 프로바이더로 지정"
                                    >
                                        {isActive ? (
                                            <CheckCircle2 size={22} className="text-emerald-600 shrink-0" />
                                        ) : (
                                            <Circle size={22} className="text-[#c4c4c0] group-hover:text-[#9b9a97] shrink-0" />
                                        )}
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-base font-semibold text-[#171717]">{providerInfo.name}</h3>
                                                <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${providerInfo.badgeColor}`}>
                                                    {providerInfo.provider.toUpperCase()}
                                                </span>
                                            </div>
                                            <p className="text-xs text-[#787774] mt-0.5">{providerInfo.description}</p>
                                        </div>
                                    </button>
                                </div>

                                <div className="flex items-center gap-2">
                                    {hasKey ? (
                                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                            <Key size={12} /> 등록됨
                                        </span>
                                    ) : (
                                        <span className="text-xs font-medium text-[#787774] bg-[#f7f7f5] border border-[#e9e9e8] px-2.5 py-1 rounded-lg">
                                            미등록
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Inputs Section */}
                            <div className="space-y-4 pt-2">
                                {/* API Key / BaseURL Row */}
                                {providerInfo.isLocal ? (
                                    <div>
                                        <label className="block text-xs font-medium text-[#787774] mb-1.5 flex items-center gap-1">
                                            <Server size={13} /> 로컬 서버 주소 (Base URL)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={currentBaseUrl}
                                                onChange={e =>
                                                    updateProviderKeyAndModel(
                                                        providerInfo.provider,
                                                        currentKey,
                                                        currentModel,
                                                        e.target.value
                                                    )
                                                }
                                                placeholder={DEFAULT_OLLAMA_BASE_URL}
                                                className="flex-1 px-3.5 py-2 bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl text-sm focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleFetchLocalModels(providerInfo.provider, currentBaseUrl, currentKey)}
                                                disabled={loadingLocalModels[providerInfo.provider]}
                                                className="px-3.5 py-2 bg-[#f7f7f5] text-[#37352f] border border-[#e9e9e8] rounded-xl hover:bg-[#ececec] text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                                            >
                                                <RefreshCw size={13} className={loadingLocalModels[providerInfo.provider] ? 'animate-spin' : ''} />
                                                모델 목록 가져오기
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-xs font-medium text-[#787774] mb-1.5 flex items-center gap-1">
                                            <Key size={13} /> API Key
                                        </label>
                                        <div className="relative flex items-center">
                                            <input
                                                type={isShowingKey ? 'text' : 'password'}
                                                value={currentKey}
                                                onChange={e =>
                                                    updateProviderKeyAndModel(
                                                        providerInfo.provider,
                                                        e.target.value,
                                                        currentModel,
                                                        currentBaseUrl
                                                    )
                                                }
                                                placeholder={providerInfo.placeholder}
                                                className="w-full pl-3.5 pr-10 py-2.5 bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl text-sm focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => toggleShowKey(providerInfo.provider)}
                                                className="absolute right-3 text-[#9b9a97] hover:text-[#37352f]"
                                            >
                                                {isShowingKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Model Selection Dropdown & Test Connection Action */}
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                                    <div className="flex-1 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-medium text-[#787774]">
                                                사용할 기본 모델
                                            </label>
                                            <span className="text-[11px] text-[#9b9a97]">선택 또는 직접 입력</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <select
                                                value={(modelOptions as any[]).some(m => (typeof m === 'string' ? m : m.id) === currentModel) ? currentModel : ''}
                                                onChange={e => {
                                                    if (e.target.value) {
                                                        updateProviderKeyAndModel(
                                                            providerInfo.provider,
                                                            currentKey,
                                                            e.target.value,
                                                            currentBaseUrl
                                                        );
                                                    }
                                                }}
                                                className="flex-1 px-3 py-2 bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl text-sm font-medium focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors cursor-pointer"
                                            >
                                                <option value="" disabled>-- 추천 목록에서 선택 --</option>
                                                {typeof modelOptions[0] === 'string'
                                                    ? (modelOptions as string[]).map(m => (
                                                          <option key={m} value={m}>
                                                              {m}
                                                          </option>
                                                      ))
                                                    : (modelOptions as Array<{ id: string; label: string; description?: string }>).map(m => (
                                                          <option key={m.id} value={m.id}>
                                                              {m.label} {m.description ? `(${m.description})` : ''}
                                                          </option>
                                                      ))}
                                            </select>
                                            <input
                                                type="text"
                                                value={currentModel}
                                                onChange={e =>
                                                    updateProviderKeyAndModel(
                                                        providerInfo.provider,
                                                        currentKey,
                                                        e.target.value,
                                                        currentBaseUrl
                                                    )
                                                }
                                                placeholder="직접 모델ID 입력 (e.g. gemini-3.8-flash)"
                                                className="flex-1 px-3 py-2 bg-[#fbfbfa] border border-[#e9e9e8] rounded-xl text-xs font-mono focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
                                                title="목록에 없는 신규/미래 모델명 직접 입력 가능"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-end">
                                        <button
                                            type="button"
                                            onClick={() => handleTestConnection(providerInfo)}
                                            disabled={testStatus?.loading}
                                            className="w-full sm:w-auto px-4 py-2 bg-[#171717] text-white rounded-xl hover:bg-[#333333] text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                                        >
                                            {testStatus?.loading ? (
                                                <>
                                                    <RefreshCw size={13} className="animate-spin" /> 테스트 중...
                                                </>
                                            ) : (
                                                <>연결 테스트</>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Test Result Inline Banner (Replaces annoying browser alert) */}
                                {testStatus && !testStatus.loading && (
                                    <div
                                        className={`mt-2 p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                                            testStatus.success
                                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                : 'bg-rose-50 text-rose-800 border-rose-200'
                                        }`}
                                    >
                                        {testStatus.success ? (
                                            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                                        ) : (
                                            <AlertCircle size={16} className="text-rose-600 shrink-0" />
                                        )}
                                        <span>{testStatus.message}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ApiSettingsView;

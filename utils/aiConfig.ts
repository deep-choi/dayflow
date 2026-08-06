import { AppSettings, ApiConnection } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_XAI_MODEL = 'grok-4.3';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-0';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_QWEN_MODEL = 'qwen3.7-max';
export const DEFAULT_KIMI_MODEL = 'kimi-k3';
export const DEFAULT_GLM_MODEL = 'glm-5.2';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
export const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export interface ModelOption {
    id: string;
    label: string;
    description?: string;
}

export const XAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'grok-4.3', label: 'Grok 4.3', description: 'xAI 최신 4.3 플래그십' },
    { id: 'grok-build-0.1', label: 'Grok Build 0.1', description: '코드/개발 특화' },
    { id: 'grok-4.20-multi-agent', label: 'Grok 4.20 Multi-Agent', description: '멀티에이전트 고성능' },
    { id: 'grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning', description: '추론 강화 심층 모델' },
    { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning', description: '빠른 추론' },
    { id: 'grok-3', label: 'Grok 3', description: 'Grok 3 플래그십' },
];

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: '최신 고성능·고속 모델 (추천)' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: '에이전트·코딩 작업용 고성능 모델' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: '가장 빠르고 비용 효율적인 3.5 모델' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: '복합 추론 프로 미리보기' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: '경량 고속 모델' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: '2.5 세대 고급 추론' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: '2.5 세대 경량 응답' },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: '최신 플래그십·복잡한 작업용 (추천)' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: '성능·속도·비용 균형형' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: '가장 빠르고 경제적인 고처리량 모델' },
    { id: 'gpt-5.5', label: 'GPT-5.5', description: '5.5 범용 고성능' },
    { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', description: '5.5 심층 프로' },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: '5.4 범용 고성능' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: '5.4 고성능 미니' },
    { id: 'gpt-4o', label: 'GPT-4o', description: 'Omni 멀티모달' },
    { id: 'o1', label: 'o1', description: '복잡 논리 추론' },
];

export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
    { id: 'claude-opus-5-0', label: 'Claude Opus 5.0', description: '차세대 5세대 최고 성능 오퍼스 (추천)' },
    { id: 'claude-5-sonnet', label: 'Claude 5 Sonnet', description: '5세대 차세대 소네트' },
    { id: 'claude-fable-5', label: 'Claude Fable 5', description: '5세대 에이전트 특화' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: '고성능 분석 오퍼스' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: '소네트 4.6 플래그십' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: '하이쿠 초고속' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', description: '3.5 세대 소네트' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: '3.5 세대 하이쿠' },
];

export const DEEPSEEK_MODEL_OPTIONS: ModelOption[] = [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: '최신 고속 범용 모델 (추천)' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '최신 고성능 추론 모델' },
];

export const QWEN_MODEL_OPTIONS: ModelOption[] = [
    { id: 'qwen3.7-max', label: 'Qwen3.7 Max', description: '최신 플래그십·복합 추론 (추천)' },
    { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', description: '범용 고성능' },
    { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', description: '안정적인 범용 모델' },
    { id: 'qwen3.6-flash', label: 'Qwen3.6 Flash', description: '빠른 응답·저비용' },
    { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', description: '검증된 범용 모델' },
    { id: 'qwen3.5-flash', label: 'Qwen3.5 Flash', description: '경량 고속 모델' },
    { id: 'qwen3-max', label: 'Qwen3 Max', description: 'Qwen3 추론 모델' },
];

export const KIMI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'kimi-k3', label: 'Kimi K3', description: '최신 1M 컨텍스트 플래그십 (추천)' },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', description: '코딩 특화 256K 컨텍스트' },
    { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed', description: '고속 코딩 응답' },
    { id: 'kimi-k2.6', label: 'Kimi K2.6', description: '텍스트·이미지·추론 범용 모델' },
];

export const GLM_MODEL_OPTIONS: ModelOption[] = [
    { id: 'glm-5.2', label: 'GLM-5.2', description: '최신 1M 컨텍스트 플래그십 (추천)' },
    { id: 'glm-5.1', label: 'GLM-5.1', description: '장기 작업·코딩 강화' },
    { id: 'glm-5', label: 'GLM-5', description: 'Agent·복합 시스템 작업' },
    { id: 'glm-5-turbo', label: 'GLM-5 Turbo', description: '장기 작업 최적화' },
    { id: 'glm-4.7', label: 'GLM-4.7', description: '범용 대화·추론·에이전트' },
    { id: 'glm-4.7-flashx', label: 'GLM-4.7 FlashX', description: '경량 고속 응답' },
    { id: 'glm-4.7-flash', label: 'GLM-4.7 Flash', description: '무료 경량 모델' },
];

export const CHAT_PROVIDERS: ApiConnection['provider'][] = [
    'gemini', 'openai', 'anthropic', 'xai', 'deepseek', 'qwen', 'kimi', 'glm', 'ollama', 'custom',
];

export const getProviderDisplayName = (provider: ApiConnection['provider']): string => {
    if (provider === 'xai') return 'xAI';
    if (provider === 'deepseek') return 'DeepSeek';
    if (provider === 'qwen') return 'Qwen';
    if (provider === 'kimi') return 'Kimi';
    if (provider === 'glm') return 'GLM';
    if (provider === 'ollama') return 'Ollama';
    if (provider === 'custom') return '로컬 서버';
    if (provider === 'anthropic') return 'Anthropic';
    if (provider === 'openai') return 'OpenAI';
    return 'Gemini';
};

export const getProviderDefaultBaseUrl = (provider: ApiConnection['provider']): string | undefined => {
    if (provider === 'deepseek') return DEFAULT_DEEPSEEK_BASE_URL;
    if (provider === 'qwen') return DEFAULT_QWEN_BASE_URL;
    if (provider === 'kimi') return DEFAULT_KIMI_BASE_URL;
    if (provider === 'glm') return DEFAULT_GLM_BASE_URL;
    if (provider === 'ollama') return DEFAULT_OLLAMA_BASE_URL;
    if (provider === 'custom') return undefined;
    return undefined;
};

export const isHostedOpenAICompatibleProvider = (provider: ApiConnection['provider']): boolean =>
    provider === 'deepseek' || provider === 'qwen' || provider === 'kimi' || provider === 'glm';

const GEMINI_MODEL_ALIASES: Record<string, string> = {
    'gemini-3.6': 'gemini-3.6-flash',
    'gemini-3.5': 'gemini-3.5-flash',
    'gemini-3.5-flashlite': 'gemini-3.5-flash-lite',
    'gemini-3.0-pro': 'gemini-3-pro-preview',
    'gemini-3.0-flash': 'gemini-3-flash-preview',
    'gemini-3-pro': 'gemini-3.1-pro-preview',
    'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3.1-flashlite': 'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
    'gemini-2.5-flashlite': 'gemini-2.5-flash-lite',
    'gemini-2.5-flash-lite-preview': 'gemini-2.5-flash-lite',
};

const isMediaGenerationModelName = (modelName?: string): boolean => {
    const id = (modelName || '').toLowerCase();
    return id.includes('image') || id.includes('video') || id.includes('imagine');
};

export const normalizeGeminiModelName = (modelName?: string): string => {
    const normalized = (modelName || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_GEMINI_MODEL;
    const aliased = GEMINI_MODEL_ALIASES[normalized] || normalized;
    return isMediaGenerationModelName(aliased) ? DEFAULT_GEMINI_MODEL : aliased;
};

export const getDefaultModelForProvider = (provider: ApiConnection['provider']): string => {
    if (provider === 'gemini') return DEFAULT_GEMINI_MODEL;
    if (provider === 'xai') return DEFAULT_XAI_MODEL;
    if (provider === 'openai') return DEFAULT_OPENAI_MODEL;
    if (provider === 'anthropic') return DEFAULT_ANTHROPIC_MODEL;
    if (provider === 'deepseek') return DEFAULT_DEEPSEEK_MODEL;
    if (provider === 'qwen') return DEFAULT_QWEN_MODEL;
    if (provider === 'kimi') return DEFAULT_KIMI_MODEL;
    if (provider === 'glm') return DEFAULT_GLM_MODEL;
    return '';
};

export const getModelOptionsForProvider = (provider: ApiConnection['provider']): ModelOption[] => {
    if (provider === 'gemini') return GEMINI_MODEL_OPTIONS;
    if (provider === 'xai') return XAI_MODEL_OPTIONS;
    if (provider === 'openai') return OPENAI_MODEL_OPTIONS;
    if (provider === 'anthropic') return ANTHROPIC_MODEL_OPTIONS;
    if (provider === 'deepseek') return DEEPSEEK_MODEL_OPTIONS;
    if (provider === 'qwen') return QWEN_MODEL_OPTIONS;
    if (provider === 'kimi') return KIMI_MODEL_OPTIONS;
    if (provider === 'glm') return GLM_MODEL_OPTIONS;
    return [];
};

export const hasProviderModelOptions = (provider: ApiConnection['provider']): boolean => {
    return getModelOptionsForProvider(provider).length > 0;
};

export const normalizeProviderModelName = (
    provider: ApiConnection['provider'],
    modelName?: string
): string => {
    const normalized = provider === 'gemini'
        ? normalizeGeminiModelName(modelName)
        : (modelName || '').trim();
    const fallback = getDefaultModelForProvider(provider);
    if (!normalized) return fallback;
    return isMediaGenerationModelName(normalized) ? fallback : normalized;
};

const normalizeConnectionModelName = (connection: ApiConnection): string => {
    return normalizeProviderModelName(connection.provider, connection.modelName);
};

export interface ActiveGeminiConfig {
    connectionId?: string;
    apiKey: string;
    modelName: string;
}

export interface ActiveAIConfig {
    connectionId?: string;
    provider: ApiConnection['provider'];
    apiKey: string;
    modelName: string;
    baseUrl?: string;
}

const CHAT_SUPPORTED_PROVIDERS = CHAT_PROVIDERS;

export const isChatSupportedProvider = (provider: ApiConnection['provider']): boolean => {
    return CHAT_SUPPORTED_PROVIDERS.includes(provider);
};

export const hasUsableAIConnection = (
    connection?: Pick<ActiveAIConfig, 'provider' | 'apiKey' | 'baseUrl'> | null
): boolean => {
    if (!connection) return false;
    if (connection.provider === 'ollama' || connection.provider === 'custom') {
        return typeof connection.baseUrl === 'string' && connection.baseUrl.trim().length > 0;
    }
    return typeof connection.apiKey === 'string' && connection.apiKey.trim().length > 0;
};

const hasUsableCredentials = (connection: ApiConnection): boolean => hasUsableAIConnection(connection);

export const getActiveAIConfig = (settings: AppSettings): ActiveAIConfig | null => {
    const connections = settings.apiConnections || [];

    // 1. Try the explicitly selected connection
    const selected = connections.find(
        c =>
            c.id === settings.activeConnectionId &&
            c.isActive &&
            isChatSupportedProvider(c.provider) &&
            hasUsableCredentials(c)
    );

    if (selected) {
        return {
            connectionId: selected.id,
            provider: selected.provider,
            apiKey: selected.apiKey,
            modelName: normalizeConnectionModelName(selected),
            baseUrl: selected.baseUrl,
        };
    }

    // 2. Fallback to first active connection
    const firstActive = connections.find(c => c.isActive && isChatSupportedProvider(c.provider) && hasUsableCredentials(c));
    if (firstActive) {
        return {
            connectionId: firstActive.id,
            provider: firstActive.provider,
            apiKey: firstActive.apiKey,
            modelName: normalizeConnectionModelName(firstActive),
            baseUrl: firstActive.baseUrl,
        };
    }

    // 3. Legacy geminiApiKey fallback
    if (typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.trim().length > 0) {
        return {
            provider: 'gemini',
            apiKey: settings.geminiApiKey,
            modelName: DEFAULT_GEMINI_MODEL,
        };
    }

    return null;
};

/** Resolve a persona override first, then fall back to the global default connection. */
export const getAgentAIConfig = (settings: AppSettings, agentConnectionId?: string): ActiveAIConfig | null => {
    if (!agentConnectionId) {
        return getActiveAIConfig(settings);
    }

    const connections = settings.apiConnections || [];
    const agentConnection = connections.find(c => c.id === agentConnectionId);

    if (agentConnection) {
        if (!hasUsableCredentials(agentConnection)) {
            console.warn('[aiConfig] Agent connection has no usable credentials:', agentConnectionId);
            return getActiveAIConfig(settings);
        }
        if (!isChatSupportedProvider(agentConnection.provider)) {
            console.warn('[aiConfig] Agent connection provider is not supported in chat:', agentConnection.provider);
            return getActiveAIConfig(settings);
        }
        console.log('[aiConfig] Found specific connection for agent:', agentConnection.modelName);
        return {
            connectionId: agentConnection.id,
            provider: agentConnection.provider,
            apiKey: agentConnection.apiKey,
            modelName: normalizeConnectionModelName(agentConnection),
            baseUrl: agentConnection.baseUrl,
        };
    }

    console.warn('[aiConfig] Agent connection is unavailable; using the global default:', agentConnectionId);
    return getActiveAIConfig(settings);
};

/** @deprecated Use getActiveAIConfig instead. Kept for backward compatibility. */
export const getActiveGeminiConfig = (settings: AppSettings): ActiveGeminiConfig | null => {
    const config = getActiveAIConfig(settings);
    if (!config) return null;
    // If active connection is Gemini, return it. Otherwise try to find a Gemini fallback.
    if (config.provider === 'gemini') {
        return { connectionId: config.connectionId, apiKey: config.apiKey, modelName: config.modelName };
    }
    // Fallback: look for any active Gemini connection
    const connections = settings.apiConnections || [];
    const gemini = connections.find(c => c.provider === 'gemini' && c.isActive && hasUsableCredentials(c));
    if (gemini) {
        return { connectionId: gemini.id, apiKey: gemini.apiKey, modelName: normalizeGeminiModelName(gemini.modelName) };
    }
    if (typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.trim().length > 0) {
        return { apiKey: settings.geminiApiKey, modelName: DEFAULT_GEMINI_MODEL };
    }
    return null;
};

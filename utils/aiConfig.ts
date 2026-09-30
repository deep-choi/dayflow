import { AppSettings, ApiConnection, ReasoningEffort } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_XAI_MODEL = 'grok-4.7';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-sol';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_QWEN_MODEL = 'qwen3.8-max';
export const DEFAULT_KIMI_MODEL = 'kimi-k3';
export const DEFAULT_GLM_MODEL = 'glm-5.3';
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

// Each provider lists at most six models, newest release first.
export const XAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'grok-4.7', label: 'Grok 4.7', description: '최신 플래그십·코딩/지식 작업 (추천)' },
    { id: 'grok-4.6', label: 'Grok 4.6', description: '이전 세대 플래그십' },
    { id: 'grok-4.5', label: 'Grok 4.5', description: '범용 고성능' },
    { id: 'grok-4.3', label: 'Grok 4.3', description: '1M 컨텍스트 범용 모델' },
    { id: 'grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning', description: '추론 강화 모델' },
    { id: 'grok-4.20-0309-non-reasoning', label: 'Grok 4.20 Non-Reasoning', description: '추론 없이 빠른 응답' },
];

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: '최신 고성능 Flash·에이전트/코딩 (추천)' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: '이전 세대 Flash' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: '고성능·고속 모델' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: '에이전트·코딩 작업용 모델' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: '가장 빠르고 비용 효율적인 3.5 모델' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: '복합 추론 프로 미리보기' },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: '최고 성능·가장 어려운 작업용' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', description: '복잡한 코딩·에이전트 작업용 (추천)' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: '가장 효율적인 고처리량 모델' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: '이전 세대 플래그십' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: '성능·속도·비용 균형형' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: '빠르고 경제적인 모델' },
];

export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: '속도와 지능의 최적 균형' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: '장기 에이전트·지식 작업용 (추천)' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', description: '고난도 추론·장기 에이전트 작업' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', description: '5세대 오퍼스' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: '5세대 소네트' },
    { id: 'claude-fable-5', label: 'Claude Fable 5', description: '5세대 페이블' },
];

export const DEEPSEEK_MODEL_OPTIONS: ModelOption[] = [
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', description: '최신 고속 범용·비전 모델 (추천)' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '고성능 추론 모델' },
];

export const QWEN_MODEL_OPTIONS: ModelOption[] = [
    { id: 'qwen3.8-max', label: 'Qwen3.8 Max', description: '최신 플래그십·복합 추론 (추천)' },
    { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', description: '최신 고속·1M 컨텍스트' },
    { id: 'qwen3.7-max', label: 'Qwen3.7 Max', description: '이전 세대 플래그십' },
    { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', description: '범용 고성능' },
    { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus', description: '안정적인 범용 모델' },
    { id: 'qwen3.6-flash', label: 'Qwen3.6 Flash', description: '빠른 응답·저비용' },
];

export const KIMI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'kimi-k3', label: 'Kimi K3', description: '최신 1M 컨텍스트 플래그십 (추천)' },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', description: '코딩 특화 256K 컨텍스트' },
    { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed', description: '고속 코딩 응답' },
    { id: 'kimi-k2.6', label: 'Kimi K2.6', description: '텍스트·이미지·추론 범용 모델' },
];

export const GLM_MODEL_OPTIONS: ModelOption[] = [
    { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', description: '최신 멀티모달 경량 모델' },
    { id: 'glm-5.3-flashx', label: 'GLM-5.3 FlashX', description: '경량 고속 응답' },
    { id: 'glm-5.3', label: 'GLM-5.3', description: '최신 1M 컨텍스트 플래그십 (추천)' },
    { id: 'glm-5.2', label: 'GLM-5.2', description: '이전 세대 플래그십' },
    { id: 'glm-5.1', label: 'GLM-5.1', description: '장기 작업·코딩 강화' },
    { id: 'glm-5', label: 'GLM-5', description: 'Agent·복합 시스템 작업' },
];

// ─── Reasoning effort ─────────────────────────────────────────────
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'fast';

export const REASONING_EFFORT_OPTIONS: Array<{ id: ReasoningEffort; label: string; description: string }> = [
    { id: 'fast', label: '낮음', description: '생각을 최소화하고 바로 답해요' },
    { id: 'balanced', label: '중간', description: '적당히 생각한 뒤 답해요' },
    { id: 'deep', label: '높음', description: '충분히 생각해요. 느리고 토큰을 더 써요' },
];

/**
 * Extra output tokens to reserve for thinking. Every supported provider counts thinking
 * toward its output limit, so the reply budget alone would be eaten by the thoughts.
 */
export const REASONING_TOKEN_HEADROOM: Record<ReasoningEffort, number> = {
    fast: 1024,
    balanced: 4096,
    deep: 12288,
};

export const isDeepSeekThinkingModel = (modelName: string): boolean => {
    const model = modelName.trim().toLowerCase();
    return model.startsWith('deepseek-v4') || model === 'deepseek-flash';
};

/** GLM-5.3 models always think; the API rejects turning it off. */
export const isGlmForcedThinkingModel = (modelName: string): boolean =>
    /^glm-5\.3/i.test(modelName.trim());

export const isGlmThinkingModel = (modelName: string): boolean =>
    /^glm-(5|4\.[5-9])/i.test(modelName.trim());

export const isQwenThinkingModel = (modelName: string): boolean =>
    /^qwen3/i.test(modelName.trim());

export const isOpenAIReasoningModel = (modelName: string): boolean =>
    /^(gpt-5|gpt-6|o\d)/i.test(modelName.trim());

/** Claude models from the 4.6 generation on use dateless IDs and adaptive thinking. */
export const isClaudeAdaptiveThinkingModel = (modelName: string): boolean =>
    !/-\d{8}$/.test(modelName.trim());

export const isGeminiThinkingLevelModel = (modelName: string): boolean =>
    /^gemini-3\./i.test(normalizeGeminiModelName(modelName));

/** Whether the chat "추론 강도" control changes anything for this model. */
export const supportsReasoningEffort = (provider: ApiConnection['provider'], modelName: string): boolean => {
    const model = (modelName || '').trim();
    if (!model) return false;
    if (provider === 'openai') return isOpenAIReasoningModel(model);
    if (provider === 'anthropic') return isClaudeAdaptiveThinkingModel(model);
    if (provider === 'gemini') return isGeminiThinkingLevelModel(model);
    if (provider === 'deepseek') return isDeepSeekThinkingModel(model);
    if (provider === 'qwen') return isQwenThinkingModel(model);
    if (provider === 'glm') return isGlmThinkingModel(model) && !isGlmForcedThinkingModel(model);
    if (provider === 'kimi') return model.toLowerCase() === 'kimi-k3';
    return false;
};

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
    'gemini-3.8': 'gemini-3.8-flash',
    'gemini-3.7': 'gemini-3.7-flash',
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

// IDs saved by earlier versions of the picker that the Claude API never accepted,
// or that belong to retired models.
const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
    'claude-opus-5-0': 'claude-opus-5',
    'claude-5-sonnet': 'claude-sonnet-5',
    'claude-3-5-sonnet-20241022': 'claude-sonnet-5-5',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
};

export const normalizeProviderModelName = (
    provider: ApiConnection['provider'],
    modelName?: string
): string => {
    const trimmed = (modelName || '').trim();
    const normalized = provider === 'gemini'
        ? normalizeGeminiModelName(modelName)
        : provider === 'anthropic'
            ? (ANTHROPIC_MODEL_ALIASES[trimmed.toLowerCase()] || trimmed)
            : trimmed;
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

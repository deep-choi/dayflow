import { AppSettings, ApiConnection } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const DEFAULT_XAI_MODEL = 'grok-4.3';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export interface ModelOption {
    id: string;
    label: string;
}

export const XAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'grok-4.3', label: 'Grok 4.3' },
    { id: 'grok-build-0.1', label: 'Grok Build 0.1' },
    { id: 'grok-4.20-multi-agent', label: 'Grok 4.20 Multi-Agent' },
    { id: 'grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning (0309)' },
    { id: 'grok-4.20-0309-non-reasoning', label: 'Grok 4.20 Non-Reasoning (0309)' },
    { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning' },
    { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast Non-Reasoning' },
    { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
    { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast Reasoning' },
    { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast Non-Reasoning' },
    { id: 'grok-4-0709', label: 'Grok 4 (0709)' },
    { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    { id: 'grok-3', label: 'Grok 3' },
];

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
];

export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
];

const GEMINI_MODEL_ALIASES: Record<string, string> = {
    'gemini-3.5': 'gemini-3.5-flash',
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
    return '';
};

export const getModelOptionsForProvider = (provider: ApiConnection['provider']): ModelOption[] => {
    if (provider === 'gemini') return GEMINI_MODEL_OPTIONS;
    if (provider === 'xai') return XAI_MODEL_OPTIONS;
    if (provider === 'openai') return OPENAI_MODEL_OPTIONS;
    if (provider === 'anthropic') return ANTHROPIC_MODEL_OPTIONS;
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

const CHAT_SUPPORTED_PROVIDERS: ApiConnection['provider'][] = ['gemini', 'xai', 'openai', 'anthropic', 'ollama'];

export const isChatSupportedProvider = (provider: ApiConnection['provider']): boolean => {
    return CHAT_SUPPORTED_PROVIDERS.includes(provider);
};

const hasUsableCredentials = (connection: ApiConnection): boolean => {
    if (connection.provider === 'ollama') {
        return typeof connection.baseUrl === 'string' && connection.baseUrl.trim().length > 0;
    }
    return typeof connection.apiKey === 'string' && connection.apiKey.trim().length > 0;
};

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

/**
 * Resolve the AI config for a specific agent.
 * This function is strict for persona chat:
 * - If the agent has no connectionId, return null.
 * - If the connection is invalid or unsupported, return null.
 */
export const getAgentAIConfig = (settings: AppSettings, agentConnectionId?: string): ActiveAIConfig | null => {
    if (!agentConnectionId) {
        return null;
    }

    const connections = settings.apiConnections || [];
    const agentConnection = connections.find(c => c.id === agentConnectionId);

    if (agentConnection) {
        if (!hasUsableCredentials(agentConnection)) {
            console.warn('[aiConfig] Agent connection has no usable credentials:', agentConnectionId);
            return null;
        }
        if (!isChatSupportedProvider(agentConnection.provider)) {
            console.warn('[aiConfig] Agent connection provider is not supported in chat:', agentConnection.provider);
            return null;
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

    console.warn('[aiConfig] Agent has connectionId but not found or invalid:', agentConnectionId);
    return null;
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

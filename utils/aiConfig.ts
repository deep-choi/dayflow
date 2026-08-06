import { AppSettings, ApiConnection } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_XAI_MODEL = 'grok-2-1212';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export interface ModelOption {
    id: string;
    label: string;
    description?: string;
}

export const XAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'grok-2-1212', label: 'Grok 2 (1212)', description: 'xAI flagship model' },
    { id: 'grok-2-vision-1212', label: 'Grok 2 Vision', description: 'Multimodal vision model' },
    { id: 'grok-beta', label: 'Grok Beta', description: 'General reasoning model' },
];

export const GEMINI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast, lightweight & highly capable (Recommended)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Advanced reasoning and complex tasks' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Ultra fast response model' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: 'Cost effective lightweight model' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Standard flash model' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'High context pro model' },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
    { id: 'gpt-4o', label: 'GPT-4o', description: 'Omni flagship model for text & vision' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast & affordable daily chat model' },
    { id: 'o1', label: 'o1', description: 'Advanced reasoning model for complex logic' },
    { id: 'o1-mini', label: 'o1-mini', description: 'Faster reasoning model' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: 'High capability model' },
];

export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', description: 'State of the art intelligence and coding' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: 'Fastest Claude model' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', description: 'Deep analysis and writing' },
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

const CHAT_SUPPORTED_PROVIDERS: ApiConnection['provider'][] = ['gemini', 'xai', 'openai', 'anthropic', 'ollama', 'custom'];

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

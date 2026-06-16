import { AppSettings, ApiConnection } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_XAI_MODEL = 'grok-4-1-fast-non-reasoning';

export interface GeminiModelOption {
    id: string;
    label: string;
}

export interface XaiModelOption {
    id: string;
    label: string;
}

export const XAI_MODEL_OPTIONS: XaiModelOption[] = [
    { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning' },
    { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast Non-Reasoning' },
    { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
    { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast Reasoning' },
    { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast Non-Reasoning' },
    { id: 'grok-4-0709', label: 'Grok 4 (0709)' },
    { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    { id: 'grok-3', label: 'Grok 3' },
    { id: 'grok-2-vision-1212', label: 'Grok 2 Vision (1212)' },
];

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash-Lite Preview (09-2025)' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

const GEMINI_MODEL_ALIASES: Record<string, string> = {
    'gemini-3.0-pro': 'gemini-3-pro-preview',
    'gemini-3.0-flash': 'gemini-3-flash-preview',
    'gemini-3-pro': 'gemini-3-pro-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
    'gemini-3.1-flashlite': 'gemini-3.1-flash-lite-preview',
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

const normalizeConnectionModelName = (connection: ApiConnection): string => {
    if (connection.provider === 'gemini') return normalizeGeminiModelName(connection.modelName);
    if (connection.provider === 'xai' && isMediaGenerationModelName(connection.modelName)) return DEFAULT_XAI_MODEL;
    return connection.modelName;
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
}

const CHAT_SUPPORTED_PROVIDERS: ApiConnection['provider'][] = ['gemini'];

export const isChatSupportedProvider = (provider: ApiConnection['provider']): boolean => {
    return CHAT_SUPPORTED_PROVIDERS.includes(provider);
};

const hasUsableKey = (connection: ApiConnection): boolean => {
    return typeof connection.apiKey === 'string' && connection.apiKey.trim().length > 0;
};

export const getActiveAIConfig = (settings: AppSettings): ActiveAIConfig | null => {
    const connections = settings.apiConnections || [];

    // 1. Try the explicitly selected connection
    const selected = connections.find(
        c =>
            c.id === settings.activeConnectionId &&
            c.isActive &&
            hasUsableKey(c)
    );

    if (selected) {
        return {
            connectionId: selected.id,
            provider: selected.provider,
            apiKey: selected.apiKey,
            modelName: normalizeConnectionModelName(selected),
        };
    }

    // 2. Fallback to first active connection
    const firstActive = connections.find(c => c.isActive && hasUsableKey(c));
    if (firstActive) {
        return {
            connectionId: firstActive.id,
            provider: firstActive.provider,
            apiKey: firstActive.apiKey,
            modelName: normalizeConnectionModelName(firstActive),
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
        if (!hasUsableKey(agentConnection)) {
            console.warn('[aiConfig] Agent connection has no usable apiKey:', agentConnectionId);
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
    const gemini = connections.find(c => c.provider === 'gemini' && c.isActive && hasUsableKey(c));
    if (gemini) {
        return { connectionId: gemini.id, apiKey: gemini.apiKey, modelName: normalizeGeminiModelName(gemini.modelName) };
    }
    if (typeof settings.geminiApiKey === 'string' && settings.geminiApiKey.trim().length > 0) {
        return { apiKey: settings.geminiApiKey, modelName: DEFAULT_GEMINI_MODEL };
    }
    return null;
};

import { AppSettings, ApiConnection } from '../types';

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_XAI_MODEL = 'grok-4-1-fast-reasoning';

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
    { id: 'grok-imagine-image-pro', label: 'Grok Imagine Image Pro' },
    { id: 'grok-imagine-image', label: 'Grok Imagine Image' },
    { id: 'grok-2-image-1212', label: 'Grok 2 Image (1212)' },
    { id: 'grok-imagine-video', label: 'Grok Imagine Video' },
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
    { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
    { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
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

export const normalizeGeminiModelName = (modelName?: string): string => {
    const normalized = (modelName || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_GEMINI_MODEL;
    return GEMINI_MODEL_ALIASES[normalized] || normalized;
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

const CHAT_SUPPORTED_PROVIDERS: ApiConnection['provider'][] = ['gemini', 'xai'];

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
        const modelName = selected.provider === 'gemini'
            ? normalizeGeminiModelName(selected.modelName)
            : selected.modelName;
        return {
            connectionId: selected.id,
            provider: selected.provider,
            apiKey: selected.apiKey,
            modelName,
        };
    }

    // 2. Fallback to first active connection
    const firstActive = connections.find(c => c.isActive && hasUsableKey(c));
    if (firstActive) {
        const modelName = firstActive.provider === 'gemini'
            ? normalizeGeminiModelName(firstActive.modelName)
            : firstActive.modelName;
        return {
            connectionId: firstActive.id,
            provider: firstActive.provider,
            apiKey: firstActive.apiKey,
            modelName,
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
        const modelName = agentConnection.provider === 'gemini'
            ? normalizeGeminiModelName(agentConnection.modelName)
            : agentConnection.modelName;
        return {
            connectionId: agentConnection.id,
            provider: agentConnection.provider,
            apiKey: agentConnection.apiKey,
            modelName,
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

export const isImageGenerationModel = (modelId: string): boolean => {
    const id = modelId.toLowerCase();
    return (
        id.includes('imagine') ||
        id.includes('image') ||
        id === 'grok-2' || // Grok-2 is multimodal often
        id === 'grok-3'
    );
};

export const isVideoGenerationModel = (modelId: string): boolean => {
    const id = modelId.toLowerCase();
    return id.includes('video');
};

export const findMediaConnection = (settings: AppSettings, type: 'image' | 'video'): ActiveAIConfig | null => {
    const connections = settings.apiConnections || [];
    const checkFunc = type === 'image' ? isImageGenerationModel : isVideoGenerationModel;

    // First try active connection
    const active = getActiveAIConfig(settings);
    if (active && checkFunc(active.modelName)) return active;

    // Then try any active connection that matches
    const found = connections.find(c => c.isActive && hasUsableKey(c) && checkFunc(c.modelName));
    if (found) {
        return {
            connectionId: found.id,
            provider: found.provider,
            apiKey: found.apiKey,
            modelName: found.provider === 'gemini' ? normalizeGeminiModelName(found.modelName) : found.modelName,
        };
    }

    return null;
};

export const findMediaConnectionForProvider = (
    settings: AppSettings,
    type: 'image' | 'video',
    provider: ApiConnection['provider'],
    preferredConnectionId?: string
): ActiveAIConfig | null => {
    const connections = settings.apiConnections || [];
    const checkFunc = type === 'image' ? isImageGenerationModel : isVideoGenerationModel;

    if (preferredConnectionId) {
        const preferred = connections.find((connection) =>
            connection.id === preferredConnectionId &&
            connection.provider === provider &&
            connection.isActive &&
            hasUsableKey(connection) &&
            checkFunc(connection.modelName)
        );
        if (preferred) {
            return {
                connectionId: preferred.id,
                provider: preferred.provider,
                apiKey: preferred.apiKey,
                modelName: preferred.provider === 'gemini' ? normalizeGeminiModelName(preferred.modelName) : preferred.modelName,
            };
        }
    }

    const providerMedia = connections.find((connection) =>
        connection.provider === provider &&
        connection.isActive &&
        hasUsableKey(connection) &&
        checkFunc(connection.modelName)
    );
    if (providerMedia) {
        return {
            connectionId: providerMedia.id,
            provider: providerMedia.provider,
            apiKey: providerMedia.apiKey,
            modelName: providerMedia.provider === 'gemini' ? normalizeGeminiModelName(providerMedia.modelName) : providerMedia.modelName,
        };
    }

    return null;
};

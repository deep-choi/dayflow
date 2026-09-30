import { ApiUsageStats, ReasoningEffort } from '../types';
import {
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_REASONING_EFFORT,
    REASONING_TOKEN_HEADROOM,
    isClaudeAdaptiveThinkingModel,
} from '../utils/aiConfig';

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface AnthropicCallOptions {
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
}

const CLAUDE_EFFORT: Record<ReasoningEffort, 'low' | 'medium' | 'high'> = {
    fast: 'low',
    balanced: 'medium',
    deep: 'high',
};

const normalizeAnthropicMessages = (
    messages: AnthropicChatMessage[]
): { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } => {
    const system = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
        .trim();

    const conversation = messages
        .filter((message) => message.role !== 'system' && message.content.trim())
        .map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content.trim(),
        }));

    const firstUserIndex = conversation.findIndex((message) => message.role === 'user');
    const scoped = firstUserIndex >= 0 ? conversation.slice(firstUserIndex) : conversation;
    const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    scoped.forEach((message) => {
        const previous = merged[merged.length - 1];
        if (previous?.role === message.role) {
            previous.content = `${previous.content}\n\n${message.content}`;
            return;
        }
        merged.push({ ...message });
    });

    return { system, messages: merged };
};

const readAnthropicResponseText = (data: any): string => {
    return (data?.content || [])
        .filter((content: any) => content?.type === 'text')
        .map((content: any) => content?.text || '')
        .join('')
        .trim();
};

export const callAnthropicChatAPI = async (
    apiKey: string,
    messages: AnthropicChatMessage[],
    updateUsage?: (stats: ApiUsageStats) => void,
    modelName: string = DEFAULT_ANTHROPIC_MODEL,
    options?: AnthropicCallOptions
): Promise<string> => {
    if (!apiKey) {
        throw new Error('API Key가 필요합니다.');
    }

    const normalized = normalizeAnthropicMessages(messages);
    if (normalized.messages.length === 0) {
        throw new Error('보낼 메시지가 없습니다.');
    }

    const replyTokens = options?.maxTokens ?? 768;
    const body: Record<string, unknown> = {
        model: modelName,
        system: normalized.system || undefined,
        messages: normalized.messages,
    };

    // Dated snapshots (Claude Haiku 4.5 and older) still take `temperature`. From the 4.6
    // generation on, IDs are dateless; the current models (Opus 5.5, Fable 5.1, ...) reject
    // non-default sampling values and think adaptively, steered by `output_config.effort`.
    if (isClaudeAdaptiveThinkingModel(modelName)) {
        const effort = options?.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
        // Thinking counts toward max_tokens, so leave room for it on top of the reply budget.
        body.max_tokens = replyTokens + REASONING_TOKEN_HEADROOM[effort];
        body.output_config = { effort: CLAUDE_EFFORT[effort] };
    } else {
        body.max_tokens = replyTokens;
        body.temperature = options?.temperature ?? 0.5;
    }

    const response = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `Anthropic API 요청 실패 (${response.status})`);
    }

    const data = await response.json();
    const text = readAnthropicResponseText(data);
    if (!text) {
        if (data?.stop_reason === 'refusal') {
            throw new Error('모델이 이 요청에 대한 응답을 거절했습니다.');
        }
        throw new Error('응답이 비어 있습니다.');
    }

    if (updateUsage) {
        updateUsage({
            totalRequests: 1,
            totalTokens: (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0),
            lastRequestDate: new Date().toISOString(),
        });
    }

    return text;
};

export const testAnthropicConnection = async (
    apiKey: string,
    modelName: string = DEFAULT_ANTHROPIC_MODEL
): Promise<string> => {
    return callAnthropicChatAPI(
        apiKey,
        [{ role: 'user', content: '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.' }],
        undefined,
        modelName,
        { maxTokens: 32, temperature: 0.2 }
    );
};

export const callAnthropicChatJSON = async (
    apiKey: string,
    systemPrompt: string,
    messages: AnthropicChatMessage[],
    modelName: string = DEFAULT_ANTHROPIC_MODEL,
    options?: AnthropicCallOptions
): Promise<any> => {
    const text = await callAnthropicChatAPI(
        apiKey,
        [
            {
                role: 'system',
                content: `${systemPrompt}\n\nJSON 객체만 반환하세요. 마크다운 코드블록이나 설명 문장은 넣지 마세요.`,
            },
            ...messages,
        ],
        undefined,
        modelName,
        options
    );

    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(jsonText);
    } catch {
        return { title: '오늘의 인사이트', content: text, tags: ['Insight'] };
    }
};

import { ApiUsageStats } from '../types';
import { DEFAULT_XAI_MODEL } from '../utils/aiConfig';

const XAI_BASE_URL = 'https://api.x.ai/v1';



interface XaiChatMessage {
    role: 'system' | 'user' | 'assistant';
    content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
        >;
}

interface XaiCallOptions {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
}

/**
 * Call XAI's OpenAI-compatible Chat Completion API.
 */
export const callXaiChatAPI = async (
    apiKey: string,
    messages: XaiChatMessage[],
    updateUsage?: (stats: ApiUsageStats) => void,
    modelName: string = DEFAULT_XAI_MODEL,
    options?: XaiCallOptions
): Promise<string> => {
    if (!apiKey) {
        throw new Error('API Key가 필요합니다.');
    }

    const url = `${XAI_BASE_URL}/chat/completions`;

    const body: Record<string, any> = {
        model: modelName,
        messages,
        temperature: options?.temperature ?? 0.5,
        max_tokens: options?.maxTokens ?? 768,
    };

    if (options?.jsonMode) {
        body.response_format = { type: 'json_object' };
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
                (errorData as any)?.error?.message || `XAI API 요청 실패 (${response.status})`
            );
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim() || '';

        if (!text) {
            throw new Error('응답이 비어 있습니다.');
        }

        if (updateUsage) {
            const promptTokens = data.usage?.prompt_tokens || 0;
            const completionTokens = data.usage?.completion_tokens || 0;
            updateUsage({
                totalRequests: 1,
                totalTokens: promptTokens + completionTokens,
                lastRequestDate: new Date().toISOString(),
            });
        }

        return text;
    } catch (error) {
        console.error('XAI API Error:', error);
        throw error;
    }
};

/**
 * Simple connection test for XAI.
 */
export const testXaiConnection = async (
    apiKey: string,
    modelName: string = DEFAULT_XAI_MODEL
): Promise<string> => {
    return callXaiChatAPI(
        apiKey,
        [{ role: 'user', content: '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.' }],
        undefined,
        modelName,
        { maxTokens: 32 }
    );
};

/**
 * Generate a chat completion using XAI with JSON mode for structured output.
 * The caller should include JSON schema instructions in the system prompt.
 */
export const callXaiChatJSON = async (
    apiKey: string,
    systemPrompt: string,
    messages: XaiChatMessage[],
    modelName: string = DEFAULT_XAI_MODEL,
    options?: Omit<XaiCallOptions, 'jsonMode'>
): Promise<any> => {
    const allMessages: XaiChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages,
    ];

    const text = await callXaiChatAPI(apiKey, allMessages, undefined, modelName, {
        ...options,
        jsonMode: true,
    });

    try {
        return JSON.parse(text);
    } catch {
        // If JSON parsing fails, extract the reply string using regex
        let fallbackReply = text;
        try {
            const replyMatch = text.match(/"reply"\s*:\s*"([^]+?)(?:",\s*"action"|"\s*}$|"$|$)/);
            if (replyMatch && replyMatch[1]) {
                fallbackReply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            }
        } catch (e) {
            // parsing fallback failed, continue
        }
        return { reply: fallbackReply, action: { type: 'none' } };
    }
};

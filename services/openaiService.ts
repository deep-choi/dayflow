import { ApiUsageStats } from '../types';
import { DEFAULT_OPENAI_MODEL } from '../utils/aiConfig';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAIChatMessage {
    role: 'system' | 'user' | 'assistant' | 'developer';
    content: string;
}

interface OpenAICallOptions {
    temperature?: number;
    maxTokens?: number;
}

const readOpenAIResponseText = (data: any): string => {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const outputText = (data?.output || [])
        .flatMap((item: any) => item?.content || [])
        .filter((content: any) => content?.type === 'output_text' || content?.type === 'text')
        .map((content: any) => content?.text || '')
        .join('')
        .trim();

    if (outputText) return outputText;

    return (data?.choices?.[0]?.message?.content || '').trim();
};

const shouldOmitTemperature = (modelName: string): boolean => /^gpt-5\.6-(sol|terra|luna)$/i.test(modelName.trim());

export const callOpenAIChatAPI = async (
    apiKey: string,
    messages: OpenAIChatMessage[],
    updateUsage?: (stats: ApiUsageStats) => void,
    modelName: string = DEFAULT_OPENAI_MODEL,
    options?: OpenAICallOptions
): Promise<string> => {
    if (!apiKey) {
        throw new Error('API Key가 필요합니다.');
    }

    const body: Record<string, unknown> = {
        model: modelName,
        input: messages.map((message) => ({
            role: message.role,
            content: message.content,
        })),
        max_output_tokens: options?.maxTokens ?? 768,
        store: false,
    };

    // GPT-5.6 Sol/Terra/Luna do not accept sampling parameters such as temperature.
    if (!shouldOmitTemperature(modelName)) {
        body.temperature = options?.temperature ?? 0.5;
    }

    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `OpenAI API 요청 실패 (${response.status})`);
    }

    const data = await response.json();
    const text = readOpenAIResponseText(data);
    if (!text) {
        throw new Error('응답이 비어 있습니다.');
    }

    if (updateUsage) {
        const inputTokens = data?.usage?.input_tokens || data?.usage?.prompt_tokens || 0;
        const outputTokens = data?.usage?.output_tokens || data?.usage?.completion_tokens || 0;
        updateUsage({
            totalRequests: 1,
            totalTokens: inputTokens + outputTokens,
            lastRequestDate: new Date().toISOString(),
        });
    }

    return text;
};

export const testOpenAIConnection = async (
    apiKey: string,
    modelName: string = DEFAULT_OPENAI_MODEL
): Promise<string> => {
    return callOpenAIChatAPI(
        apiKey,
        [{ role: 'user', content: '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.' }],
        undefined,
        modelName,
        { maxTokens: 32, temperature: 0.2 }
    );
};

export const callOpenAIChatJSON = async (
    apiKey: string,
    systemPrompt: string,
    messages: OpenAIChatMessage[],
    modelName: string = DEFAULT_OPENAI_MODEL,
    options?: OpenAICallOptions
): Promise<any> => {
    const text = await callOpenAIChatAPI(
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

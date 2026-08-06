import { ApiUsageStats } from '../types';

export interface OpenAICompatibleChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAICompatibleCallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

const getChatCompletionsUrl = (baseUrl: string): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return body?.error?.message || body?.error || body?.message || `API 요청 실패 (${response.status})`;
};

const readMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
};

const shouldOmitTemperature = (modelName: string): boolean => {
  const model = modelName.trim().toLowerCase();
  return model.startsWith('deepseek-v4') || model === 'kimi-k3' || model.startsWith('kimi-k2.7-code');
};

export const callOpenAICompatibleChatAPI = async (
  apiKey: string,
  baseUrl: string,
  messages: OpenAICompatibleChatMessage[],
  modelName: string,
  options: OpenAICompatibleCallOptions = {},
  updateUsage?: (stats: ApiUsageStats) => void,
): Promise<string> => {
  if (!apiKey.trim()) throw new Error('API Key가 필요합니다.');
  if (!baseUrl.trim()) throw new Error('API Base URL이 필요합니다.');
  if (!modelName.trim()) throw new Error('모델 이름이 필요합니다.');

  const body: Record<string, unknown> = {
    model: modelName.trim(),
    messages,
    stream: false,
    max_tokens: options.maxTokens ?? 768,
  };

  if (!shouldOmitTemperature(modelName)) {
    body.temperature = options.temperature ?? 0.5;
  }

  if (modelName.trim().toLowerCase().startsWith('deepseek-v4')) {
    body.thinking = { type: 'disabled' };
  } else if (modelName.trim().toLowerCase() === 'kimi-k3') {
    body.reasoning_effort = 'low';
  }

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(getChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(await readErrorMessage(response));

  const data = await response.json();
  const text = readMessageContent(data?.choices?.[0]?.message?.content);
  if (!text) throw new Error('API 응답이 비어 있습니다.');

  if (updateUsage) {
    const inputTokens = data?.usage?.prompt_tokens || data?.usage?.input_tokens || 0;
    const outputTokens = data?.usage?.completion_tokens || data?.usage?.output_tokens || 0;
    updateUsage({
      totalRequests: 1,
      totalTokens: inputTokens + outputTokens,
      lastRequestDate: new Date().toISOString(),
    });
  }

  return text;
};

export const testOpenAICompatibleConnection = (
  apiKey: string,
  baseUrl: string,
  modelName: string,
): Promise<string> => callOpenAICompatibleChatAPI(
  apiKey,
  baseUrl,
  [{ role: 'user', content: '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.' }],
  modelName,
  { maxTokens: 32, temperature: 0.2 },
);

export const callOpenAICompatibleChatJSON = async (
  apiKey: string,
  baseUrl: string,
  systemPrompt: string,
  messages: OpenAICompatibleChatMessage[],
  modelName: string,
  options: Omit<OpenAICompatibleCallOptions, 'jsonMode'> = {},
): Promise<any> => {
  const text = await callOpenAICompatibleChatAPI(
    apiKey,
    baseUrl,
    [
      { role: 'system', content: `${systemPrompt}\n\nJSON 객체만 반환하세요. 마크다운 코드블록이나 설명 문장은 넣지 마세요.` },
      ...messages,
    ],
    modelName,
    { ...options, jsonMode: true },
  );

  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return { title: '오늘의 인사이트', content: text, tags: ['Insight'] };
  }
};

import { ApiUsageStats, ReasoningEffort } from '../types';
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_TOKEN_HEADROOM,
  isDeepSeekThinkingModel,
  isGlmForcedThinkingModel,
  isGlmThinkingModel,
  isQwenThinkingModel,
} from '../utils/aiConfig';

export interface OpenAICompatibleChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAICompatibleCallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  reasoningEffort?: ReasoningEffort;
}

const DEEPSEEK_EFFORT: Record<Exclude<ReasoningEffort, 'fast'>, 'high' | 'max'> = {
  balanced: 'high',
  deep: 'max',
};

const KIMI_EFFORT: Record<ReasoningEffort, 'low' | 'medium' | 'high'> = {
  fast: 'low',
  balanced: 'medium',
  deep: 'high',
};

const QWEN_THINKING_BUDGET: Record<Exclude<ReasoningEffort, 'fast'>, number> = {
  balanced: 2048,
  deep: 8192,
};

/**
 * Applies each hosted provider's thinking controls (identified by model name) and returns
 * whether the model will think, so the caller can reserve output tokens for it.
 */
const applyReasoningSettings = (
  body: Record<string, unknown>,
  modelName: string,
  effort: ReasoningEffort,
): boolean => {
  const model = modelName.trim().toLowerCase();

  if (isDeepSeekThinkingModel(model)) {
    if (effort === 'fast') {
      body.thinking = { type: 'disabled' };
      return false;
    }
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = DEEPSEEK_EFFORT[effort];
    return true;
  }

  if (model === 'kimi-k3') {
    body.reasoning_effort = KIMI_EFFORT[effort];
    return true;
  }

  if (isQwenThinkingModel(model)) {
    if (effort === 'fast') {
      body.enable_thinking = false;
      return false;
    }
    body.enable_thinking = true;
    body.thinking_budget = QWEN_THINKING_BUDGET[effort];
    return true;
  }

  // GLM-5.3 always thinks and rejects `disabled`; other GLM-5.x/4.5+ models can switch it off.
  if (isGlmForcedThinkingModel(model)) return true;
  if (isGlmThinkingModel(model)) {
    body.thinking = { type: effort === 'fast' ? 'disabled' : 'enabled' };
    return effort !== 'fast';
  }

  return false;
};

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
  return isDeepSeekThinkingModel(model) || model === 'kimi-k3' || model.startsWith('kimi-k2.7-code');
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

  const buildBody = (effort: ReasoningEffort): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: modelName.trim(),
      messages,
      stream: false,
    };

    if (!shouldOmitTemperature(modelName)) {
      body.temperature = options.temperature ?? 0.5;
    }

    const willThink = applyReasoningSettings(body, modelName, effort);
    // Thinking counts toward max_tokens, so reserve room for it on top of the reply budget.
    body.max_tokens = (options.maxTokens ?? 768) + (willThink ? REASONING_TOKEN_HEADROOM[effort] : 0);

    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    return body;
  };

  const send = (body: Record<string, unknown>) => fetch(getChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  });

  const effort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  let response = await send(buildBody(effort));

  // Qwen differs per model: hybrid models may only think on streaming calls, while
  // thinking-only models reject enable_thinking=false. Retry once the other way.
  if (!response.ok && isQwenThinkingModel(modelName)) {
    const message = await readErrorMessage(response);
    if (!/enable_thinking|thinking|stream/i.test(message)) throw new Error(message);
    if (effort !== 'fast') {
      response = await send(buildBody('fast'));
    } else {
      const retryBody = buildBody('fast');
      delete retryBody.enable_thinking;
      retryBody.max_tokens = (options.maxTokens ?? 768) + REASONING_TOKEN_HEADROOM.fast;
      response = await send(retryBody);
    }
  }

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

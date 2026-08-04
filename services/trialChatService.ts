import { supabase } from '../utils/supabase';

export const DAYFLOW_TRIAL_API_KEY = '__dayflow_trial_api__';

export const DAYFLOW_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', shortLabel: '3 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', shortLabel: '3.5 Flash' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', shortLabel: '2.5 Flash' },
] as const;

export type DayflowModelId = (typeof DAYFLOW_MODELS)[number]['id'];

export const DEFAULT_DAYFLOW_MODEL_ID: DayflowModelId = DAYFLOW_MODELS[0].id;
export const DAYFLOW_TRIAL_MODEL = DEFAULT_DAYFLOW_MODEL_ID;

export const getDayflowModel = (modelId: string | null | undefined) =>
  DAYFLOW_MODELS.find((model) => model.id === modelId) || DAYFLOW_MODELS[0];

type TrialGeminiRequest = {
  contents: unknown;
  systemInstruction?: unknown;
  safetySettings?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  trialTurnId: string;
  model: DayflowModelId;
};

type TrialGeminiResponse = {
  text?: string;
  candidates?: unknown;
  usageMetadata?: unknown;
  remaining?: number;
  model?: string;
  planId?: string;
  limit?: number;
};

export class TrialChatError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TrialChatError';
    this.code = code;
  }
}

export const isTrialExhaustedError = (error: unknown): boolean =>
  error instanceof TrialChatError && ['TRIAL_EXHAUSTED', 'AI_QUOTA_EXHAUSTED'].includes(error.code);

const readFunctionError = async (error: unknown): Promise<{ code: string; message: string }> => {
  const fallback = {
    code: 'TRIAL_REQUEST_FAILED',
    message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return fallback;

  try {
    const payload = await context.clone().json() as { code?: unknown; message?: unknown };
    return {
      code: typeof payload.code === 'string' ? payload.code : fallback.code,
      message: typeof payload.message === 'string' ? payload.message : fallback.message,
    };
  } catch {
    return fallback;
  }
};

export const generateTrialGeminiContent = async (
  request: TrialGeminiRequest,
): Promise<TrialGeminiResponse> => {
  const { data, error } = await supabase.functions.invoke<TrialGeminiResponse>('trial-chat', {
    body: request,
  });

  if (error) {
    const parsed = await readFunctionError(error);
    throw new TrialChatError(parsed.code, parsed.message);
  }
  if (!data) {
    throw new TrialChatError('AI_EMPTY_RESPONSE', 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  return data;
};

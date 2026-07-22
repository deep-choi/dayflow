import { supabase } from '../utils/supabase';

export const DAYFLOW_TRIAL_API_KEY = '__dayflow_trial_api__';
export const DAYFLOW_TRIAL_MODEL = 'gemini-3-flash-preview';

type TrialGeminiRequest = {
  contents: unknown;
  systemInstruction?: unknown;
  safetySettings?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  trialTurnId: string;
};

type TrialGeminiResponse = {
  text?: string;
  candidates?: unknown;
  usageMetadata?: unknown;
  remaining?: number;
  model?: string;
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
  error instanceof TrialChatError && error.code === 'TRIAL_EXHAUSTED';

const readFunctionError = async (error: unknown): Promise<{ code: string; message: string }> => {
  const fallback = {
    code: 'TRIAL_REQUEST_FAILED',
    message: '체험 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
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
    throw new TrialChatError('TRIAL_EMPTY_RESPONSE', '체험 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  return data;
};

export const DEFAULT_LOCAL_SERVER_BASE_URL = 'http://127.0.0.1:1234/v1';

type LocalServerChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const normalizeBaseUrl = (baseUrl?: string): string => {
  const normalized = (baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL).trim().replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
};

const buildHeaders = (apiKey?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
});

const readError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return body?.error?.message || body?.error || body?.message || `로컬 서버 요청 실패 (${response.status})`;
};

const withConnectionHint = (error: unknown): Error => {
  if (error instanceof TypeError) {
    return new Error('로컬 서버에 연결하지 못했습니다. 서버 실행 상태, 주소, CORS 설정을 확인해 주세요.');
  }
  return error instanceof Error ? error : new Error('로컬 서버 요청에 실패했습니다.');
};

export const listLocalServerModels = async (baseUrl?: string, apiKey?: string): Promise<string[]> => {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, { headers: buildHeaders(apiKey) });
    if (!response.ok) throw new Error(await readError(response));
    const body = await response.json();
    const entries = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
    return entries.map((model: unknown) => {
      if (typeof model === 'string') return model;
      if (model && typeof model === 'object') {
        const candidate = model as { id?: unknown; name?: unknown; model?: unknown };
        if (typeof candidate.id === 'string') return candidate.id;
        if (typeof candidate.name === 'string') return candidate.name;
        if (typeof candidate.model === 'string') return candidate.model;
      }
      return '';
    }).filter((model: string) => model.length > 0);
  } catch (error) {
    throw withConnectionHint(error);
  }
};

export const callLocalServerChatAPI = async (
  baseUrl: string | undefined,
  apiKey: string | undefined,
  modelName: string,
  messages: LocalServerChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> => {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: false,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens,
      }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    const text = typeof content === 'string'
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part: { text?: unknown }) => typeof part?.text === 'string' ? part.text : '').join('').trim()
        : '';
    if (!text) throw new Error('로컬 서버 응답이 비어 있습니다.');
    return text;
  } catch (error) {
    throw withConnectionHint(error);
  }
};

export const testLocalServerConnection = (
  baseUrl: string | undefined,
  apiKey: string | undefined,
  modelName: string
): Promise<string> => callLocalServerChatAPI(
  baseUrl,
  apiKey,
  modelName,
  [{ role: 'user', content: '연결 성공이라고만 답하세요.' }],
  { maxTokens: 32, temperature: 0.2 }
);

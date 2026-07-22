import { DEFAULT_OLLAMA_BASE_URL } from '../utils/aiConfig';

type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const normalizeOllamaBaseUrl = (baseUrl?: string): string => {
  const normalized = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized.slice(0, -4) : normalized;
};

const readError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return body?.error || `Ollama API 요청 실패 (${response.status})`;
};

export const listOllamaModels = async (baseUrl?: string): Promise<string[]> => {
  const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/tags`);
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json();
  return Array.isArray(body?.models)
    ? body.models.map((model: { name?: unknown }) => typeof model?.name === 'string' ? model.name : '').filter(Boolean)
    : [];
};

export const callOllamaChatAPI = async (
  baseUrl: string | undefined,
  modelName: string,
  messages: OllamaChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> => {
  const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: false,
      think: false,
      options: {
        temperature: options.temperature ?? 0.5,
        num_predict: options.maxTokens,
      },
      keep_alive: '10m',
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json();
  const text = typeof body?.message?.content === 'string' ? body.message.content.trim() : '';
  if (!text) throw new Error('Ollama 응답이 비어 있습니다.');
  return text;
};

export const testOllamaConnection = async (baseUrl: string | undefined, modelName: string): Promise<string> =>
  callOllamaChatAPI(baseUrl, modelName, [{ role: 'user', content: '연결 성공이라고만 답하세요.' }], { maxTokens: 64, temperature: 0.2 });

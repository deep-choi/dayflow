import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TRIAL_LIMIT = 10;
const TRIAL_MODEL = 'gemini-3-flash-preview';
const MAX_INPUT_CHARS = 120_000;
const MAX_OUTPUT_TOKENS = 4_096;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });

const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const hashValue = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readText = (value: unknown): string => typeof value === 'string' ? value : '';

const getPayloadSize = (contents: unknown, systemInstruction: unknown): number =>
  JSON.stringify(contents ?? []).length + JSON.stringify(systemInstruction ?? {}).length;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  const authorization = request.headers.get('Authorization') || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !geminiApiKey) {
    return json(500, { code: 'TRIAL_NOT_CONFIGURED', message: '체험 채팅이 아직 설정되지 않았습니다.' });
  }
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { code: 'INVALID_BODY', message: '요청 형식이 올바르지 않습니다.' });
  }

  // Signed-in users are counted per account. A request that carries no valid user
  // session but names a device id is counted as a guest turn instead.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userError ? null : userData.user;
  const guestDeviceId = body.guestDeviceId;
  if (!user && !isUuid(guestDeviceId)) {
    return json(401, { code: 'UNAUTHORIZED', message: '로그인 정보를 확인하지 못했습니다.' });
  }

  const requestId = body.trialTurnId;
  const contents = body.contents;
  const systemInstruction = body.systemInstruction;
  const safetySettings = Array.isArray(body.safetySettings) ? body.safetySettings : [];
  const temperature = Number(body.temperature);
  const requestedMaxOutputTokens = Number(body.maxOutputTokens);

  if (!isUuid(requestId) || !Array.isArray(contents) || contents.length === 0) {
    return json(400, { code: 'INVALID_BODY', message: '채팅 요청 정보가 올바르지 않습니다.' });
  }
  if (getPayloadSize(contents, systemInstruction) > MAX_INPUT_CHARS) {
    return json(413, { code: 'INPUT_TOO_LARGE', message: '대화 내용이 너무 깁니다.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ipHash = '';
  if (!user) {
    const forwarded = request.headers.get('x-forwarded-for') || '';
    const clientIp = request.headers.get('cf-connecting-ip') || forwarded.split(',')[0].trim() || 'unknown';
    ipHash = await hashValue(`${serviceRoleKey}:${clientIp}`);
  }

  const { data: claimRows, error: claimError } = user
    ? await admin.rpc('claim_ai_trial_turn', {
      p_user_id: user.id,
      p_request_id: requestId,
    })
    : await admin.rpc('claim_ai_guest_trial_turn', {
      p_device_id: guestDeviceId,
      p_ip_hash: ipHash,
      p_request_id: requestId,
    });
  if (claimError) {
    console.error('Trial claim failed:', claimError.message);
    return json(500, { code: 'TRIAL_CLAIM_FAILED', message: '체험 사용량을 확인하지 못했습니다.' });
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.allowed) {
    if (!user && (claim?.reason === 'IP_LIMIT' || claim?.reason === 'GLOBAL_LIMIT')) {
      return json(429, {
        code: 'GUEST_TRIAL_UNAVAILABLE',
        message: '지금은 체험 이용이 많아요. 로그인하면 바로 대화를 이어갈 수 있어요.',
        remaining: 0,
      });
    }
    return json(402, {
      code: 'TRIAL_EXHAUSTED',
      message: user
        ? `무료 체험 ${TRIAL_LIMIT}회를 모두 사용했어요. 계속 대화하려면 개인 API를 연결해 주세요.`
        : `무료 체험 ${TRIAL_LIMIT}회를 모두 사용했어요. 로그인하면 계속 이용할 수 있어요.`,
      remaining: 0,
    });
  }

  const releaseClaim = async () => {
    if (!claim?.claimed_new) return;
    const { error } = user
      ? await admin.rpc('release_ai_trial_turn', {
        p_user_id: user.id,
        p_request_id: requestId,
      })
      : await admin.rpc('release_ai_guest_trial_turn', {
        p_device_id: guestDeviceId,
        p_ip_hash: ipHash,
        p_request_id: requestId,
      });
    if (error) console.error('Trial claim release failed:', error.message);
  };

  const generationConfig: Record<string, number> = {
    maxOutputTokens: Number.isFinite(requestedMaxOutputTokens)
      ? Math.min(MAX_OUTPUT_TOKENS, Math.max(128, Math.floor(requestedMaxOutputTokens)))
      : 1_024,
  };
  if (Number.isFinite(temperature)) {
    generationConfig.temperature = Math.min(1, Math.max(0, temperature));
  }

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TRIAL_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({
          contents,
          systemInstruction,
          safetySettings,
          generationConfig,
        }),
      },
    );
  } catch (error) {
    console.error('Trial Gemini network request failed:', error);
    await releaseClaim();
    return json(502, {
      code: 'TRIAL_PROVIDER_ERROR',
      message: '체험 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  const responseBody = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    const upstreamMessage = readText((responseBody as { error?: { message?: unknown } })?.error?.message);
    console.error('Trial Gemini request failed:', geminiResponse.status, upstreamMessage);
    await releaseClaim();
    return json(502, {
      code: 'TRIAL_PROVIDER_ERROR',
      message: '체험 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  const candidate = (responseBody as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0];
  const text = candidate?.content?.parts?.map(part => part.text || '').join('') || '';

  if (!text.trim()) {
    await releaseClaim();
    return json(502, {
      code: 'TRIAL_EMPTY_RESPONSE',
      message: '체험 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  return json(200, {
    text,
    candidates: (responseBody as { candidates?: unknown }).candidates,
    usageMetadata: (responseBody as { usageMetadata?: unknown }).usageMetadata,
    remaining: Number(claim.remaining_count ?? 0),
    guest: !user,
    model: TRIAL_MODEL,
  });
});

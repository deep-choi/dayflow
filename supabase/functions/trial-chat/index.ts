import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TRIAL_LIMIT = 10;
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const ALLOWED_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
]);
const PLAN_LIMITS: Record<string, number> = {
  dayflow_plus_monthly: 100,
  dayflow_pro_monthly: 300,
};
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

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { code: 'UNAUTHORIZED', message: '로그인 정보를 확인하지 못했습니다.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { code: 'INVALID_BODY', message: '요청 형식이 올바르지 않습니다.' });
  }

  const requestId = body.trialTurnId;
  const contents = body.contents;
  const systemInstruction = body.systemInstruction;
  const safetySettings = Array.isArray(body.safetySettings) ? body.safetySettings : [];
  const temperature = Number(body.temperature);
  const requestedMaxOutputTokens = Number(body.maxOutputTokens);
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : DEFAULT_MODEL;

  if (!isUuid(requestId) || !Array.isArray(contents) || contents.length === 0) {
    return json(400, { code: 'INVALID_BODY', message: '채팅 요청 정보가 올바르지 않습니다.' });
  }
  if (!ALLOWED_MODELS.has(requestedModel)) {
    return json(400, { code: 'MODEL_NOT_ALLOWED', message: 'Dayflow에서 지원하지 않는 AI 모델입니다.' });
  }
  if (getPayloadSize(contents, systemInstruction) > MAX_INPUT_CHARS) {
    return json(413, { code: 'INPUT_TOO_LARGE', message: '대화 내용이 너무 깁니다.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nowIso = new Date().toISOString();
  const { data: subscription, error: subscriptionError } = await admin
    .from('billing_subscriptions')
    .select('plan_id,current_period_start,current_period_end')
    .eq('user_id', userData.user.id)
    .in('status', ['active', 'canceled'])
    .gt('current_period_end', nowIso)
    .maybeSingle();
  if (subscriptionError) {
    console.error('Subscription lookup failed:', subscriptionError.message);
    return json(500, { code: 'AI_ACCESS_CHECK_FAILED', message: 'AI 이용 권한을 확인하지 못했습니다.' });
  }

  const subscriptionLimit = subscription ? PLAN_LIMITS[subscription.plan_id] : undefined;
  let usesSubscription = false;
  let usageLimit = TRIAL_LIMIT;
  let usagePlanId = 'dayflow_free';
  let usagePeriodStart: string | null = null;

  if (subscription && subscriptionLimit && subscription.current_period_start) {
    usesSubscription = true;
    usageLimit = subscriptionLimit;
    usagePlanId = subscription.plan_id;
    usagePeriodStart = subscription.current_period_start;
  }

  const { data: claimRows, error: claimError } = usesSubscription
    ? await admin.rpc('claim_ai_subscription_turn', {
      p_user_id: userData.user.id,
      p_request_id: requestId,
      p_plan_id: usagePlanId,
      p_period_start: usagePeriodStart,
      p_limit: usageLimit,
    })
    : await admin.rpc('claim_ai_trial_turn', {
      p_user_id: userData.user.id,
      p_request_id: requestId,
    });
  if (claimError) {
    console.error('AI usage claim failed:', claimError.message);
    return json(500, { code: 'AI_USAGE_CLAIM_FAILED', message: 'AI 사용량을 확인하지 못했습니다.' });
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.allowed) {
    return json(402, {
      code: usesSubscription ? 'AI_QUOTA_EXHAUSTED' : 'TRIAL_EXHAUSTED',
      message: usesSubscription
        ? `이번 이용기간의 AI 대화 ${usageLimit}회를 모두 사용했어요. 다음 이용기간에 다시 사용할 수 있습니다.`
        : `무료 AI 대화 ${TRIAL_LIMIT}회를 모두 사용했어요. 계속 이용하려면 Plus 또는 Pro를 구독해 주세요.`,
      remaining: 0,
      planId: usagePlanId,
    });
  }

  const releaseClaim = async () => {
    if (!claim?.claimed_new) return;
    const { error } = usesSubscription
      ? await admin.rpc('release_ai_subscription_turn', {
        p_user_id: userData.user.id,
        p_request_id: requestId,
        p_period_start: usagePeriodStart,
      })
      : await admin.rpc('release_ai_trial_turn', {
        p_user_id: userData.user.id,
        p_request_id: requestId,
      });
    if (error) console.error('AI usage claim release failed:', error.message);
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
      `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent`,
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
    console.error('Dayflow Gemini network request failed:', error);
    await releaseClaim();
    return json(502, {
      code: 'AI_PROVIDER_ERROR',
      message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  const responseBody = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    const upstreamMessage = readText((responseBody as { error?: { message?: unknown } })?.error?.message);
    console.error('Dayflow Gemini request failed:', geminiResponse.status, upstreamMessage);
    await releaseClaim();
    return json(502, {
      code: 'AI_PROVIDER_ERROR',
      message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  const candidate = (responseBody as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0];
  const text = candidate?.content?.parts?.map(part => part.text || '').join('') || '';

  if (!text.trim()) {
    await releaseClaim();
    return json(502, {
      code: 'AI_EMPTY_RESPONSE',
      message: 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }

  return json(200, {
    text,
    candidates: (responseBody as { candidates?: unknown }).candidates,
    usageMetadata: (responseBody as { usageMetadata?: unknown }).usageMetadata,
    remaining: Number(claim.remaining_count ?? 0),
    model: requestedModel,
    planId: usagePlanId,
    limit: usageLimit,
  });
});

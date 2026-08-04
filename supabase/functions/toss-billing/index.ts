import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { readBillingReadiness } from '../_shared/billing-config.ts';

const TOSS_API_BASE = 'https://api.tosspayments.com';
const PAID_PLANS = {
  dayflow_plus_monthly: {
    id: 'dayflow_plus_monthly',
    name: 'Dayflow Plus 월간 구독',
    amount: 4_900,
    currency: 'KRW',
    aiQuota: 100,
    billingCycle: 'monthly',
  },
  dayflow_pro_monthly: {
    id: 'dayflow_pro_monthly',
    name: 'Dayflow Pro 월간 구독',
    amount: 9_900,
    currency: 'KRW',
    aiQuota: 300,
    billingCycle: 'monthly',
  },
} as const;

type PaidPlanId = keyof typeof PAID_PLANS;

const getPaidPlan = (value: unknown) =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAID_PLANS, value)
    ? PAID_PLANS[value as PaidPlanId]
    : null;

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

const readTossError = async (response: Response): Promise<{ code: string; message: string }> => {
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : 'TOSS_REQUEST_FAILED',
      message: typeof body.message === 'string' ? body.message : '결제 요청을 처리하지 못했습니다.',
    };
  } catch {
    return { code: 'TOSS_REQUEST_FAILED', message: '결제 요청을 처리하지 못했습니다.' };
  }
};

const createOrderId = (): string => `dayflow-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const tossFetch = (input: string, init: RequestInit): Promise<Response> =>
  fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossClientKey = Deno.env.get('TOSS_CLIENT_KEY');
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY');
  const authorization = request.headers.get('Authorization') || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(503, { code: 'BILLING_NOT_CONFIGURED', message: '결제 서버 설정이 완료되지 않았습니다.' });
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

  const action = typeof body.action === 'string' ? body.action : '';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userId = userData.user.id;

  if (action === 'prepare') {
    const billingReadiness = readBillingReadiness({ requireClientKey: true, requireSecretKey: true });
    if (!billingReadiness.ready) return json(503, { code: billingReadiness.code, message: billingReadiness.message });
    const plan = getPaidPlan(body.planId);
    if (!plan) {
      return json(400, { code: 'INVALID_PLAN', message: '선택한 요금제를 확인하지 못했습니다.' });
    }

    const { data: existing, error: lookupError } = await admin
      .from('billing_customers')
      .select('customer_key')
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupError) {
      console.error('Billing customer lookup failed:', lookupError.message);
      return json(500, { code: 'BILLING_PREPARE_FAILED', message: '결제 준비 정보를 확인하지 못했습니다.' });
    }

    const customerKey = existing?.customer_key || `df_${crypto.randomUUID()}`;
    if (!existing) {
      const { error: insertError } = await admin.from('billing_customers').insert({
        user_id: userId,
        customer_key: customerKey,
      });
      if (insertError) {
        console.error('Billing customer creation failed:', insertError.message);
        return json(500, { code: 'BILLING_PREPARE_FAILED', message: '결제 준비 정보를 만들지 못했습니다.' });
      }
    }

    return json(200, {
      clientKey: tossClientKey,
      customerKey,
      customerEmail: userData.user.email || null,
      customerName: userData.user.user_metadata?.name || userData.user.user_metadata?.full_name || null,
      plan,
    });
  }

  if (action === 'status') {
    const { data, error } = await admin
      .from('billing_subscriptions')
      .select('plan_id,status,card_company,card_number_masked,current_period_start,current_period_end,next_billing_at,canceled_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('Subscription lookup failed:', error.message);
      return json(500, { code: 'SUBSCRIPTION_LOOKUP_FAILED', message: '구독 상태를 확인하지 못했습니다.' });
    }
    return json(200, { subscription: data || null, plans: Object.values(PAID_PLANS) });
  }

  if (action === 'confirm') {
    const billingReadiness = readBillingReadiness({ requireClientKey: true, requireSecretKey: true });
    if (!billingReadiness.ready) return json(503, { code: billingReadiness.code, message: billingReadiness.message });
    const authKey = typeof body.authKey === 'string' ? body.authKey : '';
    const customerKey = typeof body.customerKey === 'string' ? body.customerKey : '';
    const plan = getPaidPlan(body.planId);
    if (!authKey || !customerKey || !plan) {
      return json(400, { code: 'INVALID_BILLING_AUTH', message: '카드 등록 결과가 올바르지 않습니다.' });
    }

    const { data: customer, error: customerError } = await admin
      .from('billing_customers')
      .select('customer_key')
      .eq('user_id', userId)
      .eq('customer_key', customerKey)
      .maybeSingle();
    if (customerError || !customer) {
      return json(400, { code: 'CUSTOMER_KEY_MISMATCH', message: '결제 사용자 정보가 일치하지 않습니다.' });
    }

    const authKeyHash = await sha256(authKey);
    const { data: checkoutRows, error: checkoutError } = await admin.rpc('claim_billing_checkout', {
      p_user_id: userId,
      p_plan_id: plan.id,
      p_customer_key: customerKey,
      p_auth_key_hash: authKeyHash,
      p_toss_order_id: createOrderId(),
    });
    if (checkoutError) {
      console.error('Billing checkout claim failed:', checkoutError.message);
      return json(500, { code: 'BILLING_CHECKOUT_CLAIM_FAILED', message: '결제 요청을 안전하게 시작하지 못했습니다.' });
    }
    const checkout = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
    const claimStatus = String(checkout?.claim_status || '');
    if (claimStatus === 'SUBSCRIPTION_ACTIVE') return json(409, { code: 'SUBSCRIPTION_ALREADY_ACTIVE', message: '아직 이용기간이 남아 있는 유료 요금제가 있습니다.' });
    if (claimStatus === 'IN_PROGRESS') return json(409, { code: 'BILLING_IN_PROGRESS', message: '같은 결제를 처리 중입니다. 잠시 후 다시 확인해 주세요.' });
    if (claimStatus === 'FAILED') return json(409, { code: 'BILLING_AUTH_ALREADY_FAILED', message: '이 카드 등록 요청은 이미 실패했습니다. 결제수단 등록을 다시 시작해 주세요.' });
    if (claimStatus === 'MISMATCH') return json(400, { code: 'BILLING_AUTH_MISMATCH', message: '결제 승인 정보가 기존 요청과 일치하지 않습니다.' });
    if (claimStatus === 'COMPLETED') {
      const { data: currentSubscription } = await admin.from('billing_subscriptions')
        .select('plan_id,status,card_company,card_number_masked,current_period_start,current_period_end,next_billing_at,canceled_at')
        .eq('user_id', userId).maybeSingle();
      return json(200, { subscription: currentSubscription || null, orderId: checkout?.toss_order_id });
    }
    if (claimStatus !== 'CLAIMED' || !checkout?.attempt_id || !checkout?.toss_order_id) {
      return json(500, { code: 'BILLING_CHECKOUT_INVALID', message: '결제 처리 상태를 확인하지 못했습니다.' });
    }

    const failCheckout = async (code: string, message: string) => {
      const { error } = await admin.from('billing_checkout_attempts').update({
        status: 'failed', failure_code: code, failure_message: message,
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', checkout.attempt_id).eq('status', 'processing');
      if (error) console.error('Billing checkout failure storage failed:', error.message);
    };
    const basicAuth = `Basic ${btoa(`${tossSecretKey}:`)}`;
    let issueResponse: Response;
    try {
      issueResponse = await tossFetch(`${TOSS_API_BASE}/v1/billing/authorizations/issue`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json',
        'Idempotency-Key': String(checkout.issue_idempotency_key),
      },
      body: JSON.stringify({ authKey, customerKey }),
      });
    } catch {
      return json(502, { code: 'TOSS_NETWORK_ERROR', message: '결제사 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (!issueResponse.ok) {
      const issueError = await readTossError(issueResponse);
      await failCheckout(issueError.code, issueError.message);
      console.error('Toss billing key issue failed:', issueError.code, issueError.message);
      return json(issueResponse.status, issueError);
    }

    const billing = await issueResponse.json() as {
      billingKey?: string;
      card?: { issuerCode?: string; number?: string; company?: string };
    };
    if (!billing.billingKey) {
      await failCheckout('BILLING_KEY_MISSING', '결제수단 등록 결과에 빌링키가 없습니다.');
      return json(502, { code: 'BILLING_KEY_MISSING', message: '결제수단 등록 결과를 확인하지 못했습니다.' });
    }

    const orderId = String(checkout.toss_order_id);
    let paymentResponse: Response;
    try {
      paymentResponse = await tossFetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(billing.billingKey)}`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json',
        'Idempotency-Key': String(checkout.payment_idempotency_key),
      },
      body: JSON.stringify({
        customerKey,
        amount: plan.amount,
        orderId,
        orderName: plan.name,
        customerEmail: userData.user.email || undefined,
        customerName: userData.user.user_metadata?.name || userData.user.user_metadata?.full_name || undefined,
      }),
      });
    } catch {
      return json(502, { code: 'TOSS_NETWORK_ERROR', message: '결제사 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (!paymentResponse.ok) {
      const paymentError = await readTossError(paymentResponse);
      await failCheckout(paymentError.code, paymentError.message);
      console.error('Toss first billing payment failed:', paymentError.code, paymentError.message);
      return json(paymentResponse.status, paymentError);
    }

    const payment = await paymentResponse.json() as { paymentKey?: string; status?: string; approvedAt?: string; orderId?: string; totalAmount?: number };
    if (!payment.paymentKey || payment.status !== 'DONE' || (payment.orderId && payment.orderId !== orderId) || (payment.totalAmount != null && payment.totalAmount !== plan.amount)) {
      console.error('Toss first billing response validation failed:', payment.status, payment.orderId, payment.totalAmount);
      return json(502, { code: 'INVALID_PAYMENT_RESULT', message: '결제 승인 결과를 자동 반영하지 못했습니다. 고객지원에 문의해 주세요.' });
    }
    const periodStart = payment.approvedAt || new Date().toISOString();
    const cardCompany = billing.card?.company || billing.card?.issuerCode || null;
    const cardNumberMasked = billing.card?.number || null;
    const { data: completionRows, error: completionError } = await admin.rpc('complete_billing_checkout', {
      p_attempt_id: checkout.attempt_id,
      p_billing_key: billing.billingKey,
      p_payment_key: payment.paymentKey,
      p_payment_status: payment.status,
      p_approved_at: periodStart,
      p_card_company: cardCompany,
      p_card_number_masked: cardNumberMasked,
    });
    if (completionError) {
      console.error('Subscription atomic storage failed:', completionError.message);
      return json(500, { code: 'SUBSCRIPTION_STORAGE_FAILED', message: '결제는 승인되었지만 구독 정보를 저장하지 못했습니다. 고객지원에 문의해 주세요.' });
    }
    const completion = Array.isArray(completionRows) ? completionRows[0] : completionRows;

    return json(200, {
      subscription: {
        plan_id: completion?.plan_id || plan.id,
        status: 'active',
        card_company: cardCompany,
        card_number_masked: cardNumberMasked,
        current_period_start: completion?.current_period_start || periodStart,
        current_period_end: completion?.current_period_end,
        next_billing_at: completion?.current_period_end,
        canceled_at: null,
      },
      orderId,
    });
  }

  if (action === 'cancel') {
    if (!tossSecretKey) return json(503, { code: 'BILLING_NOT_CONFIGURED', message: '결제 서버 키가 설정되지 않았습니다.' });
    const { data: subscription, error: lookupError } = await admin
      .from('billing_subscriptions')
      .select('billing_key,status')
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupError || !subscription) {
      return json(404, { code: 'SUBSCRIPTION_NOT_FOUND', message: '해지할 구독을 찾지 못했습니다.' });
    }
    if (subscription.status === 'canceled') return json(200, { canceled: true });

    const deleteResponse = await tossFetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(subscription.billing_key)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${btoa(`${tossSecretKey}:`)}` },
    });
    if (!deleteResponse.ok) {
      const deleteError = await readTossError(deleteResponse);
      console.error('Toss billing key deletion failed:', deleteError.code, deleteError.message);
      return json(deleteResponse.status, deleteError);
    }

    const canceledAt = new Date().toISOString();
    const { error: updateError } = await admin.from('billing_subscriptions').update({
      status: 'canceled',
      next_billing_at: null,
      canceled_at: canceledAt,
      updated_at: canceledAt,
    }).eq('user_id', userId);
    if (updateError) {
      console.error('Subscription cancellation storage failed:', updateError.message);
      return json(500, { code: 'CANCEL_STORAGE_FAILED', message: '결제수단은 해지되었지만 구독 상태를 저장하지 못했습니다. 고객지원에 문의해 주세요.' });
    }
    return json(200, { canceled: true, canceledAt });
  }

  return json(400, { code: 'UNKNOWN_ACTION', message: '지원하지 않는 결제 요청입니다.' });
});

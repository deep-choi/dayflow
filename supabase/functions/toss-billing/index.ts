import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TOSS_API_BASE = 'https://api.tosspayments.com';
const PLAN = {
  id: 'dayflow_pro_monthly',
  name: 'Dayflow Pro 월간 구독',
  amount: 9_900,
  currency: 'KRW',
  aiQuota: 300,
  billingCycle: 'monthly',
} as const;

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

const addOneMonth = (date: Date): Date => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
};

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossClientKey = Deno.env.get('TOSS_CLIENT_KEY');
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY');
  const authorization = request.headers.get('Authorization') || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !tossClientKey || !tossSecretKey) {
    return json(503, { code: 'BILLING_NOT_CONFIGURED', message: '결제 테스트 키가 아직 설정되지 않았습니다.' });
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
      plan: PLAN,
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
    return json(200, { subscription: data || null, plan: PLAN });
  }

  if (action === 'confirm') {
    const authKey = typeof body.authKey === 'string' ? body.authKey : '';
    const customerKey = typeof body.customerKey === 'string' ? body.customerKey : '';
    const planId = typeof body.planId === 'string' ? body.planId : '';
    if (!authKey || !customerKey || planId !== PLAN.id) {
      return json(400, { code: 'INVALID_BILLING_AUTH', message: '카드 등록 결과가 올바르지 않습니다.' });
    }

    // 리다이렉트 재시도나 새로고침으로 첫 결제가 중복 승인되지 않도록 서버에서 막습니다.
    const { data: activeSubscription, error: activeLookupError } = await admin
      .from('billing_subscriptions')
      .select('status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (activeLookupError) {
      console.error('Active subscription lookup failed:', activeLookupError.message);
      return json(500, { code: 'SUBSCRIPTION_LOOKUP_FAILED', message: '기존 구독 상태를 확인하지 못했습니다.' });
    }
    if (activeSubscription) {
      return json(409, { code: 'SUBSCRIPTION_ALREADY_ACTIVE', message: '이미 이용 중인 Dayflow Pro 구독이 있습니다.' });
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

    const basicAuth = `Basic ${btoa(`${tossSecretKey}:`)}`;
    const issueResponse = await fetch(`${TOSS_API_BASE}/v1/billing/authorizations/issue`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ authKey, customerKey }),
    });
    if (!issueResponse.ok) {
      const issueError = await readTossError(issueResponse);
      console.error('Toss billing key issue failed:', issueError.code, issueError.message);
      return json(issueResponse.status, issueError);
    }

    const billing = await issueResponse.json() as {
      billingKey?: string;
      card?: { issuerCode?: string; number?: string; company?: string };
    };
    if (!billing.billingKey) {
      return json(502, { code: 'BILLING_KEY_MISSING', message: '결제수단 등록 결과를 확인하지 못했습니다.' });
    }

    const orderId = createOrderId();
    const paymentResponse = await fetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(billing.billingKey)}`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        customerKey,
        amount: PLAN.amount,
        orderId,
        orderName: PLAN.name,
        customerEmail: userData.user.email || undefined,
        customerName: userData.user.user_metadata?.name || userData.user.user_metadata?.full_name || undefined,
      }),
    });
    if (!paymentResponse.ok) {
      const paymentError = await readTossError(paymentResponse);
      await admin.from('billing_payments').insert({
        user_id: userId,
        toss_order_id: orderId,
        plan_id: PLAN.id,
        amount: PLAN.amount,
        status: 'FAILED',
        failure_code: paymentError.code,
        failure_message: paymentError.message,
      });
      console.error('Toss first billing payment failed:', paymentError.code, paymentError.message);
      return json(paymentResponse.status, paymentError);
    }

    const payment = await paymentResponse.json() as { paymentKey?: string; status?: string; approvedAt?: string };
    const periodStart = payment.approvedAt ? new Date(payment.approvedAt) : new Date();
    const periodEnd = addOneMonth(periodStart);
    const cardCompany = billing.card?.company || billing.card?.issuerCode || null;
    const cardNumberMasked = billing.card?.number || null;

    const { data: subscription, error: subscriptionError } = await admin
      .from('billing_subscriptions')
      .upsert({
        user_id: userId,
        plan_id: PLAN.id,
        status: 'active',
        billing_key: billing.billingKey,
        card_company: cardCompany,
        card_number_masked: cardNumberMasked,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        next_billing_at: periodEnd.toISOString(),
        canceled_at: null,
        last_payment_key: payment.paymentKey || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (subscriptionError || !subscription) {
      console.error('Subscription storage failed:', subscriptionError?.message);
      return json(500, { code: 'SUBSCRIPTION_STORAGE_FAILED', message: '결제는 승인되었지만 구독 정보를 저장하지 못했습니다. 고객지원에 문의해 주세요.' });
    }

    const { error: paymentStorageError } = await admin.from('billing_payments').insert({
      user_id: userId,
      subscription_id: subscription.id,
      toss_order_id: orderId,
      payment_key: payment.paymentKey || null,
      plan_id: PLAN.id,
      amount: PLAN.amount,
      status: payment.status || 'DONE',
      approved_at: periodStart.toISOString(),
    });
    if (paymentStorageError) console.error('Payment storage failed:', paymentStorageError.message);

    return json(200, {
      subscription: {
        plan_id: PLAN.id,
        status: 'active',
        card_company: cardCompany,
        card_number_masked: cardNumberMasked,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        next_billing_at: periodEnd.toISOString(),
        canceled_at: null,
      },
      orderId,
    });
  }

  if (action === 'cancel') {
    const { data: subscription, error: lookupError } = await admin
      .from('billing_subscriptions')
      .select('billing_key,status')
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupError || !subscription) {
      return json(404, { code: 'SUBSCRIPTION_NOT_FOUND', message: '해지할 구독을 찾지 못했습니다.' });
    }
    if (subscription.status === 'canceled') return json(200, { canceled: true });

    const deleteResponse = await fetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(subscription.billing_key)}`, {
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

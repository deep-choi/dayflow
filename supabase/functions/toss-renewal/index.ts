import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { readBillingReadiness } from '../_shared/billing-config.ts';

const TOSS_API_BASE = 'https://api.tosspayments.com';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const PLANS: Record<string, { name: string; amount: number }> = {
  dayflow_plus_monthly: { name: 'Dayflow Plus 월간 구독', amount: 4_900 },
  dayflow_pro_monthly: { name: 'Dayflow Pro 월간 구독', amount: 9_900 },
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const readTossError = async (response: Response): Promise<{ code: string; message: string }> => {
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : 'TOSS_REQUEST_FAILED',
      message: typeof body.message === 'string' ? body.message : '자동결제를 처리하지 못했습니다.',
    };
  } catch {
    return { code: 'TOSS_REQUEST_FAILED', message: '자동결제를 처리하지 못했습니다.' };
  }
};

const compactId = (value: string): string => value.replace(/-/g, '').slice(0, 20);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY');
  const cronSecret = Deno.env.get('BILLING_CRON_SECRET');
  const suppliedSecret = request.headers.get('x-dayflow-cron-secret') || '';
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return json(503, { code: 'RENEWAL_NOT_CONFIGURED', message: '정기결제 실행 환경이 설정되지 않았습니다.' });
  }
  if (!suppliedSecret || suppliedSecret !== cronSecret) {
    return json(401, { code: 'INVALID_CRON_SECRET', message: '정기결제 실행 권한이 없습니다.' });
  }
  const billingReadiness = readBillingReadiness({ requireSecretKey: true });
  if (!billingReadiness.ready || !tossSecretKey) {
    return json(503, { code: billingReadiness.code, message: billingReadiness.message });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const { data: dueSubscriptions, error: dueError } = await admin
    .from('billing_subscriptions')
    .select('id,user_id,plan_id,billing_key,status,current_period_end,next_billing_at,retry_count,grace_period_end')
    .in('status', ['active', 'past_due'])
    .not('next_billing_at', 'is', null)
    .lte('next_billing_at', now.toISOString())
    .order('next_billing_at', { ascending: true })
    .limit(100);
  if (dueError) return json(500, { code: 'RENEWAL_LOOKUP_FAILED', message: dueError.message });

  const results: Array<Record<string, unknown>> = [];
  for (const subscription of dueSubscriptions || []) {
    const plan = PLANS[subscription.plan_id];
    const scheduledAt = subscription.next_billing_at as string;
    const attemptNumber = Math.max(1, Number(subscription.retry_count || 0) + 1);
    const orderId = `df-renew-${compactId(subscription.id)}-${new Date(scheduledAt).getTime()}`.slice(0, 64);
    const idempotencyKey = `dayflow-renewal-${subscription.id}-${scheduledAt}`;
    if (!plan) {
      await admin.from('billing_subscriptions').update({
        status: 'past_due', next_billing_at: null, last_billing_error: 'UNKNOWN_PLAN', updated_at: now.toISOString(),
      }).eq('id', subscription.id);
      results.push({ subscriptionId: subscription.id, status: 'failed', code: 'UNKNOWN_PLAN' });
      continue;
    }

    let attempt: { id: string } | null = null;
    const { data: insertedAttempt, error: claimError } = await admin.from('billing_attempts').insert({
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      scheduled_at: scheduledAt,
      attempt_number: attemptNumber,
      idempotency_key: idempotencyKey,
      toss_order_id: orderId,
      amount: plan.amount,
      status: 'processing',
      locked_at: new Date().toISOString(),
    }).select('id').maybeSingle();
    attempt = insertedAttempt;
    if (claimError?.code === '23505') {
      const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: reclaimedAttempt, error: reclaimError } = await admin.from('billing_attempts')
        .update({ locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('idempotency_key', idempotencyKey)
        .eq('status', 'processing')
        .lt('locked_at', staleBefore)
        .select('id')
        .maybeSingle();
      if (reclaimError) console.error('Renewal reclaim failed:', reclaimError.message);
      attempt = reclaimedAttempt;
    } else if (claimError) {
      console.error('Renewal claim failed:', claimError.message);
    }
    if (!attempt) {
      results.push({ subscriptionId: subscription.id, status: 'skipped', code: claimError?.code || 'ALREADY_CLAIMED' });
      continue;
    }

    const { data: customer, error: customerError } = await admin
      .from('billing_customers')
      .select('customer_key')
      .eq('user_id', subscription.user_id)
      .maybeSingle();
    if (customerError || !customer) {
      const { error: failureError } = await admin.rpc('fail_billing_renewal', {
        p_attempt_id: attempt.id,
        p_failure_code: 'CUSTOMER_NOT_FOUND',
        p_failure_message: '결제 고객 키가 없습니다.',
        p_next_retry_at: null,
        p_grace_period_end: subscription.grace_period_end || new Date(now.getTime() + GRACE_PERIOD_MS).toISOString(),
      });
      if (failureError) console.error('Renewal failure storage failed:', failureError.message);
      results.push({ subscriptionId: subscription.id, status: 'failed', code: 'CUSTOMER_NOT_FOUND' });
      continue;
    }

    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(subscription.billing_key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${tossSecretKey}:`)}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          customerKey: customer.customer_key,
          amount: plan.amount,
          orderId,
          orderName: plan.name,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.error('Renewal payment network state is ambiguous:', error);
      results.push({ subscriptionId: subscription.id, status: 'skipped', code: 'NETWORK_STATE_UNKNOWN' });
      continue;
    }

    if (!paymentResponse.ok) {
      const tossError = await readTossError(paymentResponse);
      const nextRetryAt = attemptNumber < MAX_ATTEMPTS ? new Date(now.getTime() + RETRY_DELAY_MS).toISOString() : null;
      const graceEnd = subscription.grace_period_end || new Date(now.getTime() + GRACE_PERIOD_MS).toISOString();
      const { error: failureError } = await admin.rpc('fail_billing_renewal', {
        p_attempt_id: attempt.id,
        p_failure_code: tossError.code,
        p_failure_message: tossError.message,
        p_next_retry_at: nextRetryAt,
        p_grace_period_end: graceEnd,
      });
      if (failureError) {
        console.error('Renewal failure storage failed:', failureError.message);
        results.push({ subscriptionId: subscription.id, status: 'skipped', code: 'FAILURE_STORAGE_FAILED' });
        continue;
      }
      results.push({ subscriptionId: subscription.id, status: 'failed', code: tossError.code, nextRetryAt });
      continue;
    }

    const payment = await paymentResponse.json() as { paymentKey?: string; status?: string; approvedAt?: string; orderId?: string; totalAmount?: number };
    if (!payment.paymentKey || payment.status !== 'DONE' || (payment.orderId && payment.orderId !== orderId) || (payment.totalAmount != null && payment.totalAmount !== plan.amount)) {
      console.error('Renewal response validation failed:', payment.status, payment.orderId, payment.totalAmount);
      results.push({ subscriptionId: subscription.id, status: 'skipped', code: 'INVALID_PAYMENT_RESULT' });
      continue;
    }
    const { error: completionError } = await admin.rpc('complete_billing_renewal', {
      p_attempt_id: attempt.id,
      p_payment_key: payment.paymentKey,
      p_payment_status: payment.status,
      p_approved_at: payment.approvedAt || new Date().toISOString(),
    });
    if (completionError) {
      console.error('Renewal atomic storage failed:', completionError.message);
      results.push({ subscriptionId: subscription.id, status: 'skipped', code: 'SUCCESS_STORAGE_FAILED' });
      continue;
    }
    results.push({ subscriptionId: subscription.id, status: 'succeeded', orderId });
  }

  return json(200, {
    processedAt: new Date().toISOString(),
    due: dueSubscriptions?.length || 0,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    results,
  });
});

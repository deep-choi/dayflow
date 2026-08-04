import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TOSS_API_BASE = 'https://api.tosspayments.com';

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const textValue = (value: unknown): string => typeof value === 'string' ? value : '';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY');
  const webhookToken = Deno.env.get('TOSS_WEBHOOK_TOKEN');
  const suppliedToken = new URL(request.url).searchParams.get('token') || '';
  if (!supabaseUrl || !serviceRoleKey || !tossSecretKey || !webhookToken) {
    return json(503, { code: 'WEBHOOK_NOT_CONFIGURED', message: '결제 웹훅 환경이 설정되지 않았습니다.' });
  }
  if (!suppliedToken || suppliedToken !== webhookToken) {
    return json(401, { code: 'INVALID_WEBHOOK_TOKEN', message: '웹훅 인증에 실패했습니다.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json(400, { code: 'INVALID_BODY', message: '웹훅 본문이 올바르지 않습니다.' });
  }

  const eventType = textValue(payload.eventType) || 'PAYMENT_STATUS_CHANGED';
  const nestedData = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : payload;
  const orderId = textValue(nestedData.orderId) || textValue(payload.orderId);
  const paymentKey = textValue(nestedData.paymentKey) || textValue(payload.paymentKey);
  const billingKey = textValue(payload.billingKey) || textValue(nestedData.billingKey);
  const createdAt = textValue(payload.createdAt) || new Date().toISOString();
  const identity = orderId || paymentKey || billingKey || crypto.randomUUID();
  const eventKey = `${eventType}:${identity}:${createdAt}`.slice(0, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: eventRow, error: insertError } = await admin.from('billing_events').insert({
    event_key: eventKey,
    event_type: eventType,
    toss_order_id: orderId || null,
    payment_key: paymentKey || null,
    billing_key: billingKey || null,
    payload,
  }).select('id').maybeSingle();
  if (insertError?.code === '23505') return json(200, { ok: true, duplicate: true });
  if (insertError || !eventRow) return json(500, { code: 'WEBHOOK_STORAGE_FAILED', message: '웹훅을 저장하지 못했습니다.' });

  const finish = async (status: 'processed' | 'ignored' | 'failed', errorMessage?: string) => {
    await admin.from('billing_events').update({
      processing_status: status,
      error_message: errorMessage || null,
      processed_at: new Date().toISOString(),
    }).eq('id', eventRow.id);
  };

  try {
    if (eventType === 'BILLING_DELETED' && billingKey) {
      const { data: subscription, error } = await admin
        .from('billing_subscriptions')
        .select('id,user_id,status')
        .eq('billing_key', billingKey)
        .maybeSingle();
      if (error) throw error;
      if (!subscription) {
        await finish('ignored');
        return json(200, { ok: true, ignored: true });
      }
      const canceledAt = new Date().toISOString();
      const { error: updateError } = await admin.from('billing_subscriptions').update({
        status: 'canceled', next_billing_at: null, canceled_at: canceledAt, updated_at: canceledAt,
      }).eq('id', subscription.id);
      if (updateError) throw updateError;
      await admin.from('admin_audit_logs').insert({
        admin_user_id: null,
        action: 'subscription.billing_key_deleted',
        target_type: 'subscription',
        target_id: subscription.id,
        reason: textValue(payload.reason) || '토스페이먼츠 웹훅',
        metadata: { userId: subscription.user_id },
      });
      await finish('processed');
      return json(200, { ok: true });
    }

    if ((eventType === 'PAYMENT_STATUS_CHANGED' || orderId || paymentKey) && (orderId || paymentKey)) {
      const lookupUrl = paymentKey
        ? `${TOSS_API_BASE}/v1/payments/${encodeURIComponent(paymentKey)}`
        : `${TOSS_API_BASE}/v1/payments/orders/${encodeURIComponent(orderId)}`;
      const response = await fetch(lookupUrl, {
        headers: { Authorization: `Basic ${btoa(`${tossSecretKey}:`)}` },
      });
      if (!response.ok) throw new Error(`토스 결제 조회 실패: ${response.status}`);
      const payment = await response.json() as {
        paymentKey?: string;
        orderId?: string;
        status?: string;
        approvedAt?: string;
      };
      const verifiedOrderId = payment.orderId || orderId;
      const { data: storedPayment, error } = await admin
        .from('billing_payments')
        .select('id,user_id,status')
        .eq('toss_order_id', verifiedOrderId)
        .maybeSingle();
      if (error) throw error;
      if (!storedPayment) {
        await finish('ignored');
        return json(200, { ok: true, ignored: true });
      }
      const { error: updateError } = await admin.from('billing_payments').update({
        payment_key: payment.paymentKey || paymentKey || null,
        status: payment.status || storedPayment.status,
        approved_at: payment.approvedAt || null,
      }).eq('id', storedPayment.id);
      if (updateError) throw updateError;
      await finish('processed');
      return json(200, { ok: true });
    }

    await finish('ignored');
    return json(200, { ok: true, ignored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '웹훅 처리 실패';
    console.error('Toss webhook processing failed:', error);
    await finish('failed', message);
    return json(500, { code: 'WEBHOOK_PROCESSING_FAILED', message });
  }
});

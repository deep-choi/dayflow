import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TOSS_API_BASE = 'https://api.tosspayments.com';

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

const isAdminUser = (metadata: Record<string, unknown> | undefined): boolean =>
  metadata?.role === 'admin' || metadata?.is_admin === true;

const readTossError = async (response: Response): Promise<{ code: string; message: string }> => {
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : 'TOSS_REQUEST_FAILED',
      message: typeof body.message === 'string' ? body.message : '토스페이먼츠 요청을 처리하지 못했습니다.',
    };
  } catch {
    return { code: 'TOSS_REQUEST_FAILED', message: '토스페이먼츠 요청을 처리하지 못했습니다.' };
  }
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY');
  const authorization = request.headers.get('Authorization') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { code: 'ADMIN_NOT_CONFIGURED', message: '관리자 API 설정이 완료되지 않았습니다.' });
  }
  if (!authorization.startsWith('Bearer ')) return json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(401, { code: 'UNAUTHORIZED', message: '로그인 정보를 확인하지 못했습니다.' });
  if (!isAdminUser(authData.user.app_metadata as Record<string, unknown> | undefined)) {
    return json(403, { code: 'ADMIN_REQUIRED', message: '관리자 권한이 필요합니다.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { code: 'INVALID_BODY', message: '요청 형식이 올바르지 않습니다.' });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!action || !targetId) return json(400, { code: 'INVALID_OPERATION', message: '작업 대상과 종류를 확인해 주세요.' });
  if (action !== 'add_note' && action !== 'support_reply' && reason.length < 2) {
    return json(400, { code: 'REASON_REQUIRED', message: '운영 조치 사유를 2자 이상 입력해 주세요.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const writeAudit = async (auditAction: string, targetType: string, id: string, metadata: Record<string, unknown> = {}) => {
    const { error } = await admin.from('admin_audit_logs').insert({
      admin_user_id: authData.user.id,
      action: auditAction,
      target_type: targetType,
      target_id: id,
      reason: reason || null,
      metadata,
    });
    if (error) throw new Error(`감사 기록 저장 실패: ${error.message}`);
  };

  try {
    if (action === 'add_note') {
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > 2000) return json(400, { code: 'INVALID_NOTE', message: '메모는 1자 이상 2,000자 이하로 입력해 주세요.' });
      const { data, error } = await admin.from('admin_notes').insert({
        user_id: targetId,
        admin_user_id: authData.user.id,
        note,
      }).select('id,user_id,admin_user_id,note,created_at').single();
      if (error) throw error;
      await writeAudit('member.note.created', 'user', targetId, { noteId: data.id });
      return json(200, { ok: true, note: data });
    }

    if (action === 'support_reply') {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 5000) return json(400, { code: 'INVALID_REPLY', message: '답변은 1자 이상 5,000자 이하로 입력해 주세요.' });
      const { data: ticket, error: ticketError } = await admin.from('support_tickets').select('id,user_id,status').eq('id', targetId).maybeSingle();
      if (ticketError || !ticket) return json(404, { code: 'TICKET_NOT_FOUND', message: '문의를 찾지 못했습니다.' });
      const { error: messageError } = await admin.from('support_messages').insert({
        ticket_id: ticket.id, sender_user_id: authData.user.id, sender_role: 'admin', message,
      });
      if (messageError) throw messageError;
      const updatedAt = new Date().toISOString();
      await admin.from('support_tickets').update({ status: 'in_progress', assigned_admin_id: authData.user.id, updated_at: updatedAt }).eq('id', ticket.id);
      await writeAudit('support.replied', 'support_ticket', ticket.id, { userId: ticket.user_id });
      return json(200, { ok: true });
    }

    if (action === 'support_status') {
      const status = typeof body.status === 'string' ? body.status : '';
      if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) return json(400, { code: 'INVALID_STATUS', message: '문의 처리 상태를 확인해 주세요.' });
      const nowIso = new Date().toISOString();
      const { data: ticket, error } = await admin.from('support_tickets').update({
        status,
        assigned_admin_id: authData.user.id,
        updated_at: nowIso,
        resolved_at: status === 'resolved' || status === 'closed' ? nowIso : null,
      }).eq('id', targetId).select('id,user_id').maybeSingle();
      if (error || !ticket) return json(404, { code: 'TICKET_NOT_FOUND', message: '문의를 찾지 못했습니다.' });
      await writeAudit('support.status_changed', 'support_ticket', ticket.id, { userId: ticket.user_id, status });
      return json(200, { ok: true });
    }

    if (action === 'suspend_user' || action === 'restore_user') {
      if (targetId === authData.user.id) {
        return json(400, { code: 'SELF_OPERATION_BLOCKED', message: '현재 로그인한 관리자 계정에는 이 작업을 수행할 수 없습니다.' });
      }
      const banDuration = action === 'suspend_user' ? '876000h' : 'none';
      const { data, error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
      if (error || !data.user) throw error || new Error('회원 상태를 변경하지 못했습니다.');
      const bannedUntil = (data.user as typeof data.user & { banned_until?: string | null }).banned_until || null;
      await writeAudit(
        action === 'suspend_user' ? 'member.suspended' : 'member.restored',
        'user',
        targetId,
        { bannedUntil },
      );
      return json(200, { ok: true, bannedUntil });
    }

    if (action === 'cancel_subscription') {
      if (!tossSecretKey) return json(503, { code: 'BILLING_NOT_CONFIGURED', message: '결제 서버 키가 설정되지 않았습니다.' });
      const { data: subscription, error } = await admin
        .from('billing_subscriptions')
        .select('id,user_id,billing_key,status,current_period_end')
        .eq('id', targetId)
        .maybeSingle();
      if (error || !subscription) return json(404, { code: 'SUBSCRIPTION_NOT_FOUND', message: '구독을 찾지 못했습니다.' });
      if (subscription.status !== 'canceled') {
        const response = await fetch(`${TOSS_API_BASE}/v1/billing/${encodeURIComponent(subscription.billing_key)}`, {
          method: 'DELETE',
          headers: { Authorization: `Basic ${btoa(`${tossSecretKey}:`)}` },
        });
        if (!response.ok) {
          const tossError = await readTossError(response);
          return json(response.status, tossError);
        }
        const canceledAt = new Date().toISOString();
        const { error: updateError } = await admin.from('billing_subscriptions').update({
          status: 'canceled',
          next_billing_at: null,
          canceled_at: canceledAt,
          updated_at: canceledAt,
        }).eq('id', subscription.id);
        if (updateError) throw updateError;
      }
      await writeAudit('subscription.canceled', 'subscription', subscription.id, {
        userId: subscription.user_id,
        currentPeriodEnd: subscription.current_period_end,
      });
      return json(200, { ok: true });
    }

    if (action === 'refund_payment') {
      if (!tossSecretKey) return json(503, { code: 'BILLING_NOT_CONFIGURED', message: '결제 서버 키가 설정되지 않았습니다.' });
      const requestedAmount = Math.floor(Number(body.amount));
      const { data: payment, error } = await admin
        .from('billing_payments')
        .select('id,user_id,payment_key,amount,status')
        .eq('id', targetId)
        .maybeSingle();
      if (error || !payment || !payment.payment_key) return json(404, { code: 'PAYMENT_NOT_FOUND', message: '환불 가능한 결제를 찾지 못했습니다.' });
      const { data: priorRefunds, error: refundLookupError } = await admin
        .from('billing_refunds')
        .select('amount,status')
        .eq('payment_id', payment.id);
      if (refundLookupError) throw refundLookupError;
      const refunded = (priorRefunds || []).filter((item) => item.status === 'DONE').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const refundable = Math.max(0, Number(payment.amount || 0) - refunded);
      const amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : refundable;
      if (amount <= 0 || amount > refundable) return json(400, { code: 'INVALID_REFUND_AMOUNT', message: '환불 가능 금액을 확인해 주세요.' });

      const response = await fetch(`${TOSS_API_BASE}/v1/payments/${encodeURIComponent(payment.payment_key)}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${tossSecretKey}:`)}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ cancelReason: reason, ...(amount < Number(payment.amount) ? { cancelAmount: amount } : {}) }),
      });
      if (!response.ok) {
        const tossError = await readTossError(response);
        return json(response.status, tossError);
      }
      const canceledPayment = await response.json() as {
        status?: string;
        cancels?: Array<{ transactionKey?: string; cancelAmount?: number }>;
      };
      const latestCancel = canceledPayment.cancels?.[canceledPayment.cancels.length - 1];
      const { error: insertError } = await admin.from('billing_refunds').insert({
        payment_id: payment.id,
        user_id: payment.user_id,
        admin_user_id: authData.user.id,
        amount,
        reason,
        status: 'DONE',
        toss_transaction_key: latestCancel?.transactionKey || null,
      });
      if (insertError) throw insertError;
      const nextStatus = amount === refundable ? 'CANCELED' : 'PARTIAL_CANCELED';
      const { error: paymentUpdateError } = await admin.from('billing_payments').update({ status: nextStatus }).eq('id', payment.id);
      if (paymentUpdateError) throw paymentUpdateError;
      await writeAudit('payment.refunded', 'payment', payment.id, { userId: payment.user_id, amount, status: nextStatus });
      return json(200, { ok: true, amount, status: nextStatus });
    }

    return json(400, { code: 'UNKNOWN_ACTION', message: '지원하지 않는 관리자 작업입니다.' });
  } catch (error) {
    console.error('Admin operation failed:', error);
    return json(500, { code: 'ADMIN_OPERATION_FAILED', message: error instanceof Error ? error.message : '관리자 작업을 처리하지 못했습니다.' });
  }
});

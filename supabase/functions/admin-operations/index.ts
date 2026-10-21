import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TOSS_API_BASE = 'https://api.tosspayments.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
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
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetId);
      if (targetError || !target.user) return json(404, { code: 'USER_NOT_FOUND', message: '사용자를 찾지 못했습니다.' });
      if (isAdminUser(target.user.app_metadata)) return json(400, { code: 'ADMIN_PROTECTED', message: '관리자 계정은 이용 제한할 수 없습니다.' });
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
      const operationId = typeof body.operationId === 'string' ? body.operationId : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        return json(400, { code: 'INVALID_OPERATION_ID', message: '환불 작업 식별자가 올바르지 않습니다.' });
      }
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return json(400, { code: 'INVALID_REFUND_AMOUNT', message: '환불 가능 금액을 확인해 주세요.' });
      }
      const { data: claimRows, error: claimError } = await admin.rpc('claim_billing_refund', {
        p_payment_id: targetId,
        p_admin_user_id: authData.user.id,
        p_operation_key: operationId,
        p_amount: requestedAmount,
        p_reason: reason,
      });
      if (claimError) throw claimError;
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      const claimStatus = String(claim?.claim_status || '');
      if (claimStatus === 'PAYMENT_NOT_FOUND') return json(404, { code: 'PAYMENT_NOT_FOUND', message: '환불 가능한 결제를 찾지 못했습니다.' });
      if (claimStatus === 'INVALID_AMOUNT') return json(400, { code: 'INVALID_REFUND_AMOUNT', message: '환불 가능 금액을 확인해 주세요.' });
      if (claimStatus === 'IN_PROGRESS') return json(409, { code: 'REFUND_IN_PROGRESS', message: '같은 환불 요청을 처리 중입니다.' });
      if (claimStatus === 'FAILED') return json(409, { code: 'REFUND_ALREADY_FAILED', message: '이 환불 요청은 실패했습니다. 창을 닫고 새 환불 요청을 시작해 주세요.' });
      if (claimStatus === 'COMPLETED') return json(200, { ok: true, amount: requestedAmount, status: 'COMPLETED' });
      if (claimStatus !== 'CLAIMED' || !claim?.refund_id || !claim?.payment_key || !claim?.idempotency_key) {
        throw new Error('환불 처리 상태를 확인하지 못했습니다.');
      }

      let response: Response;
      try {
        response = await fetch(`${TOSS_API_BASE}/v1/payments/${encodeURIComponent(claim.payment_key)}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`${tossSecretKey}:`)}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': String(claim.idempotency_key),
          },
          body: JSON.stringify({ cancelReason: reason, ...(requestedAmount < Number(claim.payment_amount) ? { cancelAmount: requestedAmount } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return json(502, { code: 'TOSS_NETWORK_ERROR', message: '환불 결과를 확인 중입니다. 잠시 후 같은 작업에서 다시 시도해 주세요.' });
      }
      if (!response.ok) {
        const tossError = await readTossError(response);
        await admin.from('billing_refunds').update({
          status: 'FAILED', failure_code: tossError.code, failure_message: tossError.message, updated_at: new Date().toISOString(),
        }).eq('id', claim.refund_id).eq('status', 'processing');
        return json(response.status, tossError);
      }
      const canceledPayment = await response.json() as {
        status?: string;
        cancels?: Array<{ transactionKey?: string; cancelAmount?: number }>;
      };
      const latestCancel = canceledPayment.cancels?.[canceledPayment.cancels.length - 1];
      const { data: completionRows, error: completionError } = await admin.rpc('complete_billing_refund', {
        p_refund_id: claim.refund_id,
        p_toss_transaction_key: latestCancel?.transactionKey || null,
      });
      if (completionError) throw completionError;
      const completion = Array.isArray(completionRows) ? completionRows[0] : completionRows;
      return json(200, { ok: true, amount: requestedAmount, status: completion?.payment_status || canceledPayment.status || 'DONE' });
    }

    return json(400, { code: 'UNKNOWN_ACTION', message: '지원하지 않는 관리자 작업입니다.' });
  } catch (error) {
    console.error('Admin operation failed:', error);
    return json(500, { code: 'ADMIN_OPERATION_FAILED', message: error instanceof Error ? error.message : '관리자 작업을 처리하지 못했습니다.' });
  }
});

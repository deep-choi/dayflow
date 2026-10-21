import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const PLAN_LIMITS: Record<string, number> = {
  dayflow_free: 10,
  dayflow_plus_monthly: 100,
  dayflow_pro_monthly: 300,
};

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

const isAdminUser = (appMetadata: Record<string, unknown> | undefined): boolean =>
  appMetadata?.role === 'admin' || appMetadata?.is_admin === true;

const readRequestCount = (requestIds: unknown): number =>
  Array.isArray(requestIds) ? requestIds.length : 0;

const asTime = (value: unknown): number => {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : 0;
};

const readTossKeyMode = (clientKey: string, secretKey: string): 'test' | 'live' | 'missing' | 'mismatch' | 'unknown' => {
  if (!clientKey || !secretKey) return 'missing';
  const clientMode = clientKey.startsWith('test_') ? 'test' : clientKey.startsWith('live_') ? 'live' : 'unknown';
  const secretMode = secretKey.startsWith('test_') ? 'test' : secretKey.startsWith('live_') ? 'live' : 'unknown';
  if (clientMode === 'unknown' || secretMode === 'unknown') return 'unknown';
  return clientMode === secretMode ? clientMode : 'mismatch';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tossClientKey = Deno.env.get('TOSS_CLIENT_KEY') || '';
  const tossSecretKey = Deno.env.get('TOSS_SECRET_KEY') || '';
  const billingCronSecret = Deno.env.get('BILLING_CRON_SECRET') || '';
  const tossWebhookToken = Deno.env.get('TOSS_WEBHOOK_TOKEN') || '';
  const billingEnabled = Deno.env.get('BILLING_ENABLED') === 'true';
  const billingMode = Deno.env.get('BILLING_MODE') || '';
  const authorization = request.headers.get('Authorization') || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { code: 'ADMIN_NOT_CONFIGURED', message: '관리자 API 설정이 완료되지 않았습니다.' });
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
  if (!isAdminUser(userData.user.app_metadata as Record<string, unknown> | undefined)) {
    return json(403, { code: 'ADMIN_REQUIRED', message: '관리자 권한이 필요합니다.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    usersResult,
    profilesResult,
    subscriptionsResult,
    paymentsResult,
    refundsResult,
    attemptsResult,
    trialUsageResult,
    subscriptionUsageResult,
    aiEventsResult,
    auditsResult,
    notesResult,
    ticketsResult,
    supportMessagesResult,
    billingEventsResult,
    guestAiEventsResult,
  ] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from('profiles').select('id,name,avatar_url,updated_at').limit(2000),
    admin.from('billing_subscriptions').select('id,user_id,plan_id,status,card_company,card_number_masked,current_period_start,current_period_end,next_billing_at,canceled_at,retry_count,grace_period_end,last_billing_error,updated_at').limit(2000),
    admin.from('billing_payments').select('id,user_id,toss_order_id,plan_id,amount,currency,status,failure_code,failure_message,approved_at,created_at').order('created_at', { ascending: false }).limit(200),
    admin.from('billing_refunds').select('id,payment_id,user_id,admin_user_id,amount,reason,status,created_at').order('created_at', { ascending: false }).limit(200),
    admin.from('billing_attempts').select('id,subscription_id,user_id,scheduled_at,attempt_number,amount,status,failure_code,failure_message,processed_at,created_at').order('created_at', { ascending: false }).limit(200),
    admin.from('ai_trial_usage').select('user_id,request_ids,updated_at').limit(2000),
    admin.from('ai_subscription_usage').select('user_id,period_start,plan_id,request_ids,updated_at').order('period_start', { ascending: false }).limit(2000),
    admin.from('ai_usage_events').select('id,user_id,request_id,plan_id,provider,model,status,input_tokens,output_tokens,total_tokens,duration_ms,error_code,created_at').gte('created_at', lastThirtyDays.toISOString()).order('created_at', { ascending: false }).limit(2000),
    admin.from('admin_audit_logs').select('id,admin_user_id,action,target_type,target_id,reason,metadata,created_at').order('created_at', { ascending: false }).limit(200),
    admin.from('admin_notes').select('id,user_id,admin_user_id,note,created_at').order('created_at', { ascending: false }).limit(1000),
    admin.from('support_tickets').select('id,user_id,category,subject,status,priority,assigned_admin_id,created_at,updated_at,resolved_at').order('updated_at', { ascending: false }).limit(1000),
    admin.from('support_messages').select('id,ticket_id,sender_user_id,sender_role,message,created_at').order('created_at', { ascending: true }).limit(3000),
    admin.from('billing_events').select('id,event_type,toss_order_id,processing_status,error_message,received_at,processed_at').order('received_at', { ascending: false }).limit(200),
    admin.from('dayflow_guest_ai_events').select('id,request_id,model,status,input_tokens,output_tokens,total_tokens,duration_ms,error_code,created_at').gte('created_at', lastThirtyDays.toISOString()).order('created_at', { ascending: false }).limit(2000),
  ]);

  const queryResults = [
    guestAiEventsResult,
    profilesResult,
    subscriptionsResult,
    paymentsResult,
    refundsResult,
    attemptsResult,
    trialUsageResult,
    subscriptionUsageResult,
    aiEventsResult,
    auditsResult,
    notesResult,
    ticketsResult,
    supportMessagesResult,
    billingEventsResult,
  ];
  const firstError = usersResult.error || queryResults.find((result) => result.error)?.error;
  if (firstError) {
    console.error('Admin dashboard query failed:', firstError.message);
    return json(500, { code: 'ADMIN_QUERY_FAILED', message: '운영 데이터를 불러오지 못했습니다.' });
  }

  const users = usersResult.data.users || [];
  const totalUsers = 'total' in usersResult.data ? Number(usersResult.data.total || 0) : users.length;
  const profiles = profilesResult.data || [];
  const subscriptions = subscriptionsResult.data || [];
  const payments = paymentsResult.data || [];
  const refunds = refundsResult.data || [];
  const attempts = attemptsResult.data || [];
  const trialUsage = trialUsageResult.data || [];
  const subscriptionUsage = subscriptionUsageResult.data || [];
  const aiEvents = [...(aiEventsResult.data || []), ...(guestAiEventsResult.data || [])].sort((a,b) => asTime(b.created_at) - asTime(a.created_at)).slice(0,2000);
  const audits = auditsResult.data || [];
  const notes = notesResult.data || [];
  const tickets = ticketsResult.data || [];
  const supportMessages = supportMessagesResult.data || [];
  const billingEvents = billingEventsResult.data || [];

  const profilesByUser = new Map(profiles.map((profile) => [profile.id, profile]));
  const subscriptionsByUser = new Map(subscriptions.map((subscription) => [subscription.user_id, subscription]));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const trialUsageByUser = new Map(trialUsage.map((usage) => [usage.user_id, readRequestCount(usage.request_ids)]));
  const subscriptionUsageByUser = new Map<string, { used: number; planId: string }>();
  for (const usage of subscriptionUsage) {
    if (!subscriptionUsageByUser.has(usage.user_id)) {
      subscriptionUsageByUser.set(usage.user_id, {
        used: readRequestCount(usage.request_ids),
        planId: usage.plan_id,
      });
    }
  }
  const noteCountByUser = new Map<string, number>();
  for (const note of notes) noteCountByUser.set(note.user_id, (noteCountByUser.get(note.user_id) || 0) + 1);
  const refundedByPayment = new Map<string, number>();
  for (const refund of refunds) {
    if (refund.status === 'DONE') {
      refundedByPayment.set(refund.payment_id, (refundedByPayment.get(refund.payment_id) || 0) + Number(refund.amount || 0));
    }
  }

  const members = users
    .slice()
    .sort((left, right) => asTime(right.created_at) - asTime(left.created_at))
    .map((user) => {
      const profile = profilesByUser.get(user.id);
      const subscription = subscriptionsByUser.get(user.id);
      const paidUsage = subscriptionUsageByUser.get(user.id);
      const planId = subscription?.plan_id || 'dayflow_free';
      const aiUsed = paidUsage?.used ?? trialUsageByUser.get(user.id) ?? 0;
      const limit = PLAN_LIMITS[planId] || PLAN_LIMITS.dayflow_free;
      return {
        id: user.id,
        email: user.email || '',
        name: profile?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || '사용자',
        avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
        joinedAt: user.created_at,
        lastSignInAt: user.last_sign_in_at || null,
        provider: user.app_metadata?.provider || 'email',
        adminRole: isAdminUser(user.app_metadata) ? 'admin' : '',
        bannedUntil: (user as typeof user & { banned_until?: string | null }).banned_until || null,
        planId,
        subscriptionStatus: subscription?.status || 'free',
        currentPeriodEnd: subscription?.current_period_end || null,
        nextBillingAt: subscription?.next_billing_at || null,
        aiUsed,
        aiLimit: limit,
        aiRemaining: Math.max(0, limit - aiUsed),
        trialUsed: trialUsageByUser.get(user.id) || 0,
        trialLimit: PLAN_LIMITS.dayflow_free,
        noteCount: noteCountByUser.get(user.id) || 0,
      };
    });

  const nowTime = now.getTime();
  const entitledSubscriptions = subscriptions.filter((subscription) =>
    (subscription.status === 'active' || subscription.status === 'canceled')
    && asTime(subscription.current_period_end) > nowTime
  );
  const autoRenewSubscriptions = subscriptions.filter((subscription) => subscription.status === 'active').length;
  const cancelingSubscriptions = subscriptions.filter((subscription) =>
    subscription.status === 'canceled' && asTime(subscription.current_period_end) > nowTime
  ).length;
  const pastDueSubscriptions = subscriptions.filter((subscription) => subscription.status === 'past_due').length;
  const monthlyGrossRevenue = payments
    .filter((payment) => payment.status === 'DONE' && asTime(payment.approved_at || payment.created_at) >= monthStart.getTime())
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const monthlyRefunds = refunds
    .filter((refund) => refund.status === 'DONE' && asTime(refund.created_at) >= monthStart.getTime())
    .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
  const failedPayments = payments.filter((payment) => payment.status === 'FAILED').length;
  const failedRenewals = attempts.filter((attempt) => attempt.status === 'failed').length;
  const openSupportTickets = tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length;
  const successfulAiEvents = aiEvents.filter((event) => event.status === 'succeeded');
  const failedAiEvents = aiEvents.filter((event) => event.status === 'failed');
  const totalAiTokens = aiEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
  const totalAiDuration = aiEvents.reduce((sum, event) => sum + Number(event.duration_ms || 0), 0);
  const aiRequests = trialUsage.reduce((sum, usage) => sum + readRequestCount(usage.request_ids), 0)
    + subscriptionUsage.reduce((sum, usage) => sum + readRequestCount(usage.request_ids), 0);

  const modelMap = new Map<string, { model: string; requests: number; failures: number; tokens: number; duration: number }>();
  for (const event of aiEvents) {
    const current = modelMap.get(event.model) || { model: event.model, requests: 0, failures: 0, tokens: 0, duration: 0 };
    current.requests += 1;
    current.failures += event.status === 'failed' ? 1 : 0;
    current.tokens += Number(event.total_tokens || 0);
    current.duration += Number(event.duration_ms || 0);
    modelMap.set(event.model, current);
  }
  const modelBreakdown = [...modelMap.values()].map((model) => ({
    model: model.model,
    requests: model.requests,
    failures: model.failures,
    totalTokens: model.tokens,
    averageDurationMs: model.requests ? Math.round(model.duration / model.requests) : 0,
  })).sort((left, right) => right.requests - left.requests);

  const alerts = [
    pastDueSubscriptions > 0 ? {
      id: 'past-due', severity: 'critical', section: 'billing', count: pastDueSubscriptions,
      title: '결제 지연 구독', description: '재결제 실패 원인과 이용 권한을 확인해야 합니다.',
    } : null,
    failedRenewals > 0 ? {
      id: 'failed-renewals', severity: 'critical', section: 'billing', count: failedRenewals,
      title: '정기결제 실패', description: '실패 코드와 다음 재시도 일정을 확인하세요.',
    } : null,
    failedPayments > 0 ? {
      id: 'failed-payments', severity: 'warning', section: 'billing', count: failedPayments,
      title: '결제 실패 내역', description: '최근 결제 실패가 기록되어 있습니다.',
    } : null,
    failedAiEvents.length > 0 ? {
      id: 'ai-errors', severity: 'warning', section: 'ai', count: failedAiEvents.length,
      title: 'AI 요청 오류', description: '최근 30일 AI 제공자 오류를 확인하세요.',
    } : null,
    cancelingSubscriptions > 0 ? {
      id: 'canceling', severity: 'info', section: 'billing', count: cancelingSubscriptions,
      title: '해지 예정 구독', description: '이용 종료일 이후 무료 요금제로 전환됩니다.',
    } : null,
    openSupportTickets > 0 ? {
      id: 'support-open', severity: 'info', section: 'support', count: openSupportTickets,
      title: '미처리 고객 문의', description: '접수된 문의를 확인하고 처리 상태를 변경하세요.',
    } : null,
  ].filter(Boolean);

  return json(200, {
    generatedAt: now.toISOString(),
    summary: {
      totalUsers,
      activeEntitlements: entitledSubscriptions.length,
      autoRenewSubscriptions,
      cancelingSubscriptions,
      pastDueSubscriptions,
      monthlyGrossRevenue,
      monthlyRefunds,
      monthlyNetRevenue: monthlyGrossRevenue - monthlyRefunds,
      aiRequests,
      aiRequests30d: aiEvents.length,
      aiFailures30d: failedAiEvents.length,
      aiSuccessRate30d: aiEvents.length ? Math.round((successfulAiEvents.length / aiEvents.length) * 1000) / 10 : 100,
      aiTokens30d: totalAiTokens,
      aiAverageDurationMs30d: aiEvents.length ? Math.round(totalAiDuration / aiEvents.length) : 0,
      failedPayments,
      failedRenewals,
      openSupportTickets,
    },
    alerts,
    members,
    subscriptions,
    payments: payments.map((payment) => ({
      ...payment,
      refundedAmount: refundedByPayment.get(payment.id) || 0,
      refundableAmount: Math.max(0, Number(payment.amount || 0) - (refundedByPayment.get(payment.id) || 0)),
    })),
    refunds,
    billingAttempts: attempts,
    ai: {
      modelBreakdown,
      recentEvents: aiEvents.slice(0, 100),
    },
    audits: audits.map((audit) => ({
      ...audit,
      adminEmail: usersById.get(audit.admin_user_id)?.email || '삭제된 관리자',
    })),
    notes: notes.map((note) => ({
      ...note,
      adminEmail: usersById.get(note.admin_user_id)?.email || '삭제된 관리자',
    })),
    support: {
      tickets,
      messages: supportMessages,
    },
    system: {
      billingEvents,
      configuration: {
        billingEnabled,
        billingMode: billingMode === 'test' || billingMode === 'live' ? billingMode : 'invalid',
        tossKeyMode: readTossKeyMode(tossClientKey, tossSecretKey),
        billingCronSecretConfigured: billingCronSecret.length >= 32,
        tossWebhookTokenConfigured: tossWebhookToken.length >= 32,
        lastRenewalAttemptAt: attempts[0]?.created_at || null,
        lastWebhookReceivedAt: billingEvents[0]?.received_at || null,
      },
    },
  });
});

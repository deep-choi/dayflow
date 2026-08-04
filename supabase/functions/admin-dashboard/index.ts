import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

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

const isAdminUser = (appMetadata: Record<string, unknown> | undefined): boolean =>
  appMetadata?.role === 'admin' || appMetadata?.is_admin === true;

const readRequestCount = (requestIds: unknown): number =>
  Array.isArray(requestIds) ? requestIds.length : 0;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [usersResult, profilesResult, subscriptionsResult, paymentsResult, monthPaymentsResult, trialUsageResult, subscriptionUsageResult] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 100 }),
    admin.from('profiles').select('id,name,avatar_url,updated_at').limit(1000),
    admin.from('billing_subscriptions').select('user_id,plan_id,status,current_period_end,next_billing_at,canceled_at,updated_at').limit(1000),
    admin.from('billing_payments').select('id,user_id,toss_order_id,plan_id,amount,currency,status,failure_code,approved_at,created_at').order('created_at', { ascending: false }).limit(30),
    admin.from('billing_payments').select('amount,status,approved_at,created_at').gte('created_at', monthStart.toISOString()).limit(1000),
    admin.from('ai_trial_usage').select('user_id,request_ids,updated_at').limit(1000),
    admin.from('ai_subscription_usage').select('user_id,period_start,plan_id,request_ids,updated_at').order('period_start', { ascending: false }).limit(1000),
  ]);

  const firstError = [
    usersResult.error,
    profilesResult.error,
    subscriptionsResult.error,
    paymentsResult.error,
    monthPaymentsResult.error,
    trialUsageResult.error,
    subscriptionUsageResult.error,
  ].find(Boolean);
  if (firstError) {
    console.error('Admin dashboard query failed:', firstError.message);
    return json(500, { code: 'ADMIN_QUERY_FAILED', message: '운영 데이터를 불러오지 못했습니다.' });
  }

  const users = usersResult.data.users || [];
  const totalUsers = 'total' in usersResult.data ? Number(usersResult.data.total || 0) : users.length;
  const profiles = profilesResult.data || [];
  const subscriptions = subscriptionsResult.data || [];
  const payments = paymentsResult.data || [];
  const trialUsage = trialUsageResult.data || [];
  const subscriptionUsage = subscriptionUsageResult.data || [];

  const profilesByUser = new Map(profiles.map((profile) => [profile.id, profile]));
  const subscriptionsByUser = new Map(subscriptions.map((subscription) => [subscription.user_id, subscription]));
  const trialUsageByUser = new Map(trialUsage.map((usage) => [usage.user_id, readRequestCount(usage.request_ids)]));
  const subscriptionUsageByUser = new Map<string, { used: number; planId: string }>();
  for (const usage of subscriptionUsage) {
    if (subscriptionUsageByUser.has(usage.user_id)) continue;
    subscriptionUsageByUser.set(usage.user_id, {
      used: readRequestCount(usage.request_ids),
      planId: usage.plan_id,
    });
  }

  const members = users
    .slice()
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .map((user) => {
      const profile = profilesByUser.get(user.id);
      const subscription = subscriptionsByUser.get(user.id);
      const paidUsage = subscriptionUsageByUser.get(user.id);
      return {
        id: user.id,
        email: user.email || '',
        name: profile?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || '사용자',
        avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
        joinedAt: user.created_at,
        lastSignInAt: user.last_sign_in_at || null,
        provider: user.app_metadata?.provider || 'email',
        planId: subscription?.plan_id || 'dayflow_free',
        subscriptionStatus: subscription?.status || 'free',
        currentPeriodEnd: subscription?.current_period_end || null,
        aiUsed: paidUsage?.used ?? trialUsageByUser.get(user.id) ?? 0,
      };
    });

  const activeSubscriptions = subscriptions.filter((subscription) =>
    subscription.status === 'active'
    || (subscription.status === 'canceled' && new Date(subscription.current_period_end).getTime() > Date.now())
  ).length;
  const monthlyRevenue = (monthPaymentsResult.data || [])
    .filter((payment) => payment.status === 'DONE')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const aiRequests = trialUsage.reduce((sum, usage) => sum + readRequestCount(usage.request_ids), 0)
    + subscriptionUsage.reduce((sum, usage) => sum + readRequestCount(usage.request_ids), 0);

  return json(200, {
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers,
      activeSubscriptions,
      monthlyRevenue,
      aiRequests,
    },
    members,
    payments,
  });
});

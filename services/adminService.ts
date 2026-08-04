import { supabase } from '../utils/supabase';

export type AdminSection = 'overview' | 'members' | 'billing' | 'ai' | 'support' | 'system' | 'audit';

export type AdminMember = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  joinedAt: string;
  lastSignInAt?: string | null;
  provider: string;
  adminRole: string;
  bannedUntil?: string | null;
  planId: string;
  subscriptionStatus: string;
  currentPeriodEnd?: string | null;
  nextBillingAt?: string | null;
  aiUsed: number;
  aiLimit: number;
  aiRemaining: number;
  noteCount: number;
};

export type AdminSubscription = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  card_company?: string | null;
  card_number_masked?: string | null;
  current_period_start: string;
  current_period_end: string;
  next_billing_at?: string | null;
  canceled_at?: string | null;
  retry_count?: number;
  grace_period_end?: string | null;
  last_billing_error?: string | null;
  updated_at: string;
};

export type AdminPayment = {
  id: string;
  user_id: string;
  toss_order_id: string;
  plan_id: string;
  amount: number;
  currency: string;
  status: string;
  failure_code?: string | null;
  failure_message?: string | null;
  approved_at?: string | null;
  created_at: string;
  refundedAmount: number;
  refundableAmount: number;
};

export type AdminRefund = {
  id: string;
  payment_id: string;
  user_id: string;
  admin_user_id?: string | null;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
};

export type AdminBillingAttempt = {
  id: string;
  subscription_id: string;
  user_id: string;
  scheduled_at: string;
  attempt_number: number;
  amount: number;
  status: string;
  failure_code?: string | null;
  failure_message?: string | null;
  processed_at?: string | null;
  created_at: string;
};

export type AdminAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  section: AdminSection;
  count: number;
  title: string;
  description: string;
};

export type AdminAiEvent = {
  id: string;
  user_id: string;
  request_id: string;
  plan_id: string;
  provider: string;
  model: string;
  status: 'succeeded' | 'failed';
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
  error_code?: string | null;
  created_at: string;
};

export type AdminAiModelBreakdown = {
  model: string;
  requests: number;
  failures: number;
  totalTokens: number;
  averageDurationMs: number;
};

export type AdminAudit = {
  id: string;
  admin_user_id?: string | null;
  adminEmail: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  reason?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminNote = {
  id: string;
  user_id: string;
  admin_user_id?: string | null;
  adminEmail: string;
  note: string;
  created_at: string;
};

export type AdminSupportTicket = {
  id: string;
  user_id: string;
  category: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_admin_id?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export type AdminSupportMessage = {
  id: string;
  ticket_id: string;
  sender_user_id?: string | null;
  sender_role: 'user' | 'admin';
  message: string;
  created_at: string;
};

export type AdminBillingEvent = {
  id: string;
  event_type: string;
  toss_order_id?: string | null;
  processing_status: 'received' | 'processed' | 'ignored' | 'failed';
  error_message?: string | null;
  received_at: string;
  processed_at?: string | null;
};

export type AdminDashboardData = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    activeEntitlements: number;
    autoRenewSubscriptions: number;
    cancelingSubscriptions: number;
    pastDueSubscriptions: number;
    monthlyGrossRevenue: number;
    monthlyRefunds: number;
    monthlyNetRevenue: number;
    aiRequests: number;
    aiRequests30d: number;
    aiFailures30d: number;
    aiSuccessRate30d: number;
    aiTokens30d: number;
    aiAverageDurationMs30d: number;
    failedPayments: number;
    failedRenewals: number;
    openSupportTickets: number;
  };
  alerts: AdminAlert[];
  members: AdminMember[];
  subscriptions: AdminSubscription[];
  payments: AdminPayment[];
  refunds: AdminRefund[];
  billingAttempts: AdminBillingAttempt[];
  ai: {
    modelBreakdown: AdminAiModelBreakdown[];
    recentEvents: AdminAiEvent[];
  };
  audits: AdminAudit[];
  notes: AdminNote[];
  support: {
    tickets: AdminSupportTicket[];
    messages: AdminSupportMessage[];
  };
  system: {
    billingEvents: AdminBillingEvent[];
  };
};

type AdminOperationPayload = {
  action: 'add_note' | 'suspend_user' | 'restore_user' | 'cancel_subscription' | 'refund_payment' | 'support_reply' | 'support_status';
  targetId: string;
  reason?: string;
  note?: string;
  amount?: number;
  message?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
};

const readFunctionError = async (error: unknown, fallback: string): Promise<string> => {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return fallback;
  try {
    const body = await context.clone().json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : fallback;
  } catch {
    return fallback;
  }
};

export const getAdminDashboard = async (): Promise<AdminDashboardData> => {
  const { data, error } = await supabase.functions.invoke<AdminDashboardData>('admin-dashboard', { body: {} });
  if (error) throw new Error(await readFunctionError(error, '운영 데이터를 불러오지 못했습니다.'));
  if (!data) throw new Error('운영 데이터가 비어 있습니다.');
  return data;
};

export const runAdminOperation = async (payload: AdminOperationPayload): Promise<void> => {
  const { error } = await supabase.functions.invoke('admin-operations', { body: payload });
  if (error) throw new Error(await readFunctionError(error, '관리자 작업을 처리하지 못했습니다.'));
};

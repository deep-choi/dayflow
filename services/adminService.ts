import { supabase } from '../utils/supabase';

export type AdminMember = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  joinedAt: string;
  lastSignInAt?: string | null;
  provider: string;
  planId: string;
  subscriptionStatus: string;
  currentPeriodEnd?: string | null;
  aiUsed: number;
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
  approved_at?: string | null;
  created_at: string;
};

export type AdminDashboardData = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    activeSubscriptions: number;
    monthlyRevenue: number;
    aiRequests: number;
  };
  members: AdminMember[];
  payments: AdminPayment[];
};

const readFunctionError = async (error: unknown): Promise<string> => {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return '운영 데이터를 불러오지 못했습니다.';
  try {
    const body = await context.clone().json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : '운영 데이터를 불러오지 못했습니다.';
  } catch {
    return '운영 데이터를 불러오지 못했습니다.';
  }
};

export const getAdminDashboard = async (): Promise<AdminDashboardData> => {
  const { data, error } = await supabase.functions.invoke<AdminDashboardData>('admin-dashboard', {
    body: {},
  });
  if (error) throw new Error(await readFunctionError(error));
  if (!data) throw new Error('운영 데이터가 비어 있습니다.');
  return data;
};

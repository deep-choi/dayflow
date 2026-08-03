import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
import { supabase } from '../utils/supabase';

export const TEMPORARY_PRO_PLAN = {
  id: 'dayflow_pro_monthly',
  name: 'Dayflow Pro',
  amount: 9_900,
  aiQuota: 300,
} as const;

export type BillingSubscription = {
  plan_id: string;
  status: 'active' | 'canceled' | 'past_due';
  card_company: string | null;
  card_number_masked: string | null;
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string | null;
  canceled_at: string | null;
};

type BillingPlan = typeof TEMPORARY_PRO_PLAN & { currency: string; billingCycle: string };
type BillingResponse = {
  clientKey?: string;
  customerKey?: string;
  customerEmail?: string | null;
  customerName?: string | null;
  plan?: BillingPlan;
  subscription?: BillingSubscription | null;
};

export class BillingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
  }
}

const readFunctionError = async (error: unknown): Promise<{ code: string; message: string }> => {
  const fallback = { code: 'BILLING_REQUEST_FAILED', message: '결제 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return fallback;
  if (context.status === 404) {
    return { code: 'BILLING_NOT_DEPLOYED', message: '결제 서버 함수를 배포하면 토스페이먼츠 테스트를 시작할 수 있습니다.' };
  }
  try {
    const payload = await context.clone().json() as { code?: unknown; message?: unknown };
    return {
      code: typeof payload.code === 'string' ? payload.code : fallback.code,
      message: typeof payload.message === 'string' ? payload.message : fallback.message,
    };
  } catch {
    return fallback;
  }
};

const invokeBilling = async (body: Record<string, unknown>): Promise<BillingResponse> => {
  const { data, error } = await supabase.functions.invoke<BillingResponse>('toss-billing', { body });
  if (error) {
    const parsed = await readFunctionError(error);
    throw new BillingError(parsed.code, parsed.message);
  }
  if (!data) throw new BillingError('BILLING_EMPTY_RESPONSE', '결제 서버에서 응답을 받지 못했습니다.');
  return data;
};

export const getSubscriptionStatus = async (): Promise<BillingSubscription | null> => {
  const response = await invokeBilling({ action: 'status' });
  return response.subscription || null;
};

export const requestBillingCardRegistration = async (): Promise<void> => {
  const prepared = await invokeBilling({ action: 'prepare', planId: TEMPORARY_PRO_PLAN.id });
  if (!prepared.clientKey || !prepared.customerKey) {
    throw new BillingError('BILLING_PREPARE_INVALID', '결제 준비 정보가 올바르지 않습니다.');
  }

  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('view', 'support');
  returnUrl.searchParams.set('tab', 'pricing');
  returnUrl.searchParams.set('billing', 'success');
  const failUrl = new URL(returnUrl);
  failUrl.searchParams.set('billing', 'fail');

  const tossPayments = await loadTossPayments(prepared.clientKey);
  const payment = tossPayments.payment({ customerKey: prepared.customerKey });
  await payment.requestBillingAuth({
    method: 'CARD',
    successUrl: returnUrl.toString(),
    failUrl: failUrl.toString(),
    customerEmail: prepared.customerEmail || undefined,
    customerName: prepared.customerName || undefined,
  });
};

export const confirmBillingCardRegistration = async (authKey: string, customerKey: string): Promise<BillingSubscription> => {
  const response = await invokeBilling({
    action: 'confirm',
    authKey,
    customerKey,
    planId: TEMPORARY_PRO_PLAN.id,
  });
  if (!response.subscription) throw new BillingError('SUBSCRIPTION_EMPTY', '구독 시작 결과를 확인하지 못했습니다.');
  return response.subscription;
};

export const cancelSubscription = async (): Promise<void> => {
  await invokeBilling({ action: 'cancel' });
};

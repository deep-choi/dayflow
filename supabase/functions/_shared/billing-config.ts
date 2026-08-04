export type BillingMode = 'test' | 'live';

export type BillingReadiness = {
  enabled: boolean;
  mode: BillingMode | null;
  ready: boolean;
  code: string;
  message: string;
};

const readMode = (value: string | undefined): BillingMode | null =>
  value === 'test' || value === 'live' ? value : null;

const keyMatchesMode = (key: string | undefined, mode: BillingMode, kind: 'client' | 'secret'): boolean => {
  if (!key) return false;
  const prefix = `${mode}_${kind === 'client' ? 'ck' : 'sk'}_`;
  return key.startsWith(prefix);
};

export const readBillingReadiness = (options: {
  requireClientKey?: boolean;
  requireSecretKey?: boolean;
} = {}): BillingReadiness => {
  const enabled = Deno.env.get('BILLING_ENABLED') === 'true';
  const mode = readMode(Deno.env.get('BILLING_MODE'));

  if (!enabled) {
    return { enabled, mode, ready: false, code: 'BILLING_DISABLED', message: '현재 신규 결제가 일시 중지되어 있습니다.' };
  }
  if (!mode) {
    return { enabled, mode, ready: false, code: 'BILLING_MODE_INVALID', message: '결제 운영 환경이 올바르게 설정되지 않았습니다.' };
  }
  if (options.requireClientKey && !keyMatchesMode(Deno.env.get('TOSS_CLIENT_KEY'), mode, 'client')) {
    return { enabled, mode, ready: false, code: 'BILLING_CLIENT_KEY_MISMATCH', message: '결제 클라이언트 키와 운영 환경이 일치하지 않습니다.' };
  }
  if (options.requireSecretKey && !keyMatchesMode(Deno.env.get('TOSS_SECRET_KEY'), mode, 'secret')) {
    return { enabled, mode, ready: false, code: 'BILLING_SECRET_KEY_MISMATCH', message: '결제 서버 키와 운영 환경이 일치하지 않습니다.' };
  }
  return { enabled, mode, ready: true, code: 'BILLING_READY', message: '결제를 처리할 수 있습니다.' };
};

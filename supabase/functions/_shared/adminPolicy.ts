export const isAdminUser = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== 'object') return false;
  const value = metadata as Record<string, unknown>;
  return value.role === 'admin' || value.is_admin === true;
};
export const validSettings = (value: unknown): value is { revision: number; trial_paused: boolean; guest_ip_daily_limit: number; guest_global_daily_limit: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(',') === 'guest_global_daily_limit,guest_ip_daily_limit,revision,trial_paused' &&
    Number.isSafeInteger(v.revision) && Number(v.revision) >= 0 && typeof v.trial_paused === 'boolean' &&
    ['guest_ip_daily_limit', 'guest_global_daily_limit'].every(key => Number.isSafeInteger(v[key]) && Number(v[key]) >= 1 && Number(v[key]) <= 100000);
};
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const isAdminMetadata = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== 'object') return false;
  const value = metadata as Record<string, unknown>;
  return value.role === 'admin' || value.is_admin === true;
};

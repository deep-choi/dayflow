import { supabase } from '../utils/supabase';
import type { AdminDashboard, AdminSettings, SupportTicket } from '../adminTypes';

export class AdminError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export async function adminInvoke<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data: current } = await supabase.auth.getSession();
  const uid = current.session?.user.id;
  if (!uid) throw new AdminError(401, 'AUTH_REQUIRED', '운영자 계정으로 로그인해 주세요.');
  const { data: latest } = await supabase.auth.getSession();
  if (latest.session?.user.id !== uid) throw new AdminError(401, 'ACCOUNT_CHANGED', '계정이 변경되어 요청을 중단했습니다.');
  const { data, error } = await supabase.functions.invoke<T>(name, { body, headers: { Authorization: `Bearer ${latest.session.access_token}` } });
  const { data: after } = await supabase.auth.getSession();
  if (after.session?.user.id !== uid) throw new AdminError(401, 'ACCOUNT_CHANGED', '계정이 변경되었습니다. 다시 로그인해 주세요.');
  if (error) {
    const context = error.context instanceof Response ? error.context : null;
    const payload = await context?.clone().json().catch(() => null);
    throw new AdminError(context?.status || 503, payload?.code || 'ADMIN_UNAVAILABLE', payload?.message || '운영 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!data) throw new AdminError(503, 'EMPTY_RESPONSE', '서버 응답을 확인하지 못했습니다.');
  return data;
}
export const fetchAdminDashboard = () => adminInvoke<AdminDashboard>('admin-dashboard');
export const fetchAdminSettings = () => adminInvoke<{ settings: AdminSettings }>('dayflow-admin', { action: 'settings' });
export const saveAdminSettings = (settings: AdminSettings) => adminInvoke('dayflow-admin', { action: 'settings.update', settings });
export const updateSupportStatus = (ticket: SupportTicket, status: SupportTicket['status'], reason: string) =>
  adminInvoke('dayflow-admin', { action: 'ticket.update', ticketId: ticket.id, expectedUpdatedAt: ticket.updated_at, status, reason });
export const updateMember = (userId: string, suspend: boolean, reason: string) => adminInvoke('admin-operations', {
  action: suspend ? 'suspend_user' : 'restore_user', targetId: userId, reason,
});
export const addMemberNote = (userId: string, note: string) => adminInvoke('admin-operations', { action: 'add_note', targetId: userId, note });

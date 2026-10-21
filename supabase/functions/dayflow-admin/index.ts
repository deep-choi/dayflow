import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isAdminUser, validSettings, uuid } from '../_shared/adminPolicy.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret) return json(503, { code: 'ADMIN_NOT_CONFIGURED', message: '관리자 설정이 필요합니다.' });
  const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) return json(401, { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' });
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return json(401, { code: 'AUTH_INVALID', message: '다시 로그인해 주세요.' });
  if (!isAdminUser(auth.user.app_metadata)) return json(403, { code: 'ADMIN_REQUIRED', message: '관리자 권한이 필요합니다.' });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const body = await request.json();
    if (body.action === 'settings') {
      const { data, error } = await admin.from('dayflow_operations_settings').select('revision,trial_paused,guest_ip_daily_limit,guest_global_daily_limit').eq('id', true).single();
      if (error) throw error;
      return json(200, { settings: data });
    }
    let result;
    if (body.action === 'settings.update') {
      if (!validSettings(body.settings)) return json(400, { code: 'INVALID_SETTINGS', message: '설정 값을 확인해 주세요.' });
      const s = body.settings;
      result = await admin.rpc('save_dayflow_operations', { p_actor: auth.user.id, p_revision: s.revision, p_paused: s.trial_paused, p_ip_limit: s.guest_ip_daily_limit, p_global_limit: s.guest_global_daily_limit });
    } else if (body.action === 'ticket.update') {
      if (!uuid(body.ticketId) || typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt)) ||
        !['open','in_progress','resolved','closed'].includes(body.status) || typeof body.reason !== 'string' || body.reason.trim().length < 2 || body.reason.length > 500) {
        return json(400, { code: 'INVALID_TICKET', message: '처리 상태와 사유를 확인해 주세요.' });
      }
      result = await admin.rpc('update_dayflow_ticket', { p_actor: auth.user.id, p_ticket: body.ticketId, p_updated_at: body.expectedUpdatedAt, p_status: body.status, p_reason: body.reason.trim() });
    } else return json(400, { code: 'INVALID_ACTION', message: '지원하지 않는 작업입니다.' });
    if (result.error) throw result.error;
    return json(200, { ok: true, settings: body.action === 'settings.update' ? result.data : undefined });
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
    if (message.includes('CONFLICT')) return json(409, { code: 'EDIT_CONFLICT', message: '다른 곳에서 변경되었습니다. 새로고침 후 다시 저장해 주세요.' });
    if (message.includes('TICKET_NOT_FOUND')) return json(404, { code: 'TICKET_NOT_FOUND', message: '문의를 찾지 못했습니다.' });
    console.error(JSON.stringify({ event: 'admin_operation_failed', code: 'ADMIN_UNAVAILABLE' }));
    return json(503, { code: 'ADMIN_UNAVAILABLE', message: '운영 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

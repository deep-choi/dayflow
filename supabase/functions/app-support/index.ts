import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const respond = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return respond(405, 'POST 요청만 지원합니다.');
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret) return respond(503, '요청 접수가 준비되지 않았습니다.');
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return respond(401, '로그인이 필요합니다.');
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return respond(401, '로그인 정보를 확인하지 못했습니다.');
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return respond(400, '요청 형식이 올바르지 않습니다.'); }
  if (!['ai-report', 'account-deletion'].includes(String(body.action))) return respond(400, '지원하지 않는 요청입니다.');
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (body.action === 'ai-report' && (!content || content.length > 5000 || !reason || reason.length > 500)) return respond(400, '신고 내용과 사유를 확인해 주세요.');
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  // UID는 요청 본문에서 받지 않고 검증된 세션에서만 가져온다. 운영자용 테이블의 RLS를 열지 않는다.
  const uid = data.user.id;
  const recent = await admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if (recent.error) return respond(503, '접수 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if ((recent.count ?? 0) >= 20) return respond(429, '오늘 접수 가능한 횟수를 넘었습니다. 긴급 문의는 운영자 이메일로 보내 주세요.');
  const account = body.action === 'account-deletion';
  const ticket = await admin.from('support_tickets').insert({ user_id: uid, category: account ? 'account' : 'ai', subject: account ? 'Dayflow 계정 및 연결된 데이터 삭제 요청' : 'AI 응답 신고' }).select('id').single();
  if (ticket.error) return respond(503, '요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const saved = await admin.from('support_messages').insert({ ticket_id: ticket.data.id, sender_user_id: uid, sender_role: 'user', message: account ? '로그인한 계정과 연결된 데이터의 삭제를 요청합니다. 운영자 검토 후 처리 결과를 알려 주세요.' : `사유: ${reason}\n\n신고 응답:\n${content}`.slice(0, 5000) });
  if (saved.error) {
    await admin.from('support_tickets').delete().eq('id', ticket.data.id);
    return respond(503, '요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return respond(200, account ? '계정 삭제 요청을 접수했습니다. 운영자가 확인 후 처리 결과를 안내합니다.' : '신고를 접수했습니다. 운영자가 검토합니다.');
});

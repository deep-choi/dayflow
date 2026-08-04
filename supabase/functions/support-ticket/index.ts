import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const ALLOWED_CATEGORIES = new Set(['service', 'account', 'billing', 'ai', 'other']);
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, payload: Record<string, unknown>) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 지원합니다.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { code: 'SUPPORT_NOT_CONFIGURED', message: '고객지원 서버가 설정되지 않았습니다.' });
  if (!authorization.startsWith('Bearer ')) return json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(401, { code: 'UNAUTHORIZED', message: '로그인 정보를 확인하지 못했습니다.' });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json(400, { code: 'INVALID_BODY', message: '요청 형식이 올바르지 않습니다.' }); }
  const action = typeof body.action === 'string' ? body.action : '';
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === 'create') {
    const category = typeof body.category === 'string' ? body.category : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!ALLOWED_CATEGORIES.has(category) || subject.length < 2 || subject.length > 120 || message.length < 5 || message.length > 5000) {
      return json(400, { code: 'INVALID_TICKET', message: '문의 분류, 제목과 내용을 확인해 주세요.' });
    }
    const { data: ticket, error: ticketError } = await admin.from('support_tickets').insert({
      user_id: authData.user.id, category, subject,
    }).select('id,category,subject,status,priority,created_at,updated_at').single();
    if (ticketError || !ticket) return json(500, { code: 'TICKET_CREATE_FAILED', message: '문의를 접수하지 못했습니다.' });
    const { error: messageError } = await admin.from('support_messages').insert({
      ticket_id: ticket.id, sender_user_id: authData.user.id, sender_role: 'user', message,
    });
    if (messageError) {
      await admin.from('support_tickets').delete().eq('id', ticket.id);
      return json(500, { code: 'TICKET_CREATE_FAILED', message: '문의 내용을 저장하지 못했습니다.' });
    }
    return json(200, { ticket });
  }

  if (action === 'list') {
    const { data: tickets, error } = await admin.from('support_tickets')
      .select('id,category,subject,status,priority,created_at,updated_at,resolved_at')
      .eq('user_id', authData.user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) return json(500, { code: 'TICKET_LIST_FAILED', message: '문의 내역을 불러오지 못했습니다.' });
    const ids = (tickets || []).map((ticket) => ticket.id);
    const { data: messages, error: messagesError } = ids.length
      ? await admin.from('support_messages').select('id,ticket_id,sender_role,message,created_at').in('ticket_id', ids).order('created_at', { ascending: true })
      : { data: [], error: null };
    if (messagesError) return json(500, { code: 'TICKET_LIST_FAILED', message: '문의 답변을 불러오지 못했습니다.' });
    return json(200, { tickets: tickets || [], messages: messages || [] });
  }

  if (action === 'reply') {
    const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!ticketId || message.length < 1 || message.length > 5000) return json(400, { code: 'INVALID_REPLY', message: '답변 내용을 확인해 주세요.' });
    const { data: ticket } = await admin.from('support_tickets').select('id,status').eq('id', ticketId).eq('user_id', authData.user.id).maybeSingle();
    if (!ticket || ticket.status === 'closed') return json(404, { code: 'TICKET_NOT_FOUND', message: '답변할 수 있는 문의를 찾지 못했습니다.' });
    const { error } = await admin.from('support_messages').insert({ ticket_id: ticketId, sender_user_id: authData.user.id, sender_role: 'user', message });
    if (error) return json(500, { code: 'REPLY_FAILED', message: '답변을 저장하지 못했습니다.' });
    await admin.from('support_tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', ticketId);
    return json(200, { ok: true });
  }

  return json(400, { code: 'UNKNOWN_ACTION', message: '지원하지 않는 고객지원 요청입니다.' });
});

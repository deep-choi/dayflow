import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// Minimal stateless MCP server (Streamable HTTP, JSON responses only).
// Auth: "Authorization: Bearer dfa_..." personal agent token created in Dayflow settings.
// Every query is scoped to the token owner's user_id; no delete/update tools are exposed.

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'dayflow', version: '1.0.0' };
const DEFAULT_TODO_LIST_ID = '00000000-0000-4000-8000-000000000001';
const MAX_LIST_ROWS = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' };

type Json = Record<string, unknown>;
type Auth = { userId: string; canWrite: boolean };
type Admin = ReturnType<typeof createClient>;

class ToolError extends Error {}

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const TOOLS = [
  {
    name: 'list_events',
    description: '캘린더 일정을 날짜 범위로 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '시작 날짜 YYYY-MM-DD' },
        to: { type: 'string', description: '종료 날짜 YYYY-MM-DD (생략하면 from과 같은 날)' },
      },
      required: ['from'],
    },
  },
  {
    name: 'add_event',
    description: '캘린더에 일정을 추가합니다. 시간을 생략하면 종일 일정이 됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: '여러 날 일정의 종료일 YYYY-MM-DD' },
        start_time: { type: 'string', description: 'HH:mm' },
        end_time: { type: 'string', description: 'HH:mm' },
        description: { type: 'string' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'list_todo_lists',
    description: '할 일 목록(폴더) 이름과 id를 조회합니다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_todos',
    description: '할 일을 조회합니다. 기본값은 미완료 항목만입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        include_completed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'add_todo',
    description: '할 일을 추가합니다. 사용자가 날짜를 말하지 않았다면 due_date는 생략하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        list_name: { type: 'string', description: '추가할 목록 이름 (생략하면 첫 번째 목록)' },
        list_id: { type: 'string' },
        due_date: { type: 'string', description: 'YYYY-MM-DD, 사용자가 기한을 말한 경우에만' },
      },
      required: ['text'],
    },
  },
  {
    name: 'add_journal_entry',
    description: '메모장에 메모를 추가합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['content'],
    },
  },
];
const WRITE_TOOLS = new Set(['add_event', 'add_todo', 'add_journal_entry']);

const authenticate = async (admin: Admin, request: Request): Promise<Auth | null> => {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token.startsWith('dfa_') || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const { data, error } = await admin.from('agent_tokens').select('id,user_id,can_write,last_used_at').eq('token_hash', hash).maybeSingle();
  if (error || !data) return null;
  // Throttle the bookkeeping write to once a minute.
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60_000) {
    await admin.from('agent_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  }
  return { userId: data.user_id, canWrite: data.can_write };
};

const resolveTodoListId = async (admin: Admin, userId: string, args: Json): Promise<string> => {
  const { data: lists, error } = await admin.from('todo_lists').select('id,title').eq('user_id', userId).order('order');
  if (error) throw new ToolError('할 일 목록을 읽지 못했습니다.');
  const wantedId = str(args.list_id, 64);
  const wantedName = str(args.list_name, 80);
  if (wantedId) {
    const found = lists?.find(l => l.id === wantedId);
    if (!found) throw new ToolError('list_id에 해당하는 목록이 없습니다. list_todo_lists로 확인하세요.');
    return found.id;
  }
  if (wantedName) {
    const found = lists?.find(l => l.title === wantedName) ?? lists?.find(l => l.title.includes(wantedName));
    if (!found) throw new ToolError(`'${wantedName}' 목록을 찾지 못했습니다. list_todo_lists로 확인하세요.`);
    return found.id;
  }
  if (lists && lists.length > 0) return lists[0].id;

  // Brand-new account: create the same default list the app uses.
  await admin.from('todo_tabs').upsert([{ id: 'tab_todo', user_id: userId, name: '할 일', color: '#1a73e8', order: 0 }], { onConflict: 'id' });
  const created = await admin.from('todo_lists').upsert([{ id: DEFAULT_TODO_LIST_ID, user_id: userId, title: '해야 할 일', order: 1, tab_id: 'tab_todo' }], { onConflict: 'id' });
  if (created.error) throw new ToolError('기본 할 일 목록을 만들지 못했습니다.');
  return DEFAULT_TODO_LIST_ID;
};

const callTool = async (admin: Admin, auth: Auth, name: string, args: Json) => {
  if (WRITE_TOOLS.has(name) && !auth.canWrite) throw new ToolError('이 토큰은 읽기 전용입니다.');
  const uid = auth.userId;

  switch (name) {
    case 'list_events': {
      if (!isDate(args.from)) throw new ToolError('from은 YYYY-MM-DD 형식이어야 합니다.');
      const to = args.to === undefined ? args.from : args.to;
      if (!isDate(to)) throw new ToolError('to는 YYYY-MM-DD 형식이어야 합니다.');
      const { data, error } = await admin.from('calendar_events').select('id,title,start_time,end_time,description')
        .eq('user_id', uid).lte('start_time', `${to}T23:59:59`).gte('end_time', `${args.from}T00:00:00`)
        .order('start_time').limit(MAX_LIST_ROWS);
      if (error) throw new ToolError('일정을 읽지 못했습니다.');
      return textResult(data ?? []);
    }
    case 'add_event': {
      const title = str(args.title, 120);
      if (!title) throw new ToolError('title이 필요합니다.');
      if (!isDate(args.date)) throw new ToolError('date는 YYYY-MM-DD 형식이어야 합니다.');
      if (args.end_date !== undefined && !isDate(args.end_date)) throw new ToolError('end_date는 YYYY-MM-DD 형식이어야 합니다.');
      if (args.start_time !== undefined && !isTime(args.start_time)) throw new ToolError('start_time은 HH:mm 형식이어야 합니다.');
      if (args.end_time !== undefined && !isTime(args.end_time)) throw new ToolError('end_time은 HH:mm 형식이어야 합니다.');
      const endDate = (args.end_date as string | undefined) || args.date;
      const row = {
        id: crypto.randomUUID(),
        user_id: uid,
        title,
        start_time: args.date + (args.start_time ? `T${args.start_time}:00` : 'T00:00:00'),
        end_time: endDate + (args.end_time ? `T${args.end_time}:00` : 'T23:59:59'),
        description: str(args.description, 300) || null,
        color: '#4c2889',
        tags: ['tag_1'],
      };
      const { error } = await admin.from('calendar_events').insert([row]);
      if (error) throw new ToolError('일정을 저장하지 못했습니다.');
      return textResult({ ok: true, id: row.id, title, date: args.date });
    }
    case 'list_todo_lists': {
      const { data, error } = await admin.from('todo_lists').select('id,title').eq('user_id', uid).order('order');
      if (error) throw new ToolError('할 일 목록을 읽지 못했습니다.');
      return textResult(data ?? []);
    }
    case 'list_todos': {
      let query = admin.from('todos').select('id,text,completed,list_id,due_date').eq('user_id', uid);
      if (args.include_completed !== true) query = query.eq('completed', false);
      if (typeof args.list_id === 'string' && args.list_id) query = query.eq('list_id', args.list_id);
      const { data, error } = await query.order('order').limit(MAX_LIST_ROWS);
      if (error) throw new ToolError('할 일을 읽지 못했습니다.');
      return textResult(data ?? []);
    }
    case 'add_todo': {
      const text = str(args.text, 160);
      if (!text) throw new ToolError('text가 필요합니다.');
      if (args.due_date !== undefined && !isDate(args.due_date)) throw new ToolError('due_date는 YYYY-MM-DD 형식이어야 합니다.');
      const listId = await resolveTodoListId(admin, uid, args);
      // Put new items at the end, like the app does.
      const { count } = await admin.from('todos').select('id', { count: 'exact', head: true }).eq('user_id', uid);
      const row = {
        id: crypto.randomUUID(),
        user_id: uid,
        list_id: listId,
        text,
        completed: false,
        order: count ?? 0,
        due_date: (args.due_date as string | undefined) || null,
        sub_tasks: [],
      };
      const { error } = await admin.from('todos').insert([row]);
      if (error) throw new ToolError('할 일을 저장하지 못했습니다.');
      return textResult({ ok: true, id: row.id, text, list_id: listId, due_date: row.due_date });
    }
    case 'add_journal_entry': {
      const content = str(args.content, 1800);
      if (!content) throw new ToolError('content가 필요합니다.');
      const { data: minRow } = await admin.from('journal_entries').select('order').eq('user_id', uid).order('order', { ascending: true }).limit(1).maybeSingle();
      const { data: category } = await admin.from('journal_categories').select('id').eq('user_id', uid).eq('name', '메모장').limit(1).maybeSingle();
      const row = {
        id: crypto.randomUUID(),
        user_id: uid,
        title: str(args.title, 120) || '새 메모',
        content,
        category_id: category?.id ?? null,
        mood: 'neutral',
        date: new Date().toISOString(),
        order: minRow ? (minRow.order ?? 0) - 1 : 0,
      };
      const { error } = await admin.from('journal_entries').insert([row]);
      if (error) throw new ToolError('메모를 저장하지 못했습니다.');
      return textResult({ ok: true, id: row.id, title: row.title });
    }
    default:
      throw new ToolError(`알 수 없는 도구입니다: ${name}`);
  }
};

const handleMessage = async (admin: Admin, auth: Auth, message: Json): Promise<unknown | null> => {
  const { id, method } = message as { id?: unknown; method?: unknown };
  const isNotification = id === undefined || id === null;
  if (typeof method !== 'string') return isNotification ? null : rpcError(id, -32600, 'Invalid Request');
  if (isNotification) return null;

  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Json;
  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Dayflow 일정, 할 일, 메모장을 조회하고 추가합니다. 삭제와 수정은 지원하지 않습니다.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: auth.canWrite ? TOOLS : TOOLS.filter(t => !WRITE_TOOLS.has(t.name)) });
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
      try {
        return rpcResult(id, await callTool(admin, auth, name, args));
      } catch (error) {
        if (error instanceof ToolError) return rpcResult(id, { isError: true, content: [{ type: 'text', text: error.message }] });
        console.error('[mcp-server] tool failure', name, error);
        return rpcResult(id, { isError: true, content: [{ type: 'text', text: '요청을 처리하지 못했습니다.' }] });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
};

const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extra } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return reply(rpcError(null, -32000, 'POST 요청만 지원합니다.'), 405, { Allow: 'POST, OPTIONS' });

  const url = Deno.env.get('SUPABASE_URL'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !secret) return reply(rpcError(null, -32000, '서버가 준비되지 않았습니다.'), 503);
  const admin = createClient(url, secret, { auth: { persistSession: false } });

  const auth = await authenticate(admin, request);
  if (!auth) return reply(rpcError(null, -32001, '유효하지 않은 토큰입니다.'), 401, { 'WWW-Authenticate': 'Bearer' });

  let body: unknown;
  try { body = await request.json(); } catch { return reply(rpcError(null, -32700, 'Parse error'), 400); }

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return reply(rpcError(null, -32600, 'Invalid Request'), 400);
    const responses = (await Promise.all(body.map(m => handleMessage(admin, auth, (m ?? {}) as Json)))).filter(r => r !== null);
    return responses.length === 0 ? new Response(null, { status: 202, headers: corsHeaders }) : reply(responses);
  }

  const response = await handleMessage(admin, auth, (body ?? {}) as Json);
  return response === null ? new Response(null, { status: 202, headers: corsHeaders }) : reply(response);
});

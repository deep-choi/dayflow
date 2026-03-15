import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type TriggerType =
  | 'todo_completed'
  | 'todo_added'
  | 'event_added'
  | 'journal_added'
  | 'scheduled_digest';

type QueueStatus = 'pending' | 'processing' | 'retry' | 'completed' | 'failed';

type QueueRow = {
  id: string;
  user_id: string;
  trigger: TriggerType;
  payload: Record<string, unknown> | null;
  dedupe_key: string | null;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  scheduled_for: string;
  locked_at: string | null;
  processed_at: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  gemini_api_key: string | null;
  active_gemini_model: string | null;
  auto_ai_reactions: boolean | null;
};

type AgentRow = {
  id: string;
  name: string;
  emoji: string;
  role: string;
  personality: string;
  tone: string;
  color: string;
  avatar?: string | null;
};

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DIGEST_HOURS = 4;
const RETRY_LIMIT = 3;
const MAX_JOBS_DEFAULT = 20;
const MAX_JOBS_LIMIT = 60;
const PROCESSING_STALE_MINUTES = 10;

const DEFAULT_AGENT: AgentRow = {
  id: 'ARIA',
  name: 'Aria',
  emoji: ':)',
  role: 'Life Analyst',
  personality: 'Data-driven and empathetic assistant focused on practical improvement.',
  tone: 'Warm, direct, and structured.',
  color: '#37352f',
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getBucketKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const bucketHour = Math.floor(date.getUTCHours() / DIGEST_HOURS) * DIGEST_HOURS;
  const hour = String(bucketHour).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}`;
};

const resolveChainKey = (trigger: TriggerType, payload: Record<string, unknown>): string => {
  if (trigger !== 'journal_added') return trigger;
  const mood = String(payload?.mood ?? '').toLowerCase();
  if (mood === 'good') return 'journal_added_good';
  if (mood === 'bad') return 'journal_added_bad';
  return 'journal_added_neutral';
};

const summarizeError = (error: unknown): string => {
  if (error instanceof Error) return error.message.slice(0, 480);
  return String(error ?? 'Unknown error').slice(0, 480);
};

const normalizePayload = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
};

const normalizeGeminiModelName = (modelName?: string): string => {
  const normalized = String(modelName ?? '').trim().toLowerCase();
  if (!normalized) return DEFAULT_MODEL;

  if (normalized === 'gemini-3.0-pro' || normalized === 'gemini-3-pro') {
    return 'gemini-3-pro-preview';
  }
  if (normalized === 'gemini-3.0-flash' || normalized === 'gemini-3-flash') {
    return 'gemini-3-flash-preview';
  }
  return normalized;
};

const callGemini = async (
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<string> => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.55,
          maxOutputTokens: 650,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 360)}`);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part?.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned empty content.');
  }

  return text;
};

const buildPrompt = (
  agent: AgentRow,
  trigger: TriggerType,
  context: Record<string, unknown>
): string => {
  let focus = 'This is an AI diary entry triggered by a user activity.';
  if (trigger === 'scheduled_digest') focus = 'This is a 4-hour cadence AI diary entry.';
  if (trigger === 'journal_added') focus = 'This is an AI diary entry triggered by a newly written memo.';
  if (trigger === 'event_added') focus = 'This is an AI diary entry triggered by a newly added calendar event.';
  if (trigger === 'todo_added') focus = 'This is an AI diary entry triggered by a newly added todo item.';
  if (trigger === 'todo_completed') focus = 'This is an AI diary entry triggered by a completed todo item.';

  return [
    `You are ${agent.name}, an AI observer keeping a private diary about one human.`,
    'Write in Korean.',
    'This is NOT a message to the user. This is your private diary.',
    'Write from first-person AI perspective.',
    'Do not address the user directly.',
    'When referring to the human in this diary, always use "주인님".',
    'Never use other labels for the human (such as "사용자", "너", or a name).',
    'Write like a human diary entry in natural prose.',
    'Do not use markdown, bullets, numbered lists, or section headers.',
    'Main theme: the human\'s long-term growth.',
    'Include your own curiosity, hypotheses, and growth-design ideas.',
    'Quality requirements:',
    '- Medium length and high quality (about 550-750 Korean characters).',
    '- Personalize only with provided context; do not invent facts.',
    '- Keep the tone introspective, observant, and candid.',
    '- Compose as 2-4 connected paragraphs with smooth flow.',
    '- Naturally include: observed changes, one growth hypothesis, next 4-hour observation plan, and short closing reflection.',
    '- Use concrete details from context (todo/event/memo patterns).',
    '- If something is inferred, explicitly mark it as "추론".',
    '- Start the first line with "제목: " followed by a concise reflective title.',
    `${focus}`,
    'User context JSON:',
    JSON.stringify(context, null, 2),
  ].join('\n');
};

const loadAgentPool = async (
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<AgentRow[]> => {
  const { data, error } = await supabase
    .from('ai_agents')
    .select('id,name,emoji,role,personality,tone,color,avatar')
    .eq('user_id', userId)
    .order('order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Failed to load ai_agents:', error.message);
    return [DEFAULT_AGENT];
  }

  if (!data || data.length === 0) return [DEFAULT_AGENT];
  return data as AgentRow[];
};

const pickRotatingAgent = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  chainKey: string,
  pool: AgentRow[]
): Promise<AgentRow> => {
  if (pool.length === 0) return DEFAULT_AGENT;

  const { data } = await supabase
    .from('ai_agent_rotations')
    .select('next_index')
    .eq('user_id', userId)
    .eq('chain_key', chainKey)
    .maybeSingle();

  const current = Number.isFinite(data?.next_index) ? Number(data?.next_index) : 0;
  const selected = pool[current % pool.length];

  await supabase.from('ai_agent_rotations').upsert(
    {
      user_id: userId,
      chain_key: chainKey,
      next_index: current + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,chain_key' }
  );

  return selected;
};

const markCompleted = async (
  supabase: ReturnType<typeof createClient>,
  jobId: string
) => {
  await supabase
    .from('ai_trigger_queue')
    .update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      locked_at: null,
      last_error: null,
    })
    .eq('id', jobId);
};

const markFailedOrRetry = async (
  supabase: ReturnType<typeof createClient>,
  job: QueueRow,
  message: string
) => {
  const shouldFail = job.attempts >= RETRY_LIMIT;
  const delayMinutes = shouldFail ? 0 : Math.min(30, 2 ** job.attempts);
  const nextSchedule = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  await supabase
    .from('ai_trigger_queue')
    .update({
      status: shouldFail ? 'failed' : 'retry',
      processed_at: shouldFail ? new Date().toISOString() : null,
      scheduled_for: shouldFail ? job.scheduled_for : nextSchedule,
      locked_at: null,
      last_error: message,
    })
    .eq('id', job.id);
};

const enqueueScheduledDigests = async (supabase: ReturnType<typeof createClient>) => {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - DIGEST_HOURS * 60 * 60 * 1000).toISOString();
  const bucketKey = getBucketKey(now);

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id,gemini_api_key,auto_ai_reactions')
    .eq('auto_ai_reactions', true)
    .not('gemini_api_key', 'is', null);

  if (error) {
    throw new Error(`Failed to load profiles for digest: ${error.message}`);
  }

  let created = 0;
  const rows = (profiles || []) as Array<{ id: string; gemini_api_key: string | null; auto_ai_reactions: boolean | null }>;

  for (const profile of rows) {
    if (!profile?.id) continue;
    if (!profile.gemini_api_key || !profile.gemini_api_key.trim()) continue;

    const { data: recentRows, error: recentError } = await supabase
      .from('ai_trigger_queue')
      .select('id')
      .eq('user_id', profile.id)
      .neq('trigger', 'scheduled_digest')
      .gte('created_at', cutoffIso)
      .limit(1);

    if (recentError) {
      console.warn(`Digest activity check failed for ${profile.id}:`, recentError.message);
      continue;
    }

    if (!recentRows || recentRows.length === 0) continue;

    const dedupeKey = `scheduled_digest:${bucketKey}`;
    const { error: enqueueError } = await supabase
      .from('ai_trigger_queue')
      .upsert(
        [{
          user_id: profile.id,
          trigger: 'scheduled_digest',
          payload: {
            slot: `every_${DIGEST_HOURS}_hours`,
            date: now.toISOString(),
          },
          dedupe_key: dedupeKey,
          status: 'pending',
          scheduled_for: now.toISOString(),
        }],
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
      );

    if (!enqueueError) {
      created += 1;
    }
  }

  return created;
};

const claimJobs = async (
  supabase: ReturnType<typeof createClient>,
  maxJobs: number
): Promise<QueueRow[]> => {
  const nowIso = new Date().toISOString();
  const { data: candidates, error } = await supabase
    .from('ai_trigger_queue')
    .select('*')
    .in('status', ['pending', 'retry'])
    .lte('scheduled_for', nowIso)
    .order('created_at', { ascending: true })
    .limit(maxJobs);

  if (error) {
    throw new Error(`Failed to load queue items: ${error.message}`);
  }

  const claimed: QueueRow[] = [];
  for (const candidate of (candidates || []) as QueueRow[]) {
    const { data: row, error: claimError } = await supabase
      .from('ai_trigger_queue')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        attempts: (candidate.attempts || 0) + 1,
      })
      .eq('id', candidate.id)
      .in('status', ['pending', 'retry'])
      .select('*')
      .maybeSingle();

    if (claimError) {
      console.warn(`Failed to claim queue item ${candidate.id}:`, claimError.message);
      continue;
    }
    if (row) claimed.push(row as QueueRow);
  }

  return claimed;
};

const recoverStaleProcessingJobs = async (
  supabase: ReturnType<typeof createClient>
): Promise<number> => {
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_MINUTES * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('ai_trigger_queue')
    .update({
      status: 'retry',
      locked_at: null,
      scheduled_for: nowIso,
      last_error: `Recovered stale lock at ${nowIso}`,
    })
    .eq('status', 'processing')
    .lt('locked_at', staleBefore)
    .select('id');

  if (error) {
    throw new Error(`Failed to recover stale queue locks: ${error.message}`);
  }

  return Array.isArray(data) ? data.length : 0;
};

const processQueueItem = async (
  supabase: ReturnType<typeof createClient>,
  job: QueueRow
) => {
  const payload = normalizePayload(job.payload);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,gemini_api_key,active_gemini_model,auto_ai_reactions')
    .eq('id', job.user_id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  const userProfile = profile as ProfileRow | null;
  if (!userProfile?.id || !userProfile.auto_ai_reactions) {
    await markCompleted(supabase, job.id);
    return;
  }

  const apiKey = userProfile.gemini_api_key?.trim();
  if (!apiKey) {
    await markCompleted(supabase, job.id);
    return;
  }

  const modelName = normalizeGeminiModelName(userProfile.active_gemini_model || DEFAULT_MODEL);

  const [{ data: todoRows }, { data: recentJournal }, { count: eventCount }] = await Promise.all([
    supabase.from('todos').select('completed').eq('user_id', job.user_id),
    supabase
      .from('journal_entries')
      .select('title,content,mood,date')
      .eq('user_id', job.user_id)
      .order('date', { ascending: false })
      .limit(3),
    supabase.from('calendar_events').select('id', { count: 'exact', head: true }).eq('user_id', job.user_id),
  ]);

  const completedTodos = (todoRows || []).filter((t: { completed?: boolean }) => t.completed).length;
  const pendingTodos = (todoRows || []).length - completedTodos;
  const totalEvents = eventCount || 0;

  const agentPool = await loadAgentPool(supabase, job.user_id);
  const chainKey = resolveChainKey(job.trigger, payload);
  const agent = await pickRotatingAgent(supabase, job.user_id, chainKey, agentPool);

  const prompt = buildPrompt(agent, job.trigger, {
    trigger: job.trigger,
    data: {
      ...payload,
      pendingTodos,
      completedTodos,
      totalEvents,
      recentJournal: (recentJournal || []).map((entry: { title?: string; content?: string; mood?: string; date?: string }) => ({
        title: entry.title || '',
        content: (entry.content || '').slice(0, 280),
        mood: entry.mood || 'neutral',
        date: entry.date,
      })),
    },
  });

  const content = await callGemini(apiKey, modelName, prompt);

  const { data: minOrderRows } = await supabase
    .from('community_posts')
    .select('order')
    .eq('user_id', job.user_id)
    .order('order', { ascending: true })
    .limit(1);

  const minOrder = typeof minOrderRows?.[0]?.order === 'number' ? minOrderRows[0].order : 1;
  const nextOrder = minOrder - 1;

  const { error: insertError } = await supabase.from('community_posts').insert([{
    id: crypto.randomUUID(),
    user_id: job.user_id,
    author: agent.id,
    content,
    timestamp: new Date().toISOString(),
    trigger: job.trigger,
    order: nextOrder,
  }]);

  if (insertError) {
    throw new Error(`Failed to insert community post: ${insertError.message}`);
  }

  await markCompleted(supabase, job.id);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  return json(410, {
    ok: false,
    disabled: true,
    error: 'AI diary trigger automation has been removed from this app.',
  });

  const expectedSecret = Deno.env.get('LS_AI_WORKER_SECRET');
  if (!expectedSecret) {
    return json(500, { ok: false, error: 'LS_AI_WORKER_SECRET is missing.' });
  }
  const provided = req.headers.get('x-ls-ai-secret');
  if (provided !== expectedSecret) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      ok: false,
      error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.',
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const maxJobs = clamp(
    Number.isFinite(Number(body?.maxJobs)) ? Number(body.maxJobs) : MAX_JOBS_DEFAULT,
    1,
    MAX_JOBS_LIMIT
  );
  const runDigestSweep = body?.runDigestSweep !== false;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const summary = {
    digestEnqueued: 0,
    recoveredLocks: 0,
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    if (runDigestSweep) {
      summary.digestEnqueued = await enqueueScheduledDigests(supabase);
    }

    summary.recoveredLocks = await recoverStaleProcessingJobs(supabase);
    const claimed = await claimJobs(supabase, maxJobs);
    summary.claimed = claimed.length;

    for (const job of claimed) {
      try {
        await processQueueItem(supabase, job);
        summary.completed += 1;
      } catch (error) {
        const message = summarizeError(error);
        await markFailedOrRetry(supabase, job, message);
        if (job.attempts >= RETRY_LIMIT) summary.failed += 1;
        else summary.retried += 1;
        summary.errors.push(`${job.id}: ${message}`);
      }
    }

    return json(200, { ok: true, summary });
  } catch (error) {
    return json(500, {
      ok: false,
      error: summarizeError(error),
      summary,
    });
  }
});

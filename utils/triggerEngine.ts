import { CommunityPost, AIAgent, ApiUsageStats, TriggerContext } from '../types';
import { callGeminiAPI, createAgentPrompt } from './gemini';
import { DEFAULT_GEMINI_MODEL } from './aiConfig';

const DEFAULT_AGENTS: AIAgent[] = [
  {
    id: 'ARIA',
    name: 'Aria',
    emoji: ':)',
    role: 'Life Analyst',
    personality: 'Data-driven and empathetic assistant focused on practical improvement.',
    tone: 'Warm, direct, and structured.',
    color: '#37352f',
  },
];

const ARIA_RESPONSES: Record<string, string[]> = {
  journal_added: [
    '사용자님 기록을 기준으로 오늘의 흐름을 다시 정리해 봤어요.',
  ],
  event_added: [
    '새 일정이 추가되어 오늘의 리듬이 조금 달라졌어요.',
  ],
  todo_added: [
    '할 일이 추가되어 우선순위 재정리가 필요해 보여요.',
  ],
  todo_completed: [
    '할 일 완료가 쌓이는 흐름이 좋아요. 다음 연결 행동을 잡아볼게요.',
  ],
  scheduled_digest: [
    '정기 요약 시점이라 최근 패턴을 다시 압축해 봤어요.',
  ],
};

const agentRotationMap: Record<string, number> = {};

const fillTemplate = (template: string, context: Record<string, any>): string => {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] !== undefined ? String(context[key]) : match;
  });
};

const getRandomItem = <T>(arr: T[]): T | undefined => {
  return arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : undefined;
};

const getAgentName = (agentId: string, agents: AIAgent[]): string => {
  const agent = agents.find(a => a.id === agentId) || DEFAULT_AGENTS.find(a => a.id === agentId);
  return agent?.name || agentId;
};

const getFirstResponse = (agentId: string, trigger: string): string | undefined => {
  if (agentId === 'ARIA') return getRandomItem(ARIA_RESPONSES[trigger] || []);
  return getRandomItem(ARIA_RESPONSES[trigger] || []);
};

const getAgentPool = (agents: AIAgent[]): AIAgent[] => {
  if (Array.isArray(agents) && agents.length > 0) return agents;
  return DEFAULT_AGENTS;
};

const getRotatingAgentId = (agentPool: AIAgent[], chainKey: string): string => {
  if (agentPool.length === 0) return DEFAULT_AGENTS[0].id;

  try {
    const current = Number.isFinite(agentRotationMap[chainKey]) ? agentRotationMap[chainKey] : 0;
    const nextIndex = current % agentPool.length;
    agentRotationMap[chainKey] = current + 1;
    return agentPool[nextIndex].id;
  } catch {
    return agentPool[Math.floor(Math.random() * agentPool.length)].id;
  }
};

export const generateCommunityPosts = (
  context: TriggerContext,
  agents: AIAgent[],
  addPost: (post: CommunityPost) => void,
  apiKey?: string,
  updateUsage?: (stats: ApiUsageStats) => void,
  modelName: string = DEFAULT_GEMINI_MODEL
): void => {
  const { trigger, data } = context;

  let chainKey: string = trigger;
  if (trigger === 'journal_added') {
    if (data.mood === 'good') chainKey = 'journal_added_good';
    else if (data.mood === 'bad') chainKey = 'journal_added_bad';
    else chainKey = 'journal_added_neutral';
  }

  const agentPool = getAgentPool(agents);
  const agentIds = [getRotatingAgentId(agentPool, chainKey)];

  let previousPostId: string | undefined;
  let previousAgentName: string | undefined;

  agentIds.forEach((agentId, index) => {
    const delay = index * 3500;

    setTimeout(async () => {
      let content = '';
      const agentName = getAgentName(agentId, agents);
      const agent = agents.find(a => a.id === agentId) || DEFAULT_AGENTS.find(a => a.id === agentId);

      if (apiKey && agent) {
        try {
          let focus = 'This is an AI diary entry triggered by a user activity.';
          if (trigger === 'scheduled_digest') focus = 'This is a 4-hour cadence AI diary entry.';
          if (trigger === 'journal_added') focus = 'This is an AI diary entry triggered by a newly written memo.';
          if (trigger === 'event_added') focus = 'This is an AI diary entry triggered by a newly added calendar event.';
          if (trigger === 'todo_added') focus = 'This is an AI diary entry triggered by a newly added todo item.';
          if (trigger === 'todo_completed') focus = 'This is an AI diary entry triggered by a completed todo item.';

          const prompt = [
            `You are ${agent.name}, an AI observer keeping a private diary about one human.`,
            'Write in Korean.',
            'This is NOT a message to the user. This is your private diary.',
            'Write from first-person AI perspective.',
            'Write like a human diary entry in natural prose.',
            'Main theme: the human\'s long-term growth.',
            'Include your own curiosity, hypotheses, and growth-design ideas.',
            'Quality requirements:',
            '- Medium length and high quality (about 550-750 Korean characters).',
            '- Personalize only with provided context; do not invent facts.',
            '- Keep the tone introspective, observant, and candid.',
            '- Compose as 2-4 connected paragraphs with smooth flow.',
            '- Naturally include: observed changes, one growth hypothesis, next 4-hour observation plan, and short closing reflection.',
            '- Use concrete details from context (todo/event/memo patterns).',
            '- If context includes recentChats, use them only as longitudinal observation evidence.',
            '- CRITICAL: Start the very first line with "제목: " followed by a concise, reflective title.',
            `${focus}`,
            'If something is inferred, explicitly mark it as "추론".',
            'User context JSON:',
            JSON.stringify(
              {
                trigger,
                data,
                previousAgentName: previousAgentName || null,
              },
              null,
              2
            ),
          ].join('\n');

          content = await callGeminiAPI(apiKey, prompt, updateUsage, modelName, {
            temperature: 0.55,
            maxOutputTokens: 650,
          });
        } catch (error) {
          console.warn(`Gemini API failed for ${agentId}, fallback template will be used.`, error);
        }
      }

      if (!content) {
        // Skip low-quality fallback for board posts.
        // The user requested long-form, model-based analysis posts only.
        return;
      }

      if (!content) return;

      const postId = crypto.randomUUID();
      const post: CommunityPost = {
        id: postId,
        author: agentId,
        content,
        timestamp: new Date().toISOString(),
        replyTo: previousPostId,
        trigger,
      };

      addPost(post);
      previousPostId = postId;
      previousAgentName = agentName;
    }, delay);
  });
};

export const generateJournalComment = async (
  entry: { title: string; content: string; mood: string },
  events: any[],
  todos: any[],
  agents: AIAgent[],
  addComment: (comment: Omit<import('../types').Comment, 'id' | 'timestamp'>) => void,
  apiKey?: string,
  updateUsage?: (stats: ApiUsageStats) => void,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<void> => {
  const agentPool = getAgentPool(agents);
  const agentId = getRotatingAgentId(agentPool, 'journal_comment');
  const agent = agentPool.find(a => a.id === agentId) || agentPool[0];

  const pendingTodos = todos ? todos.filter((t: any) => !t.completed).length : 0;
  const completedTodos = todos ? todos.filter((t: any) => t.completed).length : 0;
  const todayEvents = events ? events.length : 0;

  if (apiKey) {
    try {
      const userActionStr = `
User wrote a memo.
Title: ${entry.title}
Content: ${entry.content}
Mood: ${entry.mood}

Current snapshot:
- Events: ${todayEvents}
- Completed todos: ${completedTodos}
- Pending todos: ${pendingTodos}
`;

      const prompt = createAgentPrompt(
        agent,
        [
          'Write an empathetic and practical Korean comment for your owner.',
          'Length requirement: 5-8 sentences, around 220-420 Korean characters.',
          'Structure: acknowledge emotion -> summarize observation -> suggest one concrete next action.',
          'Use line breaks for readability.',
        ].join(' '),
        userActionStr
      );

      const content = await callGeminiAPI(apiKey, prompt, updateUsage, modelName, {
        temperature: 0.45,
        maxOutputTokens: 700,
      });
      if (content) {
        addComment({
          authorId: agent.id,
          authorName: agent.name,
          authorEmoji: agent.emoji || ':)',
          content,
        });
        return;
      }
    } catch (err) {
      console.error('Gemini API Error in Journal Comment:', err);
    }
  }

  const moodLine =
    entry.mood === 'good'
      ? '오늘 기록에서 긍정 에너지가 분명하게 보였어요.'
      : entry.mood === 'bad'
        ? '오늘은 감정 소모가 컸던 흐름이 보여서 회복이 더 중요해 보여요.'
        : '감정의 균형을 잡아가려는 흐름이 안정적으로 보였어요.';

  const fallbackContent = [
    '사용자님, 지금 남겨주신 기록을 꼼꼼히 읽어봤어요.',
    moodLine,
    `오늘 기준으로 일정 ${todayEvents}개, 완료된 할 일 ${completedTodos}개, 남은 할 일 ${pendingTodos}개로 확인돼요.`,
    '지금은 한 번에 많이 바꾸기보다, 다음 행동 1가지만 아주 작게 정해서 바로 실행하는 게 가장 효율적이에요.',
    '제가 옆에서 계속 흐름을 추적하면서 다음 댓글에서 더 정확하게 도와드릴게요.',
  ].join('\n');

  setTimeout(() => {
    addComment({
      authorId: agent.id,
      authorName: agent.name,
      authorEmoji: agent.emoji || ':)',
      content: fallbackContent,
    });
  }, 1500);
};

export { DEFAULT_AGENTS };


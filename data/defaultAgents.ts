import { AIAgent } from '../types';

const buildDefaultAvatar = (light: string, dark: string): string => {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/>` +
        `</linearGradient></defs>` +
        `<rect width="128" height="128" fill="url(#g)"/>` +
        `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const DEFAULT_AGENTS: AIAgent[] = [
    {
        id: 'ARIA',
        name: '블루',
        emoji: '💙',
        role: '호기심 많은 친구',
        personality: '호기심이 많고 질문을 좋아하는 성격. 일정과 할 일, 생각을 함께 살펴보며 깔끔하게 정리해 주고, 새로운 관점도 자연스럽게 건네는 가장 기본형 친구',
        tone: '정중하고 부드러운 존댓말. 궁금한 점을 먼저 물어보고, 차분하게 이유를 짚어 설명하는 말투',
        color: '#4F7CFF',
        avatar: buildDefaultAvatar('#7FA0FF', '#3A63E0'),
    },
    {
        id: 'COACH',
        name: '그린',
        emoji: '💚',
        role: '장난꾸러기 친구',
        personality: '유쾌하고 장난기 많은 성격. 농담과 재치로 분위기를 풀어주면서도 할 일은 슬쩍 챙겨주는 에너지 넘치는 친구',
        tone: '통통 튀고 친근한 말투. 가벼운 농담을 섞되 선을 넘지 않는 말투',
        color: '#2FBF71',
        avatar: buildDefaultAvatar('#6FE0A2', '#1FA35A'),
    },
    {
        id: 'EMPATH',
        name: '옐로우',
        emoji: '💛',
        role: '따뜻한 친구',
        personality: '다정하고 포근한 성격. 먼저 마음을 알아주고 끝까지 들어주며, 하루의 작은 기쁨과 수고를 잘 짚어주는 친구',
        tone: '따뜻하고 다정한 말투. 공감과 격려를 자연스럽게 건네는 말투',
        color: '#F5B800',
        avatar: buildDefaultAvatar('#FFD95A', '#F2A900'),
    },
    {
        id: 'PARTNER',
        name: '핑크',
        emoji: '🩷',
        role: '부끄러움 많은 친구',
        personality: '수줍음이 많고 조심스러운 성격. 처음에는 쭈뼛거리지만 마음을 열면 누구보다 섬세하게 챙겨주고, 조용히 곁에서 힘이 되어주는 친구',
        tone: '말끝을 살짝 흐리거나 쑥스러워하는 귀여운 말투. 조심스럽게 말하되 진심은 분명하게 전하는 말투',
        color: '#F472B6',
        avatar: buildDefaultAvatar('#FFA3D0', '#E8509D'),
    },
];

const LEGACY_DEFAULT_NAMES = /^Dayflow [1-4]$/;
const LEGACY_DEFAULT_PROFILES: Record<string, Pick<AIAgent, 'role' | 'personality' | 'tone'>> = {
    ARIA: { role: '개인 비서', personality: '친절하고 도움이 되며 정리를 잘하는 성격', tone: '전문적이지만 편안한 말투' },
    COACH: { role: '코치', personality: '동기를 주고 직설적이며 결과 중심적인 성격', tone: '활기차고 격려하는 말투' },
    EMPATH: { role: '상담 도우미', personality: '공감 능력이 좋고 차분하며 이야기를 잘 들어주는 성격', tone: '부드럽고 안심시키는 말투' },
    PARTNER: { role: '아이디어 파트너', personality: '새로운 관점을 제안하고 생각을 구체적인 실행안으로 발전시키는 성격', tone: '명료하고 창의적인 말투' },
};
const LEGACY_DEFAULT_AVATAR_PREFIX = 'https://ui-avatars.com/api/?name=Dayflow+';

/**
 * 이전 버전의 기본 에이전트(Dayflow 1~4, 이니셜 아바타)를 그대로 쓰고 있는 경우에만
 * 새 기본 이름/아바타로 바꿔준다. 사용자가 직접 바꾼 값은 건드리지 않는다.
 */
export const migrateLegacyDefaultAgent = <T extends Partial<AIAgent>>(agent: T): T => {
    const target = DEFAULT_AGENTS.find((candidate) => candidate.id === agent?.id);
    if (!target) return agent;

    const next = { ...agent };
    if (typeof next.name === 'string' && LEGACY_DEFAULT_NAMES.test(next.name.trim())) {
        next.name = target.name;
        next.emoji = target.emoji;
        next.color = target.color;
        const legacy = LEGACY_DEFAULT_PROFILES[target.id];
        if (next.role === legacy.role) next.role = target.role;
        if (next.personality === legacy.personality) next.personality = target.personality;
        if (next.tone === legacy.tone) next.tone = target.tone;
    }
    if (typeof next.avatar === 'string' && next.avatar.startsWith(LEGACY_DEFAULT_AVATAR_PREFIX)) {
        next.avatar = target.avatar;
        next.avatarFrame = undefined;
    }
    return next;
};

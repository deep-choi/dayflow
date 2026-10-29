import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  ExternalLink,
  FileText,
  House,
  Mail,
  Menu,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { openServicePage } from '../services/appSupportService';

type SupportArticleId =
  | 'updates'
  | 'getting-started'
  | 'chat'
  | 'calendar'
  | 'todo'
  | 'journal'
  | 'account'
  | 'sync'
  | 'troubleshooting'
  | 'faq'
  | 'contact';

type SupportPageId = 'home' | SupportArticleId;

type SupportSection = {
  heading: string;
  body: string;
};

type SupportArticle = {
  id: SupportArticleId;
  label: string;
  title: string;
  description: string;
  icon: React.ElementType;
  /** guide: 순서대로 따라 하는 안내, problem: 증상별 해결 방법 */
  layout: 'guide' | 'problem' | 'updates' | 'faq' | 'contact';
  keywords: string[];
  sections: SupportSection[];
};

type SupportUpdate = {
  date: string;
  title: string;
  items: Array<{ tag: '새 기능' | '개선' | '수정'; text: string }>;
};

const SUPPORT_EMAIL = 'cryingonion77@gmail.com';
const CONTACT_MAIL_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[Dayflow 문의] ')}&body=${encodeURIComponent('문제가 생긴 화면:\n사용한 기능:\n일어난 시각:\n상황 설명:\n\n오류 화면을 캡처해 첨부해 주시면 더 빠르게 확인할 수 있어요.\n비밀번호나 인증 코드는 보내지 마세요.')}`;

const UPDATES: SupportUpdate[] = [
  {
    date: '2026.10.21',
    title: '체험 대화를 더 매끄럽게',
    items: [{ tag: '수정', text: '로그인하지 않은 체험 대화에서도 일정·할 일 추가 같은 동작이 끊기지 않고 이어지도록 고쳤어요.' }],
  },
  {
    date: '2026.10.16',
    title: '로그인 없이 체험해 보기',
    items: [
      { tag: '새 기능', text: '로그인하지 않아도 체험 대화로 AI 비서를 먼저 써 볼 수 있어요.' },
      { tag: '새 기능', text: '페르소나마다 색을 정해 대화 상대를 한눈에 구분할 수 있어요.' },
      { tag: '개선', text: 'AI가 일정, 할 일, 메모 요약을 함께 참고해 더 정확하게 답해요. 지난 날짜의 기록도 찾아볼 수 있어요.' },
      { tag: '개선', text: '모바일 채팅 화면을 다듬었어요.' },
    ],
  },
  {
    date: '2026.10.13',
    title: '개인정보와 계정 요청',
    items: [
      { tag: '새 기능', text: '설정 → 프로필에서 계정 삭제를 요청할 수 있어요.' },
      { tag: '새 기능', text: 'AI 답변 아래의 응답 신고로 문제가 있는 답변을 운영자에게 알릴 수 있어요.' },
    ],
  },
  {
    date: '2026.09.30',
    title: '할 일 정리와 추론 단계',
    items: [
      { tag: '새 기능', text: '할 일을 끌어서 순서를 바꾸고, 목록 카드를 다른 탭으로 옮길 수 있어요.' },
      { tag: '새 기능', text: '채팅 입력창에서 AI의 추론 단계를 바로 조절할 수 있어요.' },
    ],
  },
  {
    date: '2026.09.29',
    title: '새로운 사이드바와 모바일 개선',
    items: [
      { tag: '개선', text: '사이드바를 아이콘 레일과 패널로 나눠 화면을 오가기 쉬워졌어요.' },
      { tag: '새 기능', text: '캘린더 태그를 만들고 색을 바꿀 수 있어요.' },
      { tag: '개선', text: '메모장 편집기를 다듬고, 할 일 목록을 탭별로 묶어 보여 줘요.' },
      { tag: '개선', text: '모바일에서 화면 배치와 터치 동작을 개선했어요.' },
    ],
  },
  {
    date: '2026.08.07',
    title: '고객지원 센터 공개',
    items: [{ tag: '새 기능', text: '사용 방법과 문제 해결 방법을 한곳에서 찾아볼 수 있는 고객지원 센터를 열었어요.' }],
  },
];

const FAQS: SupportSection[] = [
  { heading: '로그인하지 않아도 사용할 수 있나요?', body: '네, 체험 대화로 AI 비서를 먼저 써 볼 수 있어요. 체험은 하루 사용량이 정해져 있어요. 작성한 내용을 계정에 저장하고 다른 기기에서 이어서 쓰려면 로그인해 주세요.' },
  { heading: '내 API 키를 연결할 수 있나요?', body: '설정 → API & AI 모델에서 지원되는 AI 서비스의 API 키를 연결하고 원하는 모델을 고를 수 있어요. 키를 연결하지 않으면 기본 체험 모델로 대화해요.' },
  { heading: '다른 기기에서도 이어서 쓸 수 있나요?', body: '같은 계정으로 로그인하면 일정, 할 일, 메모, 대화가 계정에 저장돼 다른 기기에서도 그대로 이어서 볼 수 있어요.' },
  { heading: '데이터를 내보낼 수 있나요?', body: '설정 → 데이터 관리에서 내보내기를 누르면 일정, 할 일, 메모, 페르소나와 설정을 JSON 파일로 받을 수 있어요.' },
  { heading: 'AI 답변이 이상하면 어떻게 하나요?', body: '로그인한 상태에서 AI 답변 아래의 응답 신고를 누르고 이유를 적어 주세요. 해당 답변과 사유가 운영자에게 전달돼요.' },
  { heading: '계정을 삭제하려면 어떻게 하나요?', body: '설정 → 프로필에서 계정 삭제 요청을 보내거나, 계정 삭제 안내 페이지의 이메일로 요청할 수 있어요. 확인 후 처리되며 삭제가 끝나면 복구할 수 없어요.' },
];

const ARTICLES: Record<SupportArticleId, SupportArticle> = {
  'getting-started': {
    id: 'getting-started',
    label: 'Dayflow 시작하기',
    title: 'Dayflow 시작하기',
    description: '처음 오셨나요? 기본 화면과 기능을 짧게 둘러보세요.',
    icon: Sparkles,
    layout: 'guide',
    keywords: ['처음', '시작', '온보딩', '기본 화면', '체험'],
    sections: [
      { heading: '새 채팅으로 시작하기', body: '새 채팅에서 AI 비서에게 오늘 할 일이나 일정을 편하게 말해 보세요. 대화 중 정리된 내용은 일정, 할 일, 메모로 바로 옮길 수 있어요.' },
      { heading: '작업 공간 둘러보기', body: '왼쪽 아이콘 레일에서 채팅, 캘린더, 할 일, 메모장을 오갈 수 있어요. 모바일에서는 왼쪽 위 메뉴 버튼을 눌러 이동해요.' },
      { heading: '로그인해서 저장하기', body: '로그인하지 않아도 체험 대화를 써 볼 수 있어요. 로그인하면 작성한 내용과 설정이 계정에 저장되고 다른 기기에서도 이어서 쓸 수 있어요.' },
    ],
  },
  chat: {
    id: 'chat',
    label: '채팅 사용하기',
    title: '채팅 사용하기',
    description: 'AI 비서와 대화하며 일정을 정리하고 생각을 기록해 보세요.',
    icon: MessageCircle,
    layout: 'guide',
    keywords: ['채팅', 'AI', '페르소나', '대화', '추론', '모델'],
    sections: [
      { heading: '대화 시작하기', body: '새 채팅을 열고 원하는 내용을 자연스럽게 입력해 보세요. 여러 페르소나를 골라 함께 대화할 수도 있어요.' },
      { heading: '일정과 할 일로 정리하기', body: '대화 중 AI가 정리한 내용을 확인한 뒤 일정, 할 일, 메모로 추가할 수 있어요. AI는 저장된 일정과 할 일, 메모 요약을 함께 참고해 답해요.' },
      { heading: '모델과 추론 단계 바꾸기', body: '입력창에서 사용할 모델과 추론 단계를 바로 바꿀 수 있어요. 추론 단계를 높이면 더 깊이 생각하지만 답변이 조금 느려질 수 있어요.' },
      { heading: '지난 대화 다시 보기', body: '이전에 나눈 대화는 사이드바의 채팅 내역에서 다시 열 수 있어요.' },
    ],
  },
  calendar: {
    id: 'calendar',
    label: '일정 관리',
    title: '일정 관리',
    description: '중요한 약속과 일정을 캘린더에서 한눈에 관리하세요.',
    icon: CalendarDays,
    layout: 'guide',
    keywords: ['일정', '캘린더', '약속', '날짜', '태그'],
    sections: [
      { heading: '일정 추가하기', body: '캘린더에서 원하는 날짜를 누르거나 추가 버튼을 눌러 제목, 시간, 설명을 입력하세요.' },
      { heading: '일정 수정하고 삭제하기', body: '등록한 일정을 누르면 내용을 바꾸거나 더 이상 필요 없는 일정을 지울 수 있어요.' },
      { heading: '태그로 구분하기', body: '업무, 개인처럼 태그를 만들고 색을 정하면 일정을 한눈에 구분할 수 있어요. 태그는 캘린더 화면의 사이드 패널에서 관리해요.' },
    ],
  },
  todo: {
    id: 'todo',
    label: '할 일 관리',
    title: '할 일 관리',
    description: '해야 할 일을 목록으로 나누고 완료 상태를 쉽게 확인하세요.',
    icon: ClipboardList,
    layout: 'guide',
    keywords: ['할 일', '투두', '목록', '완료', '순서', '탭'],
    sections: [
      { heading: '할 일 추가하기', body: '할 일 화면에서 새 항목을 추가하고, 필요하면 마감일이나 목록을 함께 정하세요.' },
      { heading: '목록과 탭으로 나누기', body: '프로젝트, 개인, 루틴처럼 성격이 다른 할 일은 목록과 탭으로 나누면 관리하기 편해요.' },
      { heading: '끌어서 순서 바꾸기', body: '항목을 끌어서 순서를 바꾸고, 목록 카드를 다른 탭으로 옮길 수 있어요.' },
      { heading: '완료 표시하기', body: '끝낸 항목을 체크하면 남은 일에 더 집중할 수 있어요.' },
    ],
  },
  journal: {
    id: 'journal',
    label: '메모장 사용하기',
    title: '메모장 사용하기',
    description: '생각, 회의 내용, 하루 기록을 자유롭게 남겨 보세요.',
    icon: FileText,
    layout: 'guide',
    keywords: ['메모', '일지', '저널', '기록', '검색'],
    sections: [
      { heading: '새 메모 쓰기', body: '메모장에 제목과 내용을 입력해 필요한 정보를 빠르게 기록하세요.' },
      { heading: '카테고리로 정리하기', body: '업무, 개인, 아이디어처럼 카테고리를 만들어 두면 나중에 필요한 기록을 쉽게 찾을 수 있어요.' },
      { heading: '검색하기', body: '검색어를 입력해 예전에 쓴 메모를 빠르게 찾아보세요. 채팅에서 AI에게 지난 기록을 물어볼 수도 있어요.' },
    ],
  },
  account: {
    id: 'account',
    label: '로그인과 계정',
    title: '로그인과 계정',
    description: '로그인, 프로필 설정, 계정 삭제 방법을 안내해요.',
    icon: UserRound,
    layout: 'guide',
    keywords: ['로그인', '회원가입', '계정', '프로필', 'Google', '삭제', '탈퇴'],
    sections: [
      { heading: '회원가입과 로그인', body: '이메일 또는 Google 계정으로 로그인해 Dayflow를 시작할 수 있어요.' },
      { heading: '프로필 바꾸기', body: '설정 → 프로필에서 표시 이름과 프로필 이미지를 바꿀 수 있어요.' },
      { heading: '로그아웃', body: '공용 기기에서는 사용을 마친 뒤 계정 메뉴에서 로그아웃해 주세요.' },
      { heading: '계정 삭제 요청', body: '설정 → 프로필에서 계정 삭제 요청을 보낼 수 있어요. 확인 후 처리되며, 삭제가 끝나면 계정과 연결된 데이터는 복구할 수 없어요.' },
    ],
  },
  sync: {
    id: 'sync',
    label: '데이터 동기화',
    title: '데이터 동기화',
    description: '작성한 일정, 할 일, 메모, 대화가 계정에 저장되는 방식이에요.',
    icon: Cloud,
    layout: 'guide',
    keywords: ['동기화', '데이터', '저장', '백업', '내보내기', '기기'],
    sections: [
      { heading: '저장되는 정보', body: '로그인한 계정의 일정, 할 일, 메모, 채팅 내역과 설정이 계정에 저장돼요.' },
      { heading: '다른 기기에서 이어서 쓰기', body: '같은 계정으로 로그인하면 저장해 둔 작업 공간을 그대로 불러올 수 있어요.' },
      { heading: '파일로 내보내기', body: '설정 → 데이터 관리에서 내보내기를 누르면 일정, 할 일, 메모, 페르소나와 설정을 JSON 파일로 받을 수 있어요.' },
    ],
  },
  troubleshooting: {
    id: 'troubleshooting',
    label: '문제 해결',
    title: '문제 해결',
    description: '자주 생기는 문제와 해결 방법을 먼저 확인해 보세요.',
    icon: Wrench,
    layout: 'problem',
    keywords: ['오류', '문제', '응답 없음', '해결', '안 됨', '느림'],
    sections: [
      { heading: 'AI가 답하지 않아요', body: '연결한 AI 서비스의 API 키와 모델 설정을 확인한 뒤 다시 시도해 보세요. 체험 대화라면 오늘 사용량을 모두 썼을 수 있어요. 체험 사용량은 매일 다시 채워져요.' },
      { heading: '로그인이 되지 않아요', body: '이메일과 비밀번호를 다시 확인해 주세요. Google 로그인이라면 팝업이나 새 창이 막혀 있지 않은지 확인해 주세요.' },
      { heading: '작성한 내용이 보이지 않아요', body: '인터넷 연결을 확인하고 화면을 새로고침해 보세요. 다른 기기라면 같은 계정으로 로그인했는지도 확인해 주세요.' },
      { heading: '동기화가 늦어요', body: '연결이 불안정하면 저장이 늦어질 수 있어요. 잠시 기다린 뒤 새로고침해 보세요.' },
    ],
  },
  updates: {
    id: 'updates',
    label: '업데이트 내역',
    title: '업데이트 내역',
    description: 'Dayflow에 새로 생긴 기능과 달라진 점을 날짜순으로 모았어요.',
    icon: Sparkles,
    layout: 'updates',
    keywords: ['업데이트', '버전', '변경사항', '릴리즈', '새 기능'],
    sections: [],
  },
  faq: {
    id: 'faq',
    label: '자주 묻는 질문',
    title: '자주 묻는 질문',
    description: 'Dayflow를 쓰면서 많이 궁금해하는 내용을 모았어요.',
    icon: CircleHelp,
    layout: 'faq',
    keywords: ['FAQ', '질문', '무료', 'API', '체험'],
    sections: FAQS,
  },
  contact: {
    id: 'contact',
    label: '문의하기',
    title: '문의하기',
    description: '도움말에서 답을 찾지 못했다면 이메일로 알려 주세요. 확인한 뒤 답장 드릴게요.',
    icon: Mail,
    layout: 'contact',
    keywords: ['문의', '지원', '연락', '피드백', '이메일'],
    sections: [
      { heading: '문제가 생긴 화면과 기능', body: '어느 화면에서 어떤 기능을 쓰다가 문제가 생겼는지 알려 주세요.' },
      { heading: '일어난 시각', body: '대략적인 시각을 알려 주시면 기록을 찾아 원인을 더 빨리 확인할 수 있어요.' },
      { heading: '오류 화면 캡처', body: '오류 메시지나 화면을 캡처해 첨부해 주세요. 비밀번호나 인증 코드는 보내지 마세요.' },
    ],
  },
};

// crumb는 문서 위 위치 표시에 쓰는 짧은 이름입니다.
const NAV_GROUPS: Array<{ label: string; crumb: string; items: SupportArticleId[] }> = [
  { label: '시작하기', crumb: '시작하기', items: ['getting-started'] },
  { label: '사용 방법', crumb: '사용 방법', items: ['chat', 'calendar', 'todo', 'journal'] },
  { label: '계정 및 데이터', crumb: '계정 및 데이터', items: ['account', 'sync'] },
  { label: '새 소식', crumb: '새 소식', items: ['updates'] },
  { label: '도움이 필요하신가요?', crumb: '문제 해결과 문의', items: ['troubleshooting', 'faq', 'contact'] },
];

const ARTICLE_ORDER = NAV_GROUPS.flatMap((group) => group.items);
const HOME_TOPICS: SupportArticleId[] = ['getting-started', 'chat', 'calendar', 'todo', 'journal', 'account', 'sync', 'troubleshooting'];
const POPULAR_SEARCHES: Array<{ label: string; id: SupportArticleId; section?: number }> = [
  { label: 'AI가 답하지 않아요', id: 'troubleshooting', section: 0 },
  { label: '체험 대화', id: 'faq', section: 0 },
  { label: 'API 키 연결', id: 'faq', section: 1 },
  { label: '데이터 내보내기', id: 'sync', section: 2 },
];

const groupCrumbOf = (id: SupportArticleId) => NAV_GROUPS.find((group) => group.items.includes(id))?.crumb ?? '';
const sectionAnchor = (id: SupportArticleId, index: number) => `${id}-${index + 1}`;

const readPageFromHash = (): { page: SupportPageId; section?: number } => {
  if (typeof window === 'undefined') return { page: 'home' };
  const [rawPage, rawSection] = decodeURIComponent(window.location.hash.slice(1)).split('/');
  if (!rawPage || !(rawPage in ARTICLES)) return { page: 'home' };
  const section = Number(rawSection);
  return { page: rawPage as SupportArticleId, section: Number.isInteger(section) && section > 0 ? section - 1 : undefined };
};

type SearchResult = { id: SupportArticleId; section?: number; title: string; detail: string };

const searchArticles = (query: string): SearchResult[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const results: SearchResult[] = [];
  for (const id of ARTICLE_ORDER) {
    const article = ARTICLES[id];
    if ([article.label, article.title, article.description, ...article.keywords].join(' ').toLowerCase().includes(normalized)) {
      results.push({ id, title: article.title, detail: article.description });
    }
    article.sections.forEach((section, index) => {
      if (`${section.heading} ${section.body}`.toLowerCase().includes(normalized)) {
        results.push({ id, section: index, title: section.heading, detail: article.title });
      }
    });
  }
  return results.slice(0, 8);
};

interface SupportSearchProps {
  size: 'hero' | 'compact' | 'sheet';
  autoFocus?: boolean;
  onSelect: (id: SupportArticleId, section?: number) => void;
}

const SupportSearch: React.FC<SupportSearchProps> = ({ size, autoFocus = false, onSelect }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  const results = useMemo(() => searchArticles(query), [query]);
  const showPanel = size === 'sheet' ? query.trim().length > 0 : isOpen && query.trim().length > 0;

  const choose = (result: SearchResult) => {
    setQuery('');
    setIsOpen(false);
    onSelect(result.id, result.section);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setQuery('');
      setIsOpen(false);
    }
  };

  const inputClass =
    size === 'hero'
      ? 'h-14 rounded-2xl pl-12 pr-4 text-[16px] shadow-[0_1px_2px_rgba(15,15,15,0.04),0_8px_24px_rgba(15,15,15,0.06)]'
      : size === 'sheet'
        ? 'h-12 rounded-xl pl-11 pr-4 text-[16px]'
        : 'h-10 rounded-lg pl-9 pr-3 text-[13px]';

  return (
    <div className={`relative w-full ${size === 'compact' ? 'max-w-[340px]' : ''}`}>
      <div className="relative">
        <Search
          size={size === 'compact' ? 16 : 19}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[#8a8a8a] ${size === 'hero' ? 'left-4' : size === 'sheet' ? 'left-3.5' : 'left-3'}`}
        />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={size === 'hero' ? '궁금한 내용을 검색해 보세요' : '도움말 검색'}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="고객지원 도움말 검색"
          className={`w-full border border-[#e9e9e8] bg-white text-[#37352f] outline-none transition-colors placeholder:text-[#a3a3a1] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] [&::-webkit-search-cancel-button]:hidden ${inputClass}`}
        />
      </div>
      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className={
            size === 'sheet'
              ? 'mt-3'
              : 'absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[min(420px,60dvh)] overflow-y-auto rounded-xl border border-[#e9e9e8] bg-white p-1.5 text-left shadow-[0_12px_30px_rgba(15,15,15,0.12)]'
          }
        >
          {results.length > 0 ? (
            results.map((result, index) => (
              <button
                key={`${result.id}-${result.section ?? 'article'}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(result)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${index === activeIndex ? 'bg-[#f7f7f7]' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[#37352f]">{result.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#8a8a8a]">{result.section === undefined ? result.detail : `${result.detail} 문서`}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-[#b5b5b5]" />
              </button>
            ))
          ) : (
            <div className="px-3 py-4">
              <p className="text-[14px] font-medium text-[#37352f]">‘{query.trim()}’에 맞는 도움말이 없어요</p>
              <p className="mt-1 text-[13px] leading-5 text-[#8a8a8a]">다른 말로 검색하거나 문의를 남겨 주세요.</p>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery('');
                  onSelect('contact');
                }}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
              >
                <Mail size={15} />
                문의하기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FaqList: React.FC<{ items: SupportSection[]; articleId?: SupportArticleId; openIndex?: number }> = ({ items, articleId, openIndex }) => {
  const [open, setOpen] = useState<number | null>(openIndex ?? null);
  useEffect(() => setOpen(openIndex ?? null), [openIndex]);

  return (
    <div className="divide-y divide-[#e9e9e8] overflow-hidden rounded-2xl border border-[#e9e9e8] bg-white">
      {items.map((item, index) => {
        const isOpen = open === index;
        const panelId = `faq-panel-${articleId ?? 'home'}-${index}`;
        return (
          <section key={item.heading} id={articleId ? sectionAnchor(articleId, index) : undefined} className="scroll-mt-24">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[#fbfbfa] sm:px-5"
              >
                <span className="flex-1 text-[15px] font-medium leading-6 text-[#37352f]">{item.heading}</span>
                <ChevronDown size={18} className={`shrink-0 text-[#8a8a8a] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
            </h3>
            {isOpen && (
              <p id={panelId} className="px-4 pb-5 text-[14px] leading-6 text-[#5f5f5f] sm:px-5">{item.body}</p>
            )}
          </section>
        );
      })}
    </div>
  );
};

const UPDATE_TAG_CLASS: Record<SupportUpdate['items'][number]['tag'], string> = {
  '새 기능': 'bg-[var(--color-primary-light)] text-[var(--color-primary)]',
  개선: 'bg-[#f7f7f7] text-[#5f5f5f]',
  수정: 'bg-[#f7f7f7] text-[#5f5f5f]',
};

const UpdateTimeline: React.FC<{ updates: SupportUpdate[] }> = ({ updates }) => (
  <ol className="relative space-y-8 border-l border-[#e9e9e8] pl-6 sm:pl-8">
    {updates.map((update, index) => (
      <li key={update.date} className="relative">
        <span
          aria-hidden="true"
          className={`absolute top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--app-surface)] -left-[29.5px] sm:-left-[37.5px] ${index === 0 ? 'bg-[var(--color-primary)]' : 'bg-[#d9d9d8]'}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <time className="text-[13px] font-medium tabular-nums text-[#8a8a8a]">{update.date}</time>
          {index === 0 && <span className="rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">최신</span>}
        </div>
        <h3 className="mt-1.5 text-[17px] font-semibold tracking-[-0.02em] text-[#171717]">{update.title}</h3>
        <ul className="mt-3 space-y-2.5">
          {update.items.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5 text-[14px] leading-6 text-[#5f5f5f]">
              <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${UPDATE_TAG_CLASS[item.tag]}`}>{item.tag}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </li>
    ))}
  </ol>
);

const ContactCards: React.FC = () => (
  <div className="grid gap-3 sm:grid-cols-2">
    <a
      href={CONTACT_MAIL_HREF}
      className="group flex flex-col rounded-2xl border border-[#e9e9e8] bg-white p-5 transition-colors hover:border-[#d9d9d8] sm:col-span-2 sm:flex-row sm:items-center sm:gap-5"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary)]">
        <Mail size={20} />
      </span>
      <span className="mt-4 min-w-0 flex-1 sm:mt-0">
        <span className="block text-[16px] font-semibold text-[#171717]">이메일로 문의하기</span>
        <span className="mt-1 block break-all text-[14px] text-[#5f5f5f]">{SUPPORT_EMAIL}</span>
      </span>
      <span className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-[14px] font-medium text-white transition-colors group-hover:bg-[var(--color-primary-hover)] sm:mt-0">
        메일 쓰기
        <ArrowRight size={16} />
      </span>
    </a>
    <button
      type="button"
      onClick={() => void openServicePage('account-deletion')}
      className="flex items-start gap-3 rounded-2xl border border-[#e9e9e8] bg-white p-5 text-left transition-colors hover:border-[#d9d9d8]"
    >
      <UserRound size={18} className="mt-0.5 shrink-0 text-[#8a8a8a]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-[#37352f]">계정 삭제 안내</span>
        <span className="mt-1 block text-[13px] leading-5 text-[#8a8a8a]">앱 밖에서 계정과 데이터 삭제를 요청하는 방법</span>
      </span>
      <ExternalLink size={15} className="mt-1 shrink-0 text-[#b5b5b5]" />
    </button>
    <button
      type="button"
      onClick={() => void openServicePage('privacy')}
      className="flex items-start gap-3 rounded-2xl border border-[#e9e9e8] bg-white p-5 text-left transition-colors hover:border-[#d9d9d8]"
    >
      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#8a8a8a]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-[#37352f]">개인정보처리방침</span>
        <span className="mt-1 block text-[13px] leading-5 text-[#8a8a8a]">어떤 정보를 어떻게 다루는지 확인하기</span>
      </span>
      <ExternalLink size={15} className="mt-1 shrink-0 text-[#b5b5b5]" />
    </button>
  </div>
);

interface SupportViewProps {
  onBackToApp: () => void;
}

const SupportView: React.FC<SupportViewProps> = ({ onBackToApp }) => {
  const initial = useMemo(readPageFromHash, []);
  const [page, setPage] = useState<SupportPageId>(initial.page);
  const [focusSection, setFocusSection] = useState<number | undefined>(initial.section);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const article = page === 'home' ? null : ARTICLES[page];

  const go = useCallback((next: SupportPageId, section?: number) => {
    setPage(next);
    setFocusSection(section);
    setScrollRequest((count) => count + 1);
    setIsMenuOpen(false);
    setIsSearchOpen(false);
    const hash = next === 'home' ? '' : `#${next}${section === undefined ? '' : `/${section + 1}`}`;
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({}, document.title, url);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readPageFromHash();
      setPage(next.page);
      setFocusSection(next.section);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 본문은 main 안에서 스크롤되므로 문서를 바꾸면 main을 맨 위(또는 고른 단락)로 옮깁니다.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const target = page !== 'home' && focusSection !== undefined ? document.getElementById(sectionAnchor(page, focusSection)) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else main.scrollTo({ top: 0 });
  }, [page, focusSection, scrollRequest]);

  // 앱으로 돌아갈 때 고객지원 문서 주소(#chat 등)가 앱 화면 주소에 남지 않게 지웁니다.
  const leave = () => {
    if (window.location.hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    onBackToApp();
  };

  useEffect(() => {
    document.title = article ? `${article.title} · Dayflow 고객지원` : 'Dayflow 고객지원';
    return () => {
      document.title = 'Dayflow';
    };
  }, [article]);

  useEffect(() => {
    if (!isMenuOpen && !isSearchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMenuOpen, isSearchOpen]);

  const articleIndex = article ? ARTICLE_ORDER.indexOf(article.id) : -1;
  const prevId = articleIndex > 0 ? ARTICLE_ORDER[articleIndex - 1] : null;
  const nextId = articleIndex >= 0 && articleIndex < ARTICLE_ORDER.length - 1 ? ARTICLE_ORDER[articleIndex + 1] : null;

  const renderNav = (compact: boolean) => (
    <nav aria-label="고객지원 메뉴" className="space-y-6">
      <button
        type="button"
        onClick={() => go('home')}
        aria-current={page === 'home' ? 'page' : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${compact ? 'min-h-12 text-[15px]' : 'py-2 text-[13px]'} ${page === 'home' ? 'bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]' : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
      >
        <House size={compact ? 18 : 15} strokeWidth={page === 'home' ? 2.4 : 2} />
        고객지원 홈
      </button>
      {NAV_GROUPS.map((group) => (
        <section key={group.label}>
          <h2 className="px-2.5 text-[12px] font-medium text-[#8a8a8a]">{group.label}</h2>
          <div className="mt-1.5 space-y-0.5">
            {group.items.map((id) => {
              const item = ARTICLES[id];
              const Icon = item.icon;
              const isActive = page === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => go(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${compact ? 'min-h-12 text-[15px]' : 'py-2 text-[13px]'} ${isActive ? 'bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]' : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
                >
                  <Icon size={compact ? 18 : 15} strokeWidth={isActive ? 2.4 : 2} />
                  <span className="flex-1">{item.label}</span>
                  {compact && <ChevronRight size={16} className="text-[#b5b5b5]" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );

  const renderHome = () => (
    <>
      <section className="border-b border-[#e9e9e8] bg-[#fbfbfa]">
        <div className="mx-auto w-full max-w-[880px] px-5 pb-10 pt-10 sm:px-8 sm:pb-14 sm:pt-16">
          <p className="text-[13px] font-medium text-[var(--color-primary)]">Dayflow 고객지원</p>
          <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.045em] text-[#171717] sm:text-[40px]">무엇을 도와드릴까요?</h1>
          <p className="mt-3 text-[15px] leading-7 text-[#5f5f5f] sm:text-[16px]">사용 방법부터 문제 해결까지, 필요한 도움말을 찾아보세요.</p>
          <div className="mt-7">
            <SupportSearch size="hero" onSelect={go} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] text-[#8a8a8a]">많이 찾는 도움말</span>
            {POPULAR_SEARCHES.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => go(item.id, item.section)}
                className="inline-flex h-8 items-center rounded-full border border-[#e9e9e8] bg-white px-3 text-[13px] text-[#5f5f5f] transition-colors hover:border-[#d9d9d8] hover:text-[#171717]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[880px] space-y-14 px-5 py-10 sm:px-8 sm:py-14">
        <section aria-labelledby="support-topics">
          <h2 id="support-topics" className="text-[18px] font-semibold tracking-[-0.02em] text-[#171717]">주제별 도움말</h2>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
            {HOME_TOPICS.map((id) => {
              const topic = ARTICLES[id];
              const Icon = topic.icon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => go(id)}
                  className="group flex items-center gap-4 rounded-2xl border border-[#e9e9e8] bg-white p-4 text-left transition-colors hover:border-[#d9d9d8] hover:bg-[#fbfbfa] sm:items-start sm:p-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#171717]">{topic.label}</span>
                    <span className="mt-1 block text-[13px] leading-5 text-[#8a8a8a]">{topic.description}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-[#b5b5b5] transition-transform group-hover:translate-x-0.5 sm:hidden" />
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="support-updates">
          <div className="flex items-end justify-between gap-3">
            <h2 id="support-updates" className="text-[18px] font-semibold tracking-[-0.02em] text-[#171717]">최근 업데이트</h2>
            <button type="button" onClick={() => go('updates')} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]">
              전체 보기
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="mt-4 divide-y divide-[#e9e9e8] overflow-hidden rounded-2xl border border-[#e9e9e8] bg-white">
            {UPDATES.slice(0, 3).map((update, index) => (
              <button
                key={update.date}
                type="button"
                onClick={() => go('updates')}
                className="flex w-full flex-col gap-1 px-4 py-4 text-left transition-colors hover:bg-[#fbfbfa] sm:flex-row sm:items-center sm:gap-6 sm:px-5"
              >
                <time className="flex shrink-0 items-center gap-2 text-[13px] tabular-nums text-[#8a8a8a] sm:w-[104px]">
                  {update.date}
                  {index === 0 && <span className="rounded-full bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">최신</span>}
                </time>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-[#37352f]">{update.title}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-[#8a8a8a]">{update.items[0].text}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="support-faq">
          <div className="flex items-end justify-between gap-3">
            <h2 id="support-faq" className="text-[18px] font-semibold tracking-[-0.02em] text-[#171717]">자주 묻는 질문</h2>
            <button type="button" onClick={() => go('faq')} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]">
              전체 보기
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="mt-4">
            <FaqList items={FAQS.slice(0, 4)} />
          </div>
        </section>

        <section className="rounded-2xl bg-[#f7f7f7] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#171717]">찾는 답이 없나요?</h2>
            <p className="mt-1.5 text-[14px] leading-6 text-[#5f5f5f]">이메일로 알려 주시면 확인한 뒤 답장 드릴게요.</p>
          </div>
          <button
            type="button"
            onClick={() => go('contact')}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] sm:mt-0 sm:w-auto"
          >
            <Mail size={16} />
            문의하기
          </button>
        </section>
      </div>
    </>
  );

  const renderArticleBody = (current: SupportArticle) => {
    if (current.layout === 'updates') return <UpdateTimeline updates={UPDATES} />;
    if (current.layout === 'faq') return <FaqList items={current.sections} articleId={current.id} openIndex={focusSection ?? 0} />;
    if (current.layout === 'contact') {
      return (
        <div className="space-y-10">
          <ContactCards />
          <section>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#171717]">함께 알려 주시면 좋아요</h2>
            <div className="mt-4 space-y-3">
              {current.sections.map((section, index) => (
                <div key={section.heading} id={sectionAnchor(current.id, index)} className="flex gap-3 scroll-mt-24">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f7f7f7] text-[12px] font-semibold tabular-nums text-[#5f5f5f]">{index + 1}</span>
                  <div>
                    <h3 className="text-[15px] font-medium text-[#37352f]">{section.heading}</h3>
                    <p className="mt-1 text-[14px] leading-6 text-[#5f5f5f]">{section.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      );
    }
    if (current.layout === 'problem') {
      return (
        <div className="space-y-3">
          {current.sections.map((section, index) => (
            <section
              key={section.heading}
              id={sectionAnchor(current.id, index)}
              className={`scroll-mt-24 rounded-2xl border bg-white p-5 sm:p-6 ${focusSection === index ? 'border-[var(--color-primary)]' : 'border-[#e9e9e8]'}`}
            >
              <h2 className="flex items-start gap-2.5 text-[16px] font-semibold leading-6 tracking-[-0.02em] text-[#171717]">
                <CircleHelp size={18} className="mt-[3px] shrink-0 text-[#8a8a8a]" />
                {section.heading}
              </h2>
              <p className="mt-2.5 text-[14px] leading-6 text-[#5f5f5f] sm:pl-[28px] sm:text-[15px] sm:leading-7">{section.body}</p>
            </section>
          ))}
        </div>
      );
    }
    return (
      <ol className="space-y-8">
        {current.sections.map((section, index) => (
          <li key={section.heading} id={sectionAnchor(current.id, index)} className="flex gap-4 scroll-mt-24">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${focusSection === index ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#171717] sm:text-[18px]">{section.heading}</h2>
              <p className="mt-2 text-[15px] leading-7 text-[#5f5f5f]">{section.body}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  };

  const renderArticle = (current: SupportArticle) => {
    const Icon = current.icon;
    const showToc = current.layout === 'guide' || current.layout === 'problem';
    return (
      <div className="mx-auto flex w-full max-w-[1080px] gap-12 px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
        <article className="min-w-0 max-w-[720px] flex-1">
          <nav aria-label="현재 위치" className="flex items-center gap-1.5 text-[13px] text-[#8a8a8a]">
            <button type="button" onClick={() => go('home')} className="rounded px-0.5 transition-colors hover:text-[#37352f]">고객지원</button>
            <ChevronRight size={14} className="text-[#b5b5b5]" />
            <span className="truncate">{groupCrumbOf(current.id)}</span>
          </nav>
          <div className="mt-6 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary)]">
            <Icon size={21} />
          </div>
          <h1 className="mt-4 text-[28px] font-semibold leading-tight tracking-[-0.045em] text-[#171717] sm:text-[36px]">{current.title}</h1>
          <p className="mt-3 text-[15px] leading-7 text-[#5f5f5f] sm:text-[16px]">{current.description}</p>

          <div className="mt-9 sm:mt-11">{renderArticleBody(current)}</div>

          {current.layout !== 'contact' && (
            <div className="mt-14 flex flex-col gap-4 rounded-2xl bg-[#f7f7f7] p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[14px] leading-6 text-[#5f5f5f]">원하는 답을 찾지 못했나요?</p>
              <button
                type="button"
                onClick={() => go('contact')}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#e9e9e8] bg-white px-4 text-[14px] font-medium text-[#37352f] transition-colors hover:border-[#d9d9d8]"
              >
                <Mail size={15} />
                문의하기
              </button>
            </div>
          )}

          {(prevId || nextId) && (
            <nav aria-label="다른 도움말" className="mt-6 grid gap-3 border-t border-[#e9e9e8] pt-6 sm:grid-cols-2">
              {prevId ? (
                <button type="button" onClick={() => go(prevId)} className="flex min-h-[72px] flex-col justify-center rounded-xl border border-[#e9e9e8] px-4 py-3 text-left transition-colors hover:border-[#d9d9d8]">
                  <span className="flex items-center gap-1 text-[12px] text-[#8a8a8a]"><ArrowLeft size={13} />이전</span>
                  <span className="mt-1 text-[14px] font-medium text-[#37352f]">{ARTICLES[prevId].label}</span>
                </button>
              ) : <span className="hidden sm:block" />}
              {nextId && (
                <button type="button" onClick={() => go(nextId)} className="flex min-h-[72px] flex-col items-end justify-center rounded-xl border border-[#e9e9e8] px-4 py-3 text-right transition-colors hover:border-[#d9d9d8]">
                  <span className="flex items-center gap-1 text-[12px] text-[#8a8a8a]">다음<ArrowRight size={13} /></span>
                  <span className="mt-1 text-[14px] font-medium text-[#37352f]">{ARTICLES[nextId].label}</span>
                </button>
              )}
            </nav>
          )}
        </article>

        {showToc && (
          <aside className="hidden w-[200px] shrink-0 xl:block">
            <div className="sticky top-12">
              <p className="text-[12px] font-medium text-[#8a8a8a]">이 문서의 내용</p>
              <ul className="mt-3 space-y-1 border-l border-[#e9e9e8]">
                {current.sections.map((section, index) => (
                  <li key={section.heading}>
                    <button
                      type="button"
                      onClick={() => go(current.id, index)}
                      className={`-ml-px block border-l-2 py-1 pl-3 text-left text-[13px] leading-5 transition-colors ${focusSection === index ? 'border-[var(--color-primary)] font-medium text-[var(--color-primary)]' : 'border-transparent text-[#5f5f5f] hover:text-[#171717]'}`}
                    >
                      {section.heading}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white font-sans text-[#37352f]">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[#e9e9e8] px-2 sm:h-16 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={leave}
          aria-label="앱으로 돌아가기"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] sm:hidden"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          type="button"
          onClick={() => go('home')}
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg px-1 text-left"
          aria-label="Dayflow 고객지원 홈"
        >
          <span className="sidebar-brand-logo text-[15px] font-medium tracking-[-0.02em] text-[#37352f]">Dayflow</span>
          <span className="text-[14px] font-medium text-[#5f5f5f]">고객지원</span>
        </button>

        {page !== 'home' && (
          <div className="ml-auto hidden w-full max-w-[340px] md:block">
            <SupportSearch size="compact" onSelect={go} />
          </div>
        )}

        <div className={`flex shrink-0 items-center ${page === 'home' ? 'ml-auto' : 'ml-auto md:ml-0'}`}>
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-label="도움말 검색"
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] md:hidden ${page === 'home' ? 'hidden' : ''}`}
          >
            <Search size={20} />
          </button>
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="고객지원 메뉴 열기"
            aria-expanded={isMenuOpen}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] lg:hidden"
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            onClick={leave}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] sm:inline-flex"
          >
            <ArrowLeft size={16} />
            앱으로 돌아가기
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-[#e9e9e8] px-4 py-6 lg:block">
          {renderNav(false)}
        </aside>

        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {article ? renderArticle(article) : renderHome()}
        </main>
      </div>

      {isMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="고객지원 메뉴">
          <button type="button" aria-label="메뉴 닫기" className="absolute inset-0 bg-black/30" onClick={() => setIsMenuOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(340px,88vw)] flex-col bg-white shadow-[0_0_40px_rgba(15,15,15,0.18)]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e9e9e8] pl-5 pr-2">
              <span className="text-[15px] font-semibold text-[#171717]">고객지원 메뉴</span>
              <button type="button" onClick={() => setIsMenuOpen(false)} aria-label="메뉴 닫기" className="flex h-11 w-11 items-center justify-center rounded-lg text-[#5f5f5f] hover:bg-[#f7f7f7]">
                <X size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">{renderNav(true)}</div>
            <div className="shrink-0 border-t border-[#e9e9e8] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={leave}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f7f7f7] text-[15px] font-medium text-[#37352f]"
              >
                <ArrowLeft size={17} />
                앱으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      )}

      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white md:hidden" role="dialog" aria-modal="true" aria-label="도움말 검색">
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[#e9e9e8] px-2">
            <button type="button" onClick={() => setIsSearchOpen(false)} aria-label="검색 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#5f5f5f] hover:bg-[#f7f7f7]">
              <ArrowLeft size={20} />
            </button>
            <span className="text-[15px] font-semibold text-[#171717]">도움말 검색</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <SupportSearch size="sheet" autoFocus onSelect={go} />
            <p className="mt-6 text-[12px] font-medium text-[#8a8a8a]">많이 찾는 도움말</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {POPULAR_SEARCHES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => go(item.id, item.section)}
                  className="inline-flex h-9 items-center rounded-full border border-[#e9e9e8] px-3.5 text-[14px] text-[#5f5f5f]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportView;

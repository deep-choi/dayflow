import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Cloud,
  FileText,
  MessageCircle,
  Search,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';

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

type SupportSection = {
  heading: string;
  body: string;
  bullets?: string[];
};

type SupportArticle = {
  id: SupportArticleId;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  keywords: string[];
  sections: SupportSection[];
};

type SupportNavGroup = {
  label: string;
  items: Array<{ id: SupportArticleId; icon?: React.ElementType }>;
};

const ARTICLES: Record<SupportArticleId, SupportArticle> = {
  updates: {
    id: 'updates',
    label: '업데이트 내역',
    eyebrow: '고객지원 / 업데이트 내역',
    title: '업데이트 내역',
    description: 'Dayflow에 새로 추가된 기능과 개선 사항을 한곳에서 확인해보세요.',
    keywords: ['업데이트', '버전', '변경사항', '릴리즈'],
    sections: [
      {
        heading: '고객지원 센터 공개',
        body: 'Dayflow의 기능 안내, 문제 해결 방법, 최신 변경 사항을 더 쉽게 찾을 수 있도록 고객지원 센터를 준비했어요.',
        bullets: ['사용 방법을 기능별 문서로 정리했어요.', '업데이트 내용을 날짜별로 계속 추가할 예정이에요.', '문제가 생겼을 때 확인할 수 있는 도움말 메뉴를 마련했어요.'],
      },
      {
        heading: '더 나은 사용 흐름',
        body: '채팅, 일정, 할 일, 메모 등 자주 사용하는 기능의 시작 방법을 문서에서 빠르게 확인할 수 있어요.',
      },
      {
        heading: '다음 업데이트',
        body: '새 기능이 준비되면 이 페이지에 변경 내용과 사용 방법을 함께 안내할게요.',
      },
    ],
  },
  'getting-started': {
    id: 'getting-started',
    label: 'Dayflow 시작하기',
    eyebrow: '고객지원 / 시작하기',
    title: 'Dayflow 시작하기',
    description: '처음 방문하셨나요? Dayflow의 기본 기능을 짧게 둘러보세요.',
    keywords: ['처음', '시작', '온보딩', '기본 화면'],
    sections: [
      { heading: '새 채팅으로 시작하기', body: '새 채팅에서 AI 비서와 대화를 시작하고, 필요한 내용을 일정이나 할 일로 정리해보세요.' },
      { heading: '내 작업 공간 둘러보기', body: '캘린더에서는 일정을, 할 일에서는 해야 할 일을, 메모장에서는 생각과 기록을 관리할 수 있어요.' },
      { heading: '로그인하기', body: '로그인하면 작성한 내용과 설정을 계정에 안전하게 저장하고 다른 기기에서도 이어서 사용할 수 있어요.' },
    ],
  },
  chat: {
    id: 'chat',
    label: '채팅 사용하기',
    eyebrow: '고객지원 / 사용 방법 / 채팅',
    title: '채팅 사용하기',
    description: 'AI 비서와 대화하며 일정을 정리하고 생각을 기록해보세요.',
    keywords: ['채팅', 'AI', '페르소나', '대화'],
    sections: [
      { heading: '대화 시작하기', body: '새 채팅을 열고 원하는 내용을 자연스럽게 입력해보세요. 여러 페르소나를 선택해 함께 대화할 수도 있어요.' },
      { heading: '일정과 할 일 정리', body: '대화 중 정리된 내용을 확인한 뒤 일정, 할 일, 메모로 추가할 수 있어요.' },
      { heading: '대화 내역', body: '이전에 나눈 대화는 사이드바의 채팅 내역에서 다시 열어볼 수 있어요.' },
    ],
  },
  calendar: {
    id: 'calendar',
    label: '일정 관리',
    eyebrow: '고객지원 / 사용 방법 / 일정 관리',
    title: '일정 관리',
    description: '중요한 약속과 해야 할 일을 캘린더에서 한눈에 관리하세요.',
    keywords: ['일정', '캘린더', '약속', '날짜'],
    sections: [
      { heading: '일정 추가하기', body: '캘린더에서 원하는 날짜를 선택하거나 추가 버튼을 눌러 제목, 시간, 설명을 입력하세요.' },
      { heading: '일정 수정 및 삭제', body: '등록한 일정을 선택하면 내용을 바꾸거나 더 이상 필요하지 않은 일정을 삭제할 수 있어요.' },
      { heading: '태그로 구분하기', body: '업무, 개인 일정처럼 태그를 활용하면 중요한 일정을 더 빠르게 찾을 수 있어요.' },
    ],
  },
  todo: {
    id: 'todo',
    label: '할 일 관리',
    eyebrow: '고객지원 / 사용 방법 / 할 일 관리',
    title: '할 일 관리',
    description: '해야 할 일을 목록으로 나누고, 완료 상태를 쉽게 확인하세요.',
    keywords: ['할 일', '투두', '목록', '완료'],
    sections: [
      { heading: '할 일 추가하기', body: '할 일 화면에서 새 항목을 추가하고 필요하면 마감일이나 목록을 함께 정하세요.' },
      { heading: '목록과 탭 활용하기', body: '프로젝트, 개인, 루틴처럼 성격이 다른 할 일은 별도 목록으로 나누면 관리하기 편해요.' },
      { heading: '완료 처리하기', body: '완료한 항목을 체크하면 남은 작업에 더 집중할 수 있어요.' },
    ],
  },
  journal: {
    id: 'journal',
    label: '메모장 사용하기',
    eyebrow: '고객지원 / 사용 방법 / 메모장',
    title: '메모장 사용하기',
    description: '생각, 회의 내용, 하루 기록을 자유롭게 남겨보세요.',
    keywords: ['메모', '일지', '저널', '기록'],
    sections: [
      { heading: '새 메모 작성하기', body: '메모장에 제목과 내용을 입력해 필요한 정보를 빠르게 기록하세요.' },
      { heading: '카테고리로 정리하기', body: '업무, 개인, 아이디어처럼 카테고리를 만들면 나중에 필요한 기록을 쉽게 찾을 수 있어요.' },
      { heading: '검색하기', body: '검색어를 입력해 이전에 작성한 메모와 기록을 빠르게 찾아보세요.' },
    ],
  },
  account: {
    id: 'account',
    label: '로그인과 계정',
    eyebrow: '고객지원 / 계정 및 데이터 / 로그인과 계정',
    title: '로그인과 계정',
    description: '계정 생성, 로그인, 프로필 설정 방법을 안내합니다.',
    keywords: ['로그인', '회원가입', '계정', '프로필'],
    sections: [
      { heading: '회원가입 및 로그인', body: '이메일 또는 지원되는 소셜 로그인으로 계정을 만들고 Dayflow를 시작할 수 있어요.' },
      { heading: '프로필 변경', body: '계정 메뉴의 설정에서 표시 이름과 프로필 이미지를 바꿀 수 있어요.' },
      { heading: '로그아웃', body: '공용 기기에서는 사용을 마친 뒤 계정 메뉴에서 로그아웃해 주세요.' },
    ],
  },
  sync: {
    id: 'sync',
    label: '데이터 동기화',
    eyebrow: '고객지원 / 계정 및 데이터 / 데이터 동기화',
    title: '데이터 동기화',
    description: '작성한 일정, 할 일, 메모, 대화를 계정에 저장하는 방법입니다.',
    keywords: ['동기화', '데이터', '저장', '백업'],
    sections: [
      { heading: '동기화되는 정보', body: '로그인한 계정의 일정, 할 일, 메모, 채팅 내역과 설정이 안전하게 동기화돼요.' },
      { heading: '새 기기에서 이어서 사용하기', body: '같은 계정으로 로그인하면 이전에 저장한 작업 공간을 불러올 수 있어요.' },
      { heading: '동기화가 늦을 때', body: '인터넷 연결 상태를 확인한 뒤 잠시 기다리거나 새로고침해 보세요.' },
    ],
  },
  troubleshooting: {
    id: 'troubleshooting',
    label: '문제 해결',
    eyebrow: '고객지원 / 문제 해결',
    title: '문제 해결',
    description: '자주 발생하는 문제를 먼저 확인해보세요.',
    keywords: ['오류', '문제', '응답 없음', '해결'],
    sections: [
      { heading: 'AI 응답이 없을 때', body: '연결한 AI 서비스의 API 키와 모델 설정을 확인한 뒤 다시 시도해 보세요.' },
      { heading: '로그인할 수 없을 때', body: '입력한 이메일과 비밀번호를 확인하고, 계속 문제가 생기면 로그인 화면에서 다시 시도해 주세요.' },
      { heading: '내용이 보이지 않을 때', body: '네트워크 상태를 확인하고 화면을 새로고침해 보세요. 다른 기기에서는 같은 계정으로 로그인했는지도 확인해 주세요.' },
    ],
  },
  faq: {
    id: 'faq',
    label: '자주 묻는 질문',
    eyebrow: '고객지원 / 자주 묻는 질문',
    title: '자주 묻는 질문',
    description: 'Dayflow 사용 중 많이 궁금해하는 내용을 모았습니다.',
    keywords: ['FAQ', '질문', '무료', 'API'],
    sections: [
      { heading: '로그인하지 않아도 사용할 수 있나요?', body: '기본 화면은 둘러볼 수 있지만, 대화와 데이터 저장 같은 기능은 로그인 후 사용할 수 있어요.' },
      { heading: '내 API 키를 연결할 수 있나요?', body: '설정에서 지원되는 AI 서비스의 API 키를 연결하고 원하는 모델을 선택할 수 있어요.' },
      { heading: '데이터를 내보낼 수 있나요?', body: '계정 설정의 데이터 관리 메뉴에서 내보내기 기능을 이용할 수 있어요.' },
    ],
  },
  contact: {
    id: 'contact',
    label: '문의하기',
    eyebrow: '고객지원 / 문의하기',
    title: '문의하기',
    description: '문서에서 해결되지 않은 문제가 있다면 아래 내용을 준비해 알려주세요.',
    keywords: ['문의', '지원', '연락', '피드백'],
    sections: [
      { heading: '문의 전에 확인할 내용', body: '문제가 발생한 화면, 시각, 사용 중인 기능을 함께 알려주시면 더 빠르게 확인할 수 있어요.' },
      { heading: '오류 화면 첨부', body: '오류가 보이는 화면을 캡처해 함께 전달하면 원인을 파악하는 데 도움이 됩니다.' },
      { heading: '개선 의견', body: '불편했던 점과 원하는 사용 흐름을 구체적으로 남겨주시면 제품 개선에 반영할게요.' },
    ],
  },
};

const NAV_GROUPS: SupportNavGroup[] = [
  { label: '시작하기', items: [{ id: 'getting-started', icon: Sparkles }] },
  {
    label: '사용 방법',
    items: [
      { id: 'chat', icon: MessageCircle },
      { id: 'calendar', icon: CalendarDays },
      { id: 'todo', icon: ClipboardList },
      { id: 'journal', icon: FileText },
    ],
  },
  { label: '새 소식', items: [{ id: 'updates', icon: Sparkles }] },
  {
    label: '계정 및 데이터',
    items: [
      { id: 'account', icon: UserRound },
      { id: 'sync', icon: Cloud },
    ],
  },
  {
    label: '도움이 필요하신가요?',
    items: [
      { id: 'troubleshooting', icon: Wrench }, { id: 'faq', icon: CircleHelp }, { id: 'contact', icon: ArrowUpRight }],
  },
];

interface SupportViewProps {
  onBackToApp: () => void;
}

const SupportView: React.FC<SupportViewProps> = ({ onBackToApp }) => {
  const [activeId, setActiveId] = useState<SupportArticleId>('updates');
  const [searchQuery, setSearchQuery] = useState('');
  const activeArticle = ARTICLES[activeId];

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return Object.values(ARTICLES)
      .filter((article) => [article.label, article.title, article.description, ...article.keywords].join(' ').toLowerCase().includes(normalizedQuery))
      .slice(0, 6);
  }, [searchQuery]);

  const selectArticle = (id: SupportArticleId) => {
    setActiveId(id);
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white font-sans text-[#37352f]">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#e9e9e8] px-4 sm:px-6">
        <button
          type="button"
          onClick={() => selectArticle('updates')}
          className="flex shrink-0 items-center gap-2 text-left"
          aria-label="Dayflow 고객지원 홈"
        >
          <span className="sidebar-brand-logo text-[15px] font-medium tracking-[-0.02em] text-[#37352f]">Dayflow</span>
          <span className="hidden text-[14px] font-medium text-[#37352f] sm:inline">고객지원</span>
        </button>

        <div className="relative ml-auto hidden w-full max-w-[340px] md:block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="도움말 검색"
            className="h-10 w-full rounded-lg border border-[#e5e5e3] bg-white pl-9 pr-3 text-[13px] text-[#37352f] outline-none transition-colors placeholder:text-[#a3a3a1] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)]"
            aria-label="고객지원 문서 검색"
          />
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-[46px] z-30 overflow-hidden rounded-xl border border-[#e5e5e3] bg-white p-1.5 shadow-[0_12px_30px_rgba(15,15,15,0.12)]">
              {searchResults.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => selectArticle(article.id)}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[#f7f7f7]"
                >
                  <span className="block text-[13px] font-medium text-[#37352f]">{article.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#8a8a8a]">{article.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onBackToApp}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">앱으로 돌아가기</span>
          <span className="sm:hidden">돌아가기</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[244px] shrink-0 overflow-y-auto border-r border-[#e9e9e8] px-4 py-7 lg:block">
          <nav className="space-y-6" aria-label="고객지원 메뉴">
            {NAV_GROUPS.map((group) => (
              <section key={group.label}>
                <h2 className="px-2 text-[12px] font-medium text-[#8a8a8a]">{group.label}</h2>
                <div className="mt-1.5 space-y-0.5">
                  {group.items.map(({ id, icon: Icon }) => {
                    const article = ARTICLES[id];
                    const isActive = activeId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => selectArticle(id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${isActive ? 'bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]' : 'text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
                      >
                        {Icon && <Icon size={15} strokeWidth={isActive ? 2.4 : 2} />}
                        <span>{article.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="border-b border-[#e9e9e8] px-4 py-3 md:hidden">
            <label className="sr-only" htmlFor="support-article-select">고객지원 메뉴</label>
            <select
              id="support-article-select"
              value={activeId}
              onChange={(event) => selectArticle(event.target.value as SupportArticleId)}
              className="h-10 w-full rounded-lg border border-[#e5e5e3] bg-white px-3 text-[13px] text-[#37352f] outline-none"
            >
              {NAV_GROUPS.flatMap((group) => group.items.map(({ id }) => (
                <option key={id} value={id}>{group.label} · {ARTICLES[id].label}</option>
              )))}
            </select>
          </div>

          <div className="mx-auto w-full max-w-[1260px] px-5 py-12 sm:px-10 lg:px-14 lg:py-16">
            <article className="max-w-[760px]">
              <p className="text-[13px] text-[#787774]">{activeArticle.eyebrow}</p>
              <div className="mt-7 flex items-center gap-2">
                {activeId === 'updates' && <span className="rounded-full bg-[var(--color-primary-light)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-primary)]">최신 소식</span>}
                <span className="text-[12px] text-[#9b9a97]">2026.08.07</span>
              </div>
              <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.045em] text-[#272727] sm:text-[40px]">{activeArticle.title}</h1>
              <p className="mt-4 text-[16px] leading-7 text-[#5f5f5f]">{activeArticle.description}</p>

              {activeId === 'updates' && (
                <div className="mt-10 rounded-2xl border border-[#e5e5e3] bg-[#fcfcfb] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[var(--color-primary)] shadow-xs"><Sparkles size={18} /></span>
                      <div>
                        <p className="text-[14px] font-semibold text-[#272727]">고객지원 센터를 준비했어요</p>
                        <p className="mt-0.5 text-[12px] text-[#8a8a8a]">2026년 8월 7일</p>
                      </div>
                    </div>
                    <span className="rounded-md border border-[#e5e5e3] bg-white px-2 py-1 text-[11px] font-medium text-[#787774]">NEW</span>
                  </div>
                  <p className="mt-4 text-[14px] leading-6 text-[#5f5f5f]">사용 방법과 문제 해결 문서를 한곳에서 확인할 수 있도록 고객지원 센터를 새로 만들었습니다.</p>
                </div>
              )}

              <div className="mt-12 space-y-12">
                {activeArticle.sections.map((section, index) => (
                  <section key={section.heading} id={`section-${index}`} className="scroll-mt-8">
                    <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-[#272727]">{section.heading}</h2>
                    <p className="mt-3 text-[15px] leading-7 text-[#5f5f5f]">{section.body}</p>
                    {section.bullets && (
                      <ul className="mt-4 space-y-2.5">
                        {section.bullets.map((bullet) => (
                          <li key={bullet} className="flex gap-2.5 text-[14px] leading-6 text-[#5f5f5f]">
                            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>

              <div className="mt-16 border-t border-[#e9e9e8] pt-6">
                <p className="text-[13px] font-medium text-[#37352f]">원하는 정보를 찾으셨나요?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => selectArticle('faq')} className="rounded-lg border border-[#e5e5e3] px-3 py-2 text-[13px] text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7]">자주 묻는 질문</button>
                  <button type="button" onClick={() => selectArticle('contact')} className="rounded-lg border border-[#e5e5e3] px-3 py-2 text-[13px] text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7]">문의하기</button>
                </div>
              </div>
            </article>

          </div>
        </main>
      </div>
    </div>
  );
};

export default SupportView;

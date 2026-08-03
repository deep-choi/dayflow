import React, { useEffect, useRef, useState } from 'react';
import {
  BillingError,
  type BillingSubscription,
  TEMPORARY_PRO_PLAN,
  cancelSubscription,
  confirmBillingCardRegistration,
  getSubscriptionStatus,
  requestBillingCardRegistration,
} from '../services/billingService';

export type SupportTabId = 'main' | 'pricing' | 'terms' | 'privacy' | 'refund' | 'support' | 'ai';

interface SupportCenterViewProps {
  activeTab: SupportTabId;
  onTabChange: (tab: SupportTabId) => void;
  onBack: () => void;
  isAuthenticated: boolean;
  onLogin: () => void;
}

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: SupportTabId; label: string }> }> = [
  {
    label: '안내 센터',
    items: [
      { id: 'main', label: '시작하기' },
      { id: 'support', label: '고객지원 · FAQ' },
    ],
  },
  {
    label: '결제 안내',
    items: [
      { id: 'pricing', label: '요금제' },
      { id: 'refund', label: '환불정책' },
    ],
  },
  {
    label: '서비스 정책',
    items: [
      { id: 'terms', label: '이용약관' },
      { id: 'privacy', label: '개인정보 처리방침' },
      { id: 'ai', label: 'AI 이용 정책' },
    ],
  },
];

const PAGE_META: Record<SupportTabId, { eyebrow: string; title: string; description: string }> = {
  main: {
    eyebrow: '안내 센터',
    title: 'Dayflow 이용 안내',
    description: '서비스 이용과 결제에 필요한 안내를 한곳에서 확인하세요.',
  },
  pricing: {
    eyebrow: '결제 안내',
    title: '요금제',
    description: 'Dayflow Pro의 임시 요금과 웹 정기결제를 확인하세요.',
  },
  refund: {
    eyebrow: '결제 안내',
    title: '환불정책',
    description: '구독 해지와 환불 처리 기준을 안내합니다.',
  },
  terms: {
    eyebrow: '서비스 정책',
    title: '이용약관',
    description: 'Dayflow 서비스를 이용할 때 적용되는 기본 원칙입니다.',
  },
  privacy: {
    eyebrow: '서비스 정책',
    title: '개인정보 처리방침',
    description: '사용자 정보와 저장 데이터를 처리하는 기준을 안내합니다.',
  },
  ai: {
    eyebrow: '서비스 정책',
    title: 'AI 이용 정책',
    description: 'AI 기능을 안전하게 이용하기 위한 기본 원칙입니다.',
  },
  support: {
    eyebrow: '고객지원',
    title: '자주 묻는 질문',
    description: 'Dayflow 이용 중 궁금한 내용을 빠르게 찾아보세요.',
  },
};

const DocumentSection = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="py-9 first:pt-0 sm:py-11">
    <h2 className="border-b border-[#dcdcd9] pb-2.5 text-[22px] font-semibold tracking-[-0.025em] text-[#171717]">{title}</h2>
    {description && <p className="mt-3.5 max-w-3xl text-[16px] leading-7 text-[#62625f]">{description}</p>}
    <div className="mt-6">{children}</div>
  </section>
);

const BulletList = ({ items }: { items: string[] }) => (
  <ul className="max-w-3xl list-disc space-y-3 pl-5 text-[16px] leading-7 text-[#4f4f4c] marker:text-[#a0a09c]">
    {items.map((item) => <li key={item}>{item}</li>)}
  </ul>
);

const TextRows = ({ items }: { items: Array<[string, string]> }) => (
  <div className="space-y-3">
    {items.map(([title, text]) => (
      <div key={title} className="py-3 sm:grid sm:grid-cols-[180px_1fr] sm:gap-8">
        <h3 className="text-[16px] font-semibold leading-7 text-[#171717]">{title}</h3>
        <p className="mt-1.5 text-[16px] leading-7 text-[#62625f] sm:mt-0">{text}</p>
      </div>
    ))}
  </div>
);

const MainPanel = ({ onTabChange }: Pick<SupportCenterViewProps, 'onTabChange'>) => (
  <div className="divide-y divide-[#e7e7e5]">
    {[
      ['support', '고객지원 · FAQ', '계정, 데이터, 결제와 AI 이용에 관한 자주 묻는 질문을 확인합니다.'],
      ['pricing', '요금제 안내', 'Dayflow Pro 출시 준비 현황과 요금 공개 원칙을 확인합니다.'],
      ['refund', '구독 해지와 환불', '자동결제 해지와 환불 처리 기준을 확인합니다.'],
      ['privacy', '개인정보 보호', 'Dayflow가 사용자 데이터를 처리하는 원칙을 확인합니다.'],
    ].map(([id, title, description]) => (
      <button
        key={id}
        type="button"
        onClick={() => onTabChange(id as SupportTabId)}
        className="block w-full py-4 text-left sm:grid sm:grid-cols-[210px_1fr] sm:gap-10"
      >
        <span className="text-[16px] font-semibold leading-7 text-[#171717]">{title}</span>
        <span className="mt-1.5 block text-[16px] leading-7 text-[#62625f] sm:mt-0">{description}</span>
      </button>
    ))}
  </div>
);

const FAQS = [
  { category: '서비스 이용', question: '서비스 이용 중 문제가 발생했어요.', answer: '먼저 페이지를 새로고침하고 다시 로그인해 주세요. 문제가 계속되면 사용 중인 기기와 브라우저, 문제가 발생한 화면과 시간을 함께 적어 고객지원으로 알려주세요.' },
  { category: '서비스 이용', question: '저장한 일정이나 할 일이 보이지 않아요.', answer: '같은 계정으로 로그인했는지 확인한 뒤 동기화가 끝날 때까지 잠시 기다려 주세요. 계속 보이지 않는다면 데이터를 새로 만들지 말고 고객지원에 먼저 문의해 주세요.' },
  { category: '계정', question: '로그인이 되지 않아요.', answer: '가입할 때 사용한 로그인 방식과 이메일을 확인해 주세요. 비밀번호 로그인이라면 비밀번호 재설정을 진행하고, Google 로그인이라면 동일한 Google 계정을 선택해 주세요.' },
  { category: '계정', question: '회원탈퇴를 하면 데이터는 어떻게 되나요?', answer: '탈퇴가 완료되면 법령상 보관이 필요한 정보를 제외한 계정 데이터는 정해진 절차에 따라 삭제됩니다. 삭제된 데이터는 복구할 수 없도록 안내한 뒤 최종 확인을 받습니다.' },
  { category: '결제 및 환불', question: 'Dayflow Pro는 언제 결제할 수 있나요?', answer: '현재 토스페이먼츠를 이용한 웹 정기결제를 준비하고 있습니다. 가격, 제공량과 출시일이 확정되면 요금제 페이지에서 결제 전에 안내합니다.' },
  { category: '결제 및 환불', question: '구독은 언제든 해지할 수 있나요?', answer: '구독이 출시되면 내 계정에서 언제든 해지할 수 있도록 준비합니다. 해지 후에는 현재 이용기간 종료일까지 사용할 수 있고 다음 결제일부터 자동 청구가 중단됩니다.' },
  { category: '결제 및 환불', question: '결제 취소나 환불은 어떻게 요청하나요?', answer: '중복결제, 결제 오류, 결제 직후 미사용 여부와 서비스 장애 내역을 확인한 뒤 최종 환불정책과 관련 법령에 따라 처리합니다.' },
  { category: 'AI 이용', question: 'AI 답변이 부정확하거나 이상해요.', answer: 'AI 답변은 부정확할 수 있습니다. 중요한 정보는 반드시 다시 확인해 주세요. 같은 문제가 반복되면 사용한 모델과 질문 내용, 발생 시간을 고객지원에 전달해 주세요.' },
  { category: 'AI 이용', question: '개인 API나 로컬 모델을 연결할 수 있나요?', answer: 'Dayflow는 지원되는 AI 제공업체의 개인 API와 로컬 모델 연결 기능을 제공합니다. 연결 정보는 설정의 AI 항목에서 관리할 수 있습니다.' },
] as const;

const FAQ_CATEGORIES = ['전체', '서비스 이용', '계정', '결제 및 환불', 'AI 이용'] as const;

const CustomerSupportPanel = () => {
  const [category, setCategory] = useState<(typeof FAQ_CATEGORIES)[number]>('전체');
  const visibleFaqs = category === '전체' ? FAQS : FAQS.filter((faq) => faq.category === category);

  return (
    <div>
      <div className="flex gap-5 overflow-x-auto border-b border-[#dcdcd9]" role="tablist" aria-label="FAQ 분류">
        {FAQ_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
            onClick={() => setCategory(item)}
            className={`shrink-0 border-b-2 pb-3 text-[16px] ${category === item
              ? 'border-[var(--color-primary)] font-semibold text-[#171717]'
              : 'border-transparent text-[#777773] hover:text-[#171717]'}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="divide-y divide-[#e7e7e5] border-b border-[#e7e7e5]">
        {visibleFaqs.map((faq) => (
          <details key={faq.question} className="group py-5">
            <summary className="relative cursor-pointer list-none pr-8 text-[16px] font-semibold leading-7 text-[#242422] marker:content-none after:absolute after:right-1 after:top-0 after:text-[20px] after:font-normal after:text-[#8a8a86] after:content-['+'] group-open:after:content-['−']">
              {faq.question}
            </summary>
            <p className="mt-3 max-w-3xl text-[16px] leading-7 text-[#62625f]">{faq.answer}</p>
          </details>
        ))}
      </div>
      <div className="mt-10 pt-7">
        <h2 className="text-[17px] font-semibold text-[#171717]">도움이 더 필요하신가요?</h2>
        <p className="mt-2 text-[16px] leading-7 text-[#62625f]">사업자 정보와 공식 지원 이메일 확정 후 문의 접수를 시작합니다.</p>
        <p className="mt-3 text-[15px] font-medium text-[var(--color-primary)]">결제 출시 전 공개 예정</p>
      </div>
    </div>
  );
};

const formatDate = (value: string | null): string => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
};

const PricingPanel = ({ isAuthenticated, onLogin }: Pick<SupportCenterViewProps, 'isAuthenticated' | 'onLogin'>) => {
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(isAuthenticated);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);
  const confirmationStarted = useRef(false);

  const clearBillingQuery = () => {
    const url = new URL(window.location.href);
    ['billing', 'authKey', 'customerKey', 'code', 'message'].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, document.title, `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get('billing');
    const authKey = params.get('authKey');
    const customerKey = params.get('customerKey');

    if (billingResult === 'success' && authKey && customerKey && !confirmationStarted.current) {
      confirmationStarted.current = true;
      setIsLoading(true);
      confirmBillingCardRegistration(authKey, customerKey)
        .then((result) => {
          setSubscription(result);
          setNotice({ tone: 'success', message: '카드 등록과 첫 결제가 완료되었습니다. Dayflow Pro 구독이 시작됐어요.' });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '구독 시작을 완료하지 못했습니다.';
          setNotice({ tone: 'error', message });
        })
        .finally(() => {
          clearBillingQuery();
          setIsLoading(false);
        });
      return;
    }

    if (billingResult === 'fail') {
      const message = params.get('message') || '카드 등록이 취소되었거나 실패했습니다.';
      setNotice({ tone: 'error', message });
      clearBillingQuery();
    }

    setIsLoading(true);
    getSubscriptionStatus()
      .then(setSubscription)
      .catch((error: unknown) => {
        if (error instanceof BillingError && ['BILLING_NOT_CONFIGURED', 'BILLING_NOT_DEPLOYED'].includes(error.code)) {
          setNotice({ tone: 'info', message: error.message });
          return;
        }
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : '구독 상태를 확인하지 못했습니다.' });
      })
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

  const startSubscription = async () => {
    if (!isAuthenticated) {
      onLogin();
      return;
    }
    setIsLoading(true);
    setNotice(null);
    try {
      await requestBillingCardRegistration();
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : '결제창을 열지 못했습니다.' });
      setIsLoading(false);
    }
  };

  const cancelCurrentSubscription = async () => {
    if (!window.confirm('다음 자동결제를 중단할까요? 현재 이용기간까지는 Pro를 계속 사용할 수 있습니다.')) return;
    setIsLoading(true);
    setNotice(null);
    try {
      await cancelSubscription();
      setSubscription((current) => current ? { ...current, status: 'canceled', next_billing_at: null, canceled_at: new Date().toISOString() } : current);
      setNotice({ tone: 'success', message: '구독을 해지했습니다. 현재 결제한 이용기간까지 Pro를 사용할 수 있습니다.' });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : '구독을 해지하지 못했습니다.' });
    } finally {
      setIsLoading(false);
    }
  };

  const isActive = subscription?.status === 'active';

  return (
    <div>
      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mb-9 border-l-2 px-4 py-3 text-[16px] leading-7 ${notice.tone === 'error'
            ? 'border-[#d94b4b] bg-[#fff7f7] text-[#8d2f2f]'
            : notice.tone === 'success'
              ? 'border-[var(--color-primary)] bg-[#f5f8ff] text-[#294d9c]'
              : 'border-[#aaa9a4] bg-[#f7f7f5] text-[#62625f]'}`}
        >
          {notice.message}
        </div>
      )}

      <DocumentSection title="요금제 비교" description="아래 가격과 AI 제공량은 결제 연결을 검증하기 위한 임시 기준이며 정식 출시 전에 변경될 수 있습니다.">
        <div className="grid border-y border-[#dcdcd9] md:grid-cols-2 md:divide-x md:divide-[#dcdcd9]">
          <div className="py-7 md:pr-9">
            <p className="text-[18px] font-semibold text-[#171717]">Free</p>
            <p className="mt-4 text-[30px] font-semibold tracking-[-0.04em] text-[#171717]">무료</p>
            <ul className="mt-6 space-y-2.5 text-[16px] leading-7 text-[#62625f]">
              <li>일정, 할 일, 메모 관리</li>
              <li>가입 후 무료 AI 체험</li>
              <li>개인 API와 로컬 모델 연결</li>
            </ul>
          </div>
          <div className="border-t border-[#dcdcd9] py-7 md:border-t-0 md:pl-9">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[18px] font-semibold text-[#171717]">{TEMPORARY_PRO_PLAN.name}</p>
              <span className="text-[14px] font-medium text-[var(--color-primary)]">임시 요금</span>
            </div>
            <p className="mt-4 text-[30px] font-semibold tracking-[-0.04em] text-[#171717]">
              월 {TEMPORARY_PRO_PLAN.amount.toLocaleString('ko-KR')}원
            </p>
            <p className="mt-1 text-[15px] text-[#777773]">부가가치세 포함 · 매월 자동결제</p>
            <ul className="mt-6 space-y-2.5 text-[16px] leading-7 text-[#62625f]">
              <li>매월 AI 대화 {TEMPORARY_PRO_PLAN.aiQuota.toLocaleString('ko-KR')}회</li>
              <li>Free의 모든 기능 포함</li>
              <li>웹에서 구독 상태와 다음 결제 예정일 관리</li>
            </ul>
            <button
              type="button"
              onClick={startSubscription}
              disabled={isLoading || isActive}
              className="mt-7 w-full bg-[var(--color-primary)] px-5 py-3.5 text-[16px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isLoading ? '확인 중...' : isActive ? '이용 중' : isAuthenticated ? '카드 등록하고 시작하기' : '로그인하고 시작하기'}
            </button>
          </div>
        </div>
      </DocumentSection>

      {subscription && (
        <DocumentSection title="내 구독" description="등록된 카드 전체 번호는 Dayflow에 저장하지 않으며 토스페이먼츠가 발급한 결제키로 자동결제합니다.">
          <TextRows items={[
            ['구독 상태', subscription.status === 'active' ? '이용 중' : subscription.status === 'canceled' ? '해지됨' : '결제 확인 필요'],
            ['이용기간', `${formatDate(subscription.current_period_start)} ~ ${formatDate(subscription.current_period_end)}`],
            ['다음 결제일', subscription.status === 'active' ? formatDate(subscription.next_billing_at) : '자동결제 중단'],
            ['결제수단', [subscription.card_company, subscription.card_number_masked].filter(Boolean).join(' ') || '등록된 카드'],
          ]} />
          {subscription.status === 'active' && (
            <button type="button" onClick={cancelCurrentSubscription} disabled={isLoading} className="mt-6 text-[16px] font-medium text-[#686864] underline underline-offset-4 hover:text-[#171717] disabled:opacity-45">
              구독 해지하기
            </button>
          )}
        </DocumentSection>
      )}

      <DocumentSection title="결제 진행 방식" description="국내 신용·체크카드를 등록하면 첫 달 요금이 바로 결제됩니다. 정식 운영 전 매월 결제 실행 스케줄을 연결합니다.">
        <TextRows items={[
          ['1. 요금제 확인', '월 결제금액, AI 제공량, 자동결제 주기와 환불 기준을 확인합니다.'],
          ['2. 카드 등록', '토스페이먼츠 결제창에서 본인 카드를 등록합니다. Dayflow는 전체 카드번호를 직접 저장하지 않습니다.'],
          ['3. 첫 결제', '카드 등록이 끝나면 서버에서 월 9,900원을 확인하고 첫 결제를 승인합니다.'],
          ['4. 구독 관리', '이 페이지에서 이용기간과 다음 결제 예정일을 확인하고 이후 자동결제를 해지할 수 있습니다.'],
        ]} />
      </DocumentSection>
    </div>
  );
};

const TermsPanel = () => (
  <div>
    <DocumentSection title="약관의 목적과 적용" description="이 약관은 Dayflow 계정과 서비스 기능을 이용할 때 회사와 사용자 사이에 적용되는 기본 기준을 설명하기 위한 초안입니다.">
      <BulletList items={[
        '회원가입 또는 서비스 이용을 시작하면 공개된 약관과 운영정책이 적용됩니다.',
        '유료 서비스에는 결제 전에 별도로 고지한 가격, 이용기간과 상품 조건이 함께 적용됩니다.',
        '약관이 변경되면 시행일과 주요 변경 내용을 서비스 안에서 미리 안내합니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="계정과 사용자 책임">
      <TextRows items={[
        ['계정 관리', '사용자는 정확한 가입 정보를 제공하고 자신의 로그인 수단을 안전하게 관리해야 합니다. 계정을 다른 사람에게 양도하거나 판매할 수 없습니다.'],
        ['저장 콘텐츠', '사용자가 입력한 일정, 할 일, 메모와 채팅 내용에 대한 권리와 책임은 사용자에게 있습니다.'],
        ['금지 행위', '서비스 장애 유발, 비정상적인 자동화 요청, 타인의 권리 침해, 불법 콘텐츠 생성이나 계정 도용 행위를 금지합니다.'],
      ]} />
    </DocumentSection>
    <DocumentSection title="서비스 운영과 이용 제한">
      <BulletList items={[
        '점검, 장애 또는 외부 AI 제공업체의 상태에 따라 일부 기능이 일시적으로 제한될 수 있습니다.',
        '기능이나 제공 방식이 크게 변경되는 경우 변경 이유와 적용 시점을 안내합니다.',
        '약관이나 운영정책을 반복적으로 위반하면 사전 안내 후 일부 기능 또는 계정 이용을 제한할 수 있습니다.',
        '회원탈퇴 전 필요한 데이터는 사용자가 직접 확인하고 내보낼 수 있는 절차를 제공합니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="유료 서비스">
      <TextRows items={[
        ['자동결제', '정기 구독은 사용자가 해지하기 전까지 안내된 주기에 따라 갱신됩니다. 다음 결제일과 금액은 내 계정에서 확인할 수 있게 제공합니다.'],
        ['결제 실패', '결제수단 문제로 승인이 실패하면 구독 상태와 재결제 방법을 안내하며, 일정 기간 후 유료 기능이 제한될 수 있습니다.'],
        ['해지와 환불', '구독 해지와 환불에는 결제 당시 공개된 환불정책 및 관련 법령이 적용됩니다.'],
      ]} />
      <p className="mt-6 text-[15px] leading-7 text-[#858581]">현재 문서는 정식 약관 작성 전 서비스 운영 기준을 설명하는 초안입니다. 사업자 정보와 결제 조건이 확정되면 약관 버전, 공고일과 시행일을 함께 게시합니다.</p>
    </DocumentSection>
  </div>
);

const PrivacyPanel = () => (
  <div>
    <DocumentSection title="처리하는 정보" description="Dayflow는 계정 운영과 사용자가 요청한 기능 제공에 필요한 범위에서 정보를 처리합니다.">
      <TextRows items={[
        ['계정 정보', '이메일, 표시 이름, 프로필 이미지, 로그인 제공자와 계정 식별정보를 처리합니다. 비밀번호 로그인 정보는 인증 시스템의 보호된 방식으로 관리합니다.'],
        ['사용자 콘텐츠', '사용자가 직접 입력한 일정, 할 일, 메모, 채팅 내용과 페르소나 설정을 저장하고 동기화합니다.'],
        ['서비스 기록', '로그인 시각, 기능 이용 기록, 오류 정보와 기기·브라우저 관련 정보를 서비스 보안과 장애 대응에 필요한 범위에서 처리할 수 있습니다.'],
        ['결제 정보', '유료 서비스 출시 후 주문번호, 상품명, 결제금액, 결제상태, 구독기간과 결제수단의 제한된 식별정보를 처리합니다. 전체 카드번호는 Dayflow가 직접 저장하지 않습니다.'],
      ]} />
    </DocumentSection>
    <DocumentSection title="이용 목적과 보관">
      <BulletList items={[
        '회원 확인, 로그인 유지와 계정 복구를 위해 계정 정보를 이용합니다.',
        '일정과 기록 동기화, AI 응답 생성 등 사용자가 요청한 기능을 제공하기 위해 저장 데이터를 이용합니다.',
        '결제 승인, 구독 상태 확인, 환불과 고객 문의 처리를 위해 결제 기록을 이용합니다.',
        '회원탈퇴 시 복구할 수 없다는 안내와 최종 확인을 거친 뒤 데이터를 삭제합니다.',
        '전자상거래 등 관련 법령에서 일정 기간 보관을 요구하는 정보는 해당 기간 동안 분리 보관한 뒤 삭제합니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="외부 서비스와 데이터 전달" description="선택한 기능에 따라 아래 서비스로 필요한 정보가 전달될 수 있습니다. 최종 방침에는 처리 목적, 항목, 보유기간과 국외 이전 여부를 구체적으로 공개합니다.">
      <TextRows items={[
        ['Supabase', '회원 인증과 사용자 데이터 저장·동기화를 위해 이용합니다.'],
        ['Firebase', '웹 애플리케이션 제공과 배포를 위해 이용합니다.'],
        ['AI 제공업체', 'AI 응답을 만들기 위해 사용자가 선택한 모델 제공업체로 질문과 필요한 대화 문맥이 전달될 수 있습니다.'],
        ['토스페이먼츠', '유료 서비스 출시 후 결제 승인, 취소, 정기결제와 결제 상태 확인을 위해 이용할 예정입니다.'],
      ]} />
    </DocumentSection>
    <DocumentSection title="사용자의 권리">
      <BulletList items={[
        '내 계정에서 프로필과 저장 데이터를 확인하거나 수정할 수 있습니다.',
        '제공되는 내보내기 기능을 이용해 주요 데이터를 내려받을 수 있습니다.',
        '회원탈퇴를 통해 개인정보 삭제를 요청할 수 있으며 법정 보관 대상은 별도로 안내합니다.',
        '개인정보 처리와 관련한 문의 채널은 정식 고객지원 정보가 확정되는 즉시 공개합니다.',
      ]} />
      <p className="mt-6 text-[15px] leading-7 text-[#858581]">현재 문서는 개인정보 처리방침 작성을 위한 서비스 구조 안내입니다. 정식 출시 전 개인정보 보호책임자, 연락처, 보유기간과 시행일을 포함한 최종 방침을 게시합니다.</p>
    </DocumentSection>
  </div>
);

const RefundPanel = () => (
  <div>
    <DocumentSection title="구독 해지" description="구독이 출시되면 고객지원 문의 없이 내 계정에서 직접 해지할 수 있도록 제공합니다.">
      <TextRows items={[
        ['해지 신청', '내 계정의 구독 관리에서 해지를 선택하고 이용 종료일을 확인한 뒤 신청합니다.'],
        ['이용 가능 기간', '일반적인 정기 구독 해지는 현재 결제한 이용기간의 마지막 날까지 유료 기능을 사용할 수 있습니다.'],
        ['다음 결제', '해지가 완료되면 다음 자동결제일부터 추가 청구가 중단됩니다.'],
        ['확인 방법', '해지 완료일, 남은 이용기간과 최종 이용 종료일을 내 계정에 표시합니다.'],
      ]} />
    </DocumentSection>
    <DocumentSection title="환불을 검토하는 경우" description="환불 요청이 접수되면 결제 상태, 요청 시점과 실제 유료 기능 이용 여부를 함께 확인합니다.">
      <BulletList items={[
        '동일한 상품이 중복으로 결제되었거나 승인 과정에서 명백한 결제 오류가 발생한 경우',
        '결제 직후 유료 기능을 사용하지 않은 상태에서 취소를 요청한 경우',
        'Dayflow의 중대한 서비스 장애로 유료 기능을 정상적으로 이용하지 못한 경우',
        '관련 법령상 청약철회 또는 환불이 필요한 경우',
      ]} />
    </DocumentSection>
    <DocumentSection title="환불 요청 절차">
      <TextRows items={[
        ['1. 요청 접수', '고객지원 채널에서 계정 이메일, 주문번호, 결제일과 요청 사유를 제출합니다. 비밀번호나 전체 카드번호는 요청하지 않습니다.'],
        ['2. 이용 내역 확인', '결제 승인 상태, 유료 기능 이용량, 중복결제와 장애 여부를 확인합니다.'],
        ['3. 처리 결과 안내', '환불 가능 여부와 처리 금액을 안내한 뒤 원래 결제수단으로 취소를 요청합니다.'],
        ['4. 환급 완료', '실제 환급 시점은 카드사와 결제수단에 따라 달라질 수 있으며 결제 취소 결과에서 확인할 수 있습니다.'],
      ]} />
      <p className="mt-6 text-[15px] leading-7 text-[#858581]">유료 결제는 아직 시작되지 않았습니다. 상품 가격과 제공 방식이 확정되면 청약철회 가능 기간, 이용량에 따른 공제 기준과 처리기간을 최종 환불정책에 명시합니다.</p>
    </DocumentSection>
  </div>
);

const AiPolicyPanel = () => (
  <div>
    <DocumentSection title="AI가 제공하는 기능" description="Dayflow의 AI는 대화를 바탕으로 일정을 정리하고 할 일, 메모와 생각을 구조화하는 보조 도구입니다.">
      <BulletList items={[
        '사용자의 질문에 답하고 일정, 할 일과 메모를 정리하도록 도울 수 있습니다.',
        '연결한 모델과 설정에 따라 답변의 품질, 속도와 사용할 수 있는 기능이 달라질 수 있습니다.',
        'AI가 데이터 변경을 제안하거나 실행하는 경우 사용자가 결과를 확인하고 수정할 수 있어야 합니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="반드시 알아야 할 한계">
      <BulletList items={[
        'AI 응답은 부정확하거나 최신 정보가 아닐 수 있으므로 중요한 판단은 반드시 확인합니다.',
        '의료, 법률, 금융, 안전 등 전문적인 판단이나 긴급한 결정을 AI 답변만으로 내리지 않습니다.',
        'AI가 작성한 일정, 할 일, 요약과 계산 결과는 저장하거나 활용하기 전에 사용자가 직접 검토해야 합니다.',
        '모델 제공업체의 장애, 사용량 제한 또는 정책 변경에 따라 답변 생성이 일시적으로 중단될 수 있습니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="대화 데이터와 모델 연결">
      <TextRows items={[
        ['Dayflow 제공 모델', '응답 생성에 필요한 질문과 대화 문맥이 Dayflow가 연결한 AI 제공업체로 전달될 수 있습니다.'],
        ['개인 API', '사용자가 직접 등록한 API를 이용할 때에는 해당 제공업체의 이용약관, 데이터 처리와 비용 정책이 적용됩니다.'],
        ['로컬 모델', '로컬 모델을 선택하면 모델 실행은 사용자의 환경에서 이루어질 수 있지만 Dayflow의 계정 동기화 데이터는 별도 저장 설정의 영향을 받습니다.'],
        ['민감정보', '주민등록번호, 금융정보, 건강정보, 비밀번호와 타인의 개인정보처럼 불필요한 민감정보를 대화에 입력하지 않아야 합니다.'],
      ]} />
    </DocumentSection>
    <DocumentSection title="금지되는 이용과 제한">
      <BulletList items={[
        '불법 행위, 사기, 계정 탈취, 악성코드 제작이나 타인에게 실질적인 피해를 주기 위한 이용',
        '타인의 개인정보, 저작권, 초상권과 그 밖의 권리를 침해하는 콘텐츠 생성이나 배포',
        '서비스 안정성을 해치는 자동화 요청, 비정상적인 대량 호출 또는 이용 제한 우회',
        '악용이 확인된 경우 사전 안내 또는 긴급 조치 후 AI 기능이나 계정 이용이 제한될 수 있습니다.',
      ]} />
    </DocumentSection>
    <DocumentSection title="정책 변경 안내">
      <p className="max-w-3xl text-[16px] leading-7 text-[#62625f]">사용 모델, AI 제공업체 또는 데이터 처리 방식이 달라지면 적용일과 주요 변경 내용을 안내합니다. 사용자 권리나 데이터 처리에 중요한 변경은 시행 전에 확인할 수 있도록 별도로 고지합니다.</p>
    </DocumentSection>
  </div>
);

const SupportCenterView: React.FC<SupportCenterViewProps> = ({ activeTab, onTabChange, onBack, isAuthenticated, onLogin }) => {
  const meta = PAGE_META[activeTab];
  const panel = (() => {
    switch (activeTab) {
      case 'pricing': return <PricingPanel isAuthenticated={isAuthenticated} onLogin={onLogin} />;
      case 'terms': return <TermsPanel />;
      case 'privacy': return <PrivacyPanel />;
      case 'refund': return <RefundPanel />;
      case 'support': return <CustomerSupportPanel />;
      case 'ai': return <AiPolicyPanel />;
      case 'main':
      default: return <MainPanel onTabChange={onTabChange} />;
    }
  })();

  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-30 border-b border-[#e7e7e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center px-5 sm:px-8">
          <button type="button" onClick={onBack} className="text-left text-[18px] font-semibold tracking-[-0.03em] text-[#171717] hover:text-[var(--color-primary)]">
            Dayflow <span className="font-normal text-[#8a8a8a]">안내 센터</span>
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1320px] md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#e7e7e5] px-6 py-10 md:block">
          <nav className="sticky top-24 space-y-9" aria-label="안내 센터 문서">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-[15px] font-medium tracking-[0.01em] text-[#a0a09c]">{group.label}</p>
                <div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onTabChange(item.id)}
                      className={`block w-full px-3 py-2.5 text-left text-[16px] ${activeTab === item.id
                        ? 'font-semibold text-[var(--color-primary)]'
                        : 'font-normal text-[#555552] hover:text-[#171717]'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-5 py-7 sm:px-9 sm:py-10 lg:px-14 lg:py-12">
          <label className="mb-8 block md:hidden">
            <span className="sr-only">안내 문서 선택</span>
            <select
              value={activeTab}
              onChange={(event) => onTabChange(event.target.value as SupportTabId)}
              className="w-full border border-[#dcdcd9] bg-white px-3 py-3 text-[16px] text-[#171717] outline-none focus:border-[var(--color-primary)]"
            >
              {NAV_GROUPS.flatMap((group) => group.items).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          <div className="mb-10 border-b border-[#dcdcd9] pb-8">
            <p className="text-[15px] font-medium text-[var(--color-primary)]">{meta.eyebrow}</p>
            <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.045em] text-[#171717] sm:text-[40px]">{meta.title}</h1>
            <p className="mt-3 max-w-3xl text-[17px] leading-8 text-[#62625f]">{meta.description}</p>
          </div>

          <div className="max-w-[860px]">{panel}</div>
        </main>
      </div>
    </div>
  );
};

export default SupportCenterView;

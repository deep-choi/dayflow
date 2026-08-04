import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { AdminDashboardData, AdminMember, getAdminDashboard } from '../services/adminService';

const PLAN_LABELS: Record<string, string> = {
  dayflow_free: '무료',
  dayflow_plus_monthly: 'Plus',
  dayflow_pro_monthly: 'Pro',
};

const STATUS_LABELS: Record<string, string> = {
  active: '이용 중',
  canceled: '해지 예정',
  past_due: '결제 지연',
  free: '무료',
  DONE: '결제 완료',
  CANCELED: '취소',
  PARTIAL_CANCELED: '부분 취소',
  ABORTED: '결제 중단',
  EXPIRED: '만료',
};

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatWon = (amount: number): string => `${Math.max(0, Number(amount) || 0).toLocaleString('ko-KR')}원`;

const getStatusClassName = (status: string): string => {
  if (status === 'active' || status === 'DONE') return 'bg-[#eaf7ee] text-[#2f7d47]';
  if (status === 'past_due' || status === 'ABORTED') return 'bg-[#fff3df] text-[#a15c00]';
  if (status === 'CANCELED' || status === 'PARTIAL_CANCELED') return 'bg-[#fff0f0] text-[#b34040]';
  return 'bg-[#f2f2f0] text-[#6f6f6b]';
};

const MemberAvatar = ({ member }: { member: AdminMember }) => (
  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f1f1f0] text-[13px] font-medium text-[#5f5f5f]">
    {member.avatarUrl ? (
      <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
    ) : (
      member.name.slice(0, 1).toUpperCase()
    )}
  </div>
);

const AdminView: React.FC = () => {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getAdminDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '운영 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const filteredMembers = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return data?.members || [];
    return (data?.members || []).filter((member) =>
      member.name.toLowerCase().includes(normalized)
      || member.email.toLowerCase().includes(normalized)
      || (PLAN_LABELS[member.planId] || member.planId).toLowerCase().includes(normalized)
    );
  }, [data?.members, searchQuery]);

  const membersById = useMemo(
    () => new Map((data?.members || []).map((member) => [member.id, member])),
    [data?.members]
  );

  return (
    <div className="mx-auto w-full max-w-[1380px] space-y-8 px-4 py-8 pb-16 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-4 border-b border-[#e9e9e8] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[13px] font-medium text-[var(--color-primary)]">ADMIN</div>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.03em] text-[#171717]">운영 대시보드</h1>
          <p className="mt-2 text-sm text-[#787774]">회원, 구독, 결제와 AI 사용량을 조회합니다. 현재 화면은 읽기 전용입니다.</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generatedAt && <span className="text-xs text-[#9b9a97]">갱신 {formatDate(data.generatedAt)}</span>}
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={isLoading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dededb] bg-white px-3 text-sm text-[#37352f] transition-colors hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </header>

      {error && (
        <div className="border-l-2 border-[#d94848] bg-[#fff8f8] px-4 py-3 text-sm leading-6 text-[#8f3030]">
          {error}
        </div>
      )}

      <section aria-label="운영 현황" className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-[#e9e9e8] pb-7 lg:grid-cols-4">
        {[
          ['전체 회원', data?.summary.totalUsers ?? 0, '명'],
          ['유료 이용 중', data?.summary.activeSubscriptions ?? 0, '명'],
          ['이번 달 결제', formatWon(data?.summary.monthlyRevenue ?? 0), ''],
          ['누적 AI 요청', data?.summary.aiRequests ?? 0, '회'],
        ].map(([label, value, suffix]) => (
          <div key={String(label)}>
            <div className="text-[13px] text-[#8a8a8a]">{label}</div>
            <div className="mt-2 text-2xl font-medium tracking-[-0.02em] text-[#171717]">
              {isLoading && !data ? '-' : value}{suffix}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-[#171717]">회원</h2>
            <p className="mt-1 text-[13px] text-[#8a8a8a]">최근 가입 순으로 최대 100명까지 표시합니다.</p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="이름, 이메일, 요금제 검색"
              className="h-10 w-full rounded-lg border border-[#dededb] bg-white pl-9 pr-3 text-sm text-[#37352f] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
        </div>

        <div className="overflow-x-auto border-y border-[#e9e9e8]">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="text-[12px] font-medium text-[#8a8a8a]">
                <th className="px-3 py-3">회원</th>
                <th className="px-3 py-3">가입</th>
                <th className="px-3 py-3">최근 로그인</th>
                <th className="px-3 py-3">요금제</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3 text-right">AI 사용</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr key={member.id} className="border-t border-[#efefed] text-sm text-[#37352f]">
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-3">
                      <MemberAvatar member={member} />
                      <div className="min-w-0">
                        <div className="font-medium text-[#171717]">{member.name}</div>
                        <div className="mt-0.5 max-w-[260px] truncate text-xs text-[#8a8a8a]">{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(member.joinedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(member.lastSignInAt)}</td>
                  <td className="px-3 py-3.5 font-medium">{PLAN_LABELS[member.planId] || member.planId}</td>
                  <td className="px-3 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClassName(member.subscriptionStatus)}`}>
                      {STATUS_LABELS[member.subscriptionStatus] || member.subscriptionStatus}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums">{member.aiUsed.toLocaleString('ko-KR')}회</td>
                </tr>
              ))}
              {!isLoading && filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-sm text-[#9b9a97]">표시할 회원이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-[#171717]">최근 결제</h2>
          <p className="mt-1 text-[13px] text-[#8a8a8a]">결제키와 빌링키 같은 민감정보는 표시하지 않습니다.</p>
        </div>
        <div className="overflow-x-auto border-y border-[#e9e9e8]">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="text-[12px] font-medium text-[#8a8a8a]">
                <th className="px-3 py-3">결제 시각</th>
                <th className="px-3 py-3">회원</th>
                <th className="px-3 py-3">요금제</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3 text-right">금액</th>
              </tr>
            </thead>
            <tbody>
              {(data?.payments || []).map((payment) => {
                const member = membersById.get(payment.user_id);
                return (
                  <tr key={payment.id} className="border-t border-[#efefed] text-sm text-[#37352f]">
                    <td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(payment.approved_at || payment.created_at)}</td>
                    <td className="px-3 py-3.5">
                      <div>{member?.name || '알 수 없는 회원'}</div>
                      <div className="mt-0.5 text-xs text-[#8a8a8a]">{member?.email || payment.user_id}</div>
                    </td>
                    <td className="px-3 py-3.5 font-medium">{PLAN_LABELS[payment.plan_id] || payment.plan_id}</td>
                    <td className="px-3 py-3.5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClassName(payment.status)}`}>
                        {STATUS_LABELS[payment.status] || payment.status}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-right font-medium tabular-nums">{formatWon(payment.amount)}</td>
                  </tr>
                );
              })}
              {!isLoading && (data?.payments.length || 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center text-sm text-[#9b9a97]">아직 결제 내역이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AdminView;

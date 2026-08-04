import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  Headphones,
  Menu,
  RefreshCw,
  Search,
  ScrollText,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAudit,
  AdminDashboardData,
  AdminMember,
  AdminPayment,
  AdminSection,
  AdminSubscription,
  getAdminDashboard,
  runAdminOperation,
} from '../services/adminService';

type AdminViewProps = {
  adminName?: string;
  adminEmail?: string;
  onExit: () => void;
};

type PendingAction =
  | { type: 'suspend_user' | 'restore_user'; targetId: string; title: string; description: string }
  | { type: 'cancel_subscription'; targetId: string; title: string; description: string }
  | { type: 'refund_payment'; targetId: string; title: string; description: string; maxAmount: number; operationId: string };

const PLAN_LABELS: Record<string, string> = {
  dayflow_free: 'Free',
  dayflow_plus_monthly: 'Plus',
  dayflow_pro_monthly: 'Pro',
};

const STATUS_LABELS: Record<string, string> = {
  active: '자동갱신',
  canceled: '해지 예정',
  past_due: '결제 지연',
  free: '무료',
  DONE: '결제 완료',
  FAILED: '결제 실패',
  CANCELED: '전체 환불',
  PARTIAL_CANCELED: '부분 환불',
  ABORTED: '결제 중단',
  EXPIRED: '만료',
  succeeded: '성공',
  failed: '실패',
  processing: '처리 중',
  open: '접수',
  in_progress: '처리 중',
  resolved: '답변 완료',
  closed: '종료',
  received: '수신',
  processed: '처리 완료',
  ignored: '무시',
};

const ACTION_LABELS: Record<string, string> = {
  'member.note.created': '회원 메모 작성',
  'member.suspended': '회원 이용 제한',
  'member.restored': '회원 이용 복구',
  'subscription.canceled': '구독 자동갱신 해지',
  'subscription.renewed': '구독 자동갱신 성공',
  'subscription.billing_key_deleted': '빌링키 삭제 반영',
  'payment.refunded': '결제 환불',
  'support.replied': '고객 문의 답변',
  'support.status_changed': '고객 문의 상태 변경',
};

const NAV_ITEMS: Array<{ id: AdminSection; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: '운영 현황', icon: LayoutDashboard },
  { id: 'members', label: '회원', icon: Users },
  { id: 'billing', label: '구독·결제', icon: CreditCard },
  { id: 'ai', label: 'AI 사용량', icon: Bot },
  { id: 'support', label: '고객지원', icon: Headphones },
  { id: 'system', label: '시스템', icon: Activity },
  { id: 'audit', label: '감사 기록', icon: ScrollText },
];

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

const formatWon = (amount: number): string => `${Math.max(0, Number(amount) || 0).toLocaleString('ko-KR')}원`;
const formatNumber = (value: number): string => Math.max(0, Number(value) || 0).toLocaleString('ko-KR');

const getStatusClassName = (status: string): string => {
  if (status === 'active' || status === 'DONE' || status === 'succeeded' || status === 'processed' || status === 'resolved') return 'bg-[#eaf7ee] text-[#2f7d47]';
  if (status === 'past_due' || status === 'FAILED' || status === 'failed' || status === 'ABORTED') return 'bg-[#fff0f0] text-[#b34040]';
  if (status === 'canceled' || status === 'PARTIAL_CANCELED' || status === 'processing' || status === 'open' || status === 'in_progress' || status === 'received') return 'bg-[#fff3df] text-[#925600]';
  return 'bg-[#f2f2f0] text-[#6f6f6b]';
};

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClassName(status)}`}>
    {STATUS_LABELS[status] || status}
  </span>
);

const MemberAvatar = ({ member }: { member: AdminMember }) => (
  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f1f1f0] text-[13px] font-medium text-[#5f5f5f]">
    {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" /> : member.name.slice(0, 1).toUpperCase()}
  </div>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="py-14 text-center text-sm text-[#8a8a8a]">{children}</div>
);

const SectionHeader = ({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#171717]">{title}</h1>
      <p className="mt-2 text-[14px] leading-6 text-[#787774]">{description}</p>
    </div>
    {action}
  </div>
);

const Metric = ({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) => (
  <div className="border-t border-[#dededb] pt-4">
    <div className="text-[13px] text-[#8a8a8a]">{label}</div>
    <div className="mt-2 text-[24px] font-medium tracking-[-0.02em] text-[#171717]">{value}</div>
    {detail && <div className="mt-1.5 text-[13px] text-[#8a8a8a]">{detail}</div>}
  </div>
);

const AdminView: React.FC<AdminViewProps> = ({ adminName, adminEmail, onExit }) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberNote, setMemberNote] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [supportReply, setSupportReply] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [isActionRunning, setIsActionRunning] = useState(false);

  const loadDashboard = async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    setError(null);
    try {
      setData(await getAdminDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '운영 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, []);

  const navigate = (next: AdminSection) => {
    setSection(next);
    setIsMobileNavOpen(false);
    setSearchQuery('');
  };

  const membersById = useMemo(
    () => new Map((data?.members || []).map((member) => [member.id, member])),
    [data?.members],
  );
  const subscriptionsByUser = useMemo(
    () => new Map((data?.subscriptions || []).map((subscription) => [subscription.user_id, subscription])),
    [data?.subscriptions],
  );
  const selectedMember = selectedMemberId ? membersById.get(selectedMemberId) || null : null;
  const selectedSubscription = selectedMember ? subscriptionsByUser.get(selectedMember.id) || null : null;
  const selectedTicket = selectedTicketId ? data?.support.tickets.find((ticket) => ticket.id === selectedTicketId) || null : null;

  const filteredMembers = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return (data?.members || []).filter((member) => {
      const matchesSearch = !normalized
        || member.name.toLowerCase().includes(normalized)
        || member.email.toLowerCase().includes(normalized);
      const matchesPlan = planFilter === 'all' || member.planId === planFilter;
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'suspended' ? Boolean(member.bannedUntil && new Date(member.bannedUntil).getTime() > Date.now()) : member.subscriptionStatus === statusFilter);
      return matchesSearch && matchesPlan && matchesStatus;
    });
  }, [data?.members, planFilter, searchQuery, statusFilter]);

  const filteredPayments = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return (data?.payments || []).filter((payment) => {
      const member = membersById.get(payment.user_id);
      const matchesSearch = !normalized
        || payment.toss_order_id.toLowerCase().includes(normalized)
        || member?.name.toLowerCase().includes(normalized)
        || member?.email.toLowerCase().includes(normalized);
      return matchesSearch && (statusFilter === 'all' || payment.status === statusFilter);
    });
  }, [data?.payments, membersById, searchQuery, statusFilter]);

  const filteredAudits = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return (data?.audits || []).filter((audit) => !normalized
      || audit.adminEmail.toLowerCase().includes(normalized)
      || (ACTION_LABELS[audit.action] || audit.action).toLowerCase().includes(normalized)
      || (audit.reason || '').toLowerCase().includes(normalized));
  }, [data?.audits, searchQuery]);

  const performAction = async () => {
    if (!pendingAction || actionReason.trim().length < 2) return;
    setIsActionRunning(true);
    setError(null);
    try {
      await runAdminOperation({
        action: pendingAction.type,
        targetId: pendingAction.targetId,
        reason: actionReason.trim(),
        ...(pendingAction.type === 'refund_payment' ? { amount: Number(refundAmount) || pendingAction.maxAmount, operationId: pendingAction.operationId } : {}),
      });
      setPendingAction(null);
      setActionReason('');
      setRefundAmount('');
      setNotice('관리자 작업이 처리되고 감사 기록에 저장되었습니다.');
      await loadDashboard(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '관리자 작업을 처리하지 못했습니다.');
    } finally {
      setIsActionRunning(false);
    }
  };

  const saveMemberNote = async () => {
    if (!selectedMember || !memberNote.trim()) return;
    setIsActionRunning(true);
    try {
      await runAdminOperation({ action: 'add_note', targetId: selectedMember.id, note: memberNote.trim() });
      setMemberNote('');
      setNotice('운영 메모를 저장했습니다.');
      await loadDashboard(true);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : '메모를 저장하지 못했습니다.');
    } finally {
      setIsActionRunning(false);
    }
  };

  const replyToTicket = async () => {
    if (!selectedTicket || !supportReply.trim()) return;
    setIsActionRunning(true);
    try {
      await runAdminOperation({
        action: 'support_reply',
        targetId: selectedTicket.id,
        reason: '고객 문의 답변',
        message: supportReply.trim(),
      });
      setSupportReply('');
      setNotice('고객 문의에 답변했습니다.');
      await loadDashboard(true);
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : '답변을 저장하지 못했습니다.');
    } finally {
      setIsActionRunning(false);
    }
  };

  const changeTicketStatus = async (status: 'open' | 'in_progress' | 'resolved' | 'closed') => {
    if (!selectedTicket) return;
    setIsActionRunning(true);
    try {
      await runAdminOperation({
        action: 'support_status',
        targetId: selectedTicket.id,
        reason: `문의 상태를 ${status}(으)로 변경`,
        status,
      });
      setNotice('문의 처리 상태를 변경했습니다.');
      await loadDashboard(true);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '문의 상태를 변경하지 못했습니다.');
    } finally {
      setIsActionRunning(false);
    }
  };

  const refreshButton = (
    <button
      type="button"
      onClick={() => void loadDashboard()}
      disabled={isLoading}
      className="inline-flex h-10 items-center justify-center gap-2 border border-[#dededb] bg-white px-3 text-[14px] text-[#37352f] hover:bg-[#f7f7f7] disabled:opacity-60"
    >
      <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} /> 새로고침
    </button>
  );

  const renderOverview = () => (
    <div className="space-y-10">
      <SectionHeader
        title="운영 현황"
        description="문제가 필요한 항목을 먼저 확인하고 서비스·매출·AI 상태를 점검합니다."
        action={<div className="flex items-center gap-3"><span className="text-xs text-[#8a8a8a]">갱신 {formatDate(data?.generatedAt)}</span>{refreshButton}</div>}
      />

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="text-[18px] font-medium text-[#171717]">조치 필요</h2><p className="mt-1 text-[13px] text-[#8a8a8a]">운영자가 확인해야 할 상태입니다.</p></div>
          <span className="text-[13px] text-[#8a8a8a]">{data?.alerts.length || 0}개 항목</span>
        </div>
        {(data?.alerts.length || 0) > 0 ? (
          <div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">
            {data?.alerts.map((alert) => (
              <button key={alert.id} type="button" onClick={() => navigate(alert.section)} className="flex w-full items-center gap-4 px-1 py-4 text-left hover:bg-[#fafafa]">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${alert.severity === 'critical' ? 'bg-[#fff0f0] text-[#b34040]' : alert.severity === 'warning' ? 'bg-[#fff3df] text-[#925600]' : 'bg-[#eff6ff] text-[#2563eb]'}`}>
                  <AlertCircle size={17} />
                </div>
                <div className="min-w-0 flex-1"><div className="font-medium text-[#171717]">{alert.title} <span className="text-[#b34040]">{alert.count}건</span></div><div className="mt-1 text-[13px] text-[#787774]">{alert.description}</div></div>
                <span className="text-[13px] text-[#8a8a8a]">확인</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 border-y border-[#e9e9e8] py-5 text-[14px] text-[#4f6f58]"><CheckCircle2 size={18} />현재 감지된 운영 경고가 없습니다.</div>
        )}
      </section>

      <section>
        <h2 className="text-[18px] font-medium text-[#171717]">핵심 지표</h2>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-7 lg:grid-cols-4">
          <Metric label="전체 회원" value={`${formatNumber(data?.summary.totalUsers || 0)}명`} detail={`자동갱신 ${formatNumber(data?.summary.autoRenewSubscriptions || 0)}명`} />
          <Metric label="유료 권한 활성" value={`${formatNumber(data?.summary.activeEntitlements || 0)}명`} detail={`해지 예정 ${formatNumber(data?.summary.cancelingSubscriptions || 0)}명`} />
          <Metric label="이번 달 순매출" value={formatWon(data?.summary.monthlyNetRevenue || 0)} detail={`총결제 ${formatWon(data?.summary.monthlyGrossRevenue || 0)} · 환불 ${formatWon(data?.summary.monthlyRefunds || 0)}`} />
          <Metric label="AI 성공률 · 30일" value={`${data?.summary.aiSuccessRate30d ?? 100}%`} detail={`${formatNumber(data?.summary.aiRequests30d || 0)}회 · 오류 ${formatNumber(data?.summary.aiFailures30d || 0)}회`} />
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[18px] font-medium">최근 결제</h2><button type="button" onClick={() => navigate('billing')} className="text-[13px] text-[#2563eb]">전체 보기</button></div>
          <div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">
            {(data?.payments || []).slice(0, 5).map((payment) => {
              const member = membersById.get(payment.user_id);
              return <div key={payment.id} className="flex items-center gap-3 py-3.5"><div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium">{member?.name || '알 수 없는 회원'}</div><div className="mt-1 text-[13px] text-[#8a8a8a]">{formatDate(payment.approved_at || payment.created_at)}</div></div><StatusBadge status={payment.status} /><div className="w-24 text-right text-[14px] font-medium">{formatWon(payment.amount)}</div></div>;
            })}
            {!data?.payments.length && <EmptyState>결제 내역이 없습니다.</EmptyState>}
          </div>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[18px] font-medium">최근 관리자 작업</h2><button type="button" onClick={() => navigate('audit')} className="text-[13px] text-[#2563eb]">전체 보기</button></div>
          <div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">
            {(data?.audits || []).slice(0, 5).map((audit) => <div key={audit.id} className="py-3.5"><div className="text-[14px] font-medium">{ACTION_LABELS[audit.action] || audit.action}</div><div className="mt-1 text-[13px] text-[#8a8a8a]">{audit.adminEmail} · {formatDate(audit.created_at)}</div></div>)}
            {!data?.audits.length && <EmptyState>아직 관리자 작업 기록이 없습니다.</EmptyState>}
          </div>
        </div>
      </section>
    </div>
  );

  const renderMembers = () => (
    <div className="space-y-7">
      <SectionHeader title="회원" description="회원의 계정, 구독 권한, AI 사용량과 운영 메모를 확인합니다." action={refreshButton} />
      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="이름 또는 이메일 검색" className="h-10 w-full border border-[#dededb] bg-white pl-9 pr-3 text-[14px]" /></label>
        <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="h-10 border border-[#dededb] bg-white px-3 text-[14px]"><option value="all">전체 요금제</option><option value="dayflow_free">Free</option><option value="dayflow_plus_monthly">Plus</option><option value="dayflow_pro_monthly">Pro</option></select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 border border-[#dededb] bg-white px-3 text-[14px]"><option value="all">전체 상태</option><option value="active">자동갱신</option><option value="canceled">해지 예정</option><option value="past_due">결제 지연</option><option value="free">무료</option><option value="suspended">이용 제한</option></select>
      </div>

      <div className="overflow-x-auto border-y border-[#e9e9e8]">
        <table className="w-full min-w-[940px] border-collapse text-left">
          <thead><tr className="text-[12px] font-medium text-[#8a8a8a]"><th className="px-3 py-3">회원</th><th className="px-3 py-3">가입</th><th className="px-3 py-3">최근 로그인</th><th className="px-3 py-3">요금제</th><th className="px-3 py-3">상태</th><th className="px-3 py-3 text-right">AI 사용</th><th className="px-3 py-3 text-right">메모</th></tr></thead>
          <tbody>
            {filteredMembers.map((member) => {
              const suspended = Boolean(member.bannedUntil && new Date(member.bannedUntil).getTime() > Date.now());
              return <tr key={member.id} onClick={() => setSelectedMemberId(member.id)} className="cursor-pointer border-t border-[#efefed] text-[14px] text-[#37352f] hover:bg-[#fafafa]">
                <td className="px-3 py-3.5"><div className="flex items-center gap-3"><MemberAvatar member={member} /><div><div className="font-medium text-[#171717]">{member.name}{member.adminRole === 'admin' && <span className="ml-2 text-[11px] text-[#2563eb]">ADMIN</span>}</div><div className="mt-0.5 text-xs text-[#8a8a8a]">{member.email}</div></div></div></td>
                <td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(member.joinedAt)}</td><td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(member.lastSignInAt)}</td>
                <td className="px-3 py-3.5 font-medium">{PLAN_LABELS[member.planId] || member.planId}</td><td className="px-3 py-3.5">{suspended ? <span className="inline-flex rounded-full bg-[#fff0f0] px-2.5 py-1 text-xs text-[#b34040]">이용 제한</span> : <StatusBadge status={member.subscriptionStatus} />}</td>
                <td className="px-3 py-3.5 text-right tabular-nums">{member.aiUsed}/{member.aiLimit}</td><td className="px-3 py-3.5 text-right tabular-nums">{member.noteCount}</td>
              </tr>;
            })}
            {!isLoading && filteredMembers.length === 0 && <tr><td colSpan={7}><EmptyState>조건에 맞는 회원이 없습니다.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBilling = () => (
    <div className="space-y-9">
      <SectionHeader title="구독·결제" description="자동갱신, 결제 실패, 해지와 환불 상태를 운영합니다." action={refreshButton} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Metric label="자동갱신" value={`${formatNumber(data?.summary.autoRenewSubscriptions || 0)}명`} /><Metric label="해지 예정" value={`${formatNumber(data?.summary.cancelingSubscriptions || 0)}명`} /><Metric label="결제 지연" value={`${formatNumber(data?.summary.pastDueSubscriptions || 0)}명`} /><Metric label="이번 달 환불" value={formatWon(data?.summary.monthlyRefunds || 0)} />
      </div>

      <section>
        <h2 className="mb-4 text-[18px] font-medium">구독</h2>
        <div className="overflow-x-auto border-y border-[#e9e9e8]"><table className="w-full min-w-[940px] text-left"><thead><tr className="text-[12px] text-[#8a8a8a]"><th className="px-3 py-3">회원</th><th className="px-3 py-3">요금제</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">이용 종료</th><th className="px-3 py-3">다음 결제</th><th className="px-3 py-3">재시도</th><th className="px-3 py-3 text-right">관리</th></tr></thead><tbody>
          {(data?.subscriptions || []).map((subscription) => { const member = membersById.get(subscription.user_id); return <tr key={subscription.id} className="border-t border-[#efefed] text-[14px]"><td className="px-3 py-3.5"><div className="font-medium">{member?.name || '알 수 없는 회원'}</div><div className="mt-1 text-xs text-[#8a8a8a]">{member?.email}</div></td><td className="px-3 py-3.5 font-medium">{PLAN_LABELS[subscription.plan_id] || subscription.plan_id}</td><td className="px-3 py-3.5"><StatusBadge status={subscription.status} /></td><td className="px-3 py-3.5 text-[#787774]">{formatDate(subscription.current_period_end)}</td><td className="px-3 py-3.5 text-[#787774]">{formatDate(subscription.next_billing_at)}</td><td className="px-3 py-3.5">{subscription.retry_count || 0}회{subscription.last_billing_error && <div className="mt-1 max-w-[220px] truncate text-xs text-[#b34040]">{subscription.last_billing_error}</div>}</td><td className="px-3 py-3.5 text-right">{subscription.status === 'active' && <button type="button" onClick={() => setPendingAction({ type: 'cancel_subscription', targetId: subscription.id, title: '자동갱신을 해지할까요?', description: '현재 이용기간은 유지되고 다음 결제는 실행되지 않습니다.' })} className="text-[13px] text-[#b34040] hover:underline">자동갱신 해지</button>}</td></tr>; })}
          {!data?.subscriptions.length && <tr><td colSpan={7}><EmptyState>구독 내역이 없습니다.</EmptyState></td></tr>}
        </tbody></table></div>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-[18px] font-medium">결제</h2><p className="mt-1 text-[13px] text-[#8a8a8a]">결제키와 빌링키는 화면에 노출하지 않습니다.</p></div><div className="flex gap-3"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="회원 또는 주문번호" className="h-10 w-64 border border-[#dededb] pl-9 pr-3 text-[14px]" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 border border-[#dededb] bg-white px-3 text-[14px]"><option value="all">전체 상태</option><option value="DONE">결제 완료</option><option value="FAILED">결제 실패</option><option value="PARTIAL_CANCELED">부분 환불</option><option value="CANCELED">전체 환불</option></select></div></div>
        <div className="overflow-x-auto border-y border-[#e9e9e8]"><table className="w-full min-w-[900px] text-left"><thead><tr className="text-[12px] text-[#8a8a8a]"><th className="px-3 py-3">결제 시각</th><th className="px-3 py-3">회원</th><th className="px-3 py-3">주문번호</th><th className="px-3 py-3">상태</th><th className="px-3 py-3 text-right">금액</th><th className="px-3 py-3 text-right">관리</th></tr></thead><tbody>
          {filteredPayments.map((payment: AdminPayment) => { const member = membersById.get(payment.user_id); return <tr key={payment.id} className="border-t border-[#efefed] text-[14px]"><td className="whitespace-nowrap px-3 py-3.5 text-[#787774]">{formatDate(payment.approved_at || payment.created_at)}</td><td className="px-3 py-3.5"><div className="font-medium">{member?.name || '알 수 없는 회원'}</div><div className="mt-1 text-xs text-[#8a8a8a]">{member?.email}</div></td><td className="max-w-[230px] truncate px-3 py-3.5 text-xs text-[#787774]">{payment.toss_order_id}</td><td className="px-3 py-3.5"><StatusBadge status={payment.status} />{payment.failure_code && <div className="mt-1 max-w-[220px] truncate text-xs text-[#b34040]">{payment.failure_code}: {payment.failure_message}</div>}</td><td className="px-3 py-3.5 text-right"><div className="font-medium">{formatWon(payment.amount)}</div>{payment.refundedAmount > 0 && <div className="mt-1 text-xs text-[#8a8a8a]">환불 {formatWon(payment.refundedAmount)}</div>}</td><td className="px-3 py-3.5 text-right">{payment.refundableAmount > 0 && payment.status !== 'FAILED' && <button type="button" onClick={() => { setPendingAction({ type: 'refund_payment', targetId: payment.id, title: '결제를 환불할까요?', description: `최대 ${formatWon(payment.refundableAmount)}까지 환불할 수 있습니다.`, maxAmount: payment.refundableAmount, operationId: crypto.randomUUID() }); setRefundAmount(String(payment.refundableAmount)); }} className="text-[13px] text-[#b34040] hover:underline">환불</button>}</td></tr>; })}
          {!filteredPayments.length && <tr><td colSpan={6}><EmptyState>조건에 맞는 결제가 없습니다.</EmptyState></td></tr>}
        </tbody></table></div>
      </section>

      <section><h2 className="mb-4 text-[18px] font-medium">최근 정기결제 시도</h2><div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">{(data?.billingAttempts || []).slice(0, 20).map((attempt) => <div key={attempt.id} className="grid gap-2 py-3.5 text-[14px] sm:grid-cols-[1fr_130px_100px]"><div><span className="font-medium">{membersById.get(attempt.user_id)?.name || '알 수 없는 회원'}</span><span className="ml-2 text-[#8a8a8a]">{attempt.attempt_number}차 시도 · {formatDate(attempt.scheduled_at)}</span>{attempt.failure_code && <div className="mt-1 text-xs text-[#b34040]">{attempt.failure_code}: {attempt.failure_message}</div>}</div><StatusBadge status={attempt.status} /><div className="text-right font-medium">{formatWon(attempt.amount)}</div></div>)}{!data?.billingAttempts.length && <EmptyState>정기결제 시도 기록이 없습니다.</EmptyState>}</div></section>
    </div>
  );

  const renderAi = () => (
    <div className="space-y-9">
      <SectionHeader title="AI 사용량" description="최근 30일 모델별 요청, 토큰, 성공률과 응답 시간을 확인합니다." action={refreshButton} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4"><Metric label="요청" value={`${formatNumber(data?.summary.aiRequests30d || 0)}회`} /><Metric label="성공률" value={`${data?.summary.aiSuccessRate30d ?? 100}%`} /><Metric label="사용 토큰" value={formatNumber(data?.summary.aiTokens30d || 0)} /><Metric label="평균 응답 시간" value={`${formatNumber(data?.summary.aiAverageDurationMs30d || 0)}ms`} /></div>
      <section><h2 className="mb-4 text-[18px] font-medium">모델별 현황</h2><div className="overflow-x-auto border-y border-[#e9e9e8]"><table className="w-full min-w-[680px] text-left"><thead><tr className="text-[12px] text-[#8a8a8a]"><th className="px-3 py-3">모델</th><th className="px-3 py-3 text-right">요청</th><th className="px-3 py-3 text-right">오류</th><th className="px-3 py-3 text-right">토큰</th><th className="px-3 py-3 text-right">평균 응답</th></tr></thead><tbody>{(data?.ai.modelBreakdown || []).map((model) => <tr key={model.model} className="border-t border-[#efefed] text-[14px]"><td className="px-3 py-3.5 font-medium">{model.model}</td><td className="px-3 py-3.5 text-right">{formatNumber(model.requests)}</td><td className="px-3 py-3.5 text-right text-[#b34040]">{formatNumber(model.failures)}</td><td className="px-3 py-3.5 text-right">{formatNumber(model.totalTokens)}</td><td className="px-3 py-3.5 text-right">{formatNumber(model.averageDurationMs)}ms</td></tr>)}{!data?.ai.modelBreakdown.length && <tr><td colSpan={5}><EmptyState>새 사용량 수집 이후 모델별 지표가 표시됩니다.</EmptyState></td></tr>}</tbody></table></div></section>
      <section><h2 className="mb-4 text-[18px] font-medium">최근 요청</h2><div className="overflow-x-auto border-y border-[#e9e9e8]"><table className="w-full min-w-[820px] text-left"><thead><tr className="text-[12px] text-[#8a8a8a]"><th className="px-3 py-3">시각</th><th className="px-3 py-3">회원</th><th className="px-3 py-3">모델</th><th className="px-3 py-3">상태</th><th className="px-3 py-3 text-right">토큰</th><th className="px-3 py-3 text-right">응답 시간</th></tr></thead><tbody>{(data?.ai.recentEvents || []).map((event) => <tr key={event.id} className="border-t border-[#efefed] text-[14px]"><td className="px-3 py-3.5 text-[#787774]">{formatDate(event.created_at)}</td><td className="px-3 py-3.5">{membersById.get(event.user_id)?.name || '알 수 없는 회원'}</td><td className="px-3 py-3.5 font-medium">{event.model}</td><td className="px-3 py-3.5"><StatusBadge status={event.status} />{event.error_code && <div className="mt-1 text-xs text-[#b34040]">{event.error_code}</div>}</td><td className="px-3 py-3.5 text-right">{formatNumber(event.total_tokens)}</td><td className="px-3 py-3.5 text-right">{formatNumber(event.duration_ms)}ms</td></tr>)}{!data?.ai.recentEvents.length && <tr><td colSpan={6}><EmptyState>새 사용량 수집 이후 요청 내역이 표시됩니다.</EmptyState></td></tr>}</tbody></table></div></section>
    </div>
  );

  const renderSupport = () => (
    <div className="space-y-8">
      <SectionHeader title="고객지원" description="서비스 안에서 접수된 문의를 회원 정보와 함께 확인하고 답변합니다." action={refreshButton} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Metric label="미처리 문의" value={`${formatNumber(data?.summary.openSupportTickets || 0)}건`} />
        <Metric label="전체 문의" value={`${formatNumber(data?.support.tickets.length || 0)}건`} />
        <Metric label="긴급" value={`${formatNumber(data?.support.tickets.filter((ticket) => ticket.priority === 'urgent').length || 0)}건`} />
        <Metric label="답변 완료" value={`${formatNumber(data?.support.tickets.filter((ticket) => ticket.status === 'resolved').length || 0)}건`} />
      </div>
      <div className="overflow-x-auto border-y border-[#e9e9e8]">
        <table className="w-full min-w-[820px] text-left"><thead><tr className="text-[12px] text-[#8a8a8a]"><th className="px-3 py-3">접수 시각</th><th className="px-3 py-3">회원</th><th className="px-3 py-3">분류</th><th className="px-3 py-3">제목</th><th className="px-3 py-3">상태</th><th className="px-3 py-3 text-right">확인</th></tr></thead><tbody>
          {(data?.support.tickets || []).map((ticket) => { const member = membersById.get(ticket.user_id); return <tr key={ticket.id} className="border-t border-[#efefed] text-[14px]"><td className="px-3 py-3.5 text-[#787774]">{formatDate(ticket.created_at)}</td><td className="px-3 py-3.5"><div className="font-medium">{member?.name || '알 수 없는 회원'}</div><div className="mt-1 text-xs text-[#8a8a8a]">{member?.email}</div></td><td className="px-3 py-3.5">{ticket.category}</td><td className="max-w-[340px] truncate px-3 py-3.5 font-medium">{ticket.subject}</td><td className="px-3 py-3.5"><StatusBadge status={ticket.status} /></td><td className="px-3 py-3.5 text-right"><button type="button" onClick={() => setSelectedTicketId(ticket.id)} className="text-[13px] text-[#2563eb]">열기</button></td></tr>; })}
          {!data?.support.tickets.length && <tr><td colSpan={6}><EmptyState>접수된 문의가 없습니다.</EmptyState></td></tr>}
        </tbody></table>
      </div>
    </div>
  );

  const renderSystem = () => (
    <div className="space-y-9">
      <SectionHeader title="시스템" description="결제 웹훅, 정기결제 시도와 AI 오류 수집 상태를 확인합니다." action={refreshButton} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Metric label="정기결제 실패" value={`${formatNumber(data?.summary.failedRenewals || 0)}건`} />
        <Metric label="결제 실패" value={`${formatNumber(data?.summary.failedPayments || 0)}건`} />
        <Metric label="AI 오류 · 30일" value={`${formatNumber(data?.summary.aiFailures30d || 0)}건`} />
        <Metric label="웹훅 처리 실패" value={`${formatNumber(data?.system.billingEvents.filter((event) => event.processing_status === 'failed').length || 0)}건`} />
      </div>
      <section><h2 className="mb-4 text-[18px] font-medium">토스 웹훅</h2><div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">{(data?.system.billingEvents || []).map((event) => <div key={event.id} className="grid gap-2 py-3.5 text-[14px] sm:grid-cols-[1fr_140px_180px]"><div><div className="font-medium">{event.event_type}</div><div className="mt-1 text-xs text-[#8a8a8a]">{event.toss_order_id || '주문번호 없음'}{event.error_message && <span className="ml-2 text-[#b34040]">{event.error_message}</span>}</div></div><StatusBadge status={event.processing_status} /><div className="text-[#787774] sm:text-right">{formatDate(event.received_at)}</div></div>)}{!data?.system.billingEvents.length && <EmptyState>아직 수신된 결제 웹훅이 없습니다.</EmptyState>}</div></section>
      <section><h2 className="mb-4 text-[18px] font-medium">운영 설정 점검</h2><div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8] text-[14px]"><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">신규 결제·자동갱신</div><div className="mt-1 text-xs text-[#8a8a8a]">명시적으로 활성화한 경우에만 결제를 실행합니다.</div></div><span className={data?.system.configuration.billingEnabled ? 'text-[#b34040]' : 'text-[#2f7d47]'}>{data?.system.configuration.billingEnabled ? `${data.system.configuration.billingMode === 'live' ? '실결제' : '테스트'} 활성` : '안전 정지'}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">토스 결제 키</div><div className="mt-1 text-xs text-[#8a8a8a]">키 값은 표시하지 않고 테스트·실결제 환경만 판별합니다.</div></div><span className={data?.system.configuration.tossKeyMode === 'test' ? 'text-[#2563eb]' : data?.system.configuration.tossKeyMode === 'live' ? 'text-[#b34040]' : 'text-[#925600]'}>{({ test: '테스트 키', live: '실결제 키', missing: '키 없음', mismatch: '환경 불일치', unknown: '판별 불가' } as const)[data?.system.configuration.tossKeyMode || 'unknown']}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">정기결제 보호 비밀값</div><div className="mt-1 text-xs text-[#8a8a8a]">비밀값 설정 여부만 확인합니다. 외부 스케줄 등록은 별도 확인이 필요합니다.</div></div><span className={data?.system.configuration.billingCronSecretConfigured ? 'text-[#2f7d47]' : 'text-[#925600]'}>{data?.system.configuration.billingCronSecretConfigured ? '설정됨' : '미설정'}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">웹훅 보호 토큰</div><div className="mt-1 text-xs text-[#8a8a8a]">토큰 설정 여부만 확인합니다. 토스 개발자센터 등록은 별도 확인이 필요합니다.</div></div><span className={data?.system.configuration.tossWebhookTokenConfigured ? 'text-[#2f7d47]' : 'text-[#925600]'}>{data?.system.configuration.tossWebhookTokenConfigured ? '설정됨' : '미설정'}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">최근 정기결제 실행</div><div className="mt-1 text-xs text-[#8a8a8a]">실행 이력이 없으면 Cron 연결 여부를 확인할 수 없습니다.</div></div><span className="text-[#787774]">{data?.system.configuration.lastRenewalAttemptAt ? formatDate(data.system.configuration.lastRenewalAttemptAt) : '이력 없음'}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">최근 웹훅 수신</div><div className="mt-1 text-xs text-[#8a8a8a]">실제 이벤트가 수신된 시각입니다.</div></div><span className="text-[#787774]">{data?.system.configuration.lastWebhookReceivedAt ? formatDate(data.system.configuration.lastWebhookReceivedAt) : '이력 없음'}</span></div><div className="flex items-center justify-between gap-5 py-4"><div><div className="font-medium">AI 사용량 이벤트</div><div className="mt-1 text-xs text-[#8a8a8a]">새 AI 요청부터 토큰과 응답 시간이 수집됩니다.</div></div><span className="text-[#2f7d47]">코드 연결 완료</span></div></div></section>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-7">
      <SectionHeader title="감사 기록" description="관리자와 자동화가 수행한 운영 작업의 사유와 대상을 확인합니다." action={refreshButton} />
      <label className="relative block max-w-md"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="관리자, 작업 또는 사유 검색" className="h-10 w-full border border-[#dededb] pl-9 pr-3 text-[14px]" /></label>
      <div className="divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">{filteredAudits.map((audit: AdminAudit) => <div key={audit.id} className="grid gap-2 py-4 text-[14px] lg:grid-cols-[220px_1fr_220px]"><div><div className="font-medium text-[#171717]">{ACTION_LABELS[audit.action] || audit.action}</div><div className="mt-1 text-xs text-[#8a8a8a]">{audit.target_type} · {audit.target_id || '-'}</div></div><div><div className="text-[#37352f]">{audit.reason || '사유 없음'}</div><div className="mt-1 text-xs text-[#8a8a8a]">{Object.keys(audit.metadata || {}).length ? JSON.stringify(audit.metadata) : '추가 정보 없음'}</div></div><div className="lg:text-right"><div>{audit.adminEmail}</div><div className="mt-1 text-xs text-[#8a8a8a]">{formatDate(audit.created_at)}</div></div></div>)}{!filteredAudits.length && <EmptyState>감사 기록이 없습니다.</EmptyState>}</div>
    </div>
  );

  const renderContent = () => {
    if (isLoading && !data) return <div className="flex min-h-[60vh] items-center justify-center text-[14px] text-[#8a8a8a]"><RefreshCw size={18} className="mr-2 animate-spin" />운영 데이터를 불러오는 중입니다.</div>;
    if (section === 'members') return renderMembers();
    if (section === 'billing') return renderBilling();
    if (section === 'ai') return renderAi();
    if (section === 'support') return renderSupport();
    if (section === 'system') return renderSystem();
    if (section === 'audit') return renderAudit();
    return renderOverview();
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-[#f8f8f7]">
      <div className="flex h-16 items-center justify-between border-b border-[#e5e5e3] px-5"><div><div className="text-[16px] font-medium text-[#171717]">Dayflow</div><div className="text-[11px] font-medium tracking-[0.08em] text-[#2563eb]">ADMIN</div></div><button type="button" onClick={() => setIsMobileNavOpen(false)} className="md:hidden"><X size={19} /></button></div>
      <nav className="flex-1 space-y-1 px-3 py-5" aria-label="관리자 메뉴">{NAV_ITEMS.map((item) => { const Icon = item.icon; const active = section === item.id; return <button key={item.id} type="button" onClick={() => navigate(item.id)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition-colors ${active ? 'bg-white font-medium text-[#171717]' : 'text-[#5f5f5f] hover:bg-white/70'}`}><Icon size={17} /><span>{item.label}</span>{item.id === 'overview' && (data?.alerts.length || 0) > 0 && <span className="ml-auto text-xs text-[#b34040]">{data?.alerts.length}</span>}</button>; })}</nav>
      <div className="border-t border-[#e5e5e3] p-3"><div className="mb-3 flex items-center gap-3 px-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563eb] text-xs text-white">{adminName?.[0] || 'A'}</div><div className="min-w-0"><div className="truncate text-[13px] font-medium">{adminName || '관리자'}</div><div className="truncate text-[11px] text-[#8a8a8a]">{adminEmail || ''}</div></div></div><button type="button" onClick={onExit} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] text-[#5f5f5f] hover:bg-white"><ArrowLeft size={17} />Dayflow로 돌아가기</button></div>
    </div>
  );

  return (
    <div className="flex min-h-full bg-white text-[#171717]">
      <aside className="hidden w-[240px] shrink-0 border-r border-[#e5e5e3] md:block">{sidebar}</aside>
      {isMobileNavOpen && <div className="fixed inset-0 z-[120] md:hidden"><button type="button" aria-label="메뉴 닫기" onClick={() => setIsMobileNavOpen(false)} className="absolute inset-0 bg-black/20" /><aside className="relative h-full w-[270px] border-r border-[#e5e5e3]">{sidebar}</aside></div>}
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-[#e9e9e8] px-4 md:hidden"><button type="button" onClick={() => setIsMobileNavOpen(true)} aria-label="관리자 메뉴 열기"><Menu size={20} /></button><span className="text-[14px] font-medium">{NAV_ITEMS.find((item) => item.id === section)?.label}</span><div className="w-5" /></header>
        <main className="mx-auto w-full max-w-[1420px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          {error && <div className="mb-6 flex items-start gap-3 border-l-2 border-[#d94848] bg-[#fff8f8] px-4 py-3 text-[14px] text-[#8f3030]"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
          {notice && <div className="mb-6 flex items-center justify-between border-l-2 border-[#3d8a55] bg-[#f5fbf6] px-4 py-3 text-[14px] text-[#356b45]"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}><X size={16} /></button></div>}
          {renderContent()}
        </main>
      </div>

      {selectedMember && (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/20" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMemberId(null); }}>
          <aside className="h-full w-full max-w-[480px] overflow-y-auto border-l border-[#dededb] bg-white p-6 sm:p-8">
            <div className="flex items-start justify-between"><div className="flex items-center gap-3"><MemberAvatar member={selectedMember} /><div><h2 className="text-[20px] font-medium">{selectedMember.name}</h2><p className="mt-1 text-[13px] text-[#8a8a8a]">{selectedMember.email}</p></div></div><button type="button" onClick={() => setSelectedMemberId(null)}><X size={20} /></button></div>
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-[#e9e9e8] py-5 text-[14px]"><div><div className="text-xs text-[#8a8a8a]">요금제</div><div className="mt-1.5 font-medium">{PLAN_LABELS[selectedMember.planId]}</div></div><div><div className="text-xs text-[#8a8a8a]">구독 상태</div><div className="mt-1.5"><StatusBadge status={selectedMember.subscriptionStatus} /></div></div><div><div className="text-xs text-[#8a8a8a]">AI 사용량</div><div className="mt-1.5 font-medium">{selectedMember.aiUsed}/{selectedMember.aiLimit}회</div></div><div><div className="text-xs text-[#8a8a8a]">최근 로그인</div><div className="mt-1.5">{formatDate(selectedMember.lastSignInAt)}</div></div><div><div className="text-xs text-[#8a8a8a]">이용 종료</div><div className="mt-1.5">{formatDate(selectedMember.currentPeriodEnd)}</div></div><div><div className="text-xs text-[#8a8a8a]">다음 결제</div><div className="mt-1.5">{formatDate(selectedMember.nextBillingAt)}</div></div></div>
            <section className="mt-8"><h3 className="text-[16px] font-medium">운영 메모</h3><textarea value={memberNote} onChange={(event) => setMemberNote(event.target.value)} maxLength={2000} placeholder="회원 응대나 운영 조치에 필요한 내용을 기록하세요." className="mt-3 min-h-24 w-full resize-y border border-[#dededb] p-3 text-[14px]" /><button type="button" onClick={() => void saveMemberNote()} disabled={!memberNote.trim() || isActionRunning} className="mt-2 h-9 bg-[#171717] px-4 text-[13px] text-white disabled:opacity-40">메모 저장</button><div className="mt-4 divide-y divide-[#e9e9e8] border-y border-[#e9e9e8]">{(data?.notes || []).filter((note) => note.user_id === selectedMember.id).map((note) => <div key={note.id} className="py-3 text-[14px]"><p className="whitespace-pre-wrap leading-6">{note.note}</p><div className="mt-1 text-xs text-[#8a8a8a]">{note.adminEmail} · {formatDate(note.created_at)}</div></div>)}{!data?.notes.some((note) => note.user_id === selectedMember.id) && <EmptyState>작성된 운영 메모가 없습니다.</EmptyState>}</div></section>
            <section className="mt-8"><h3 className="text-[16px] font-medium">계정 관리</h3><p className="mt-2 text-[13px] leading-6 text-[#787774]">모든 작업은 사유와 함께 감사 기록에 저장됩니다.</p><div className="mt-4 flex flex-wrap gap-2">{selectedMember.bannedUntil && new Date(selectedMember.bannedUntil).getTime() > Date.now() ? <button type="button" onClick={() => setPendingAction({ type: 'restore_user', targetId: selectedMember.id, title: '회원 이용을 복구할까요?', description: '계정 제한을 해제하고 다시 로그인할 수 있게 합니다.' })} className="border border-[#dededb] px-3 py-2 text-[13px]">이용 복구</button> : <button type="button" onClick={() => setPendingAction({ type: 'suspend_user', targetId: selectedMember.id, title: '회원 이용을 제한할까요?', description: '현재 세션 이후 로그인을 차단합니다. 관리자 본인 계정은 제한할 수 없습니다.' })} className="border border-[#e3c5c5] px-3 py-2 text-[13px] text-[#b34040]">이용 제한</button>}{selectedSubscription?.status === 'active' && <button type="button" onClick={() => setPendingAction({ type: 'cancel_subscription', targetId: selectedSubscription.id, title: '자동갱신을 해지할까요?', description: '현재 이용기간은 유지되고 다음 결제는 실행되지 않습니다.' })} className="border border-[#e3c5c5] px-3 py-2 text-[13px] text-[#b34040]">자동갱신 해지</button>}</div></section>
          </aside>
        </div>
      )}

      {selectedTicket && (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/20" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTicketId(null); }}>
          <aside className="flex h-full w-full max-w-[520px] flex-col border-l border-[#dededb] bg-white">
            <div className="border-b border-[#e9e9e8] p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-medium text-[#2563eb]">{selectedTicket.category.toUpperCase()}</div><h2 className="mt-2 text-[20px] font-medium">{selectedTicket.subject}</h2><div className="mt-2 text-[13px] text-[#8a8a8a]">{membersById.get(selectedTicket.user_id)?.name || '알 수 없는 회원'} · {formatDate(selectedTicket.created_at)}</div></div><button type="button" onClick={() => setSelectedTicketId(null)}><X size={20} /></button></div><div className="mt-5 flex items-center gap-3"><StatusBadge status={selectedTicket.status} /><select value={selectedTicket.status} disabled={isActionRunning} onChange={(event) => void changeTicketStatus(event.target.value as 'open' | 'in_progress' | 'resolved' | 'closed')} className="h-9 border border-[#dededb] bg-white px-3 text-[13px]"><option value="open">접수</option><option value="in_progress">처리 중</option><option value="resolved">답변 완료</option><option value="closed">종료</option></select></div></div>
            <div className="flex-1 overflow-y-auto p-6 sm:p-8"><div className="space-y-5">{(data?.support.messages || []).filter((message) => message.ticket_id === selectedTicket.id).map((message) => <div key={message.id} className={`max-w-[90%] ${message.sender_role === 'admin' ? 'ml-auto' : ''}`}><div className={`p-4 text-[14px] leading-6 ${message.sender_role === 'admin' ? 'bg-[#eff6ff]' : 'bg-[#f7f7f7]'}`}>{message.message}</div><div className={`mt-1 text-xs text-[#8a8a8a] ${message.sender_role === 'admin' ? 'text-right' : ''}`}>{message.sender_role === 'admin' ? 'Dayflow 관리자' : membersById.get(selectedTicket.user_id)?.name} · {formatDate(message.created_at)}</div></div>)}</div></div>
            <div className="border-t border-[#e9e9e8] p-5"><textarea value={supportReply} onChange={(event) => setSupportReply(event.target.value)} disabled={selectedTicket.status === 'closed'} maxLength={5000} placeholder="고객에게 전달할 답변을 입력하세요." className="min-h-24 w-full resize-y border border-[#dededb] p-3 text-[14px] disabled:bg-[#f7f7f7]" /><div className="mt-2 flex justify-end"><button type="button" onClick={() => void replyToTicket()} disabled={!supportReply.trim() || isActionRunning || selectedTicket.status === 'closed'} className="bg-[#171717] px-4 py-2.5 text-[13px] text-white disabled:opacity-40">{isActionRunning ? '처리 중...' : '답변 보내기'}</button></div></div>
          </aside>
        </div>
      )}

      {pendingAction && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-[440px] bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="text-[19px] font-medium">{pendingAction.title}</h2><p className="mt-2 text-[14px] leading-6 text-[#787774]">{pendingAction.description}</p></div><button type="button" onClick={() => setPendingAction(null)}><X size={19} /></button></div>{pendingAction.type === 'refund_payment' && <label className="mt-5 block"><span className="text-[13px] text-[#5f5f5f]">환불 금액</span><input type="number" min="1" max={pendingAction.maxAmount} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} className="mt-2 h-10 w-full border border-[#dededb] px-3 text-[14px]" /></label>}<label className="mt-5 block"><span className="text-[13px] text-[#5f5f5f]">작업 사유</span><textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} maxLength={500} placeholder="고객 요청, 운영 정책 등 구체적인 사유를 입력하세요." className="mt-2 min-h-24 w-full resize-y border border-[#dededb] p-3 text-[14px]" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingAction(null)} className="h-10 border border-[#dededb] px-4 text-[14px]">취소</button><button type="button" onClick={() => void performAction()} disabled={actionReason.trim().length < 2 || isActionRunning || (pendingAction.type === 'refund_payment' && (Number(refundAmount) <= 0 || Number(refundAmount) > pendingAction.maxAmount))} className="h-10 bg-[#b34040] px-4 text-[14px] text-white disabled:opacity-40">{isActionRunning ? '처리 중...' : '확인하고 실행'}</button></div></div>
        </div>
      )}
    </div>
  );
};

export default AdminView;

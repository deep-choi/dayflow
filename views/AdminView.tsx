import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { User as AuthUser } from '@supabase/supabase-js';
import { Activity, ArrowLeft, ChevronLeft, ChevronRight, CreditCard, FileClock, Flag, Inbox, LoaderCircle, LogOut, RefreshCw, Search, Settings2, ShieldCheck, TriangleAlert, Users, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { AdminError, addMemberNote, fetchAdminDashboard, fetchAdminSettings, saveAdminSettings, updateMember, updateSupportStatus } from '../services/adminService';
import type { AdminDashboard, AdminMember, AdminSettings, SupportTicket } from '../adminTypes';
import '../styles/admin.css';

const AuthView = lazy(() => import('./AuthView'));
const tabs = [ { id: 'overview', label: '운영 현황', icon: Activity },
  { id: 'members', label: '사용자', icon: Users },
  { id: 'ai', label: 'AI 운영', icon: Settings2 },
  { id: 'support', label: '문의·신고', icon: Flag },
  { id: 'billing', label: '결제·환불', icon: CreditCard },
  { id: 'audit', label: '변경 이력', icon: FileClock } ] as const;
type Tab = typeof tabs[number]['id'];
const num = (value: number) => value.toLocaleString('ko-KR');
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : '—';
const text = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const statusLabels: Record<string, string> = { open: '접수', in_progress: '처리 중', resolved: '해결', closed: '종료' };
const statusTones: Record<string, string> = { open: 'warning', in_progress: 'info', resolved: 'success', closed: '' };
const categoryLabels: Record<string, string> = { service: '서비스', account: '계정', billing: '결제', ai: 'AI 신고', other: '기타' };
const tone = (status: string) => /^(succeeded|done|active)$/i.test(status) ? 'success' : /fail|error|abort|cancel/i.test(status) ? 'danger' : '';
const isBanned = (item: AdminMember) => Boolean(item.bannedUntil && Date.parse(item.bannedUntil) > Date.now());
const memberStatus = (item: AdminMember) => item.adminRole === 'admin' ? ['관리자', 'info'] : isBanned(item) ? ['이용 제한', 'danger'] : ['정상', 'success'];
const initial = (item: AdminMember) => (item.name || item.email || '?').trim().charAt(0).toUpperCase() || '?';

export default function AdminView() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(() => tabs.find(item => item.id === new URLSearchParams(location.search).get('tab'))?.id || 'overview');
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [member, setMember] = useState<AdminMember | null>(null);
  const generation = useRef(0);
  const uid = useRef<string | null>(null);

  useEffect(() => {
    document.title = 'Dayflow · 관리자';
    const robots = document.querySelector('meta[name="robots"]');
    robots?.setAttribute('content', 'noindex, nofollow');
    let disposed = false;
    const applyUser = (next: AuthUser | null) => {
      if (disposed) return;
      if (uid.current !== (next?.id || null)) { generation.current++; uid.current = next?.id || null; setDashboard(null); setSettings(null); setMember(null); }
      setUser(next); setAuthReady(true);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => applyUser(session?.user || null));
    void supabase.auth.getSession().then(({ data }) => applyUser(data.session?.user || null)).catch(() => { if (!disposed) { setAuthReady(true); setLoading(false); setError('로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.'); } });
    return () => { disposed = true; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!authReady) return;
    if (!user) { setLoading(false); return; }
    const ticket = ++generation.current;
    setLoading(true); setError(''); setDenied(false);
    Promise.all([fetchAdminDashboard(), fetchAdminSettings()]).then(([data, config]) => {
      if (ticket !== generation.current) return;
      setDashboard(data); setSettings(config.settings);
    }).catch(error => {
      if (ticket !== generation.current) return;
      setDashboard(null); setError(text(error));
      setDenied(error instanceof AdminError && [401, 403].includes(error.status));
    }).finally(() => { if (ticket === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [authReady, user?.id, reload]);
  const refresh = () => setReload(value => value + 1);
  const navigate = (next: Tab) => { setTab(next); setPage(0); setSearch(''); setError(''); setNotice(''); history.replaceState(null, '', `/admin?tab=${next}`); };
  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return;
    const actor = uid.current; setBusy(true); setError(''); setNotice('');
    try { await operation(); if (uid.current !== actor) return; setNotice(success); refresh(); }
    catch (error) { if (uid.current === actor) setError(text(error)); }
    finally { setBusy(false); }
  };
  const logout = async () => { const { error } = await supabase.auth.signOut(); if (error) setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'); };
  const login = <Suspense fallback={<p>로그인 준비 중…</p>}><AuthView variant="modal" onClose={() => setLoginOpen(false)} onLogin={() => { setLoginOpen(false); refresh(); }} /></Suspense>;

  if (!dashboard || !user || denied) {
    const checking = loading || !authReady;
    return <div className="df-admin admin-gate"><section className="admin-gate-card" aria-labelledby="admin-gate-title" aria-busy={checking}>
      <div className="admin-gate-brand"><img src="/favicon.svg" width={40} height={40} alt="" /><span className="admin-eyebrow"><ShieldCheck size={14} aria-hidden="true" />운영 콘솔</span></div>
      <h1 id="admin-gate-title">Dayflow 관리자</h1>
      <p className={`admin-gate-message ${!checking && error ? 'error' : ''}`} role={!checking && error ? 'alert' : 'status'}>{checking && <LoaderCircle className="admin-spin" size={16} aria-hidden="true" />}{checking ? '관리자 권한 확인 중…' : error || '운영자 계정으로 로그인해 주세요.'}</p>
      {user && <p className="admin-gate-account">{user.email}</p>}
      {!loading && authReady && <div className="admin-actions">{user ? <><button onClick={refresh}>다시 확인</button><button onClick={logout}>다른 계정으로 로그인</button></> : <button className="primary" onClick={() => setLoginOpen(true)}>로그인</button>}<a href="/"><ArrowLeft size={14} aria-hidden="true" />Dayflow로 돌아가기</a></div>}
      {loginOpen && <div className="admin-gate-login">{login}</div>}
    </section></div>;
  }

  const visibleMembers = dashboard.members.filter(item => `${item.name} ${item.email} ${item.id}`.toLowerCase().includes(search.toLowerCase()));
  const visibleTickets = dashboard.support.tickets.filter(item => `${item.subject} ${item.user_id} ${item.id} ${categoryLabels[item.category]}`.toLowerCase().includes(search.toLowerCase()));
  const memberEmail = (id: string) => dashboard.members.find(item => item.id === id)?.email || id;
  const current = tabs.find(item => item.id === tab) || tabs[0];
  const { summary } = dashboard;
  const updateSearch = (value: string) => { setSearch(value); setPage(0); };
  return <div className="df-admin admin-shell"><aside className="admin-sidebar"><a className="admin-brand" href="/admin"><img src="/favicon.svg" width={32} height={32} alt="" /><span>Dayflow<small>운영 콘솔</small></span></a>
    <nav aria-label="관리자 메뉴">{tabs.map(item => <button key={item.id} type="button" disabled={busy} aria-current={tab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} aria-hidden="true" /><span>{item.label}</span></button>)}</nav>
    <div className="admin-sidebar-footer"><span className="admin-sidebar-account" title={user.email}>{user.email}</span><a href="/"><ArrowLeft size={16} aria-hidden="true" /><span>Dayflow로 돌아가기</span></a><button type="button" onClick={logout}><LogOut size={16} aria-hidden="true" /><span>로그아웃</span></button></div></aside>
    <main className="admin-main" aria-busy={loading}><header className="admin-header"><h1>{current.label}</h1>
      <div className="admin-header-actions">{loading && <p role="status" className="admin-loading"><LoaderCircle className="admin-spin" size={14} aria-hidden="true" />최신 정보 확인 중…</p>}<button type="button" disabled={busy || loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" className={loading ? 'admin-spin' : undefined} />새로고침</button></div></header>
      {error && <div className="admin-alert error" role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}{notice && <div className="admin-alert success" role="status"><ShieldCheck size={16} aria-hidden="true" /><span>{notice}</span></div>}

      {tab === 'overview' && <><p className="admin-caption admin-meta">{date(dashboard.generatedAt)} 기준</p>
        <div className="admin-stats">{([
          ['등록 사용자', num(summary.totalUsers), '', ''],
          ['미처리 문의', num(summary.openSupportTickets), '접수·처리 중', summary.openSupportTickets > 0 ? 'warning' : ''],
          ['30일 AI 요청', num(summary.aiRequests30d), '서버 제공 AI', ''],
          ['30일 AI 실패', num(summary.aiFailures30d), summary.aiRequests30d > 0 ? `실패율 ${(summary.aiFailures30d / summary.aiRequests30d * 100).toFixed(1)}%` : '', summary.aiFailures30d > 0 ? 'danger' : ''],
        ] as const).map(([label, value, hint, accent]) => <section key={label} className={`admin-stat ${accent}`} aria-label={label}><span className="admin-stat-label">{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</section>)}</div>
        <div className="admin-overview-grid">
          <section className="admin-card"><h2>결제 현황 <small>이번 달 · UTC</small></h2><dl className="admin-usage"><div><dt>승인 금액</dt><dd>{num(summary.monthlyGrossRevenue)}<span>원</span></dd></div><div><dt>환불 금액</dt><dd>{num(summary.monthlyRefunds)}<span>원</span></dd></div><div><dt>활성 구독</dt><dd>{num(summary.activeEntitlements)}<span>개</span></dd></div></dl></section>
          <section className="admin-card admin-trial-card"><div className="admin-section-title"><h2>체험 AI</h2><span className={`admin-badge ${settings?.trial_paused ? 'warning' : 'success'}`}>{settings?.trial_paused ? '일시 중지' : '운영 중'}</span></div><dl className="admin-trial-limits"><div><dt>IP당 일일 한도</dt><dd>{settings ? `${num(settings.guest_ip_daily_limit)}회` : '—'}</dd></div><div><dt>전체 일일 한도</dt><dd>{settings ? `${num(settings.guest_global_daily_limit)}회` : '—'}</dd></div></dl><button type="button" className="admin-text-button" onClick={() => navigate('ai')}>설정 변경<ChevronRight size={14} aria-hidden="true" /></button></section>
        </div><section className="admin-card admin-recent"><div className="admin-section-title"><h2>최근 문의</h2><button type="button" className="admin-text-button" onClick={() => navigate('support')}>전체 보기<ChevronRight size={14} aria-hidden="true" /></button></div>{dashboard.support.tickets.length ? <ul className="admin-recent-list">{dashboard.support.tickets.slice(0, 4).map(ticket => <li key={ticket.id}><span className={`admin-badge ${statusTones[ticket.status] || ''}`}>{statusLabels[ticket.status]}</span><button type="button" className="admin-text-button" onClick={() => { navigate('support'); updateSearch(ticket.id); }}>{ticket.subject}</button><span className="admin-count">{new Date(ticket.created_at).toLocaleDateString('ko-KR')}</span></li>)}</ul> : <Empty>접수된 문의가 없습니다.</Empty>}</section></>}

      {tab === 'members' && <><SearchBar label="사용자 검색" placeholder="이름·이메일·UID 검색" value={search} onChange={updateSearch} count={`${num(visibleMembers.length)}명`} />
        <section className="admin-card table-card" aria-label="사용자 목록">{visibleMembers.length ? <TableWrap label="사용자 목록"><thead><tr><th scope="col">계정</th><th scope="col">최근 로그인</th><th scope="col">서버 AI 사용</th><th scope="col">상태</th><th scope="col" className="admin-col-action">관리</th></tr></thead><tbody>{visibleMembers.slice(page * 25, page * 25 + 25).map(item => {
          const [label, accent] = memberStatus(item);
          return <tr key={item.id}><td><div className="admin-account"><span className="admin-avatar" aria-hidden="true">{initial(item)}</span><div><strong>{item.name}</strong><small>{item.email}</small></div></div></td><td className="admin-nowrap">{date(item.lastSignInAt)}</td><td><span className="admin-num">{num(item.trialUsed)} / {num(item.trialLimit)}회</span></td><td><span className={`admin-badge ${accent}`}>{label}</span></td><td className="admin-col-action"><button type="button" className="compact" onClick={() => setMember(item)}>상세<span className="admin-sr-only"> · {item.name || item.email}</span></button></td></tr>;
        })}</tbody></TableWrap> : <Empty>검색 결과가 없습니다.</Empty>}</section><Pages page={page} total={visibleMembers.length} setPage={setPage} /></>}

      {tab === 'ai' && settings && <><form className="admin-settings" onSubmit={event => { event.preventDefault(); if (confirm('이 설정을 이후 서버 체험 요청부터 적용할까요?')) void mutate(() => saveAdminSettings(settings), '체험 AI 설정을 적용했습니다.'); }}>
        <div className="admin-settings-grid">
          <section className="admin-setting-row"><div><h2>서버 제공 체험</h2><span className={`admin-badge ${settings.trial_paused ? 'warning' : 'success'}`}>{settings.trial_paused ? '일시 중지' : '운영 중'}</span></div><label className="admin-check"><input type="checkbox" checked={settings.trial_paused} disabled={busy} onChange={event => setSettings({ ...settings, trial_paused: event.target.checked })} /><span>체험 AI 일시 중지<small>개인 API 연결에는 적용되지 않습니다.</small></span></label></section>
          <section className="admin-setting-row"><div><h2>비로그인 체험 한도</h2><p className="admin-caption admin-flush">매일 오전 9시 초기화</p></div><div><div className="admin-form-grid"><label>IP당 요청 수<input type="number" inputMode="numeric" min={1} max={100000} required value={settings.guest_ip_daily_limit} disabled={busy} onChange={event => setSettings({ ...settings, guest_ip_daily_limit: Number(event.target.value) })} /></label><label>전체 요청 수<input type="number" inputMode="numeric" min={1} max={100000} required value={settings.guest_global_daily_limit} disabled={busy} onChange={event => setSettings({ ...settings, guest_global_daily_limit: Number(event.target.value) })} /></label></div><details className="admin-setting-help"><summary>한도 적용 기준</summary><p>기기당·계정당 무료 체험 10회는 유지됩니다. 요청 한도는 청구액 상한이 아닙니다.</p></details></div></section>
        </div>
        <div className="admin-save"><button className="primary" disabled={busy || loading}>설정 저장</button></div></form>
        <section className="admin-card table-card admin-spaced"><div className="table-card-head"><h2>최근 30일 서버 AI 요청</h2>{dashboard.ai.recentEvents.length > 0 && <span className="admin-count">최근 {num(Math.min(30, dashboard.ai.recentEvents.length))}건</span>}</div>{dashboard.ai.recentEvents.length ? <TableWrap label="최근 30일 서버 AI 요청"><thead><tr><th scope="col">시각</th><th scope="col">모델</th><th scope="col">상태</th><th scope="col">오류 코드</th></tr></thead><tbody>{dashboard.ai.recentEvents.slice(0, 30).map(event => <tr key={event.id}><td className="admin-nowrap">{date(event.created_at)}</td><td><code>{event.model}</code></td><td><span className={`admin-badge ${tone(event.status)}`}>{event.status}</span></td><td>{event.error_code ? <code>{event.error_code}</code> : '—'}</td></tr>)}</tbody></TableWrap> : <Empty>기록된 요청이 없습니다.</Empty>}</section></>}

      {tab === 'support' && <><SearchBar label="문의 검색" placeholder="제목·계정·접수 번호 검색" value={search} onChange={updateSearch} count={`${num(visibleTickets.length)}건`} /><div className="admin-ticket-list">{visibleTickets.slice(page * 25, page * 25 + 25).map(ticket => <Ticket key={`${ticket.id}/${ticket.updated_at}`} ticket={ticket} email={memberEmail(ticket.user_id)} messages={dashboard.support.messages.filter(message => message.ticket_id === ticket.id)} busy={busy} save={(status, reason) => mutate(() => updateSupportStatus(ticket, status, reason), '문의 처리 상태를 저장했습니다.')} />)}</div>{visibleTickets.length === 0 && <div className="admin-card"><Empty>접수된 문의·신고가 없습니다.</Empty></div>}<Pages page={page} total={visibleTickets.length} setPage={setPage} /></>}

      {tab === 'billing' && <><div className="admin-billing-status"><span className={`admin-badge ${dashboard.system.configuration.billingEnabled ? 'success' : 'warning'}`}>{dashboard.system.configuration.billingEnabled ? '결제 활성' : '결제 비활성'}</span><span className="admin-count">{({ test: '테스트', live: '실결제' } as Record<string, string>)[dashboard.system.configuration.billingMode] || '미설정'} · 내역 조회</span></div>
        <section className="admin-card table-card"><div className="table-card-head"><h2>최근 결제</h2>{dashboard.payments.length > 0 && <span className="admin-count">최근 {num(Math.min(50, dashboard.payments.length))}건</span>}</div>{dashboard.payments.length ? <TableWrap label="최근 결제"><thead><tr><th scope="col">일시 / 주문 번호</th><th scope="col">사용자 / 상품</th><th scope="col" className="admin-right">금액</th><th scope="col">상태</th><th scope="col" className="admin-right">환불 누계</th></tr></thead><tbody>{dashboard.payments.slice(0, 50).map(payment => <tr key={payment.id}><td className="admin-nowrap">{date(payment.created_at)}<small><code>{payment.toss_order_id}</code></small></td><td>{memberEmail(payment.user_id)}<small>{payment.plan_id}</small></td><td className="admin-right admin-num">{num(payment.amount)} {payment.currency}</td><td><span className={`admin-badge ${tone(payment.status)}`}>{payment.status}</span></td><td className="admin-right admin-num">{num(payment.refundedAmount)}원</td></tr>)}</tbody></TableWrap> : <Empty>결제 내역이 없습니다.</Empty>}</section>
        <section className="admin-card table-card"><div className="table-card-head"><h2>최근 환불</h2>{dashboard.refunds.length > 0 && <span className="admin-count">최근 {num(Math.min(50, dashboard.refunds.length))}건</span>}</div>{dashboard.refunds.length ? <TableWrap label="최근 환불"><thead><tr><th scope="col">일시</th><th scope="col">원결제 ID</th><th scope="col" className="admin-right">금액</th><th scope="col">상태</th><th scope="col">사유</th></tr></thead><tbody>{dashboard.refunds.slice(0, 50).map(refund => <tr key={refund.id}><td className="admin-nowrap">{date(refund.created_at)}</td><td><code>{refund.payment_id}</code></td><td className="admin-right admin-num">{num(refund.amount)}원</td><td><span className={`admin-badge ${tone(refund.status)}`}>{refund.status}</span></td><td className="admin-wide">{refund.reason}</td></tr>)}</tbody></TableWrap> : <Empty>환불 내역이 없습니다.</Empty>}</section></>}

      {tab === 'audit' && <section className="admin-card table-card" aria-label="변경 이력">{dashboard.audits.length ? <><div className="table-card-head"><h2>최근 변경 작업</h2><span className="admin-count">최근 {num(Math.min(100, dashboard.audits.length))}건</span></div><TableWrap label="관리자 변경 이력"><thead><tr><th scope="col">시각</th><th scope="col">운영자</th><th scope="col">작업 / 대상</th><th scope="col">사유</th></tr></thead><tbody>{dashboard.audits.slice(0, 100).map(audit => <tr key={audit.id}><td className="admin-nowrap">{date(audit.created_at)}</td><td>{audit.adminEmail}</td><td><code>{audit.action}</code><small>{audit.target_id || audit.target_type}</small></td><td className="admin-wide">{audit.reason || '—'}</td></tr>)}</tbody></TableWrap></> : <Empty>관리자 변경 이력이 없습니다.</Empty>}</section>}
    </main>
    {member && <MemberDialog member={dashboard.members.find(item => item.id === member.id) || member} self={user.id === member.id} busy={busy} notes={dashboard.notes.filter(note => note.user_id === member.id)} onClose={() => setMember(null)}
      onNote={note => mutate(() => addMemberNote(member.id, note), '관리자 메모를 저장했습니다.')}
      onAccess={(suspend, reason) => { if (confirm(`${member.email} 계정의 로그인 이용 제한을 ${suspend ? '적용' : '해제'}할까요?`)) void mutate(() => updateMember(member.id, suspend, reason), '계정 상태를 변경했습니다.'); }} />}
  </div>;
}

function TableWrap({ label, children }: { label: string; children: React.ReactNode }) { return <div className="admin-table-wrap" role="region" aria-label={label} tabIndex={0}><table>{children}</table></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="admin-empty"><Inbox size={20} aria-hidden="true" />{children}</p>; }
function SearchBar({ label, placeholder, value, onChange, count }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; count: string }) {
  return <div className="admin-search"><div className="admin-search-field"><Search size={16} aria-hidden="true" /><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></div><span className="admin-count" aria-live="polite">{count}</span></div>;
}
function Pages({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) {
  if (total <= 25) return null;
  return <nav className="admin-pagination" aria-label="페이지 이동"><span className="admin-count">{num(page * 25 + 1)}–{num(Math.min(total, (page + 1) * 25))} / {num(total)}</span><div><button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" />이전</button><button type="button" disabled={(page + 1) * 25 >= total} onClick={() => setPage(page + 1)}>다음<ChevronRight size={16} aria-hidden="true" /></button></div></nav>;
}
function Ticket({ ticket, email, messages, busy, save }: { ticket: SupportTicket; email: string; messages: AdminDashboard['support']['messages']; busy: boolean; save: (status: SupportTicket['status'], reason: string) => Promise<void> }) {
  const [status, setStatus] = useState(ticket.status); const [reason, setReason] = useState('');
  const titleId = `admin-ticket-${ticket.id}`;
  return <details className="admin-ticket"><summary><span className={`admin-badge ${statusTones[ticket.status] || ''}`}>{statusLabels[ticket.status]}</span><span className="admin-ticket-heading"><strong id={titleId}>{ticket.subject}</strong><span className="admin-ticket-meta">{categoryLabels[ticket.category]} · {email}</span></span><time className="admin-count" dateTime={ticket.created_at}>{new Date(ticket.created_at).toLocaleDateString('ko-KR')}</time><ChevronRight size={16} className="admin-ticket-chevron" aria-hidden="true" /></summary><form className="admin-ticket-content" aria-labelledby={titleId} onSubmit={event => { event.preventDefault(); void save(status, reason); }}>
    <div className="admin-ticket-messages">{messages.length ? messages.map(message => <div key={message.id} className="admin-message"><small>{message.sender_role === 'admin' ? '운영자' : '사용자'} · {date(message.created_at)}</small><p className="admin-report-body">{message.message}</p></div>) : <p className="admin-caption">메시지가 없습니다.</p>}</div>
    <p className="admin-caption">접수 번호 <code>{ticket.id}</code></p><div className="admin-report-form"><label>처리 상태<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as SupportTicket['status'])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>처리 사유<input required minLength={2} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy}>저장</button></div></form></details>;
}
function MemberDialog({ member, self, busy, notes, onClose, onNote, onAccess }: { member: AdminMember; self: boolean; busy: boolean; notes: AdminDashboard['notes']; onClose: () => void; onNote: (note: string) => Promise<void>; onAccess: (suspend: boolean, reason: string) => void }) {
  const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const banned = isBanned(member);
  const dialog = useRef<HTMLElement>(null); const locked = self || member.adminRole === 'admin'; const [label, accent] = memberStatus(member);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [busy, onClose]);
  useEffect(() => { const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.current?.focus(); return () => previous?.focus(); }, []);
  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'));
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="admin-modal-backdrop"><section ref={dialog} tabIndex={-1} onKeyDown={trapFocus} className="admin-member-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-member-title">
    <header className="admin-dialog-head"><span className="admin-avatar large" aria-hidden="true">{initial(member)}</span><div><h2 id="admin-member-title">{member.name}</h2><p>{member.email}</p></div><button type="button" className="icon" onClick={onClose} disabled={busy} aria-label="사용자 상세 닫기"><X size={18} /></button></header>
    <dl className="admin-detail-list"><div><dt>상태</dt><dd><span className={`admin-badge ${accent}`}>{label}</span></dd></div><div><dt>UID</dt><dd><code>{member.id}</code></dd></div><div><dt>가입</dt><dd>{date(member.joinedAt)}</dd></div><div><dt>최근 로그인</dt><dd>{date(member.lastSignInAt)}</dd></div></dl>
    <form className="admin-dialog-section" onSubmit={event => { event.preventDefault(); onAccess(!banned, reason); }}><h3>로그인 이용 제한</h3>{locked && <p className="admin-caption admin-flush">본인 계정과 관리자 계정은 이용 제한을 변경할 수 없습니다.</p>}<label>처리 사유<input required minLength={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || locked} /></label><div className="admin-dialog-actions"><button className={banned ? '' : 'danger'} disabled={busy || locked}>{banned ? '이용 제한 해제' : '이용 제한'}</button></div></form>
    <form className="admin-dialog-section" onSubmit={event => { event.preventDefault(); void onNote(note); }}><h3>관리자 메모</h3><textarea aria-label="관리자 메모" required maxLength={2000} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /><div className="admin-dialog-actions"><button disabled={busy}>메모 저장</button></div></form>
    {notes.length > 0 && <ul className="admin-member-notes" aria-label="저장된 관리자 메모">{notes.map(item => <li key={item.id}><p>{item.note}</p><small>{item.adminEmail} · {date(item.created_at)}</small></li>)}</ul>}</section></div>;
}

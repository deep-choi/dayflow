import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { User as AuthUser } from '@supabase/supabase-js';
import { Activity, ArrowLeft, CreditCard, FileClock, Flag, LogOut, RefreshCw, Settings2, ShieldCheck, Users, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { AdminError, addMemberNote, fetchAdminDashboard, fetchAdminSettings, saveAdminSettings, updateMember, updateSupportStatus } from '../services/adminService';
import type { AdminDashboard, AdminMember, AdminSettings, SupportTicket } from '../adminTypes';
import '../styles/admin.css';

const AuthView = lazy(() => import('./AuthView'));
const tabs = [ { id: 'overview', label: '운영 현황', icon: Activity }, { id: 'members', label: '사용자', icon: Users },
  { id: 'ai', label: 'AI 운영', icon: Settings2 }, { id: 'support', label: '문의·신고', icon: Flag },
  { id: 'billing', label: '결제·환불', icon: CreditCard }, { id: 'audit', label: '변경 이력', icon: FileClock } ] as const;
type Tab = typeof tabs[number]['id'];
const num = (value: number) => value.toLocaleString('ko-KR');
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : '—';
const text = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const statusLabels: Record<string, string> = { open: '접수', in_progress: '처리 중', resolved: '해결', closed: '종료' };
const categoryLabels: Record<string, string> = { service: '서비스', account: '계정', billing: '결제', ai: 'AI 신고', other: '기타' };

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

  if (!dashboard || !user || denied) return <div className="df-admin admin-gate"><section className="admin-gate-card">
    <img src="/favicon.svg" width={36} height={36} alt="" /><h1>Dayflow 관리자</h1>
    <p>{loading || !authReady ? '관리자 권한 확인 중…' : error || '운영자 계정으로 로그인해 주세요.'}</p>
    {user && <p className="admin-caption">{user.email}</p>}
    {!loading && authReady && <div className="admin-actions">{user ? <><button onClick={refresh}>다시 확인</button><button onClick={logout}>다른 계정으로 로그인</button></> : <button className="primary" onClick={() => setLoginOpen(true)}>로그인</button>}<a href="/">Dayflow로 돌아가기</a></div>}
    {loginOpen && login}
  </section></div>;

  const visibleMembers = dashboard.members.filter(item => `${item.name} ${item.email} ${item.id}`.toLowerCase().includes(search.toLowerCase()));
  const visibleTickets = dashboard.support.tickets.filter(item => `${item.subject} ${item.user_id} ${item.id} ${categoryLabels[item.category]}`.toLowerCase().includes(search.toLowerCase()));
  const memberEmail = (id: string) => dashboard.members.find(item => item.id === id)?.email || id;
  return <div className="df-admin admin-shell"><aside className="admin-sidebar"><a className="admin-brand" href="/admin"><img src="/favicon.svg" width={30} height={30} alt="" /><span>Dayflow<small>운영 콘솔</small></span></a>
    <nav aria-label="관리자 메뉴">{tabs.map(item => <button key={item.id} disabled={busy} aria-current={tab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} />{item.label}</button>)}</nav>
    <div className="admin-sidebar-footer"><a href="/"><ArrowLeft size={16} />Dayflow로 돌아가기</a><button onClick={logout}><LogOut size={16} />로그아웃</button></div></aside>
    <main className="admin-main"><header className="admin-header"><div><div className="admin-eyebrow"><ShieldCheck size={14} />관리자</div><h1>{tabs.find(item => item.id === tab)?.label}</h1></div><button disabled={busy || loading} onClick={refresh}><RefreshCw size={16} />새로고침</button></header>
      {error && <div className="admin-alert error" role="alert">{error}</div>}{notice && <div className="admin-alert success" role="status">{notice}</div>}
      {loading && <p role="status" className="admin-caption">최신 정보 확인 중…</p>}
      {tab === 'overview' && <><p className="admin-caption">{date(dashboard.generatedAt)} 조회 · 서버 제공 AI 기준</p><div className="admin-stats">{[
        ['등록 사용자', num(dashboard.summary.totalUsers)], ['미처리 문의', num(dashboard.summary.openSupportTickets)], ['30일 AI 요청', num(dashboard.summary.aiRequests30d)], ['30일 AI 실패', num(dashboard.summary.aiFailures30d)]
      ].map(([label, value]) => <section key={label} className="admin-card"><span>{label}</span><strong>{value}</strong></section>)}</div>
      <section className="admin-card"><h2>결제 현황 <small>이번 달 UTC 기준 · 최근 조회 내역</small></h2><div className="admin-usage"><div><span>승인 금액</span><strong>{num(dashboard.summary.monthlyGrossRevenue)}원</strong></div><div><span>환불 금액</span><strong>{num(dashboard.summary.monthlyRefunds)}원</strong></div><div><span>이용 권한이 있는 구독</span><strong>{num(dashboard.summary.activeEntitlements)}개</strong></div></div></section>
      <section className="admin-card"><h2>체험 AI</h2><div className="admin-section-title"><span className={`admin-badge ${settings?.trial_paused ? 'warning' : ''}`}>{settings?.trial_paused ? '일시 중지' : '운영 중'}</span><button onClick={() => navigate('ai')}>AI 운영 설정</button></div><p className="admin-caption">개인 API와 로컬 모델은 사용자가 직접 연결해 이용합니다. 이 콘솔은 서버 체험의 상태와 사용량을 관리합니다.</p></section></>}

      {tab === 'members' && <><div className="admin-search"><input aria-label="사용자 검색" placeholder="이름·이메일·UID 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div><section className="admin-card table-card"><div className="admin-table-wrap"><table><thead><tr><th>계정</th><th>최근 로그인</th><th>서버 AI 사용</th><th>상태</th><th>관리</th></tr></thead><tbody>{visibleMembers.slice(page * 25, page * 25 + 25).map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.email}</small></td><td>{date(item.lastSignInAt)}</td><td>{num(item.aiUsed)} / {num(item.aiLimit)}회<small>체험 또는 구독 제공량</small></td><td>{item.adminRole === 'admin' ? '관리자' : item.bannedUntil && Date.parse(item.bannedUntil) > Date.now() ? '이용 제한' : '정상'}</td><td><button onClick={() => setMember(item)}>상세</button></td></tr>)}</tbody></table></div>{visibleMembers.length === 0 && <p className="admin-empty">검색 결과가 없습니다.</p>}</section><Pages page={page} total={visibleMembers.length} setPage={setPage} /></>}

      {tab === 'ai' && settings && <><form onSubmit={event => { event.preventDefault(); if (confirm('이 설정을 이후 서버 체험 요청부터 적용할까요?')) void mutate(() => saveAdminSettings(settings), '체험 AI 설정을 적용했습니다.'); }}>
        <section className="admin-card"><h2>서버 제공 체험</h2><label className="admin-check"><input type="checkbox" checked={settings.trial_paused} disabled={busy} onChange={event => setSettings({ ...settings, trial_paused: event.target.checked })} /><span>체험 AI 일시 중지<small>로그인 전·후 서버 체험에 적용됩니다. 개인 API 연결에는 영향을 주지 않습니다.</small></span></label></section>
        <section className="admin-card"><h2>비로그인 체험 일일 한도 <small>UTC 자정 / 한국 시간 오전 9시</small></h2><div className="admin-form-grid"><label>IP당 요청 수<input type="number" min={1} max={100000} required value={settings.guest_ip_daily_limit} disabled={busy} onChange={event => setSettings({ ...settings, guest_ip_daily_limit: Number(event.target.value) })} /></label><label>전체 요청 수<input type="number" min={1} max={100000} required value={settings.guest_global_daily_limit} disabled={busy} onChange={event => setSettings({ ...settings, guest_global_daily_limit: Number(event.target.value) })} /></label></div><p className="admin-caption">기기당 10회·로그인 계정당 무료 체험 10회는 유지됩니다. 요청 한도는 실제 청구액의 상한을 뜻하지 않습니다.</p></section>
        <div className="admin-save"><button className="primary" disabled={busy || loading}>설정 저장</button></div></form>
        <section className="admin-card table-card" style={{ marginTop: 24 }}><h2>최근 30일 서버 AI 요청</h2>{dashboard.ai.recentEvents.length ? <div className="admin-table-wrap"><table><thead><tr><th>시각</th><th>모델</th><th>상태</th><th>오류 코드</th></tr></thead><tbody>{dashboard.ai.recentEvents.slice(0, 30).map(event => <tr key={event.id}><td>{date(event.created_at)}</td><td>{event.model}</td><td>{event.status}</td><td>{event.error_code || '—'}</td></tr>)}</tbody></table></div> : <p className="admin-empty">기록된 요청이 없습니다.</p>}</section></>}

      {tab === 'support' && <><div className="admin-search"><input aria-label="문의 검색" placeholder="제목·계정·접수 번호 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>{visibleTickets.slice(page * 25, page * 25 + 25).map(ticket => <Ticket key={`${ticket.id}/${ticket.updated_at}`} ticket={ticket} email={memberEmail(ticket.user_id)} messages={dashboard.support.messages.filter(message => message.ticket_id === ticket.id)} busy={busy} save={(status, reason) => mutate(() => updateSupportStatus(ticket, status, reason), '문의 처리 상태를 저장했습니다.')} />)}{visibleTickets.length === 0 && <div className="admin-card admin-empty">접수된 문의·신고가 없습니다.</div>}<Pages page={page} total={visibleTickets.length} setPage={setPage} /></>}

      {tab === 'billing' && <><section className="admin-card"><div className="admin-section-title"><h2>결제 상태</h2><span className={`admin-badge ${dashboard.system.configuration.billingEnabled ? '' : 'warning'}`}>{dashboard.system.configuration.billingEnabled ? '결제 사용 설정 켜짐' : '결제 사용 설정 꺼짐'}</span></div><p className="admin-caption">환경: {({ test: '테스트', live: '실결제' } as Record<string, string>)[dashboard.system.configuration.billingMode] || '미설정'} · 결제·환불 내역을 조회합니다. 이 화면에서 결제나 환불을 실행하지 않습니다.</p></section>
        <section className="admin-card table-card"><h2>최근 결제</h2>{dashboard.payments.length ? <div className="admin-table-wrap"><table><thead><tr><th>일시 / 주문 번호</th><th>사용자 / 상품</th><th>금액</th><th>상태</th><th>환불 누계</th></tr></thead><tbody>{dashboard.payments.slice(0, 50).map(payment => <tr key={payment.id}><td>{date(payment.created_at)}<small>{payment.toss_order_id}</small></td><td>{memberEmail(payment.user_id)}<small>{payment.plan_id}</small></td><td>{num(payment.amount)} {payment.currency}</td><td>{payment.status}</td><td>{num(payment.refundedAmount)}원</td></tr>)}</tbody></table></div> : <p className="admin-empty">결제 내역이 없습니다.</p>}</section>
        <section className="admin-card table-card"><h2>최근 환불</h2>{dashboard.refunds.length ? <div className="admin-table-wrap"><table><thead><tr><th>일시</th><th>원결제 ID</th><th>금액</th><th>상태</th><th>사유</th></tr></thead><tbody>{dashboard.refunds.slice(0, 50).map(refund => <tr key={refund.id}><td>{date(refund.created_at)}</td><td>{refund.payment_id}</td><td>{num(refund.amount)}원</td><td>{refund.status}</td><td>{refund.reason}</td></tr>)}</tbody></table></div> : <p className="admin-empty">환불 내역이 없습니다.</p>}</section></>}

      {tab === 'audit' && <section className="admin-card table-card">{dashboard.audits.length ? <div className="admin-table-wrap"><table><thead><tr><th>시각</th><th>운영자</th><th>작업 / 대상</th><th>사유</th></tr></thead><tbody>{dashboard.audits.slice(0, 100).map(audit => <tr key={audit.id}><td>{date(audit.created_at)}</td><td>{audit.adminEmail}</td><td>{audit.action}<small>{audit.target_id || audit.target_type}</small></td><td>{audit.reason || '—'}</td></tr>)}</tbody></table></div> : <p className="admin-empty">관리자 변경 이력이 없습니다.</p>}</section>}
    </main>
    {member && <MemberDialog member={dashboard.members.find(item => item.id === member.id) || member} self={user.id === member.id} busy={busy} notes={dashboard.notes.filter(note => note.user_id === member.id)} onClose={() => setMember(null)}
      onNote={note => mutate(() => addMemberNote(member.id, note), '관리자 메모를 저장했습니다.')}
      onAccess={(suspend, reason) => { if (confirm(`${member.email} 계정의 로그인 이용 제한을 ${suspend ? '적용' : '해제'}할까요?`)) void mutate(() => updateMember(member.id, suspend, reason), '계정 상태를 변경했습니다.'); }} />}
  </div>;
}

function Pages({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) { return <div className="admin-pagination">{page > 0 && <button onClick={() => setPage(page - 1)}>이전</button>}{(page + 1) * 25 < total && <button onClick={() => setPage(page + 1)}>다음</button>}</div>; }
function Ticket({ ticket, email, messages, busy, save }: { ticket: SupportTicket; email: string; messages: AdminDashboard['support']['messages']; busy: boolean; save: (status: SupportTicket['status'], reason: string) => Promise<void> }) {
  const [status, setStatus] = useState(ticket.status); const [reason, setReason] = useState('');
  return <form className="admin-card" onSubmit={event => { event.preventDefault(); void save(status, reason); }}><div className="admin-section-title"><h2>{ticket.subject}</h2><span className="admin-badge">{statusLabels[ticket.status]}</span></div><p className="admin-caption">{categoryLabels[ticket.category]} · {email} · {date(ticket.created_at)}<br />접수 번호 {ticket.id}</p>
    <details className="admin-ticket-messages"><summary>접수 내용 보기</summary>{messages.length ? messages.map(message => <div key={message.id}><small>{message.sender_role === 'admin' ? '운영자' : '사용자'} · {date(message.created_at)}</small><p className="admin-report-body">{message.message}</p></div>) : <p>메시지가 없습니다.</p>}</details>
    <div className="admin-report-form"><label>처리 상태<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as SupportTicket['status'])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>처리 사유<input required minLength={2} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy}>저장</button></div></form>;
}
function MemberDialog({ member, self, busy, notes, onClose, onNote, onAccess }: { member: AdminMember; self: boolean; busy: boolean; notes: AdminDashboard['notes']; onClose: () => void; onNote: (note: string) => Promise<void>; onAccess: (suspend: boolean, reason: string) => void }) {
  const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const banned = Boolean(member.bannedUntil && Date.parse(member.bannedUntil) > Date.now());
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [busy, onClose]);
  return <div className="admin-modal-backdrop"><section className="admin-member-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-member-title"><div className="admin-section-title"><h2 id="admin-member-title">{member.name}</h2><button onClick={onClose} disabled={busy} aria-label="사용자 상세 닫기"><X size={16} /></button></div><p>{member.email}</p><p className="admin-caption">{member.id}<br />가입 {date(member.joinedAt)}<br />최근 로그인 {date(member.lastSignInAt)}</p>
    <form onSubmit={event => { event.preventDefault(); onAccess(!banned, reason); }}><h3>로그인 이용 제한</h3><label>처리 사유<input required minLength={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || self || member.adminRole === 'admin'} /></label><button className={banned ? '' : 'danger'} disabled={busy || self || member.adminRole === 'admin'}>{banned ? '이용 제한 해제' : '이용 제한'}</button></form>
    <form onSubmit={event => { event.preventDefault(); void onNote(note); }}><h3>관리자 메모</h3><textarea aria-label="관리자 메모" required maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /><button disabled={busy}>메모 저장</button></form><div className="admin-member-notes">{notes.map(item => <div key={item.id}><p>{item.note}</p><small>{item.adminEmail} · {date(item.created_at)}</small></div>)}</div></section></div>;
}

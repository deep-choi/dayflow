import React, { useState } from 'react';
import { ArrowLeft, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../utils/supabase';

interface AdminLoginViewProps {
  currentEmail?: string;
  onBack: () => void;
}

const hasAdminRole = (appMetadata: Record<string, unknown> | undefined): boolean =>
  appMetadata?.role === 'admin' || appMetadata?.is_admin === true;

const AdminLoginView: React.FC<AdminLoginViewProps> = ({ currentEmail, onBack }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      if (!data.user || !hasAdminRole(data.user.app_metadata as Record<string, unknown> | undefined)) {
        await supabase.auth.signOut();
        throw new Error('관리자 권한이 없는 계정입니다.');
      }
    } catch (signInError) {
      const message = signInError instanceof Error ? signInError.message : '관리자 로그인에 실패했습니다.';
      setError(message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.' : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#fbfbfa] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <button
          type="button"
          onClick={onBack}
          className="mb-8 inline-flex items-center gap-2 text-sm text-[#787774] transition-colors hover:text-[#171717]"
        >
          <ArrowLeft size={16} />
          Dayflow로 돌아가기
        </button>

        <div className="border-t-2 border-[var(--color-primary)] bg-white px-7 py-8 sm:px-9 sm:py-10">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-light)] text-[var(--color-primary)]">
            <ShieldCheck size={22} />
          </div>
          <h1 className="mt-6 text-2xl font-medium tracking-[-0.03em] text-[#171717]">관리자 로그인</h1>
          <p className="mt-2 text-sm leading-6 text-[#787774]">
            운영 데이터는 관리자 권한이 등록된 계정으로만 확인할 수 있습니다.
          </p>

          {currentEmail && (
            <div className="mt-5 border-l-2 border-[#d8d8d5] bg-[#f7f7f5] px-3 py-2.5 text-[13px] leading-5 text-[#6f6f6b]">
              현재 로그인된 {currentEmail} 계정에는 관리자 권한이 없습니다.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-[#5f5f5f]">관리자 이메일</span>
              <span className="relative block">
                <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  placeholder="admin@example.com"
                  className="h-12 w-full rounded-xl border border-[#dededb] bg-white pl-10 pr-4 text-sm text-[#171717] outline-none transition-colors focus:border-[var(--color-primary)]"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-[#5f5f5f]">비밀번호</span>
              <span className="relative block">
                <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="비밀번호를 입력하세요"
                  className="h-12 w-full rounded-xl border border-[#dededb] bg-white pl-10 pr-4 text-sm text-[#171717] outline-none transition-colors focus:border-[var(--color-primary)]"
                />
              </span>
            </label>

            {error && (
              <div className="border-l-2 border-[#d94848] bg-[#fff8f8] px-3 py-2.5 text-[13px] leading-5 text-[#a23838]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {isSubmitting ? '권한 확인 중...' : '관리자 로그인'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs leading-5 text-[#9b9a97]">
            일반 Dayflow 계정은 이 페이지에 접근할 수 없습니다.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLoginView;

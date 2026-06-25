import React, { useEffect, useState } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2, KeyRound } from 'lucide-react';
import { supabase } from '../utils/supabase';

interface AuthViewProps {
    onLogin: (userData: any) => void;
    initialMode?: 'login' | 'signup';
}

const AuthView: React.FC<AuthViewProps> = ({ onLogin, initialMode = 'login' }) => {
    const [isLogin, setIsLogin] = useState(initialMode !== 'signup');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLogin(initialMode !== 'signup');
        setError(null);
    }, [initialMode]);

    useEffect(() => {
        const readAuthError = () => {
            const searchParams = new URLSearchParams(window.location.search);
            const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
            return (
                searchParams.get('error_description') ||
                searchParams.get('error') ||
                hashParams.get('error_description') ||
                hashParams.get('error')
            );
        };

        const authError = readAuthError();
        if (!authError) return;

        setError(decodeURIComponent(authError.replace(/\+/g, ' ')));
        window.history.replaceState({}, document.title, window.location.pathname);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isLogin) {
                // Login logic
                const { data, error: authError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (authError) throw authError;

                if (data.user) {
                    // Fetch profile
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', data.user.id)
                        .single();

                    const userData = {
                        id: data.user.id,
                        email: data.user.email,
                        name: profile?.name || data.user.email?.split('@')[0],
                        avatar: profile?.avatar_url || data.user.user_metadata?.avatar_url || data.user.user_metadata?.picture || '',
                        geminiApiKey: profile?.gemini_api_key || ''
                    };
                    onLogin(userData);
                }
            } else {
                // Signup logic
                const { data, error: authError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: name,
                        }
                    }
                });

                if (authError) throw authError;

                if (data.user) {
                    // Create profile entry
                    const { error: profileError } = await supabase
                        .from('profiles')
                        .insert([
                            {
                                id: data.user.id,
                                name,
                                gemini_api_key: apiKey
                            }
                        ]);

                    if (profileError) console.error('Profile creation error:', profileError);

                    if (!data.session) {
                        setIsLogin(true);
                        setPassword('');
                        setError('회원가입이 완료되었습니다. 이메일 인증 후 로그인해주세요.');
                        return;
                    }

                    const userData = {
                        id: data.user.id,
                        email: data.user.email,
                        name: name,
                        geminiApiKey: apiKey
                    };
                    onLogin(userData);
                }
            }
        } catch (err: any) {
            setError(err.message || '인증에 실패했습니다. 정보를 다시 확인해주세요.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin
                }
            });
            if (error) throw error;
        } catch (err: any) {
            setError(err.message || 'Google 로그인에 실패했습니다.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-dvh bg-[#fbfbfa] flex justify-center px-6 py-6 font-sans sm:py-10">
            <div className="my-auto grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-20 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <section className="space-y-2 text-center lg:text-left">
                    <h1 className="text-[42px] leading-none font-medium text-[#171717] sm:text-[60px] lg:text-[76px]">
                        Dayflow
                    </h1>
                    <p className="mx-auto max-w-[360px] text-[15px] leading-6 font-normal text-[#787774] sm:text-[16px] sm:leading-7 lg:mx-0">
                        인공지능과 함께하는 완벽한 일상 기록
                    </p>
                </section>

                {/* Auth Card */}
                <section className="w-full max-w-[320px] justify-self-center space-y-4 sm:max-w-[400px] sm:space-y-8 lg:justify-self-end">
                    <div className="space-y-4 sm:space-y-6 sm:rounded-3xl sm:border sm:border-[#e9e9e8] sm:bg-white sm:p-8">
                    <div className="flex p-1 bg-[#f1f1f0] rounded-xl">
                        <button
                            onClick={() => setIsLogin(true)}
                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${isLogin ? 'bg-white text-[#37352f]' : 'text-[#787774] hover:text-[#37352f]'}`}
                        >
                            로그인
                        </button>
                        <button
                            onClick={() => setIsLogin(false)}
                            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${!isLogin ? 'bg-white text-[#37352f]' : 'text-[#787774] hover:text-[#37352f]'}`}
                        >
                            회원가입
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                        {!isLogin && (
                            <div className="space-y-1.5">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] uppercase tracking-wider ml-1">이름</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                    <input
                                        type="text"
                                        placeholder="홍길동"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required={!isLogin}
                                        className="w-full pl-11 pr-4 py-2.5 bg-[#f7f7f5] border border-transparent rounded-xl focus:border-[var(--color-primary)] transition-colors outline-none text-sm sm:py-3"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-[13px] leading-5 font-medium text-[#787774] uppercase tracking-wider ml-1">이메일</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                <input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    className="w-full pl-11 pr-4 py-2.5 bg-[#f7f7f5] border border-transparent rounded-xl focus:border-[var(--color-primary)] transition-colors outline-none text-sm sm:py-3"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[13px] leading-5 font-medium text-[#787774] uppercase tracking-wider ml-1">비밀번호</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    className="w-full pl-11 pr-4 py-2.5 bg-[#f7f7f5] border border-transparent rounded-xl focus:border-[var(--color-primary)] transition-colors outline-none text-sm sm:py-3"
                                />
                            </div>
                        </div>

                        {!isLogin && (
                            <div className="space-y-1.5">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] uppercase tracking-wider ml-1">API Key (선택)</label>
                                <div className="relative">
                                    <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                    <input
                                        type="password"
                                        placeholder="AIza..."
                                        value={apiKey}
                                        onChange={e => setApiKey(e.target.value)}
                                        className="w-full pl-11 pr-4 py-2.5 bg-[#f7f7f5] border border-transparent rounded-xl focus:border-[var(--color-primary)] transition-colors outline-none text-sm font-mono placeholder:font-sans sm:py-3"
                                    />
                                </div>
                                <p className="text-[13px] leading-5 text-[#9b9a97] ml-1">설정에서 나중에 등록할 수 있습니다.</p>
                            </div>
                        )}

                        {error && (
                            <p className="text-[13px] leading-5 text-[#eb5757] font-medium ml-1 animate-in shake-1 duration-300">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[var(--color-primary)] text-white border-none py-3 rounded-xl font-medium text-sm hover:bg-[var(--color-primary-hover)] transition-all flex items-center justify-center gap-2 group mt-2 disabled:opacity-70 disabled:cursor-not-allowed sm:mt-4 sm:py-3.5"
                        >
                            {loading ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <>
                                    {isLogin ? '로그인' : '회원가입 완료'}
                                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="space-y-2 sm:space-y-3 sm:pt-1">
                        <div className="relative flex items-center py-1 sm:py-2">
                            <div className="h-px flex-1 bg-[#f1f1f0]"></div>
                            <span className="px-3 text-[13px] leading-5 font-medium text-[#9b9a97]">또는</span>
                            <div className="h-px flex-1 bg-[#f1f1f0]"></div>
                        </div>
                        <button
                            type="button"
                            onClick={handleGoogleLogin}
                            disabled={loading}
                            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[#e1e1df] bg-white px-4 text-[15px] leading-5 font-medium text-[#171717] shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition-colors hover:border-[#d3d1cb] hover:bg-[#f7f7f5] disabled:cursor-not-allowed disabled:opacity-60 sm:h-12"
                        >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4285F4] text-[13px] leading-none font-semibold text-white" aria-hidden="true">G</span>
                            <span>Google로 계속하기</span>
                        </button>
                    </div>
                    </div>

                {/* Footer */}
                    <p className="text-center text-[12px] leading-5 text-[#9b9a97] font-medium sm:text-[13px]">
                        계속 진행함으로써 Dayflow의 서비스 이용약관 및 <br />
                        개인정보 처리방침에 동의하게 됩니다.
                    </p>
                </section>
            </div>
        </div>
    );
};

export default AuthView;

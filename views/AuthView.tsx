import React, { useEffect, useState } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, Github, Loader2 } from 'lucide-react';
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
                        avatar: profile?.avatar_url || data.user.user_metadata?.avatar_url || '',
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
        <div className="min-h-screen bg-[#fbfbfa] flex items-center justify-center p-6 font-sans">
            <div className="max-w-[400px] w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                {/* Logo & Header */}
                <div className="text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[#37352f] text-white rounded-[22px] shadow-2xl mb-2 rotate-3 hover:rotate-0 transition-transform duration-500">
                        <Sparkles size={32} />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tight text-[#37352f]">LifeSync AI</h1>
                        <p className="text-[#787774] font-medium">인공지능과 함께하는 완벽한 일상 기록</p>
                    </div>
                </div>

                {/* Auth Card */}
                <div className="bg-white border border-[#e9e9e8] rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-6">
                    <div className="flex p-1 bg-[#f1f1f0] rounded-xl mb-4">
                        <button
                            onClick={() => setIsLogin(true)}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${isLogin ? 'bg-white text-[#37352f] shadow-sm' : 'text-[#787774] hover:text-[#37352f]'}`}
                        >
                            로그인
                        </button>
                        <button
                            onClick={() => setIsLogin(false)}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${!isLogin ? 'bg-white text-[#37352f] shadow-sm' : 'text-[#787774] hover:text-[#37352f]'}`}
                        >
                            회원가입
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-[#787774] uppercase tracking-wider ml-1">이름</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                    <input
                                        type="text"
                                        placeholder="홍길동"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required={!isLogin}
                                        className="w-full pl-11 pr-4 py-3 bg-[#f7f7f5] border-none rounded-xl focus:ring-2 focus:ring-[#37352f]/10 transition-all outline-none text-sm"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-[#787774] uppercase tracking-wider ml-1">이메일</label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                <input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-[#f7f7f5] border-none rounded-xl focus:ring-2 focus:ring-[#37352f]/10 transition-all outline-none text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-[#787774] uppercase tracking-wider ml-1">비밀번호</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-[#f7f7f5] border-none rounded-xl focus:ring-2 focus:ring-[#37352f]/10 transition-all outline-none text-sm"
                                />
                            </div>
                        </div>

                        {!isLogin && (
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-[#787774] uppercase tracking-wider ml-1">Gemini API Key (선택)</label>
                                <div className="relative">
                                    <Sparkles size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
                                    <input
                                        type="password"
                                        placeholder="AIza..."
                                        value={apiKey}
                                        onChange={e => setApiKey(e.target.value)}
                                        className="w-full pl-11 pr-4 py-3 bg-[#f7f7f5] border-none rounded-xl focus:ring-2 focus:ring-[#37352f]/10 transition-all outline-none text-sm font-mono placeholder:font-sans"
                                    />
                                </div>
                                <p className="text-[10px] text-[#9b9a97] ml-1">설정에서 나중에 등록할 수 있습니다.</p>
                            </div>
                        )}

                        {error && (
                            <p className="text-xs text-[#eb5757] font-medium ml-1 animate-in shake-1 duration-300">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[#37352f] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-black transition-all shadow-lg flex items-center justify-center gap-2 group mt-4 disabled:opacity-70 disabled:cursor-not-allowed"
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

                    <div className="relative py-4">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#f1f1f0]"></div></div>
                        <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-[#9b9a97]"><span className="bg-white px-3 font-bold">또는 소셜 로그인</span></div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            disabled
                            title="GitHub 로그인은 준비 중입니다."
                            className="flex items-center justify-center gap-2 py-2.5 border border-[#e9e9e8] rounded-xl text-xs font-semibold text-[#9b9a97] bg-[#f7f7f5] cursor-not-allowed"
                        >
                            <Github size={16} /> GitHub 준비 중
                        </button>
                        <button
                            type="button"
                            onClick={handleGoogleLogin}
                            disabled={loading}
                            className="flex items-center justify-center gap-2 py-2.5 border border-[#e9e9e8] rounded-xl hover:bg-[#f7f7f5] transition-all text-xs font-semibold text-[#37352f] disabled:opacity-50"
                        >
                            <div className="w-4 h-4 bg-[#4285F4] rounded-sm flex items-center justify-center text-[10px] text-white font-bold">G</div> Google
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-[#9b9a97] font-medium">
                    계속 진행함으로써 LifeSync AI의 서비스 이용약관 및 <br />
                    개인정보 처리방침에 동의하게 됩니다.
                </p>
            </div>
        </div>
    );
};

export default AuthView;

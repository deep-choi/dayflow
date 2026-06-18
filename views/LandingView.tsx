import React from 'react';
import { Sparkles, BookOpen, MessageCircle, CheckSquare, Calendar, ArrowRight, Zap, Shield, Heart } from 'lucide-react';

interface LandingViewProps {
    onGetStarted: () => void;
    onLogin: () => void;
}

const LandingView: React.FC<LandingViewProps> = ({ onGetStarted, onLogin }) => {
    return (
        <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-black/10">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 bg-white/70 backdrop-blur-xl border-b border-[#e9e9e8]">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-2.5 group cursor-pointer">
                        <div className="w-10 h-10 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-[14px] flex items-center justify-center transition-transform group-hover:rotate-6">
                            <Sparkles size={20} />
                        </div>
                        <span className="text-xl font-normal tracking-tight">Dayflow</span>
                    </div>
                    <div className="flex items-center gap-8">
                        <button
                            onClick={onLogin}
                            className="text-sm font-normal text-[#787774] hover:text-[#37352f] transition-colors"
                        >
                            로그인
                        </button>
                        <button
                            onClick={onGetStarted}
                            className="px-6 py-2.5 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] text-sm font-normal rounded-full hover:bg-[#eeeeee] transition-all active:scale-95"
                        >
                            시작하기
                        </button>
                    </div>
                </div>
            </nav>

            <main>
                {/* Hero Section */}
                <section className="relative pt-48 pb-32 overflow-hidden">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 bg-[radial-gradient(circle_at_center,rgba(120,119,198,0.05)_0,transparent_50%)]"></div>
                    <div className="max-w-7xl mx-auto px-6 text-center space-y-12">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#f1f1f0] rounded-full text-xs font-normal text-[#37352f] mb-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
                            <Zap size={14} className="text-amber-500" />
                            <span>당신을 가장 잘 이해하는 AI 비서</span>
                        </div>
                        <h1 className="text-[64px] lg:text-[84px] font-normal tracking-tighter leading-[1.05] text-[#1a1a1a] max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                            기억하지 말고, <br />
                            <span className="text-[#171717]">연결하세요.</span>
                        </h1>
                        <p className="text-xl lg:text-2xl text-[#787774] max-w-2xl mx-auto font-normal animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                            Dayflow는 단순한 노트를 넘어, 당신의 일정과 메모를 <br className="hidden lg:block" />
                            분석하고 AI 동료들과 소통하는 새로운 경험을 제공합니다.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
                            <button
                                onClick={onGetStarted}
                                className="w-full sm:w-auto px-10 py-5 bg-[var(--color-primary)] text-white text-lg font-normal rounded-[22px] hover:bg-[var(--color-primary-hover)] transition-all flex items-center justify-center gap-3 group shadow-sm shadow-blue-100"
                            >
                                무료로 시작하기
                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                            <button
                                onClick={onLogin}
                                className="w-full sm:w-auto px-10 py-5 bg-white border border-[#e9e9e8] text-[#37352f] text-lg font-normal rounded-[22px] hover:bg-[#f7f7f5] transition-all"
                            >
                                이미 계정이 있나요?
                            </button>
                        </div>

                        {/* Mockup Preview */}
                        <div className="pt-24 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
                            <div className="relative max-w-5xl mx-auto">
                                <div className="absolute -inset-0.5 bg-[#f3f3f3] rounded-[32px] -z-10"></div>
                                <div className="bg-white border border-[#e9e9e8] rounded-[32px] overflow-hidden">
                                    <div className="h-12 bg-[#f7f7f5] border-b border-[#e9e9e8] flex items-center px-6 gap-2">
                                        <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
                                        <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                                        <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
                                    </div>
                                    <div className="aspect-[16/10] bg-[#fbfbfa] p-8 flex gap-6">
                                        <div className="w-48 bg-white rounded-xl border border-[#e9e9e8] p-4 flex flex-col gap-3">
                                            <div className="h-4 w-3/4 bg-[#f1f1f0] rounded"></div>
                                            <div className="h-4 w-1/2 bg-[#f1f1f0] rounded"></div>
                                            <div className="h-4 w-5/6 bg-[#f1f1f0] rounded"></div>
                                        </div>
                                        <div className="flex-1 space-y-6">
                                            <div className="h-10 w-1/3 bg-[#ededec] rounded-lg"></div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="aspect-square bg-white rounded-2xl border border-[#e9e9e8] p-6 space-y-4">
                                                    <div className="w-10 h-10 bg-[#f3f3f3] text-[#171717] rounded-xl flex items-center justify-center">
                                                        <Sparkles size={20} />
                                                    </div>
                                                    <div className="h-3 w-1/2 bg-[#f1f1f0] rounded"></div>
                                                    <div className="h-3 w-full bg-[#f1f1f0] rounded"></div>
                                                </div>
                                                <div className="aspect-square bg-white rounded-2xl border border-[#e9e9e8] p-6 space-y-4">
                                                    <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                                                        <Calendar size={20} />
                                                    </div>
                                                    <div className="h-3 w-2/3 bg-[#f1f1f0] rounded"></div>
                                                    <div className="h-3 w-full bg-[#f1f1f0] rounded"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Features Grid */}
                <section className="bg-[#fbfbfa] py-32 border-y border-[#e9e9e8]">
                    <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-12">
                        <div className="space-y-6 group">
                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#37352f] border border-[#e9e9e8] group-hover:scale-110 transition-transform">
                                <BookOpen size={24} />
                            </div>
                            <h3 className="text-2xl font-normal tracking-tight">지능형 일기장</h3>
                            <p className="text-[#787774] leading-relaxed">
                                당신의 하루를 기록하면 AI 페르소나들이 각자의 관점으로 반응을 남깁니다. 단순한 기록이 대화가 되는 순간을 경험하세요.
                            </p>
                        </div>
                        <div className="space-y-6 group">
                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#37352f] border border-[#e9e9e8] group-hover:scale-110 transition-transform">
                                <CheckSquare size={24} />
                            </div>
                            <h3 className="text-2xl font-normal tracking-tight">유연한 할 일 관리</h3>
                            <p className="text-[#787774] leading-relaxed">
                                생산성을 위해 설계된 직관적인 투두 리스트. 드래그 앤 드롭으로 우선순위를 정하고 AI의 최적화된 습관 조언을 받아보세요.
                            </p>
                        </div>
                        <div className="space-y-6 group">
                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#37352f] border border-[#e9e9e8] group-hover:scale-110 transition-transform">
                                <Calendar size={24} />
                            </div>
                            <h3 className="text-2xl font-normal tracking-tight">데이플로우 캘린더</h3>
                            <p className="text-[#787774] leading-relaxed">
                                모든 일정과 일기, 할 일이 하나의 타임라인에서 만납니다. 과거를 회상하고 미래를 계획하는 가장 완벽한 방법입니다.
                            </p>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="py-40">
                    <div className="max-w-5xl mx-auto px-6 bg-[#f7f7f7] border border-[#e9e9e8] rounded-[48px] p-16 lg:p-24 text-center space-y-10 relative overflow-hidden">
                        <h2 className="text-[44px] lg:text-[64px] font-normal tracking-tighter text-[#171717] leading-[1.1]">
                            지금 바로 당신의 기록을 <br />
                            동기화 하세요.
                        </h2>
                        <p className="text-xl text-[#787774] max-w-xl mx-auto">
                            수천 명의 사용자가 Dayflow와 함께 더 나은 일상을 만들고 있습니다. <br />
                            첫 30일간 모든 프로 기능을 무료로 체험하세요.
                        </p>
                        <div className="pt-8">
                            <button
                                onClick={onGetStarted}
                                className="px-10 py-5 bg-white text-[#37352f] text-lg font-normal rounded-[22px] hover:bg-[#f7f7f5] transition-all active:scale-95 flex items-center justify-center gap-3 mx-auto"
                            >
                                무료 시작하기
                                <ArrowRight size={20} />
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="py-20 border-t border-[#e9e9e8] bg-[#fbfbfa]">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:row items-center justify-between gap-12">
                    <div className="flex items-center gap-2.5 opacity-50">
                        <div className="w-8 h-8 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-[10px] flex items-center justify-center">
                            <Sparkles size={16} />
                        </div>
                        <span className="text-lg font-normal tracking-tight">Dayflow</span>
                    </div>
                    <div className="flex gap-12 text-sm font-normal text-[#9b9a97]">
                        <span className="hover:text-[#37352f] cursor-pointer">기능 소개</span>
                        <span className="hover:text-[#37352f] cursor-pointer">요금제</span>
                        <span className="hover:text-[#37352f] cursor-pointer">개인정보보호</span>
                        <span className="hover:text-[#37352f] cursor-pointer">고객지원</span>
                    </div>
                    <p className="text-xs font-normal text-[#9b9a97]">© 2026 Dayflow. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingView;

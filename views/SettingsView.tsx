import React, { useState, useEffect } from 'react';
import { AIAgent, AppSettings, PersonaMemory, ThemeMode, User } from '../types';
import { Trash2, Save, Download, Trash, Upload, SunMedium, Moon, Monitor, LogOut } from 'lucide-react';
import PersonaSettingsView from './PersonaSettingsView';

type SettingsTab = 'account' | 'theme' | 'persona' | 'data';

interface SettingsViewProps {
    agents: AIAgent[];
    onUpdateAgents: (agents: AIAgent[]) => void;
    settings: AppSettings;
    onUpdateSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
    currentUser: User | null;
    onUpdateUser: (user: User) => void;
    onLogout: () => void;
    isLoggingOut?: boolean;
    onExportData: () => void;
    onClearAllData: () => void;
    onClearActivity: () => void;
    onClearPosts: () => void;
    onClearEvents: () => void;
    onClearTodos: () => void;
    onClearEntries: () => void;
    onClearChat: () => void;
    personaMemories: PersonaMemory[];
    onAddPersonaMemory: (agentId: string, type: PersonaMemory['type'], content: string) => void;
    onForgetPersonaMemory: (memoryId: string) => void;
    onClearAgentPersonaMemories: (agentId: string) => void;
}

const THEME_OPTIONS: { id: ThemeMode; label: string; description: string; icon: React.ElementType }[] = [
    { id: 'system', label: '시스템', description: 'OS 설정을 따릅니다.', icon: Monitor },
    { id: 'light', label: '라이트', description: '밝은 테마를 사용합니다.', icon: SunMedium },
    { id: 'dark', label: '다크', description: '어두운 테마를 사용합니다.', icon: Moon },
];

const SettingsView: React.FC<SettingsViewProps> = ({
    agents,
    onUpdateAgents,
    settings,
    onUpdateSettings,
    currentUser,
    onUpdateUser,
    onLogout,
    isLoggingOut = false,
    onExportData,
    onClearAllData,
    onClearActivity,
    onClearPosts,
    onClearEvents,
    onClearTodos,
    onClearEntries,
    onClearChat,
    personaMemories,
    onAddPersonaMemory,
    onForgetPersonaMemory,
    onClearAgentPersonaMemories,
}) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');

    const [userDraft, setUserDraft] = useState<User | null>(currentUser);
    useEffect(() => {
        if (currentUser) setUserDraft(currentUser);
    }, [currentUser]);


    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (url: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기가 너무 큽니다 (최대 5MB)');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                callback(event.target.result as string);
            }
        };
        reader.readAsDataURL(file);
    };

    const tabs: { id: SettingsTab; label: string }[] = [
        { id: 'account', label: '계정' },
        { id: 'theme', label: '테마' },
        { id: 'persona', label: '페르소나' },
        { id: 'data', label: '데이터 관리' },
    ];

    return (
        <div className="max-w-[1080px] w-full mx-auto px-2 pb-20 font-sans overflow-x-hidden">
            {/* Header */}
            <div className="pt-4 mb-6">
                <h1 className="text-base font-medium text-[#37352f] tracking-normal">설정</h1>
                <p className="text-sm text-[#9b9a97] mt-1">계정, 페르소나와 데이터를 관리합니다.</p>
            </div>

            {/* Tab Navigation */}
            <div className="mb-6 overflow-x-auto scrollbar-hide">
                <div className="inline-flex min-w-max gap-1 bg-[#f7f7f5] p-1 rounded-lg">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === tab.id
                                ? 'bg-white text-[#37352f]'
                                : 'text-[#9b9a97] hover:text-[#37352f]'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ===== 테마 탭 ===== */}
            {activeTab === 'theme' && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 sm:p-6 space-y-4">
                        <div>
                            <h3 className="text-base font-medium text-[#37352f]">테마</h3>
                            <p className="text-sm text-[#9b9a97] mt-1">시스템 설정을 따르거나 라이트/다크 모드를 직접 고정할 수 있습니다.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {THEME_OPTIONS.map((option) => {
                                const isActive = settings.theme === option.id;
                                const Icon = option.icon;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => onUpdateSettings(prev => ({ ...prev, theme: option.id }))}
                                        className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${isActive
                                            ? 'bg-[#eeeeee]'
                                            : 'bg-[#f7f7f7] hover:bg-[#eeeeee]'
                                            }`}
                                    >
                                        <span className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg ${isActive ? 'bg-white text-[#171717]' : 'bg-[#f1f1f0] text-[#787774]'}`}>
                                            <Icon size={18} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium text-[#37352f]">{option.label}</span>
                                            <span className="block text-[13px] leading-5 text-[#9b9a97] mt-0.5">{option.description}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ===== 계정 탭 ===== */}
            {activeTab === 'account' && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-6 sm:p-8 space-y-8">
                        <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-[#f1f1f0]">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full bg-[#f1f1f0] flex items-center justify-center text-lg font-medium text-[#37352f] overflow-hidden">
                                    {userDraft?.avatar ? (
                                        <img src={userDraft.avatar} alt={userDraft.name} className="w-full h-full object-cover" />
                                    ) : (
                                        userDraft?.name?.[0] || 'U'
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 text-center sm:text-left">
                                <h3 className="text-base font-medium text-[#37352f]">{userDraft?.name || '사용자'}</h3>
                                <p className="text-sm text-[#9b9a97]">{userDraft?.email}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 max-w-lg">
                            <div className="space-y-2">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] px-1">이름</label>
                                <input
                                    type="text"
                                    value={userDraft?.name || ''}
                                    onChange={(e) => userDraft && setUserDraft({ ...userDraft, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[var(--color-primary)] focus:bg-white transition-colors"
                                    placeholder="이름을 입력하세요"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[13px] leading-5 font-medium text-[#787774] px-1">프로필 이미지</label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={userDraft?.avatar || ''}
                                        onChange={(e) => userDraft && setUserDraft({ ...userDraft, avatar: e.target.value })}
                                        className="flex-1 px-4 py-3 rounded-xl border border-[#e9e9e8] bg-[#fbfbfa] text-[#37352f] outline-none focus:border-[var(--color-primary)] focus:bg-white transition-colors font-mono text-sm"
                                        placeholder="이미지 URL을 입력하거나 파일을 업로드하세요"
                                    />
                                    <label className="flex items-center justify-center gap-2 px-4 py-3 bg-[#f7f7f7] rounded-xl hover:bg-[#eeeeee] transition-colors cursor-pointer text-[#37352f] w-full sm:w-auto">
                                        <Upload size={18} />
                                        <span className="text-sm font-medium whitespace-nowrap">파일 선택</span>
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={(e) => handleImageUpload(e, (url) => userDraft && setUserDraft({ ...userDraft, avatar: url }))}
                                        />
                                    </label>
                                </div>
                                <p className="text-[13px] leading-5 text-[#9b9a97] px-1">내 PC에서 사진을 직접 선택하거나 외부 이미지 링크를 입력할 수 있습니다.</p>
                            </div>

                            <div className="flex flex-col gap-2 pt-4 sm:flex-row">
                                <button
                                    onClick={() => userDraft && onUpdateUser(userDraft)}
                                    className="flex items-center justify-center gap-2 px-6 py-3 bg-[#f7f7f7] text-[#171717] rounded-xl hover:bg-[#eeeeee] transition-colors font-medium disabled:opacity-50"
                                    disabled={!userDraft?.name}
                                >
                                    <Save size={18} />
                                    프로필 저장하기
                                </button>
                                <button
                                    type="button"
                                    onClick={onLogout}
                                    disabled={isLoggingOut}
                                    className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-[#787774] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <LogOut size={17} />
                                    {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

           {/* ===== 페르소나 탭 ===== */}
            {activeTab === 'persona' && (
                <PersonaSettingsView
                    agents={agents}
                    onUpdateAgents={onUpdateAgents}
                    personaMemories={personaMemories}
                    onAddPersonaMemory={onAddPersonaMemory}
                    onForgetPersonaMemory={onForgetPersonaMemory}
                    onClearAgentPersonaMemories={onClearAgentPersonaMemories}
                />
            )}

            {/* ===== 데이터 관리 탭 ===== */}
            {activeTab === 'data' && (
                <div className="space-y-6">
                    {/* Individual Reset */}
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 space-y-1">
                        <h3 className="text-base font-medium text-[#37352f] mb-3">개별 초기화</h3>
                        {[
                            { label: '레거시 AI 게시글', desc: '이전 버전에서 생성된 AI 게시글 데이터를 정리합니다.', action: onClearPosts },
                            { label: '캘린더', desc: '저장된 일정 데이터를 모두 삭제합니다.', action: onClearEvents },
                            { label: '할 일', desc: '할 일 목록과 항목을 모두 삭제합니다.', action: onClearTodos },
                            { label: '메모장', desc: '작성한 메모/일기를 모두 삭제합니다.', action: onClearEntries },
                            { label: 'AI 대화', desc: 'AI 채팅 기록과 페르소나 메모리를 모두 삭제합니다.', action: onClearChat },
                            { label: '활동 로그', desc: '활동 기록만 삭제합니다.', action: onClearActivity },
                        ].map(item => (
                            <div key={item.label} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-[#f2f2f0] last:border-b-0">
                                <div className="min-w-0">
                                    <div className="text-sm text-[#37352f] font-medium">{item.label}</div>
                                    <div className="text-[13px] leading-5 text-[#9b9a97]">{item.desc}</div>
                                </div>
                                <button
                                    onClick={() => {
                                        if (window.confirm(`${item.label} 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) {
                                            item.action();
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f7f7f7] text-[13px] leading-5 text-[#787774] hover:bg-[#fff0f0] hover:text-[#d94848] transition-colors"
                                >
                                    <Trash size={12} /> 초기화
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Export & Full Reset */}
                    <div className="rounded-xl border border-[#e9e9e8] bg-white p-5 space-y-4">
                        <h3 className="text-base font-medium text-[#37352f]">데이터 내보내기 및 전체 초기화</h3>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={onExportData} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f7f7f7] text-sm text-[#37352f] hover:bg-[#eeeeee]">
                                <Download size={14} /> 내보내기
                            </button>
                            <button onClick={onClearAllData} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#d94848] text-sm text-white hover:bg-[#c33f3f]">
                                <Trash2 size={14} /> 전체 데이터 초기화
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;

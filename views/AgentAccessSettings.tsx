import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import {
    AgentToken,
    MAX_AGENT_TOKENS,
    createAgentToken,
    getMcpServerUrl,
    listAgentTokens,
    revokeAgentToken,
} from '../services/agentTokenService';

interface AgentAccessSettingsProps {
    userId?: string;
}

const formatDate = (value?: string): string => {
    if (!value) return '사용 기록 없음';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

const CopyBlock: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard can be blocked; the text stays selectable.
        }
    };
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[#787774]">{label}</span>
                <button type="button" onClick={copy} className="flex items-center gap-1 text-xs font-medium text-[#787774] hover:text-[#37352f]">
                    <Copy size={12} />
                    {copied ? '복사됨' : '복사'}
                </button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-[#e9e9e8] bg-[#f7f7f5] px-3 py-2.5 text-xs leading-5 text-[#37352f] select-all">{value}</pre>
        </div>
    );
};

const AgentAccessSettings: React.FC<AgentAccessSettingsProps> = ({ userId }) => {
    const [tokens, setTokens] = useState<AgentToken[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [readOnly, setReadOnly] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [newToken, setNewToken] = useState('');

    const refresh = useCallback(async () => {
        try {
            setTokens(await listAgentTokens());
            setError('');
        } catch {
            setError('토큰 목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (userId) void refresh();
        else setLoading(false);
    }, [userId, refresh]);

    const handleCreate = async () => {
        if (!userId || !name.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            setNewToken(await createAgentToken(userId, name, !readOnly));
            setName('');
            await refresh();
        } catch {
            setError('토큰을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setBusy(false);
        }
    };

    const handleRevoke = async (token: AgentToken) => {
        if (!window.confirm(`'${token.name}' 토큰을 폐기할까요?\n이 토큰을 쓰는 에이전트는 바로 접근할 수 없게 됩니다.`)) return;
        try {
            await revokeAgentToken(token.id);
            await refresh();
        } catch {
            setError('토큰을 폐기하지 못했습니다.');
        }
    };

    if (!userId) {
        return <p className="text-sm text-[#787774]">로그인한 뒤에 에이전트 연동을 설정할 수 있습니다.</p>;
    }

    const url = getMcpServerUrl();

    return (
        <div className="space-y-6">
            <div className="pb-4 border-b border-[#f0f0ee]">
                <h3 className="text-xl font-medium text-[#37352f]">AI 에이전트 연동</h3>
                <p className="text-sm text-[#787774] mt-1">
                    Codex, Claude 같은 AI 에이전트가 내 일정·할 일·메모장을 조회하고 추가할 수 있게 합니다. 삭제와 수정은 지원하지 않습니다.
                </p>
            </div>

            {newToken && (
                <div className="rounded-xl border border-[#e9e9e8] bg-white p-4 space-y-3">
                    <div className="text-sm font-medium text-[#37352f]">토큰이 만들어졌어요. 지금 한 번만 보여 드립니다.</div>
                    <CopyBlock label="액세스 토큰" value={newToken} />
                    <CopyBlock label="Codex (~/.codex/config.toml)" value={`[mcp_servers.dayflow]\nurl = "${url}"\nbearer_token_env_var = "DAYFLOW_TOKEN"\n\n# 환경 변수 DAYFLOW_TOKEN에 위 토큰을 넣어 주세요.`} />
                    <CopyBlock label="Claude Code" value={`claude mcp add --transport http dayflow ${url} --header "Authorization: Bearer ${newToken}"`} />
                    <button type="button" onClick={() => setNewToken('')} className="text-sm font-medium text-[#787774] hover:text-[#37352f]">
                        확인했어요, 닫기
                    </button>
                </div>
            )}

            <div className="space-y-3">
                <div className="text-sm font-medium text-[#37352f]">새 토큰 만들기</div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={60}
                        placeholder="이름 (예: 내 Codex)"
                        className="flex-1 min-w-0 rounded-lg border border-[#e3e3e0] px-3 py-2 text-sm focus:outline-none focus:border-[#b8b8b4]"
                    />
                    <button
                        type="button"
                        onClick={handleCreate}
                        disabled={!name.trim() || busy || tokens.length >= MAX_AGENT_TOKENS}
                        className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50"
                    >
                        {busy ? '만드는 중...' : '토큰 만들기'}
                    </button>
                </div>
                <label className="flex items-center gap-2 text-sm text-[#787774]">
                    <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
                    읽기 전용 (조회만 가능, 추가는 막기)
                </label>
                {tokens.length >= MAX_AGENT_TOKENS && (
                    <p className="text-xs text-[#9b9a97]">토큰은 최대 {MAX_AGENT_TOKENS}개까지 만들 수 있어요. 안 쓰는 토큰을 먼저 폐기해 주세요.</p>
                )}
                {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>

            <div>
                <div className="text-sm font-medium text-[#37352f] mb-1">발급된 토큰</div>
                {loading ? (
                    <p className="text-sm text-[#9b9a97] py-3">불러오는 중...</p>
                ) : tokens.length === 0 ? (
                    <p className="text-sm text-[#9b9a97] py-3">아직 발급한 토큰이 없어요.</p>
                ) : (
                    <div className="divide-y divide-[#f0f0ee]">
                        {tokens.map((token) => (
                            <div key={token.id} className="flex items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-[#37352f] truncate">
                                        {token.name}
                                        <span className="ml-2 rounded-full bg-[#f5f5f4] px-2 py-0.5 text-[11px] font-normal text-[#787774]">
                                            {token.canWrite ? '읽기·추가' : '읽기 전용'}
                                        </span>
                                    </div>
                                    <div className="mt-0.5 text-xs text-[#9b9a97]">
                                        {token.tokenPrefix}… · 만든 날 {formatDate(token.createdAt)} · 마지막 사용 {formatDate(token.lastUsedAt)}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleRevoke(token)}
                                    title="폐기"
                                    className="shrink-0 p-2 rounded-lg text-[#9b9a97] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <p className="text-xs leading-5 text-[#9b9a97]">
                토큰을 가진 사람은 내 계정의 일정·할 일·메모를 읽고 추가할 수 있어요. 공개된 곳에 올리지 말고, 유출이 의심되면 바로 폐기해 주세요.
            </p>
        </div>
    );
};

export default AgentAccessSettings;

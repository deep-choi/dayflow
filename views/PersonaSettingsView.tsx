import React, { useMemo, useState } from 'react';
import { AIAgent, AppSettings } from '../types';
import { Plus, Trash2, Save, RotateCcw, Download, Trash, Edit3, X, Upload } from 'lucide-react';

import { DEFAULT_AGENTS } from '../data/defaultAgents';

interface PersonaSettingsViewProps {
  agents: AIAgent[];
  onUpdateAgents: (agents: AIAgent[]) => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

const PersonaSettingsView: React.FC<PersonaSettingsViewProps> = ({
  agents,
  onUpdateAgents,
  settings,
  onUpdateSettings,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIAgent | null>(null);
  const supportedChatConnections = (settings.apiConnections || []).filter(
    (connection) => connection.provider === 'gemini' || connection.provider === 'xai'
  );

  const editingTarget = useMemo(
    () => agents.find((agent) => agent.id === editingId) || null,
    [agents, editingId]
  );

  const openEditor = (agent: AIAgent) => {
    setEditingId(agent.id);
    setDraft({ ...agent });
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveAgent = () => {
    if (!editingId || !draft) return;
    if (!draft.connectionId) {
      alert('전역 기본 연결은 비활성화되었습니다. 이 페르소나에 Gemini/xAI 연결을 지정해 주세요.');
      return;
    }
    onUpdateAgents(
      agents.map((agent) => (agent.id === editingId ? { ...agent, ...draft } : agent))
    );
    closeEditor();
  };

  const addCustomAgent = () => {
    const newAgent: AIAgent = {
      id: crypto.randomUUID(),
      name: 'New Agent',
      emoji: '✨',
      role: 'Custom Role',
      personality: 'Describe this agent personality',
      tone: 'Friendly',
      color: '#6366f1',
      avatar: '',
    };
    onUpdateAgents([...agents, newAgent]);
    openEditor(newAgent);
  };

  const removeAgent = (id: string) => {
    if (!window.confirm('이 페르소나를 삭제할까요?')) return;
    onUpdateAgents(agents.filter((agent) => agent.id !== id));
  };

  const resetAgents = () => {
    if (!window.confirm('기본 페르소나로 초기화할까요?')) return;
    onUpdateAgents(DEFAULT_AGENTS);
  };

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

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 px-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-normal text-[#37352f]">페르소나 설정</h2>
          <p className="text-sm text-[#787774] mt-1">AI 페르소나를 편집하고 행동 옵션을 조정하세요.</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={addCustomAgent}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#37352f] text-white text-sm hover:bg-[#2b2924] transition-colors whitespace-nowrap"
          >
            <Plus size={14} /> 추가
          </button>
          <button
            onClick={resetAgents}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#d9d9d7] text-[#37352f] text-sm hover:bg-[#f7f7f5] transition-colors whitespace-nowrap"
          >
            <RotateCcw size={14} /> 기본값
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-white border border-[#e9e9e8] rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-lg text-white shrink-0"
                  style={{ backgroundColor: agent.color || '#37352f' }}
                >
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{agent.emoji || '🤖'}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-[#37352f] truncate">{agent.name}</div>
                  <div className="text-xs text-[#9b9a97] truncate">{agent.role}</div>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEditor(agent)}
                  className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774]"
                  title="편집"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => removeAgent(agent.id)}
                  className="p-1.5 rounded-md hover:bg-[#fff0f0] text-[#cf3f3f]"
                  title="삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <p className="text-xs text-[#787774] mt-3 line-clamp-2">{agent.personality}</p>
            {agent.connectionId && (() => {
              const conn = settings.apiConnections?.find(c => c.id === agent.connectionId);
              return conn ? (
                <div className="mt-2 text-[10px] text-[#9b9a97] bg-[#f7f7f5] px-2 py-1 rounded-md inline-block">
                  🔗 {conn.provider.toUpperCase()} · {conn.modelName}
                </div>
              ) : null;
            })()}
          </div>
        ))}
      </div>
      {editingId && draft && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 overflow-hidden">
          <div className="w-full h-full sm:h-auto sm:max-w-xl bg-white sm:rounded-2xl border-x sm:border border-[#e9e9e8] shadow-2xl max-h-none sm:max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#efefef] flex items-center justify-between shrink-0 bg-white">
              <h4 className="text-[#37352f] font-semibold">{editingTarget ? '페르소나 편집' : '새 페르소나'}</h4>
              <button onClick={closeEditor} className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
              <div className="p-6 flex flex-col items-center border-b border-[#efefef] bg-[#fbfbfa]">
                <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-4xl text-white shadow-md mb-3" style={{ backgroundColor: draft.color || '#37352f' }}>
                  {draft.avatar ? (
                    <img src={draft.avatar} alt={draft.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{draft.emoji || '🤖'}</span>
                  )}
                </div>
                <div className="text-sm font-bold text-[#37352f]">{draft.name || '새 페르소나'}</div>
                <div className="text-xs text-[#9b9a97]">{draft.role || '역할을 입력하세요'}</div>
              </div>

              <div className="p-5 space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">이름</span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] focus:ring-1 focus:ring-[#37352f] transition-all outline-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">역할</span>
                    <input
                      value={draft.role}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] focus:ring-1 focus:ring-[#37352f] transition-all outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">톤</span>
                    <input
                      value={draft.tone}
                      onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] focus:ring-1 focus:ring-[#37352f] transition-all outline-none"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">성격</span>
                  <textarea
                    value={draft.personality}
                    onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
                    rows={3}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] focus:ring-1 focus:ring-[#37352f] transition-all outline-none resize-none"
                  />
                </label>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">아바타 이미지</span>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={draft.avatar || ''}
                      onChange={(e) => setDraft({ ...draft, avatar: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] outline-none"
                      placeholder="이미지 URL"
                    />
                    <label className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-[#dcdcd9] rounded-lg hover:bg-[#f7f7f5] cursor-pointer text-[#37352f] text-sm transition-colors whitespace-nowrap">
                      <Upload size={14} />
                      <span className="font-semibold">파일 선택</span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, (url) => setDraft({ ...draft, avatar: url }))}
                      />
                    </label>
                  </div>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-[#787774] ml-1 uppercase">API 연결</span>
                  <select
                    value={draft.connectionId || ''}
                    onChange={(e) => setDraft({ ...draft, connectionId: e.target.value || undefined })}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#37352f] focus:ring-1 focus:ring-[#37352f] transition-all outline-none bg-white"
                  >
                    <option value="" disabled>연결을 선택하세요</option>
                    {supportedChatConnections.map(conn => (
                      <option key={conn.id} value={conn.id}>
                        {conn.provider.toUpperCase()} · {conn.modelName}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-[#9b9a97] ml-1">전역 기본 연결은 사용하지 않으며, 각 페르소나마다 Gemini/xAI 연결이 필수입니다</span>
                </label>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#efefef] flex justify-end gap-2 shrink-0 bg-white">
              <button
                onClick={closeEditor}
                className="px-4 py-2 rounded-lg border border-[#dcdcd9] text-sm text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveAgent}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#37352f] text-sm text-white hover:bg-[#2b2924] transition-all active:scale-95 shadow-sm"
              >
                <Save size={16} />
                <span>저장하기</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonaSettingsView;

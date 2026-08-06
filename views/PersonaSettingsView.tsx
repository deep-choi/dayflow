import React, { useEffect, useMemo, useState } from 'react';
import { AIAgent, ApiConnection, AppSettings, PersonaMemory } from '../types';
import { Plus, Trash2, Save, RotateCcw, Edit3, X, FlaskConical, Cpu, Database } from 'lucide-react';
import { DEFAULT_AGENTS } from '../data/defaultAgents';
import { readImageFileAsDataUrl } from '../utils/imageAsset';
import { getAvatarImageStyle } from '../utils/avatarFrame';
import AvatarCropperModal from '../components/AvatarCropperModal';
import { callGeminiAPI } from '../utils/gemini';
import { testXaiConnection } from '../services/xaiService';
import { testOpenAIConnection } from '../services/openaiService';
import { testAnthropicConnection } from '../services/anthropicService';
import { testOpenAICompatibleConnection } from '../services/openAICompatibleService';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaService';
import { DEFAULT_LOCAL_SERVER_BASE_URL, listLocalServerModels, testLocalServerConnection } from '../services/localServerService';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  CHAT_PROVIDERS as DEFAULT_CHAT_PROVIDERS,
  getDefaultModelForProvider,
  getModelOptionsForProvider,
  getProviderDefaultBaseUrl,
  getProviderDisplayName as getConfiguredProviderDisplayName,
  isChatSupportedProvider,
  isHostedOpenAICompatibleProvider,
  normalizeProviderModelName,
} from '../utils/aiConfig';

interface PersonaSettingsViewProps {
  agents: AIAgent[];
  onUpdateAgents: (agents: AIAgent[]) => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  personaMemories: PersonaMemory[];
  onAddPersonaMemory: (agentId: string, type: PersonaMemory['type'], content: string) => void;
  onForgetPersonaMemory: (memoryId: string) => void;
  onClearAgentPersonaMemories: (agentId: string) => void;
}

type PersonaEditorTab = 'profile' | 'api';
type ApiSelection = '__default__' | '__new__' | string;

const CHAT_PROVIDERS = DEFAULT_CHAT_PROVIDERS;

const getProviderDisplayName = (provider: ApiConnection['provider']): string => {
  return getConfiguredProviderDisplayName(provider);
};

const getApiKeyPlaceholder = (provider?: ApiConnection['provider']): string => {
  if (provider === 'xai') return 'xai-...';
  if (provider === 'openai') return 'sk-...';
  if (provider === 'anthropic') return 'sk-ant-...';
  if (provider === 'gemini') return 'AIza...';
  if (provider === 'deepseek') return 'sk-...';
  if (provider === 'qwen') return 'sk-...';
  if (provider === 'kimi') return 'sk-...';
  if (provider === 'glm') return 'API Key...';
  if (provider === 'custom') return '선택 사항';
  return 'API Key';
};

const createEmptyConnectionDraft = (): Partial<ApiConnection> => ({
  provider: 'gemini',
  modelName: DEFAULT_GEMINI_MODEL,
  apiKey: '',
  isActive: true,
});

const RESPONSE_LENGTH_OPTIONS = [
  { value: 'short', label: '짧게' },
  { value: 'medium', label: '보통' },
  { value: 'long', label: '길게' },
] as const;

const MEMORY_TYPE_LABEL: Record<PersonaMemory['type'], string> = {
  fact: '사실',
  preference: '선호',
  goal: '목표',
};

const formatTimestamp = (value?: string): string => {
  if (!value) return '기록 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '기록 없음';
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getMemoryTimestamp = (memory: PersonaMemory): number => {
  return new Date(memory.lastObservedAt || memory.updatedAt || memory.createdAt).getTime();
};

const sortMemoriesByRecent = (a: PersonaMemory, b: PersonaMemory): number => {
  return getMemoryTimestamp(b) - getMemoryTimestamp(a);
};

const PersonaSettingsView: React.FC<PersonaSettingsViewProps> = ({
  agents,
  onUpdateAgents,
  settings,
  onUpdateSettings,
  personaMemories,
  onAddPersonaMemory,
  onForgetPersonaMemory,
  onClearAgentPersonaMemories,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIAgent | null>(null);
  const [editorTab, setEditorTab] = useState<PersonaEditorTab>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [memoryTypes, setMemoryTypes] = useState<Record<string, PersonaMemory['type']>>({});
  const [memoryPanelAgentId, setMemoryPanelAgentId] = useState<string | null>(null);
  const [isAvatarCropOpen, setIsAvatarCropOpen] = useState(false);
  const [apiSelection, setApiSelection] = useState<ApiSelection>('__default__');
  const [apiConnectionDraft, setApiConnectionDraft] = useState<Partial<ApiConnection>>(createEmptyConnectionDraft);
  const [isApiConnectionDirty, setIsApiConnectionDirty] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [isLoadingLocalModels, setIsLoadingLocalModels] = useState(false);
  const supportedChatConnections = (settings.apiConnections || []).filter(
    (connection) => isChatSupportedProvider(connection.provider)
  );
  const activeConnection = supportedChatConnections.find(connection => connection.id === settings.activeConnectionId)
    || supportedChatConnections[0];
  const apiModelOptions = apiConnectionDraft.provider
    ? getModelOptionsForProvider(apiConnectionDraft.provider)
    : [];

  useEffect(() => {
    if (!editingId) return;
    const provider = apiConnectionDraft.provider;
    if (provider !== 'ollama' && provider !== 'custom') {
      setLocalModels([]);
      return;
    }

    let cancelled = false;
    const restoreLocalModels = async () => {
      try {
        const models = provider === 'ollama'
          ? await listOllamaModels(apiConnectionDraft.baseUrl || DEFAULT_OLLAMA_BASE_URL)
          : await listLocalServerModels(apiConnectionDraft.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, apiConnectionDraft.apiKey);
        if (!cancelled) setLocalModels(models);
      } catch {
        if (!cancelled) setLocalModels([]);
      }
    };
    void restoreLocalModels();
    return () => { cancelled = true; };
  }, [editingId, apiConnectionDraft.provider, apiConnectionDraft.baseUrl]);

  const editingTarget = useMemo(
    () => agents.find((agent) => agent.id === editingId) || null,
    [agents, editingId]
  );
  const memoryPanelAgent = useMemo(
    () => agents.find((agent) => agent.id === memoryPanelAgentId) || null,
    [agents, memoryPanelAgentId]
  );
  const memoryPanelMemories = useMemo(
    () => personaMemories
      .filter((memory) => memory.agentId === memoryPanelAgentId)
      .sort(sortMemoriesByRecent),
    [personaMemories, memoryPanelAgentId]
  );
  const openEditor = (agent: AIAgent) => {
    const selectedConnection = supportedChatConnections.find(connection => connection.id === agent.connectionId);
    const initialConnection = selectedConnection || activeConnection;
    setIsAvatarCropOpen(false);
    setEditorTab('profile');
    setEditingId(agent.id);
    setDraft({ ...agent });
    setApiSelection(selectedConnection ? selectedConnection.id : '__default__');
    setApiConnectionDraft(initialConnection ? { ...initialConnection } : createEmptyConnectionDraft());
    setLocalModels([]);
    setIsApiConnectionDirty(false);
  };

  const closeEditor = () => {
    if (isSaving) return;
    setIsAvatarCropOpen(false);
    setEditingId(null);
    setDraft(null);
    setIsApiConnectionDirty(false);
  };

  const updateApiDraft = (updates: Partial<ApiConnection>) => {
    setApiConnectionDraft(prev => ({ ...prev, ...updates }));
    setIsApiConnectionDirty(true);
  };

  const handleApiSelectionChange = (selection: ApiSelection) => {
    setApiSelection(selection);
    setLocalModels([]);
    if (selection === '__new__') {
      setApiConnectionDraft(createEmptyConnectionDraft());
      setIsApiConnectionDirty(true);
      return;
    }

    const connection = selection === '__default__'
      ? activeConnection
      : supportedChatConnections.find(candidate => candidate.id === selection);
    setApiConnectionDraft(connection ? { ...connection } : createEmptyConnectionDraft());
    setIsApiConnectionDirty(false);
  };

  const validateApiDraft = (): string | null => {
    const provider = apiConnectionDraft.provider || 'gemini';
    if (!(apiConnectionDraft.modelName || '').trim()) return '사용할 모델을 선택하거나 입력해 주세요.';
    if (provider === 'ollama' || provider === 'custom') {
      if (!(apiConnectionDraft.baseUrl || '').trim()) return '로컬 서버 주소를 입력해 주세요.';
      return null;
    }
    if (isHostedOpenAICompatibleProvider(provider) && !(apiConnectionDraft.baseUrl || getProviderDefaultBaseUrl(provider) || '').trim()) {
      return '해당 서비스의 연결 주소를 확인해 주세요.';
    }
    if (!(apiConnectionDraft.apiKey || '').trim()) return 'API Key를 입력해 주세요.';
    return null;
  };

  const loadLocalModels = async () => {
    const provider = apiConnectionDraft.provider;
    if (provider !== 'ollama' && provider !== 'custom') return;
    setIsLoadingLocalModels(true);
    try {
      const models = provider === 'ollama'
        ? await listOllamaModels(apiConnectionDraft.baseUrl || DEFAULT_OLLAMA_BASE_URL)
        : await listLocalServerModels(apiConnectionDraft.baseUrl || DEFAULT_LOCAL_SERVER_BASE_URL, apiConnectionDraft.apiKey);
      setLocalModels(models);
      if (models.length > 0) {
        updateApiDraft({ modelName: models.includes(apiConnectionDraft.modelName || '') ? apiConnectionDraft.modelName : models[0] });
      } else {
        alert('서버에서 불러올 수 있는 모델이 없습니다. 모델 이름을 직접 입력해 주세요.');
      }
    } catch (error: any) {
      alert(`로컬 모델을 불러오지 못했습니다: ${error?.message || '알 수 없는 오류'}`);
    } finally {
      setIsLoadingLocalModels(false);
    }
  };

  const testApiDraft = async () => {
    const validationError = validateApiDraft();
    if (validationError) {
      alert(validationError);
      return;
    }

    const provider = apiConnectionDraft.provider || 'gemini';
    const modelName = normalizeProviderModelName(provider, apiConnectionDraft.modelName || '');
    const apiKey = (apiConnectionDraft.apiKey || '').trim();
    setIsTestingConnection(true);
    try {
      if (provider === 'ollama') {
        await testOllamaConnection(apiConnectionDraft.baseUrl, modelName);
      } else if (provider === 'custom') {
        await testLocalServerConnection(apiConnectionDraft.baseUrl, apiKey, modelName);
      } else if (provider === 'xai') {
        await testXaiConnection(apiKey, modelName);
      } else if (provider === 'openai') {
        await testOpenAIConnection(apiKey, modelName);
      } else if (provider === 'anthropic') {
        await testAnthropicConnection(apiKey, modelName);
      } else if (isHostedOpenAICompatibleProvider(provider)) {
        await testOpenAICompatibleConnection(apiKey, apiConnectionDraft.baseUrl || getProviderDefaultBaseUrl(provider) || '', modelName);
      } else {
        await callGeminiAPI(apiKey, '간단한 연결 확인입니다. "연결 성공"이라고만 답해주세요.', undefined, modelName);
      }
      alert(`연결 성공: ${modelName}`);
    } catch (error: any) {
      alert(`연결 실패: ${error?.message || '알 수 없는 오류'}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const saveAgent = async () => {
    if (!editingId || !draft) return;

    let nextConnectionId = apiSelection === '__default__' ? undefined : draft.connectionId;
    let connectionToPersist: ApiConnection | null = null;
    if (isApiConnectionDirty || apiSelection === '__new__') {
      const validationError = validateApiDraft();
      if (validationError) {
        setEditorTab('api');
        alert(validationError);
        return;
      }

      const provider = apiConnectionDraft.provider || 'gemini';
      const connectionId = apiSelection === '__new__'
        ? crypto.randomUUID()
        : (apiConnectionDraft.id || crypto.randomUUID());
      connectionToPersist = {
        id: connectionId,
        provider,
        modelName: normalizeProviderModelName(provider, apiConnectionDraft.modelName || ''),
        apiKey: provider === 'ollama' ? '' : (apiConnectionDraft.apiKey || '').trim(),
        baseUrl: provider === 'ollama' || provider === 'custom' || isHostedOpenAICompatibleProvider(provider)
          ? (apiConnectionDraft.baseUrl || (provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : getProviderDefaultBaseUrl(provider) || '')).trim()
          : undefined,
        isActive: true,
      };
      nextConnectionId = apiSelection === '__default__' ? undefined : connectionId;
    } else if (apiSelection !== '__default__') {
      nextConnectionId = apiSelection;
    }

    setIsSaving(true);
    try {
      if (connectionToPersist) {
        const savedConnection = connectionToPersist;
        onUpdateSettings(prev => {
          const currentConnections = prev.apiConnections || [];
          const exists = currentConnections.some(connection => connection.id === savedConnection.id);
          const nextConnections = exists
            ? currentConnections.map(connection => connection.id === savedConnection.id ? savedConnection : connection)
            : [...currentConnections, savedConnection];
          const hasCurrentDefault = nextConnections.some(connection => connection.id === prev.activeConnectionId);
          const activeConnectionId = apiSelection === '__default__' || !hasCurrentDefault
            ? savedConnection.id
            : prev.activeConnectionId;
          const activeGemini = nextConnections.find(connection => connection.id === activeConnectionId && connection.provider === 'gemini')
            || nextConnections.find(connection => connection.provider === 'gemini');
          return {
            ...prev,
            apiConnections: nextConnections.map(connection => ({ ...connection, isActive: true })),
            activeConnectionId,
            geminiApiKey: activeGemini?.apiKey || '',
          };
        });
      }

      const nextAgentDraft: AIAgent = { ...draft, connectionId: nextConnectionId };
      await Promise.resolve(
        onUpdateAgents(
          agents.map((agent) => (agent.id === editingId ? { ...agent, ...nextAgentDraft } : agent))
        )
      );
      setEditingId(null);
      setDraft(null);
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomAgent = () => {
    const newAgent: AIAgent = {
      id: crypto.randomUUID(),
      name: '새 페르소나',
      emoji: '✨',
      role: '친구',
      personality: '사용자가 직접 만든 페르소나입니다.',
      tone: '친절하고 자연스러운 말투',
      color: '#6366f1',
      avatar: '',
    };
    onUpdateAgents([...agents, newAgent]);
    openEditor(newAgent);
  };

  const removeAgent = (id: string): boolean => {
    if (agents.length <= 1) {
      alert('최소 한 개의 페르소나는 유지해야 합니다.');
      return false;
    }
    if (!window.confirm('이 페르소나를 삭제할까요?')) return false;
    onUpdateAgents(agents.filter((agent) => agent.id !== id));
    return true;
  };

  const resetAgents = () => {
    if (!window.confirm('기본 페르소나로 초기화할까요?')) return;
    onUpdateAgents(DEFAULT_AGENTS);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, callback: (url: string) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('파일 크기가 너무 큽니다 (최대 5MB)');
      return;
    }

    try {
      callback(await readImageFileAsDataUrl(file));
    } catch (error) {
      alert((error as Error).message || '이미지를 불러오지 못했습니다.');
    }
  };

  const handleAddMemory = (agentId: string) => {
    const content = (memoryDrafts[agentId] || '').trim();
    if (!content) return;
    onAddPersonaMemory(agentId, memoryTypes[agentId] || 'fact', content);
    setMemoryDrafts(prev => ({ ...prev, [agentId]: '' }));
  };

  const setDraftAvatarSource = (avatar: string, openCrop: boolean = false) => {
    setDraft(prev => prev ? { ...prev, avatar, avatarFrame: undefined } : prev);
    if (avatar.trim() && openCrop) setIsAvatarCropOpen(true);
  };

  const updateDraftAvatarFrame = (avatarFrame?: AIAgent['avatarFrame']) => {
    setDraft(prev => prev ? { ...prev, avatarFrame } : prev);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6 pb-5 sm:pb-12">
      <div className="pb-3 sm:pb-5 border-b border-[#f0f0ee]">
        <h2 className="text-lg sm:text-xl font-medium text-[#37352f] tracking-tight">페르소나 설정</h2>
        <p className="text-sm text-[#787774] mt-1">이름, 말투, 프로필, 연결 모델을 변경하세요.</p>
      </div>

      <div className="divide-y divide-[#f0f0ee]">
        {agents.map((agent) => {
          const connection = settings.apiConnections?.find((conn) => conn.id === agent.connectionId);

          return (
            <div key={agent.id} className="py-3.5 sm:py-4.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 sm:gap-4 group">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden flex items-center justify-center shrink-0 shadow-2xs border border-black/5"
                  style={{ backgroundColor: agent.color || '#37352f' }}
                >
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} style={getAvatarImageStyle(agent.avatarFrame)} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-base">{agent.emoji || '🤖'}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[15px] sm:text-base font-medium text-[#37352f] leading-snug">{agent.name}</h3>
                    <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-[#f4f4f2] text-[#5f5f5f] text-sm font-medium">
                      {agent.role}
                    </span>
                    {connection && (
                      <span className="text-sm text-[#8a8a8a] font-medium">
                        · {connection.provider.toUpperCase()} ({connection.modelName})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => openEditor(agent)}
                className="inline-flex h-9 shrink-0 items-center gap-1 px-3 rounded-lg text-sm font-medium text-[#37352f] bg-[#f4f4f2] hover:bg-[#eaeaea] transition-all"
              >
                <Edit3 size={14} /> 편집
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom Action Bar */}
      <div className="pt-4 sm:pt-5 border-t border-[#f0f0ee] grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-2.5">
        <button
          onClick={resetAgents}
          className="inline-flex items-center justify-center gap-2 px-2 sm:px-4 py-2.5 rounded-xl text-sm font-medium text-[#5f5f5f] bg-[#f4f4f2] hover:bg-[#eaeaea] hover:text-[#37352f] transition-all whitespace-nowrap"
        >
          <RotateCcw size={15} /> 기본값으로 복원
        </button>
        <button
          onClick={addCustomAgent}
          className="inline-flex items-center justify-center gap-2 px-2 sm:px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-xs whitespace-nowrap"
        >
          <Plus size={16} /> 새 페르소나
        </button>
      </div>

      {memoryPanelAgent && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden">
          <div className="w-full sm:max-w-lg max-h-[88vh] bg-white rounded-t-2xl sm:rounded-2xl border-x border-t sm:border border-[#e9e9e8] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#efefef] flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-[#37352f]">{memoryPanelAgent.name} 메모리</h4>
                <p className="text-xs text-[#9b9a97] mt-1">필요한 기억만 조용히 보관해요.</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {memoryPanelMemories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`${memoryPanelAgent.name}의 메모리를 모두 삭제할까요?`)) {
                        onClearAgentPersonaMemories(memoryPanelAgent.id);
                      }
                    }}
                    className="px-2 py-1 rounded-md text-[11px] font-medium text-[#9b9a97] hover:text-[#cf3f3f] hover:bg-[#fff0f0] transition-colors"
                  >
                    전체 삭제
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMemoryPanelAgentId(null)}
                  className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors"
                  title="닫기"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 border-b border-[#efefef] shrink-0 space-y-2">
              <select
                value={memoryTypes[memoryPanelAgent.id] || 'fact'}
                onChange={(e) => setMemoryTypes(prev => ({ ...prev, [memoryPanelAgent.id]: e.target.value as PersonaMemory['type'] }))}
                className="w-full px-3 py-2 rounded-lg border border-[#dcdcd9] bg-white text-xs text-[#37352f] outline-none"
              >
                <option value="fact">사실</option>
                <option value="preference">선호</option>
                <option value="goal">목표</option>
              </select>
              <div className="flex gap-2">
                <input
                  value={memoryDrafts[memoryPanelAgent.id] || ''}
                  onChange={(e) => setMemoryDrafts(prev => ({ ...prev, [memoryPanelAgent.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddMemory(memoryPanelAgent.id);
                  }}
                  placeholder={`${memoryPanelAgent.name}이 기억할 내용`}
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-[#dcdcd9] text-xs text-[#37352f] outline-none focus:border-[#d4d4d4]"
                />
                <button
                  type="button"
                  onClick={() => handleAddMemory(memoryPanelAgent.id)}
                  className="shrink-0 px-3 py-2 rounded-lg bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] text-xs font-medium hover:bg-[#eeeeee] transition-colors"
                >
                  추가
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
              {memoryPanelMemories.map((memory) => (
                <div key={memory.id} className="rounded-xl border border-[#efefef] bg-[#fbfbfa] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-[#787774]">
                        {MEMORY_TYPE_LABEL[memory.type]} · {formatTimestamp(memory.lastObservedAt || memory.updatedAt)}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-[#37352f] break-words">{memory.content}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onForgetPersonaMemory(memory.id)}
                      className="shrink-0 p-1 rounded-md text-[#9b9a97] hover:text-[#cf3f3f] hover:bg-[#fff0f0] transition-colors"
                      title="메모리 삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
              {memoryPanelMemories.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#dcdcd9] p-5 text-center">
                  <div className="text-sm font-medium text-[#37352f]">아직 메모리가 없어요</div>
                  <p className="mt-1 text-xs text-[#9b9a97]">직접 추가하거나 채팅 중 중요한 내용을 저장하면 여기에 모입니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingId && draft && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-hidden">
          <div className="w-full max-w-[calc(100vw-24px)] sm:max-w-lg h-auto max-h-[92dvh] sm:max-h-[90vh] bg-white rounded-2xl border border-[#e9e9e8] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#efefef] flex items-center justify-between shrink-0 bg-white">
              <div>
                <h4 className="text-[#37352f] font-medium">{editingTarget ? '페르소나 편집' : '새 페르소나'}</h4>
                <p className="text-xs text-[#9b9a97] mt-1">말투와 프로필을 이곳에서 깔끔하게 정리할 수 있어요.</p>
              </div>
              <button onClick={closeEditor} className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
              <div className="p-5 space-y-5">
                <div className="flex flex-col items-center border border-[#efefef] rounded-2xl bg-[#fbfbfa] px-5 py-6">
                  <button
                    type="button"
                    onClick={() => {
                      if (draft.avatar) {
                        setIsAvatarCropOpen(true);
                        return;
                      }
                      document.getElementById(`persona-avatar-upload-${editingId}`)?.click();
                    }}
                    className="relative w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-4xl text-white mb-3 transition-transform hover:scale-[1.02] group"
                    style={{ backgroundColor: draft.color || '#37352f' }}
                    title="이미지 변경"
                  >
                    {draft.avatar ? (
                      <img src={draft.avatar} alt={draft.name} style={getAvatarImageStyle(draft.avatarFrame)} className="w-full h-full object-cover" />
                    ) : (
                      <span>{draft.emoji || '🤖'}</span>
                    )}
                    <span className="absolute inset-0 bg-transparent group-hover:bg-white/25 transition-colors" />
                    <span className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-white/90 border border-[#e9e9e8] text-[#37352f] flex items-center justify-center">
                      <Edit3 size={15} />
                    </span>
                  </button>
                  <input
                    id={`persona-avatar-upload-${editingId}`}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, (url) => setDraftAvatarSource(url, true))}
                  />
                  <div className="text-sm font-medium text-[#37352f]">{draft.name || '새 페르소나'}</div>
                  <div className="text-xs text-[#9b9a97]">{draft.role || '역할을 입력하세요'}</div>
                </div>

                <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#e9e9e8] bg-[#f7f7f5] p-1">
                  {([
                    ['profile', '프로필'],
                    ['api', 'API'],
                  ] as Array<[PersonaEditorTab, string]>).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEditorTab(tab)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${editorTab === tab
                        ? 'bg-white text-[#37352f]'
                        : 'text-[#787774] hover:text-[#37352f]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {editorTab === 'profile' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <label className="block">
                        <span className="text-xs font-medium text-[#787774] ml-1 uppercase">이름</span>
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="text-xs font-medium text-[#787774] ml-1 uppercase">역할</span>
                        <input
                          value={draft.role}
                          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="text-xs font-medium text-[#787774] ml-1 uppercase">말투</span>
                      <input
                        value={draft.tone || ''}
                        onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none"
                        placeholder="예: 다정하고 자연스러운 존댓말"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-[#787774] ml-1 uppercase">채팅 응답 길이</span>
                      <select
                        value={draft.responseLength || 'medium'}
                        onChange={(e) => setDraft({ ...draft, responseLength: e.target.value as AIAgent['responseLength'] })}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none bg-white"
                      >
                        {RESPONSE_LENGTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-[#787774] ml-1 uppercase">성격과 행동 방식</span>
                      <textarea
                        value={draft.personality || ''}
                        onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
                        rows={7}
                        className="mt-1 w-full px-3 py-3 rounded-lg border border-[#dcdcd9] text-sm leading-relaxed focus:border-[#d4d4d4] focus:ring-1 focus:ring-[#d4d4d4] transition-all outline-none resize-y min-h-[170px]"
                        placeholder="성격, 행동 방식, 대화 규칙을 자유롭게 적어주세요."
                      />
                      <span className="mt-1 block text-[11px] text-[#9b9a97]">이제 첫 줄부터 전부 성격/지침으로 저장됩니다.</span>
                    </label>
                  </div>
                )}

                {editorTab === 'api' && (
                  <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-medium text-[#787774] ml-1 uppercase">API 공급자</span>
                          <select
                            value={apiConnectionDraft.provider || 'gemini'}
                            onChange={(e) => {
                              const provider = e.target.value as ApiConnection['provider'];
                              setLocalModels([]);
                              updateApiDraft({
                                provider,
                                modelName: getDefaultModelForProvider(provider),
                                apiKey: '',
                                 baseUrl: provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : getProviderDefaultBaseUrl(provider),
                              });
                            }}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4]"
                          >
                            {CHAT_PROVIDERS.map(provider => (
                              <option key={provider} value={provider}>{getProviderDisplayName(provider)}</option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-medium text-[#787774] ml-1 uppercase">모델</span>
                          {(apiConnectionDraft.provider === 'ollama' || apiConnectionDraft.provider === 'custom') && localModels.length > 0 ? (
                            <select
                              title={apiConnectionDraft.modelName || ''}
                              value={apiConnectionDraft.modelName || ''}
                              onChange={(e) => updateApiDraft({ modelName: e.target.value })}
                              className="mt-1 w-full px-3 pr-10 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4] truncate"
                            >
                              {localModels.map(model => <option key={model} value={model}>{model}</option>)}
                            </select>
                          ) : apiModelOptions.length > 0 ? (
                            <select
                              value={apiConnectionDraft.modelName || getDefaultModelForProvider(apiConnectionDraft.provider || 'gemini')}
                              onChange={(e) => updateApiDraft({ modelName: e.target.value })}
                              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4]"
                            >
                              {apiModelOptions.map(model => (
                                <option key={model.id} value={model.id}>{model.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={apiConnectionDraft.modelName || ''}
                              onChange={(e) => updateApiDraft({ modelName: e.target.value })}
                              placeholder={apiConnectionDraft.provider === 'ollama' || apiConnectionDraft.provider === 'custom' ? '모델 목록을 불러오거나 직접 입력' : '모델 이름'}
                              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm outline-none bg-white focus:border-[#d4d4d4]"
                            />
                          )}
                        </label>
                      </div>

                       {(apiConnectionDraft.provider === 'ollama' || apiConnectionDraft.provider === 'custom') && (
                         <label className="block">
                           <span className="text-xs font-medium text-[#787774] ml-1 uppercase">{apiConnectionDraft.provider === 'ollama' ? 'Ollama 서버 주소' : '로컬 서버 주소'}</span>
                           <input
                             value={apiConnectionDraft.baseUrl || (apiConnectionDraft.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL)}
                             onChange={(e) => updateApiDraft({ baseUrl: e.target.value })}
                             placeholder={apiConnectionDraft.provider === 'custom' ? DEFAULT_LOCAL_SERVER_BASE_URL : DEFAULT_OLLAMA_BASE_URL}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm font-mono outline-none bg-white focus:border-[#d4d4d4]"
                          />
                        </label>
                      )}

                      {(apiConnectionDraft.provider === 'ollama' || apiConnectionDraft.provider === 'custom') && (
                        <button
                          type="button"
                          onClick={() => void loadLocalModels()}
                          disabled={isLoadingLocalModels}
                          className="w-full rounded-lg border border-[#dcdcd9] bg-white px-3 py-2 text-sm text-[#37352f] hover:bg-[#f3f3f3] disabled:opacity-60"
                        >
                          {isLoadingLocalModels ? '로컬 모델 불러오는 중...' : '설치된 모델 불러오기'}
                        </button>
                      )}

                      {apiConnectionDraft.provider !== 'ollama' && (
                        <label className="block">
                          <span className="text-xs font-medium text-[#787774] ml-1 uppercase">API Key{apiConnectionDraft.provider === 'custom' ? ' (선택 사항)' : ''}</span>
                          <input
                            type="password"
                            value={apiConnectionDraft.apiKey || ''}
                            onChange={(e) => updateApiDraft({ apiKey: e.target.value })}
                            placeholder={getApiKeyPlaceholder(apiConnectionDraft.provider)}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#dcdcd9] text-sm font-mono outline-none bg-white focus:border-[#d4d4d4]"
                          />
                        </label>
                      )}

                      <div className="flex items-center justify-between gap-3 border-t border-[#e9e9e8] pt-3">
                        <p className="text-[12px] leading-5 text-[#9b9a97]">
                          {apiSelection === '__default__'
                            ? '이 연결은 모든 페르소나의 기본값으로 사용됩니다.'
                            : '이 연결은 현재 페르소나에만 지정됩니다.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => void testApiDraft()}
                          disabled={isTestingConnection}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#dcdcd9] bg-white px-3 py-2 text-sm text-[#37352f] transition-colors hover:bg-[#f3f3f3] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <FlaskConical size={14} />
                          {isTestingConnection ? '연결 중...' : '연결 테스트'}
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#efefef] flex justify-end gap-2 shrink-0 bg-white">
              {editingTarget ? (
                <button
                  onClick={() => {
                    if (removeAgent(editingTarget.id)) {
                      closeEditor();
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors inline-flex items-center gap-1.5"
                >
                  <Trash2 size={15} /> 삭제
                </button>
              ) : (
                <button
                  onClick={closeEditor}
                  className="px-4 py-2 rounded-lg border border-[#dcdcd9] text-sm text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                >
                  취소
                </button>
              )}
              <button
                onClick={() => void saveAgent()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f7f7f7] border border-[#e9e9e8] text-sm text-[#171717] hover:bg-[#eeeeee] transition-all active:scale-95"
                disabled={isSaving}
              >
                <Save size={16} />
                <span>{isSaving ? '저장 중...' : '저장하기'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {editingId && draft?.avatar && (
        <AvatarCropperModal
          isOpen={isAvatarCropOpen}
          avatar={draft.avatar}
          frame={draft.avatarFrame}
          title={`${draft.name || '페르소나'} 이미지 편집`}
          name={draft.name}
          onAvatarChange={(avatar) => setDraftAvatarSource(avatar, true)}
          onFrameChange={updateDraftAvatarFrame}
          onClose={() => setIsAvatarCropOpen(false)}
        />
      )}
    </div>
  );
};

export default PersonaSettingsView;

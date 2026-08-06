import React from 'react';
import { X, HelpCircle, Keyboard, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="도움말 및 서비스 가이드"
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-[#e9e9e8]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e9e9e8] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7f7f7] text-[#171717]">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#171717]">도움말 및 이용 가이드</h2>
              <p className="text-[13px] text-[#8a8a8a]">DayFlow 서비스의 주요 기능 및 단축키 안내</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#787774] hover:bg-[#f7f7f7] hover:text-[#171717] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm text-[#37352f]">
          {/* Feature highlights */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" />
              핵심 기능 안내
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#f7f7f7] border border-[#e9e9e8]/60 space-y-1">
                <div className="font-semibold text-[#171717] text-[14px]">🤖 멀티 AI 페르소나</div>
                <p className="text-[13px] text-[#5f5f5f]">분석가, 기획자, 비판가 등 다양한 역할의 AI 아바타와 대화하고 조언을 구하세요.</p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7f7f7] border border-[#e9e9e8]/60 space-y-1">
                <div className="font-semibold text-[#171717] text-[14px]">📅 스마트 일정 & 할일</div>
                <p className="text-[13px] text-[#5f5f5f]">자연어로 할일을 입력하거나 AI 대화를 통해 일정을 자동으로 등록할 수 있습니다.</p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7f7f7] border border-[#e9e9e8]/60 space-y-1">
                <div className="font-semibold text-[#171717] text-[14px]">📝 데일리 저널 & 회고</div>
                <p className="text-[13px] text-[#5f5f5f]">하루를 기록하면 AI 페르소나들이 맞춤형 피드백 및 응원의 댓글을 남깁니다.</p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f7f7f7] border border-[#e9e9e8]/60 space-y-1">
                <div className="font-semibold text-[#171717] text-[14px]">🔑 커스텀 API 키 연동</div>
                <p className="text-[13px] text-[#5f5f5f]">Gemini, OpenAI, Anthropic, Ollama 등 원하는 AI 모델을 직접 연동해 사용하세요.</p>
              </div>
            </div>
          </div>

          {/* Shortcuts */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8a8a8a] flex items-center gap-1.5">
              <Keyboard size={14} />
              유용한 단축키
            </h3>
            <div className="rounded-xl border border-[#e9e9e8] overflow-hidden divide-y divide-[#e9e9e8]">
              <div className="flex items-center justify-between p-3 bg-white">
                <span className="text-[13px] text-[#5f5f5f]">새 채팅 시작</span>
                <kbd className="px-2 py-1 rounded bg-[#f3f3f3] text-[12px] font-mono text-[#37352f] border border-[#e9e9e8]">Ctrl / ⌘ + Shift + O</kbd>
              </div>
              <div className="flex items-center justify-between p-3 bg-white">
                <span className="text-[13px] text-[#5f5f5f]">모달 및 창 닫기</span>
                <kbd className="px-2 py-1 rounded bg-[#f3f3f3] text-[12px] font-mono text-[#37352f] border border-[#e9e9e8]">Esc</kbd>
              </div>
              <div className="flex items-center justify-between p-3 bg-white">
                <span className="text-[13px] text-[#5f5f5f]">채팅 메시지 전송</span>
                <kbd className="px-2 py-1 rounded bg-[#f3f3f3] text-[12px] font-mono text-[#37352f] border border-[#e9e9e8]">Enter</kbd>
              </div>
              <div className="flex items-center justify-between p-3 bg-white">
                <span className="text-[13px] text-[#5f5f5f]">줄바꿈</span>
                <kbd className="px-2 py-1 rounded bg-[#f3f3f3] text-[12px] font-mono text-[#37352f] border border-[#e9e9e8]">Shift + Enter</kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e8] bg-[#fdfdfc] px-6 py-3.5 flex items-center justify-between">
          <span className="text-[12px] text-[#8a8a8a]">DayFlow v1.2.0 • AI-driven Productivity</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#171717] text-white text-[13px] font-medium hover:bg-[#333333] transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { X, Check, Sparkles, Zap, Shield, Crown } from 'lucide-react';

interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlanModal: React.FC<PlanModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="요금제 안내"
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-[#e9e9e8]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[#e9e9e8] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Crown size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#171717]">DayFlow 멤버십 & 요금제</h2>
              <p className="text-[13px] text-[#8a8a8a]">생산성을 한층 높여줄 맞춤 플랜을 확인하세요</p>
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

        {/* Plan Cards */}
        <div className="overflow-y-auto px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Free Plan */}
            <div className="rounded-2xl border border-[#e9e9e8] bg-white p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#171717]">Basic</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f3f3f3] text-[#787774]">현재 이용 중</span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#171717]">₩0 <span className="text-xs font-normal text-[#8a8a8a]">/월</span></div>
                  <p className="text-[12px] text-[#8a8a8a] mt-0.5">기본 개인 생산성 도구</p>
                </div>
                <div className="border-t border-[#e9e9e8] pt-3 space-y-2 text-[13px] text-[#5f5f5f]">
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-500 shrink-0" />
                    <span>기본 Gemini AI 모델 탑재</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-500 shrink-0" />
                    <span>할일, 일정, 저널 무제한 관리</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-500 shrink-0" />
                    <span>로컬 데이터 백업 및 엑스포트</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled
                className="w-full py-2.5 rounded-xl border border-[#e9e9e8] bg-[#f7f7f7] text-[#8a8a8a] text-[13px] font-medium text-center cursor-not-allowed"
              >
                이용 중인 플랜
              </button>
            </div>

            {/* Plus Pro Plan */}
            <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-b from-emerald-50/30 to-white p-5 flex flex-col justify-between space-y-4 relative overflow-hidden shadow-md">
              <div className="absolute top-3 right-3">
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500 text-white flex items-center gap-1">
                  <Sparkles size={11} />
                  RECOMMENDED
                </span>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-sm font-semibold text-emerald-700">DayFlow Plus Pro</span>
                  <div className="text-2xl font-bold text-[#171717] mt-1">₩9,900 <span className="text-xs font-normal text-[#8a8a8a]">/월</span></div>
                  <p className="text-[12px] text-[#8a8a8a] mt-0.5">강력한 AI 파워 사용자를 위한 고급 플랜</p>
                </div>
                <div className="border-t border-[#e9e9e8] pt-3 space-y-2 text-[13px] text-[#37352f]">
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 shrink-0" />
                    <span className="font-medium">GPT-4, Claude 3.5, Gemini Pro 연동</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 shrink-0" />
                    <span>커스텀 AI 페르소나 및 프롬프트 생성</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 shrink-0" />
                    <span>Ollama & 로컬 LLM 서버 지원</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 shrink-0" />
                    <span>우선 순위 AI 응답 속도</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  alert('Pro 플랜 가입이 요청되었습니다! 현재 베타 버전으로 모든 기능이 무료로 제공되고 있습니다.');
                  onClose();
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold text-center hover:bg-emerald-700 transition-colors shadow-xs flex items-center justify-center gap-2"
              >
                <Zap size={16} />
                Plus Pro 시작하기
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e9e9e8] bg-[#fdfdfc] px-6 py-3.5 flex items-center justify-between">
          <span className="text-[12px] text-[#8a8a8a]">언제든지 자유롭게 요금제를 변경할 수 있습니다.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-[#e9e9e8] bg-white text-[#37352f] text-[13px] font-medium hover:bg-[#f7f7f7] transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

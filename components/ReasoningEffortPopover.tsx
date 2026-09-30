import React, { useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { ReasoningEffort } from '../types';
import { REASONING_EFFORT_OPTIONS } from '../utils/aiConfig';

interface ReasoningEffortPopoverProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  isSupported: boolean;
  modelLabel: string;
  onOpenModelPicker: () => void;
}

// Knob diameter in px; the track keeps half of it as padding so the knob stays inside.
const KNOB_SIZE = 32;

const stopPosition = (index: number) => {
  const ratio = index / (REASONING_EFFORT_OPTIONS.length - 1);
  return `calc(${KNOB_SIZE / 2}px + (100% - ${KNOB_SIZE}px) * ${ratio})`;
};

export const ReasoningEffortPopover: React.FC<ReasoningEffortPopoverProps> = ({
  value,
  onChange,
  isSupported,
  modelLabel,
  onOpenModelPicker,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastIndex = REASONING_EFFORT_OPTIONS.length - 1;
  const selectedIndex = Math.max(0, REASONING_EFFORT_OPTIONS.findIndex(option => option.id === value));
  const selectedOption = REASONING_EFFORT_OPTIONS[selectedIndex];

  const selectIndex = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), lastIndex);
    const next = REASONING_EFFORT_OPTIONS[clamped].id;
    if (next !== value) onChange(next);
  };

  const selectFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - KNOB_SIZE;
    const ratio = usable > 0 ? (clientX - rect.left - KNOB_SIZE / 2) / usable : 0;
    selectIndex(Math.round(Math.min(Math.max(ratio, 0), 1) * lastIndex));
  };

  return (
    <div className="w-72 max-w-[calc(100vw-24px)] rounded-2xl border border-[#e9e9e8] bg-white p-3 text-left">
      <div className="mb-3 flex justify-center">
        <button
          type="button"
          onClick={onOpenModelPicker}
          className="inline-flex max-w-full items-center gap-0.5 rounded-md px-1.5 text-[13px] leading-5 font-normal text-[#5f5f5f] transition-colors hover:text-[#171717]"
          title="AI 모델 선택"
        >
          <span className="truncate">{modelLabel}</span>
          <ChevronRight size={14} className="shrink-0" />
        </button>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={isSupported ? 0 : -1}
        aria-label="추론 강도"
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={selectedIndex}
        aria-valuetext={selectedOption.label}
        aria-disabled={!isSupported}
        onPointerDown={(event) => {
          if (!isSupported) return;
          isDraggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          selectFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (isDraggingRef.current) selectFromPointer(event.clientX);
        }}
        onPointerUp={() => {
          isDraggingRef.current = false;
        }}
        onPointerCancel={() => {
          isDraggingRef.current = false;
        }}
        onKeyDown={(event) => {
          if (!isSupported) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            selectIndex(selectedIndex + 1);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            selectIndex(selectedIndex - 1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            selectIndex(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            selectIndex(lastIndex);
          }
        }}
        className={`relative h-8 touch-none select-none rounded-full bg-[#eeeeee] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${isSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
      >
        {isSupported && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-primary)] transition-[width] duration-150"
            style={{ width: `calc(${KNOB_SIZE}px + (100% - ${KNOB_SIZE}px) * ${selectedIndex / lastIndex})` }}
          />
        )}
        {REASONING_EFFORT_OPTIONS.map((option, index) => (
          <span
            key={option.id}
            className={`pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${isSupported && index <= selectedIndex ? 'bg-white/70' : 'bg-[#b5b5b5]'}`}
            style={{ left: stopPosition(index) }}
          />
        ))}
        <span
          className="pointer-events-none absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#e9e9e8] bg-white transition-[left] duration-150"
          style={{ left: stopPosition(selectedIndex) }}
        />
      </div>

      <div className="mt-1.5 flex justify-between px-1 text-[12px] leading-4 text-[#8a8a8a]" aria-hidden="true">
        {REASONING_EFFORT_OPTIONS.map(option => (
          <span key={option.id}>{option.label}</span>
        ))}
      </div>

      {!isSupported && (
        <p className="mt-2 text-center text-[12px] leading-4 text-[#8a8a8a]">
          현재 모델은 추론 강도 설정을 지원하지 않아요
        </p>
      )}
    </div>
  );
};

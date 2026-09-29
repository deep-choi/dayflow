import React, { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { CalendarTag } from '../types';
import { CALENDAR_TAG_COLOR_OPTIONS } from '../utils/colorPalette';

interface CalendarTagModalProps {
  tag?: CalendarTag | null;
  canDelete: boolean;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  onDelete?: () => Promise<boolean> | boolean;
}

export const CalendarTagModal: React.FC<CalendarTagModalProps> = ({
  tag,
  canDelete,
  onClose,
  onSave,
  onDelete,
}) => {
  const isEditing = Boolean(tag);
  const [name, setName] = useState(tag?.name || '');
  const [color, setColor] = useState((tag?.color || CALENDAR_TAG_COLOR_OPTIONS[4].value).toLowerCase());
  const canSave = Boolean(name.trim());

  const handleSave = () => {
    if (!canSave) return;
    onSave(name.trim(), color);
    onClose();
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (await onDelete()) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171717]/10 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? '태그 수정' : '새 태그 만들기'}
      onMouseDown={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-lg border border-[#e9e9e8] bg-white"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e9e9e8] px-5 py-4">
          <h2 className="text-lg font-medium text-[#37352f]">{isEditing ? '태그 수정' : '새 태그 만들기'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#8a8a8a] transition-colors hover:bg-[#f7f7f7] hover:text-[#37352f]"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <label htmlFor="calendar-tag-name" className="mb-1.5 block text-[13px] leading-5 font-medium text-[#8a8a8a]">태그 이름</label>
            <input
              id="calendar-tag-name"
              autoFocus
              type="text"
              placeholder="이름을 입력하세요"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  handleSave();
                }
              }}
              className="w-full rounded-lg border border-[#e9e9e8] bg-white px-3 py-2.5 text-sm font-normal text-[#171717] outline-none transition-colors placeholder:text-[#b5b5b5] focus:border-[var(--color-primary)]"
            />
          </div>

          <div>
            <span className="mb-2 block text-[13px] leading-5 font-medium text-[#8a8a8a]">색상</span>
            <div className="flex flex-wrap gap-3">
              {CALENDAR_TAG_COLOR_OPTIONS.map(option => {
                const isSelected = color === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setColor(option.value)}
                    className={`todo-color-swatch flex h-8 w-8 items-center justify-center rounded-full transition-transform ${isSelected ? 'is-selected' : 'hover:scale-105'}`}
                    style={{
                      '--todo-tab-color': option.value,
                      '--todo-tab-dark-color': option.dark,
                    } as React.CSSProperties}
                    aria-label={option.label}
                    aria-pressed={isSelected}
                    title={option.label}
                  >
                    {isSelected && <Check size={16} strokeWidth={3} style={{ color: option.checkColor || '#ffffff' }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#e9e9e8] px-5 py-4">
          <div>
            {isEditing && onDelete && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={!canDelete}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[#ef4444] transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                title={canDelete ? '태그 삭제' : '마지막 태그는 삭제할 수 없습니다'}
              >
                <Trash2 size={15} />
                삭제
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-normal text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-lg bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isEditing ? '저장' : '만들기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

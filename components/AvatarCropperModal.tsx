import React, { useRef } from 'react';
import { RotateCcw, Upload, X } from 'lucide-react';
import type { AvatarFrame } from '../types';
import { readImageFileAsDataUrl } from '../utils/imageAsset';
import { constrainAvatarFrame, getAvatarImageStyle, normalizeAvatarFrame, sanitizeAvatarFrame } from '../utils/avatarFrame';

interface AvatarCropperModalProps {
  isOpen: boolean;
  avatar?: string;
  frame?: AvatarFrame;
  title: string;
  name?: string;
  onAvatarChange: (avatar: string) => void;
  onFrameChange: (frame?: AvatarFrame) => void;
  onClose: () => void;
}

const AvatarCropperModal: React.FC<AvatarCropperModalProps> = ({
  isOpen,
  avatar,
  frame,
  title,
  name,
  onAvatarChange,
  onFrameChange,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; centerX: number; centerY: number; distance: number; zoom: number } | null>(null);
  const frameRef = useRef(normalizeAvatarFrame(frame));
  const currentFrame = constrainAvatarFrame(frame);
  frameRef.current = currentFrame;

  if (!isOpen || !avatar) return null;

  const applyFrame = (nextFrame: Partial<AvatarFrame>) => {
    const normalized = constrainAvatarFrame(nextFrame);
    frameRef.current = normalized;
    onFrameChange(sanitizeAvatarFrame(normalized));
  };

  const nudgeFrame = (deltaX: number, deltaY: number, cropSize: number) => {
    const current = frameRef.current;
    const focusMovement = 100 / Math.max(cropSize * current.zoom, 1);
    applyFrame({
      ...current,
      x: current.x - deltaX * focusMovement,
      y: current.y - deltaY * focusMovement,
    });
  };

  const getPointerDistance = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return 0;
    const [a, b] = points;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const getCropPointerGeometry = (element: HTMLDivElement, clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    return { centerX, centerY, radius, distance };
  };

  const isResizeTarget = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-crop-resize-handle]')) return true;
    const { radius, distance } = getCropPointerGeometry(event.currentTarget, event.clientX, event.clientY);
    return Math.abs(distance - radius) <= 34 || distance > radius - 38;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2) {
      pinchRef.current = {
        distance: getPointerDistance(points),
        zoom: frameRef.current.zoom,
      };
      dragRef.current = null;
      resizeRef.current = null;
      return;
    }

    if (isResizeTarget(event)) {
      const geometry = getCropPointerGeometry(event.currentTarget, event.clientX, event.clientY);
      resizeRef.current = {
        pointerId: event.pointerId,
        centerX: geometry.centerX,
        centerY: geometry.centerY,
        distance: Math.max(geometry.distance, 1),
        zoom: frameRef.current.zoom,
      };
      dragRef.current = null;
      pinchRef.current = null;
      return;
    }

    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    pinchRef.current = null;
    resizeRef.current = null;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();

    const previous = pointersRef.current.get(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointersRef.current.values());

    if (points.length >= 2 && pinchRef.current) {
      const distance = getPointerDistance(points);
      if (distance > 0 && pinchRef.current.distance > 0) {
        applyFrame({
          ...frameRef.current,
          zoom: pinchRef.current.zoom * (distance / pinchRef.current.distance),
        });
      }
      return;
    }

    if (resizeRef.current?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - resizeRef.current.centerX, event.clientY - resizeRef.current.centerY);
      applyFrame({
        ...frameRef.current,
        zoom: resizeRef.current.zoom * (Math.max(distance, 1) / resizeRef.current.distance),
      });
      return;
    }

    if (!previous || dragRef.current?.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    nudgeFrame(event.clientX - previous.x, event.clientY - previous.y, Math.min(rect.width, rect.height));
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be released automatically by the browser.
    }

    const remaining = Array.from(pointersRef.current.entries());
    pinchRef.current = null;
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0];
      dragRef.current = { pointerId, ...point };
      return;
    }
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    applyFrame({
      ...frameRef.current,
      zoom: frameRef.current.zoom + (event.deltaY < 0 ? 0.08 : -0.08),
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('파일 크기가 너무 큽니다 (최대 5MB)');
      return;
    }

    try {
      onAvatarChange(await readImageFileAsDataUrl(file));
      onFrameChange(undefined);
    } catch (error) {
      alert((error as Error).message || '이미지를 불러오지 못했습니다.');
    }
  };

  const cropImage = (
    <img
      src={avatar}
      alt={name || '페르소나 이미지'}
      draggable={false}
      style={getAvatarImageStyle(currentFrame)}
      className="absolute inset-0 h-full w-full select-none object-cover"
    />
  );

  return (
    <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-hidden">
      <div className="w-full max-w-[calc(100vw-24px)] sm:max-w-xl max-h-[92dvh] bg-white rounded-2xl border border-[#e9e9e8] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-[#efefef] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-[#37352f]">{title}</h4>
            <p className="text-xs text-[#9b9a97] mt-1">원 안쪽을 끌면 위치가 바뀌고, 흰 테두리를 잡아당기면 확대/축소돼요.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#f2f2f0] text-[#787774] transition-colors shrink-0"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 flex flex-col gap-6">
          <div className="flex justify-center shrink-0">
            <div
              role="application"
              aria-label="페르소나 이미지 위치 조정"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onWheel={handleWheel}
              className="relative mx-auto aspect-square w-full max-w-[390px] overflow-hidden rounded-full bg-[#111] cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none', maxWidth: 'min(390px, calc(100dvh - 240px), calc(100vw - 56px))' }}
            >
              <img
                src={avatar}
                alt={name || '페르소나 이미지'}
                draggable={false}
                style={getAvatarImageStyle(currentFrame)}
                className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-0 pointer-events-none"
              />
              <div className="pointer-events-none absolute inset-0 rounded-full bg-black/10" />
              <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/95">
                <div className="absolute left-1/3 top-0 h-full w-px bg-white/65" />
                <div className="absolute left-2/3 top-0 h-full w-px bg-white/65" />
                <div className="absolute left-0 top-1/3 h-px w-full bg-white/65" />
                <div className="absolute left-0 top-2/3 h-px w-full bg-white/65" />
                <span data-crop-resize-handle className="pointer-events-auto absolute left-1/2 top-1 h-6 w-6 -translate-x-1/2 rounded-full bg-[rgba(245,245,245,0.95)] cursor-ns-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[rgba(245,245,245,0.95)] cursor-ew-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute bottom-1 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-[rgba(245,245,245,0.95)] cursor-ns-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute left-1 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[rgba(245,245,245,0.95)] cursor-ew-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute right-[15%] top-[15%] h-4 w-4 rounded-full bg-[rgba(245,245,245,0.95)] cursor-nesw-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute bottom-[15%] right-[15%] h-4 w-4 rounded-full bg-[rgba(245,245,245,0.95)] cursor-nwse-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute bottom-[15%] left-[15%] h-4 w-4 rounded-full bg-[rgba(245,245,245,0.95)] cursor-nesw-resize" />
                <span data-crop-resize-handle className="pointer-events-auto absolute left-[15%] top-[15%] h-4 w-4 rounded-full bg-[rgba(245,245,245,0.95)] cursor-nwse-resize" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full max-w-[390px] mx-auto px-2">
            <span className="text-xs font-medium text-[#787774]">축소</span>
            <input 
              type="range" 
              min="1" 
              max="3" 
              step="0.01" 
              value={currentFrame.zoom}
              onChange={(e) => applyFrame({ ...frameRef.current, zoom: parseFloat(e.target.value) })}
              className="flex-1 h-1.5 bg-[#e9e9e8] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#dcdcd9] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#dcdcd9] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-pointer"
            />
            <span className="text-xs font-medium text-[#787774]">확대</span>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3 sm:py-4 border-t border-[#efefef] flex flex-wrap items-center justify-between gap-2 shrink-0 bg-white">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#dcdcd9] text-xs font-medium text-[#37352f] hover:bg-[#f7f7f5]"
            >
              <Upload size={13} /> 이미지 변경
            </button>
            <button
              type="button"
              onClick={() => onFrameChange(undefined)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#dcdcd9] text-xs font-medium text-[#787774] hover:bg-[#f7f7f5]"
            >
              <RotateCcw size={13} /> 초기화
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#f7f7f7] border border-[#e9e9e8] text-sm font-medium text-[#171717] hover:bg-[#eeeeee] transition-colors"
          >
            적용 완료
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvatarCropperModal;

import type { CSSProperties } from 'react';
import type { AvatarFrame } from '../types';

export const DEFAULT_AVATAR_FRAME: AvatarFrame = {
  zoom: 1,
  x: 50,
  y: 50,
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const normalizeAvatarFrame = (frame?: Partial<AvatarFrame> | null): AvatarFrame => ({
  zoom: clampNumber(frame?.zoom, 1, 3, DEFAULT_AVATAR_FRAME.zoom),
  x: clampNumber(frame?.x, 0, 100, DEFAULT_AVATAR_FRAME.x),
  y: clampNumber(frame?.y, 0, 100, DEFAULT_AVATAR_FRAME.y),
});

export const constrainAvatarFrame = (frame?: Partial<AvatarFrame> | null): AvatarFrame => {
  const normalized = normalizeAvatarFrame(frame);
  if (normalized.zoom <= 1.001) return normalized;

  const minFocus = 50 / normalized.zoom;
  const maxFocus = 100 - minFocus;

  return {
    ...normalized,
    x: clampNumber(normalized.x, minFocus, maxFocus, DEFAULT_AVATAR_FRAME.x),
    y: clampNumber(normalized.y, minFocus, maxFocus, DEFAULT_AVATAR_FRAME.y),
  };
};

export const isDefaultAvatarFrame = (frame?: Partial<AvatarFrame> | null): boolean => {
  const normalized = constrainAvatarFrame(frame);
  return (
    Math.abs(normalized.zoom - DEFAULT_AVATAR_FRAME.zoom) < 0.001 &&
    Math.abs(normalized.x - DEFAULT_AVATAR_FRAME.x) < 0.001 &&
    Math.abs(normalized.y - DEFAULT_AVATAR_FRAME.y) < 0.001
  );
};

export const sanitizeAvatarFrame = (frame?: unknown): AvatarFrame | undefined => {
  if (!frame || typeof frame !== 'object') return undefined;
  const normalized = constrainAvatarFrame(frame as Partial<AvatarFrame>);
  return isDefaultAvatarFrame(normalized) ? undefined : normalized;
};

export const getAvatarImageStyle = (frame?: Partial<AvatarFrame> | null): CSSProperties => {
  const normalized = constrainAvatarFrame(frame);
  const minFocus = 50 / normalized.zoom;
  const maxFocus = 100 - minFocus;
  const panX = clampNumber(normalized.x, minFocus, maxFocus, DEFAULT_AVATAR_FRAME.x);
  const panY = clampNumber(normalized.y, minFocus, maxFocus, DEFAULT_AVATAR_FRAME.y);
  const offsetX = normalized.zoom * (50 - panX);
  const offsetY = normalized.zoom * (50 - panY);

  return {
    display: 'block',
    transform: `translate(${offsetX}%, ${offsetY}%) scale(${normalized.zoom})`,
    transformOrigin: 'center center',
  };
};

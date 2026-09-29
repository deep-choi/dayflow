export type ThemeColorOption = {
  value: string;
  dark: string;
  label: string;
  // Check mark color shown on the selected swatch; light swatches need a dark mark.
  checkColor?: string;
};

export const TODO_TAB_COLOR_OPTIONS: ThemeColorOption[] = [
  { value: '#d93025', dark: '#c2413f', label: '빨강' },
  { value: '#f57c00', dark: '#c2410c', label: '주황' },
  { value: '#fbbc04', dark: '#a16207', label: '노랑', checkColor: '#3d2e00' },
  { value: '#188038', dark: '#166534', label: '초록' },
  { value: 'var(--color-primary)', dark: 'var(--app-point-surface)', label: '파랑' },
  { value: '#3f51b5', dark: '#4338ca', label: '남색' },
  { value: '#9c27b0', dark: '#7e22ce', label: '보라' },
  { value: '#5f6368', dark: '#6b7280', label: '회색' },
];

// Calendar tags are stored as hex (the UI derives translucent variants from them),
// so this palette avoids CSS variables. It includes the default tag colors.
export const CALENDAR_TAG_COLOR_OPTIONS: ThemeColorOption[] = [
  { value: '#dc2626', dark: '#dc2626', label: '빨강' },
  { value: '#f97316', dark: '#f97316', label: '주황' },
  { value: '#f59e0b', dark: '#f59e0b', label: '노랑', checkColor: '#3d2e00' },
  { value: '#10b981', dark: '#10b981', label: '초록' },
  { value: '#2563eb', dark: 'var(--app-point-surface)', label: '파랑' },
  { value: '#4f46e5', dark: '#4f46e5', label: '남색' },
  { value: '#9333ea', dark: '#9333ea', label: '보라' },
  { value: '#6b7280', dark: '#6b7280', label: '회색' },
];

const normalizeColorKey = (color?: string) => (color || '').trim().toLowerCase();

const DARK_COLOR_OVERRIDES: Record<string, string> = {
  'var(--color-primary)': 'var(--app-point-surface)',
  '#1a73e8': 'var(--app-point-surface)',
  '#2383e2': 'var(--app-point-surface)',
  '#2563eb': 'var(--app-point-surface)',
  '#2b6de9': 'var(--app-point-surface)',
  '#60a5fa': 'var(--app-point-surface)',
  '#d93025': '#c2413f',
  '#188038': '#166534',
  '#34a853': '#166534',
  '#35b37e': '#166534',
  '#f57c00': '#c2410c',
  '#fbbc04': '#a16207',
  '#f29900': '#a16207',
  '#deb13b': '#a16207',
  '#3f51b5': '#4338ca',
  '#9c27b0': '#7e22ce',
  '#4c2889': '#7e22ce',
  '#0097a7': '#0f766e',
  '#5f6368': '#6b7280',
  '#37352f': '#6b7280',
  '#ff4081': '#be185d',
};

export const normalizeThemeColorValue = (color?: string) => {
  const trimmed = (color || '').trim();
  const key = normalizeColorKey(trimmed);

  if (key === '#1a73e8' || key === '#2383e2' || key === '#2563eb' || key === '#2b6de9' || key === '#60a5fa') {
    return 'var(--color-primary)';
  }

  return trimmed || 'var(--color-primary)';
};

export const getDarkAdaptiveColor = (color?: string) => {
  const trimmed = (color || '').trim();
  const key = normalizeColorKey(trimmed);
  return DARK_COLOR_OVERRIDES[key] || trimmed || 'var(--app-point-surface)';
};

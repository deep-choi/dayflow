export type ThemeColorOption = {
  value: string;
  dark: string;
};

export const TODO_TAB_COLOR_OPTIONS: ThemeColorOption[] = [
  { value: 'var(--color-primary)', dark: 'var(--app-point-surface)' },
  { value: '#d93025', dark: '#c2413f' },
  { value: '#188038', dark: '#166534' },
  { value: '#f29900', dark: '#a16207' },
  { value: '#9c27b0', dark: '#7e22ce' },
  { value: '#0097a7', dark: '#0f766e' },
  { value: '#5f6368', dark: '#6b7280' },
  { value: '#ff4081', dark: '#be185d' },
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
  '#f29900': '#a16207',
  '#deb13b': '#a16207',
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

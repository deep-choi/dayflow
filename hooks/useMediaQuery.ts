import { useEffect, useState } from 'react';

const matches = (query: string) => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
);

/** Tracks a CSS media query, e.g. `(max-width: 1023px)` or `(pointer: coarse)`. */
export const useMediaQuery = (query: string): boolean => {
  const [isMatch, setIsMatch] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setIsMatch(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return isMatch;
};

/** Below Tailwind's `lg` breakpoint the app uses its mobile layout (no sidebar). */
export const COMPACT_LAYOUT_QUERY = '(max-width: 1023px)';
export const TOUCH_POINTER_QUERY = '(pointer: coarse)';

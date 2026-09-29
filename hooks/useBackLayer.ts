import { useEffect, useRef } from 'react';

// Set while we pop our own history entry after an overlay was closed from the UI.
// Holds the URL the app had at that moment, so the pop doesn't roll the view back.
let pendingCleanupPop: { url: string } | null = null;

/**
 * Call first in any app-level `popstate` handler. Returns true when the event is the
 * cleanup pop of a closed overlay (not a user back press); the handler should then
 * ignore it. The URL the app had before the pop is restored.
 */
export const consumeBackLayerCleanupPop = (): boolean => {
  if (!pendingCleanupPop) return false;
  const { url } = pendingCleanupPop;
  pendingCleanupPop = null;
  window.history.replaceState(window.history.state, '', url);
  return true;
};

/**
 * Lets the browser / Android back button close an overlay (menu, modal, detail pane)
 * instead of leaving the app. While `isOpen` is true a history entry is pushed;
 * pressing back pops it and calls `onClose`. Closing through the UI removes the entry.
 */
export const useBackLayer = (isOpen: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isUnmountingRef = useRef(false);

  // Declared first so its cleanup runs before the layer cleanup on unmount.
  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    let closedByBack = false;
    const layerId = `${Date.now()}-${Math.random()}`;
    window.history.pushState({ ...(window.history.state || {}), dayflowLayer: layerId }, '');

    const handlePopState = () => {
      if (pendingCleanupPop || window.history.state?.dayflowLayer === layerId) return;
      closedByBack = true;
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Closed from the UI: drop the entry we pushed so the next back press behaves normally.
      // On unmount (e.g. switching views) the entry is left alone.
      if (closedByBack || isUnmountingRef.current) return;

      // Wait a tick so a view change made in the same update (e.g. picking a page from the
      // menu) has written its URL, then pop our entry while keeping that URL.
      window.setTimeout(() => {
        if (window.history.state?.dayflowLayer !== layerId) return;
        pendingCleanupPop = { url: window.location.href };
        window.history.back();
      }, 0);
    };
  }, [isOpen]);
};

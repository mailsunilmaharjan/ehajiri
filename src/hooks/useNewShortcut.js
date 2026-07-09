import { useEffect } from 'react';

/**
 * Ctrl+N (Cmd+N on Mac) triggers onNew while `active` is true.
 * preventDefault stops the browser's native "New Window/Tab" action.
 */
export default function useNewShortcut(active, onNew) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onNew]);
}

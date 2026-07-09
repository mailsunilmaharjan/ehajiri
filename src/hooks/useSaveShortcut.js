import { useEffect } from 'react';

/**
 * Ctrl+S (Cmd+S on Mac) triggers onSave while `active` is true.
 * preventDefault stops the browser's native "Save Page As" dialog.
 * Pair with <SaveButton> from components/Common/SaveButton.jsx.
 */
export default function useSaveShortcut(active, onSave) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onSave]);
}

import { useEffect } from 'react';

/**
 * Alt+<letter> jumps focus to the form field registered under the matching
 * key, while `active` is true. `keyMap` is { letter: fieldKey }; `fieldRefs`
 * is a ref whose .current is a plain { fieldKey: element | { focus() } }
 * map, populated via callback refs on each field.
 */
export default function useFieldShortcuts(active, keyMap, fieldRefs) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const fieldKey = keyMap[e.key.toLowerCase()];
      if (!fieldKey) return;
      const el = fieldRefs.current[fieldKey];
      if (!el) return;
      e.preventDefault();
      el.focus?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, keyMap, fieldRefs]);
}

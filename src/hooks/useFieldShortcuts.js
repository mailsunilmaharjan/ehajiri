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
    // lets the top menu's Alt+letter shortcuts step aside while this form owns the Alt keys
    window.__ehFieldAlt = (window.__ehFieldAlt || 0) + 1;
    return () => { window.removeEventListener('keydown', onKeyDown); window.__ehFieldAlt = Math.max(0, (window.__ehFieldAlt || 1) - 1); };
  }, [active, keyMap, fieldRefs]);
}

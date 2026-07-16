/**
 * KeyboardMultiSelect
 * A labeled, scrollable checkbox list for one filter field.
 * Keyboard: ArrowUp/Down move the highlight by one row, PageUp/PageDown
 * jump by a page, Enter toggles the highlighted row's checkbox.
 *
 * Props:
 *   label    – field heading (e.g. "Branch")
 *   options  – string[] of distinct values
 *   values   – string[] currently checked
 *   onChange – (values: string[]) => void
 */
import React, { useState, useRef } from 'react';

const PAGE = 5;

const KeyboardMultiSelect = ({ label, options = [], values = [], onChange }) => {
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);
  const itemRefs = useRef([]);

  const toggle = (opt) =>
    onChange(values.includes(opt) ? values.filter(v => v !== opt) : [...values, opt]);

  const move = (delta) => {
    if (!options.length) return;
    const next = Math.max(0, Math.min(options.length - 1, highlight + delta));
    setHighlight(next);
    itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown')  { e.preventDefault(); move(PAGE); }
    else if (e.key === 'PageUp')    { e.preventDefault(); move(-PAGE); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[highlight] != null) toggle(options[highlight]);
    }
  };

  return (
    <div>
      <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>
        {label}{values.length > 0 && (
          <span style={{ marginLeft:6, background:'#52b02c', color:'white', borderRadius:10,
            padding:'0 6px', fontSize:10, fontWeight:700 }}>{values.length}</span>
        )}
      </div>
      <div ref={listRef} tabIndex={0} onKeyDown={onKeyDown}
        style={{ border:'1px solid #d1d5db', borderRadius:6, maxHeight:150, overflowY:'auto',
          outline:'none' }}
        onFocus={() => setHighlight(h => Math.min(h, Math.max(0, options.length - 1)))}>
        {options.length === 0 && (
          <div style={{ padding:'8px 10px', fontSize:12, color:'#9ca3af' }}>No options</div>
        )}
        {options.map((opt, i) => (
          <label key={opt}
            ref={el => itemRefs.current[i] = el}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => toggle(opt)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', fontSize:12.5,
              cursor:'pointer', userSelect:'none',
              background: highlight === i ? '#f0fdf4' : values.includes(opt) ? '#f8fafc' : 'white' }}>
            <input type="checkbox" checked={values.includes(opt)} readOnly style={{ accentColor:'#52b02c' }} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
};

export default KeyboardMultiSelect;

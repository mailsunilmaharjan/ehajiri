/**
 * ShiftGroupLevelSelect
 * Multi-select checkbox dropdown for "Assign Shift Group Level".
 *
 * Top level only shows Shift Groups (📦) and any ungrouped Access Levels —
 * the individual levels that belong to a group are hidden until you click
 * the group's expand arrow, then appear nested underneath with their own
 * checkboxes.
 *
 * Checking a group selects every level in it — its child checkboxes show
 * checked too, even though only "g:<id>" is stored in `values` (the literal
 * level ids are expanded from it by the caller at save time). Unchecking one
 * child while the group is checked "splits" the group selection into
 * individual level picks (every sibling except the one just unchecked),
 * since the group can no longer be said to be fully selected.
 *
 * Used identically by Staff → Device Connectivity and Access Rules → By
 * Person, so both screens present the same picker and the same summary.
 *
 * Props:
 *   levels      – [{ id, name, group_id }]
 *   levelGroups – [{ id, name, level_count }]
 *   values      – string[] — level ids and/or "g:<groupId>" group picks
 *   onChange    – (values: string[]) => void
 *   label       – field label (default "Assign Shift Group Level")
 *   allLabel    – trigger text when nothing is selected
 */
import React, { useState, useRef, useEffect } from 'react';

const ShiftGroupLevelSelect = ({
  levels = [],
  levelGroups = [],
  values = [],
  onChange,
  label = 'Assign Shift Group Level',
  allLabel = '— None (no restriction) —',
}) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggleValue = (val) =>
    onChange(values.includes(val) ? values.filter(v => v !== val) : [...values, val]);

  // Checking a group drops any of its individual levels already picked
  // separately (the group covers them now — keeping both around showed the
  // level's name redundantly alongside the group in the trigger summary).
  // Unchecking a group also clears those siblings, fully deselecting it.
  const toggleGroup = (groupId) => {
    const val = `g:${groupId}`;
    const siblingIds = levels.filter(l => l.group_id === groupId).map(l => String(l.id));
    onChange(
      values.includes(val)
        ? values.filter(v => v !== val && !siblingIds.includes(v))
        : [...values.filter(v => !siblingIds.includes(v)), val]
    );
  };

  // Toggling a level that belongs to a group: if the WHOLE group is currently
  // selected, this click means "every sibling except this one" — replace the
  // group pick with explicit level ids. Otherwise behaves like a plain toggle.
  const toggleChildLevel = (level) => {
    const groupVal = `g:${level.group_id}`;
    if (values.includes(groupVal)) {
      const siblingIds = levels.filter(l => l.group_id === level.group_id && l.id !== level.id).map(l => String(l.id));
      onChange([...values.filter(v => v !== groupVal), ...siblingIds]);
    } else {
      toggleValue(String(level.id));
    }
  };

  const toggleExpand = (groupId) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });

  const ungroupedLevels = levels.filter(l => !l.group_id);

  const selectedGroups = levelGroups.filter(g => values.includes(`g:${g.id}`));
  const selectedLooseLevels = levels.filter(l => values.includes(String(l.id)));

  const selectedLabels = [
    ...selectedGroups.map(g => `📦 ${g.name}`),
    ...selectedLooseLevels.map(l => l.name),
  ];

  return (
    <div style={{ position:'relative' }} ref={boxRef}>
      <label className="form-label" style={{ fontSize:12, display:'block', marginBottom:4 }}>{label}</label>
      <div onClick={() => setOpen(o => !o)}
        style={{ height:34, border:'1px solid #d1d5db', borderRadius:6, padding:'0 10px', fontSize:13,
          display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer',
          background:'white', overflow:'hidden' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          color: selectedLabels.length ? 'inherit' : '#9ca3af' }}>
          {selectedLabels.length ? selectedLabels.join(', ') : allLabel}
        </span>
        <span style={{ marginLeft:6, color:'#9ca3af', flexShrink:0 }}>▾</span>
      </div>

      {open && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:30, background:'white',
          border:'1px solid #d1d5db', borderRadius:6, maxHeight:280, overflowY:'auto',
          boxShadow:'0 4px 12px rgba(0,0,0,.1)', marginTop:2 }}>
          {levelGroups.map(g => {
            const val = `g:${g.id}`;
            const checked = values.includes(val);
            const isOpen = expanded.has(g.id);
            const childLevels = levels.filter(l => l.group_id === g.id);
            return (
              <div key={val}>
                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 8px',
                  fontSize:13, cursor:'pointer', background:'#faf5ff' }}
                  onMouseDown={e => e.preventDefault()}>
                  <span onClick={() => toggleExpand(g.id)}
                    style={{ width:16, textAlign:'center', color:'#9ca3af', flexShrink:0, cursor:'pointer' }}>
                    {childLevels.length ? (isOpen ? '−' : '+') : ''}
                  </span>
                  <label style={{ display:'flex', alignItems:'center', gap:8, flex:1, cursor:'pointer' }}
                    onClick={() => toggleGroup(g.id)}>
                    <input type="checkbox" checked={checked} readOnly style={{ accentColor:'#7c3aed' }} />
                    📦 {g.name} ({g.level_count} level{g.level_count===1?'':'s'})
                  </label>
                </div>
                {isOpen && childLevels.map(l => {
                  // Checked if picked individually, OR because the whole group is selected.
                  const lChecked = checked || values.includes(String(l.id));
                  return (
                    <label key={l.id} style={{ display:'flex', alignItems:'center', gap:8,
                      padding:'6px 8px 6px 34px', fontSize:13, cursor:'pointer' }}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => toggleChildLevel(l)}>
                      <input type="checkbox" checked={lChecked} readOnly style={{ accentColor:'#52b02c' }} />
                      {l.name}
                    </label>
                  );
                })}
              </div>
            );
          })}
          {ungroupedLevels.map(l => {
            const checked = values.includes(String(l.id));
            return (
              <label key={l.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                fontSize:13, cursor:'pointer' }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => toggleValue(String(l.id))}>
                <input type="checkbox" checked={checked} readOnly style={{ accentColor:'#52b02c' }} />
                {l.name}
              </label>
            );
          })}
        </div>
      )}

      {/* Summary of every selected Shift Group's full level list */}
      {selectedGroups.length > 0 && (
        <div style={{ marginTop:6, fontSize:12, color:'#5b21b6', background:'#faf5ff',
          border:'1px solid #e9d5ff', borderRadius:6, padding:'6px 10px' }}>
          {selectedGroups.map(g => {
            const childNames = levels.filter(l => l.group_id === g.id).map(l => l.name);
            return (
              <div key={g.id}>
                <strong>Shift Group Levels : {g.name}</strong>
                {childNames.length > 0 && <div>{childNames.join(' -- ')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ShiftGroupLevelSelect;

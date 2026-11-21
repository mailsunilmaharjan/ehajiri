/*
 * DataGrid kit — the TEMPLATE for every list grid in the app (same look and keys as the Sales Invoice list).
 *
 *   const g = useGrid({ rows, onOpen: (r) => …, getId: (r) => r.id });
 *   <table ref={g.gridRef} className="grid dg-soft">
 *     <thead><tr>{g.tickTh}<th className="sn">SN</th> …</tr></thead>
 *     <tbody>
 *       {rows.map((r, i) => <tr key={…} {...g.rowProps(r)}>{g.tickTd(r)}<td className="sn">{i + 1}</td> …</tr>)}
 *       {g.blankRows(COLS)}                                  ← optional: fill the screen
 *       <RemarksRow g={g} cols={COLS}>…details of g.curRow…</RemarksRow>   ← optional remarks box
 *     </tbody>
 *   </table>
 *
 * Gives: tick-box + grey S.N. columns, light-blue current row (first row picked automatically),
 * ↑ / ↓ / Home / End move the current row, Enter (or double-click) opens it, ticked rows in g.sel.
 * Keys are ignored while typing in a box, while a dialog / right-click menu is open, and — when a page
 * has several grids — they go to the grid clicked last.
 */
import { useEffect, useRef, useState } from 'react';
import { useFillRows } from '../lib/fillRows';

const live = [];          // grids on screen, in mount order
let active = null;        // grid clicked last

export function useGrid({ rows, onOpen, getId = (r) => r.id, autoPick = true, fill = true }) {
  const gridRef = useRef(null);
  const [cur, setCur] = useState(null);
  const [sel, setSel] = useState(new Set());
  const ids = rows.map(getId);
  const curRow = rows.find((r) => getId(r) === cur) || null;
  const { fill: nFill, remH } = useFillRows(gridRef, [rows, fill]);

  // keep a row picked (so a remarks box is never empty) and drop ticks of rows that went away
  useEffect(() => {
    if (!ids.includes(cur)) setCur(autoPick ? ids[0] ?? null : null);
    setSel((s) => { const n = new Set([...s].filter((id) => ids.includes(id))); return n.size === s.size ? s : n; });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    live.push(gridRef);
    return () => { live.splice(live.indexOf(gridRef), 1); if (active === gridRef) active = null; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || !rows.length) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(e.key)) return;
      const owner = active?.current && document.body.contains(active.current) ? active : live.find((g) => g.current);
      if (owner !== gridRef) return;
      if (document.querySelector('.modal, .dg-ctx-menu')) return;
      const tg = e.target;
      if (tg instanceof HTMLElement && (tg.isContentEditable || ['TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tg.tagName)
        || (tg.tagName === 'INPUT' && tg.type !== 'checkbox'))) return;
      const i = ids.indexOf(cur);
      let next = null;
      if (e.key === 'ArrowDown') next = ids[Math.min(i + 1, ids.length - 1)];
      else if (e.key === 'ArrowUp') next = ids[i < 0 ? 0 : Math.max(i - 1, 0)];
      else if (e.key === 'Home') next = ids[0];
      else if (e.key === 'End') next = ids[ids.length - 1];
      else if (e.key === 'Enter') { if (curRow && onOpen) { e.preventDefault(); onOpen(curRow); } return; }
      if (next == null) return;
      e.preventDefault();
      setCur(next);
      gridRef.current?.querySelector(`tr[data-id="${CSS.escape(String(next))}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = ids.length > 0 && ids.every((id) => sel.has(id));
  const stop = (e) => e.stopPropagation();

  return {
    gridRef, cur, setCur, curRow, sel, setSel, toggle,
    /** props for a data row: highlight, click = pick, double-click = open */
    rowProps: (r, extra = '') => {
      const id = getId(r);
      return {
        'data-id': id,
        className: `clickable ${cur === id ? 'current' : ''} ${sel.has(id) ? 'selected' : ''} ${extra}`,
        onClick: () => { active = gridRef; setCur(id); },
        onDoubleClick: () => onOpen?.(r),
      };
    },
    tickTh: (
      <th className="sel"><input type="checkbox" title="Select all" checked={allOn}
        onChange={() => setSel(allOn ? new Set() : new Set(ids))} /></th>
    ),
    tickTd: (r) => (
      <td className="sel" onClick={stop} onDoubleClick={stop}>
        <input type="checkbox" checked={sel.has(getId(r))} onChange={() => { active = gridRef; toggle(getId(r)); }} />
      </td>
    ),
    /** blank striped rows down to the remarks box / screen bottom (tick + S.N. cells stay grey) */
    blankRows: (cols, snCols = 2) => Array.from({ length: nFill }, (_, k) => (
      <tr key={`blank${k}`} className="blank">
        {Array.from({ length: cols }, (__, j) => <td key={j} className={j < snCols ? (j === snCols - 1 ? 'sn' : 'sel') : undefined}>&nbsp;</td>)}
      </tr>
    )),
    remH,
  };
}

/** Remarks box under the grid (like the Sales Invoice list). `right` shows on the right side, e.g. Updated By. */
export function RemarksRow({ g, cols, children, right, empty = 'Click a row to see its details.' }) {
  return (
    <tr className="remarks-row"><td colSpan={cols} style={{ height: g.remH }}>
      {g.curRow ? (
        <div className="rm-wrap">
          <div className="rm-grid">{children}</div>
          {right && <div className="rm-by">{right}</div>}
        </div>
      ) : <span className="muted">{empty}</span>}
    </td></tr>
  );
}

/** "Updated By" block for the right side of the remarks box. */
export function UpdatedBy({ name, when }) {
  if (!name) return null;
  return <><b>Updated By:</b> {name}{when && <div className="muted small">{when}</div>}</>;
}

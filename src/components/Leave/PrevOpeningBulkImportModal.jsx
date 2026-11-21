import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/* Columns (tab-separated, as copied from Excel):
   Designation (Post) | Person (Staff) | Leave (Leave Name) | Transferred (Previous Year Opening) | Current Year (optional)
   One row per staff × leave type. Header row is skipped.
   Transferred and Current Year are each optional per row (at least one is needed):
   Transferred → this tab's Prev Year opening; Current Year → the Current Year Leave
   Opening of the same fiscal year, so both years load in a single paste.

   Staff is matched by full name (or Staff ID); if several staff share a name the
   Designation column disambiguates. Leave is matched by name or short name and
   must be a carry-forward ("Accumulate") type — those are the only ones this tab
   holds. A value above the leave type's Max Accumulate Days is rejected, exactly
   like typing it in by hand. */
const parsePaste = (text, employees, leaveTypes, posts, current, currentOpening) => {
  const postNames = (e) => {
    const p = (posts || []).find(x => norm(x.name) === norm(e.position));
    return [norm(e.position), p ? norm(p.shortName) : ''].filter(Boolean);
  };
  const seen = new Set();
  const rows = [];
  text.split('\n').map(l => l.replace(/\r$/, '')).forEach((line, li) => {
    if (!line.trim()) return;
    const c = line.split('\t').map(x => x.trim());
    const [post, person, leave, transferred, currentRaw] = c;
    if (/^designation$|^post$/i.test(post || '') && /^(person|staff)$/i.test(person || '')) return; // header
    if (!person) return;
    const bad = why => rows.push({ li, cells: c, person, post, leave, invalid: why });

    // staff
    // Some tenants store the Staff ID inside the full name ("Alina Shakya [256]") —
    // compare names without that trailing "[id]" on both sides.
    const nameKey = s => norm(String(s ?? '').replace(/\s*\[[^\]]*\]\s*$/, ''));
    const n = nameKey(person);
    let matches = employees.filter(e => nameKey(e.fullName) === n || (e.employeeId && norm(e.employeeId) === norm(person)));
    if (matches.length > 1 && post) {
      const byPost = matches.filter(e => postNames(e).includes(norm(post)));
      if (byPost.length) matches = byPost;
    }
    if (matches.length === 0) return bad('staff');
    if (matches.length > 1) return bad('ambiguous');
    const emp = matches[0];

    // leave type
    const ln = norm(leave);
    const lt = leaveTypes.find(l => norm(l.name) === ln || norm(l.shortName) === ln);
    if (!lt) return bad('leave');

    // Previous Year (Transferred) — optional, any leave type (accumulate or not)
    const hasPrev = transferred !== '' && transferred !== undefined;
    const hasCurr = currentRaw !== '' && currentRaw !== undefined;
    if (!hasPrev && !hasCurr) return bad('days');
    let days = null;
    if (hasPrev) {
      days = Number(transferred);
      if (!Number.isFinite(days) || days < 0) return bad('days');
      // Max Accumulate Days only caps carry-forward types; non-accumulate leave has no such cap.
      if (lt.carryForward && lt.maxAccumulateDays != null && days > Number(lt.maxAccumulateDays)) return bad('max:' + lt.maxAccumulateDays);
    }
    // Current Year — optional, any leave type, capped by Days per Year like the Current Year tab
    let curr = null;
    if (hasCurr) {
      curr = Number(currentRaw);
      if (!Number.isFinite(curr) || curr < 0) return bad('curr');
      if (lt.daysPerYear != null && curr > Number(lt.daysPerYear)) return bad('currmax:' + lt.daysPerYear);
    }

    const key = `${emp.id}|${lt.shortName}`;
    if (seen.has(key)) return bad('dup');
    seen.add(key);
    rows.push({
      li, cells: c,
      post, person, leave,
      empId: emp.id, empName: emp.fullName, short: lt.shortName, ltName: lt.name, days, curr,
      old: Number(current?.[emp.id]?.[lt.shortName] ?? 0),
      oldCurr: Number(currentOpening?.[emp.id]?.[lt.shortName] ?? 0),
    });
  });
  return rows;
};

/* Super-Admin-only bulk entry for the Previous Year Opening tab. */
const PrevOpeningBulkImportModal = ({ open, onClose, employees, leaveTypes, posts, current, currentOpening, fyName, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,      setText]      = useState('');
  const [result,    setResult]    = useState(null);
  const [importing, setImporting] = useState(false);
  const [error,     setError]     = useState('');
  const [editing,   setEditing]   = useState(null);   // { li, col }
  const [editVal,   setEditVal]   = useState('');

  // Hooks before the early return (see Settings/BulkImportModal for why).
  const rows = useMemo(
    () => parsePaste(text, employees || [], leaveTypes || [], posts || [], current, currentOpening),
    [text, employees, leaveTypes, posts, current, currentOpening]);
  const valid = rows.filter(r => !r.invalid);
  const invalidCount = rows.length - valid.length;

  if (!open) return null;

  // Edits write straight back into the pasted text, so the textarea stays the single
  // source of truth and the preview re-validates instantly (auto-saved).
  const commitEdit = () => {
    if (!editing) return;
    const lines = text.split('\n');
    const cells = String(lines[editing.li] ?? '').replace(/\r$/, '').split('\t');
    while (cells.length <= editing.col) cells.push('');
    cells[editing.col] = editVal.trim();
    lines[editing.li] = cells.join('\t');
    setText(lines.join('\n'));
    setEditing(null);
  };
  const ec = (r, col, content, style) => {
    const on = editing && editing.li === r.li && editing.col === col;
    return (
      <td style={{ ...style, cursor:'text' }} title={L('सम्पादन गर्न डबल क्लिक गर्नुस्','Double-click to edit')}
        onDoubleClick={() => { setEditing({ li:r.li, col }); setEditVal(r.cells?.[col] ?? ''); }}>
        {on ? (
          <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') setEditing(null); }}
            style={{ width:'100%', minWidth:60, font:'inherit', padding:'2px 4px', border:'1.5px solid #1a56db', borderRadius:4, boxSizing:'border-box' }} />
        ) : content}
      </td>
    );
  };

  const handleClose = () => { setText(''); setResult(null); setError(''); setImporting(false); onClose(); };
  const handleImport = async () => {
    if (!valid.length || importing) return;
    setImporting(true); setError('');
    try { setResult(await onImport(valid)); }
    catch (e) { setError(e?.message || L('सेभ गर्न सकिएन','Could not save')); }
    finally { setImporting(false); }
  };

  const reason = k => {
    if (k?.startsWith('currmax:')) return L(`चालु वर्षको दिन प्रति वर्ष (${k.slice(8)}) भन्दा बढी`, `Current Year exceeds Days per Year (${k.slice(8)})`);
    if (k?.startsWith('max:')) return L(`अधिकतम जम्मा दिन (${k.slice(4)}) भन्दा बढी`, `Exceeds Max Accumulate Days (${k.slice(4)})`);
    return {
      staff    : L('कर्मचारी फेला परेन','Staff not found'),
      ambiguous: L('एउटै नामका धेरै कर्मचारी — पद जाँच्नुस्','Several staff share this name — check Designation'),
      leave    : L('बिदा प्रकार फेला परेन','Leave type not found'),
      nocarry  : L('यो बिदाको ढुवानी (Accumulate) छैन','Leave type is not Accumulate (carry forward)'),
      days     : L('अमान्य दिन','Invalid transferred days'),
      curr     : L('अमान्य चालु वर्ष दिन','Invalid Current Year days'),
      dup      : L('यही कर्मचारी र बिदा माथि दोहोरिएको','Duplicate staff + leave in this paste'),
    }[k];
  };
  const th = { textAlign:'left', padding:'6px 10px', fontSize:12, fontWeight:700, color:'#374151', background:'#efefef', borderBottom:'2px solid #dedede', position:'sticky', top:0, whiteSpace:'nowrap' };
  const td = { padding:'5px 10px', fontSize:12.5, borderBottom:'1px solid #f3f4f6', whiteSpace:'nowrap' };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" style={{ maxWidth:860, width:'95%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {L('अघिल्लो वर्ष प्रारम्भिक','Previous Year Opening')}{fyName ? ` (${fyName})` : ''}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
              ✅ {result.added} {L('अपडेट भयो','updated')}
              {result.skipped > 0 && `, ${result.skipped} ${L('स्किप गरियो','skipped')}`}
            </div>
          ) : (
            <>
              <div className="form-group" style={{ marginBottom:10 }}>
                <label className="form-label">{L('एक्सेलबाट पेस्ट गर्नुस्','Paste from Excel')}</label>
                <textarea
                  autoFocus
                  className="form-control"
                  rows={7}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={'Designation<Tab>Person<Tab>Leave<Tab>Transferred (Prev Year)<Tab>Current Year\nManager\tRam Sharma\tHome leave\t12\t30'}
                  style={{ width:'100%', fontFamily:'monospace', fontSize:12.5, resize:'vertical', boxSizing:'border-box' }}
                />
              </div>
              <div style={{ fontSize:12.5, color:'#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${valid.length} ${L('पङ्क्ति फेला परे','rows detected')}${invalidCount ? ` · ${invalidCount} ${L('अमान्य','invalid — double-click the red rows to fix')}` : ''}`
                  : L('कोलम: पद, कर्मचारी, बिदा, हस्तान्तरित, चालु वर्ष (वैकल्पिक)।',
                      'Columns: Designation (Post), Person (Staff), Leave (Leave Name), Transferred (Previous Year Opening, any leave type), Current Year (optional — Current Year Leave Opening). Either value may be left blank. Existing values for the pasted staff + leave are overwritten; everything else is untouched.')}
              </div>
              {error && (
                <div style={{ background:'#fff5f5', border:'1px solid #fecaca', color:'#991b1b', borderRadius:6, padding:'6px 10px', fontSize:12.5, marginBottom:8 }}>
                  ❌ {error}
                </div>
              )}
              {rows.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:300, overflow:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>{L('पद','Designation')}</th>
                        <th style={th}>{L('कर्मचारी','Person')}</th>
                        <th style={th}>{L('बिदा','Leave')}</th>
                        <th style={th}>{L('हालको','Current')}</th>
                        <th style={th}>{L('हस्तान्तरित','Transferred')}</th>
                        <th style={th}>{L('चालु वर्ष','Current Year')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => r.invalid ? (
                        <React.Fragment key={i}>
                          <tr style={{ background:'#fff5f5', color:'#991b1b' }}>
                            {ec(r, 0, r.post || '—', td)}
                            {ec(r, 1, r.person || '—', td)}
                            {ec(r, 2, r.leave || '—', td)}
                            <td style={td}></td>
                            {ec(r, 3, r.cells?.[3] || '—', td)}
                            {ec(r, 4, r.cells?.[4] || '—', td)}
                          </tr>
                          <tr style={{ background:'#fff5f5', color:'#991b1b' }}>
                            <td style={{ ...td, fontSize:11.5, paddingTop:0 }} colSpan={6}>⚠ {reason(r.invalid)} — {L('सच्याउन माथिको कोषमा डबल क्लिक गर्नुस्','double-click a cell above to fix; saved automatically')}</td>
                          </tr>
                        </React.Fragment>
                      ) : (
                        <tr key={i}>
                          {ec(r, 0, r.post, td)}
                          {ec(r, 1, r.empName, { ...td, fontWeight:600 })}
                          {ec(r, 2, <>{r.ltName} <span style={{ color:'#9ca3af' }}>({r.short})</span></>, td)}
                          <td style={{ ...td, color:'#9ca3af' }}>{r.days == null ? '' : r.old}</td>
                          {ec(r, 3, r.days == null ? '—' : r.days, { ...td, fontWeight:700, color:'#92400e' })}
                          {ec(r, 4, r.curr == null ? '—' : <>{r.curr} <span style={{ color:'#9ca3af', fontWeight:400 }}>(was {r.oldCurr})</span></>, { ...td, fontWeight:700, color:'#065f46' })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {result ? (
            <button className="btn btn-primary" onClick={handleClose}>{L('बन्द गर्नुस्','Close')}</button>
          ) : (
            <>
              <button className="btn btn-outline" onClick={handleClose} disabled={importing}>{L('रद्द गर्नुस्','Cancel')}</button>
              <button className="btn btn-primary" disabled={!valid.length || importing} onClick={handleImport}>
                {importing ? `⏳ ${L('आयात हुँदैछ...','Importing...')}` : `${L('आयात गर्नुस्','Import')} ${valid.length > 0 ? `${valid.length} ${L('पङ्क्ति','Rows')}` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrevOpeningBulkImportModal;

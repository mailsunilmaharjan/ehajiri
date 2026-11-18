import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { toAdISO } from '../../utils/bulkDate.js';
import DuplicateStaffPicker from '../Common/DuplicateStaffPicker.jsx';

// Case/whitespace-insensitive, and blind to the invisible characters (zero-width
// spaces, BOM, non-breaking spaces) a copy from Excel or a web page can carry.
const norm = s => String(s ?? '').normalize('NFC').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Some tenants store the Staff ID inside the full name ("Alina Shakya [256]"), which
// is how the grids show it. Names are compared WITHOUT that trailing "[id]" — on both
// the staff side and the pasted side — so "Alina Shakya" and "Alina Shakya [256]"
// both find the same person.
const stripId  = s => String(s ?? '').replace(/\s*\[[^\]]*\]\s*$/, '');
const nameKey  = s => norm(stripId(s));

// "Did you mean…": staff whose name contains every word of what was pasted (or the
// other way round, or shares first + last word), so a missing/extra middle name or
// surname is easy to spot.
const suggest = (list, v) => {
  const t = nameKey(v).split(' ').filter(Boolean);
  if (!t.length) return '';
  return list.filter(e => {
    const n = nameKey(e.fullName).split(' ');
    return t.every(w => n.includes(w)) || n.every(w => t.includes(w))
      || (t.length > 1 && n[0] === t[0] && n[n.length - 1] === t[t.length - 1]);
  }).slice(0, 3).map(e => `${stripId(e.fullName)}${e.employeeId ? ` [${e.employeeId}]` : ''}`).join(', ');
};
const YES = /^(yes|y|true|1|छ|हो)$/i;
const NO  = /^(no|n|false|0|छैन|होइन|)$/i;
const d10 = v => String(v || '').slice(0, 10);

/* Columns (tab-separated, as copied from Excel / the Manual Posting grid):
   Person | From Date | To Date | Days | Leave | Approved By | Approved Date |
   Recommended By | Recommended Date | Half Day?
   Every row is posted exactly like Manual Leave Posting's form does: status
   Approved, Manual. Header row is skipped.
   - Person: full name or Staff ID, among the staff you're allowed to post for.
   - Leave: leave name or short name.
   - Approved By is compulsory (same rule as the form); Recommended By optional.
     Both are matched company-wide by full name or Staff ID.
   - Days blank = counted from the dates like the form (weekend/holiday rules of
     that leave type); Half Day = Yes → 0.5.
   - Dates are read in the app's Default Calendar (BS or AD).
   A row whose staff already has a leave touching those days (existing or earlier
   in the paste) is rejected, like the form. */
const parsePaste = (text, { employees, allEmployees, leaveTypes, existingLeaves, calendar, countDays, today, overrides = {} }) => {
  // scope: 'p' = the staff you post for, 'a' = approvers/recommenders (company-wide).
  // Duplicate names resolve by (1) a trailing "[ID]" in the pasted text, then (2) the
  // Staff ID the user picked in the popup (overrides), else they stay ambiguous.
  const findEmp = (list, v, scope) => {
    const n = nameKey(v);
    if (!n) return { none: true };
    let m = list.filter(e => nameKey(e.fullName) === n || (e.employeeId && norm(e.employeeId) === norm(v)));
    if (m.length > 1) {
      const idm = String(v ?? '').match(/\[([^\]]+)\]\s*$/);
      if (idm) { const byId = m.filter(e => norm(e.employeeId) === norm(idm[1])); if (byId.length === 1) m = byId; }
    }
    if (m.length > 1) {
      const k = scope + '|' + n;
      const pick = m.find(e => String(e.id) === String(overrides[k]));
      if (pick) return { emp: pick };
      return { bad: 'ambiguous', ambig: { k, role: scope, name: stripId(v).trim(), cands: m } };
    }
    return m.length === 1 ? { emp: m[0] } : { bad: 'notfound' };
  };
  const ranges = {};   // empId -> [{from,to}] of rows already accepted in this paste
  (existingLeaves || []).forEach(l => {
    if (l.status === 'rejected') return;
    (ranges[String(l.employeeId)] ||= []).push({ from: d10(l.fromDate), to: d10(l.toDate), type: l.leaveTypeCode });
  });

  const rows = [];
  // li = the line's index in the pasted text, so a cell edited in the preview can be
  // written straight back into that line (the textarea stays the single source of truth).
  text.split('\n').map((l, li) => ({ line: l.replace(/\r$/, ''), li })).filter(x => x.line.trim()).forEach(({ line, li }) => {
    const c = line.split('\t').map(x => x.trim());
    const [person, from, to, daysRaw, leave, apprBy, apprDate, recoBy, recoDate, half] = c;
    if (!person) return;
    if (/^(person|staff)$/i.test(person) && /^from/i.test(from || '')) return; // header row
    const bad = (why, hint, ambig) => rows.push({ person, leave, invalid: why, hint, ambig, li, cells: c });

    const pe = findEmp(employees, person, 'p');
    if (pe.none || pe.bad) return bad(pe.bad === 'ambiguous' ? 'staff-ambiguous' : 'staff', pe.bad === 'notfound' ? suggest(employees, person) : '', pe.ambig);
    const emp = pe.emp;

    const lt = leaveTypes.find(l => norm(l.name) === norm(leave) || norm(l.shortName) === norm(leave));
    if (!lt) return bad('leave');

    const fromDate = toAdISO(from, calendar);
    const toDate   = to ? toAdISO(to, calendar) : fromDate;
    if (!fromDate || !toDate) return bad('date');
    if (toDate < fromDate) return bad('range');

    if (!YES.test(half || '') && !NO.test(half || '')) return bad('half');
    const halfDay = YES.test(half || '');

    // approver (compulsory) / recommender (optional)
    const ap = findEmp(allEmployees, apprBy, 'a');
    if (ap.none) return bad('approver-missing');
    if (ap.bad) return bad(ap.bad === 'ambiguous' ? 'approver-ambiguous' : 'approver', '', ap.ambig);
    let reco = null;
    if (recoBy) {
      const rc = findEmp(allEmployees, recoBy, 'a');
      if (rc.bad) return bad(rc.bad === 'ambiguous' ? 'reco-ambiguous' : 'reco', '', rc.ambig);
      reco = rc.emp;
    }
    const approvedDate = apprDate ? toAdISO(apprDate, calendar) : today;
    const recommendedDate = recoDate ? toAdISO(recoDate, calendar) : null;
    if (!approvedDate || (recoDate && !recommendedDate)) return bad('date');

    // days
    let days;
    let fixedDays = false;   // Days 0 on a single date -> 1 (counted in the preview message)
    if (halfDay) days = 0.5;
    else if (daysRaw !== undefined && daysRaw !== '') {
      // Devanagari digits (२, ०.५) from a Nepali sheet count too
      days = Number(String(daysRaw).replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)));
      if (days === 0 && fromDate === toDate) { days = 1; fixedDays = true; }
      if (!Number.isFinite(days) || days <= 0) return bad('days');
    } else {
      days = countDays(emp, lt, fromDate, toDate);
    }

    // same duplicate / overlap rules as the form
    const key = String(emp.id);
    const clash = (ranges[key] || []).find(r => r.from <= toDate && r.to >= fromDate);
    if (clash) return bad(clash.from === fromDate && clash.to === toDate && clash.type === lt.shortName ? 'dup' : 'overlap');
    (ranges[key] ||= []).push({ from: fromDate, to: toDate, type: lt.shortName });

    rows.push({
      li, cells: c,
      person, leave,
      empId: key, empName: emp.fullName,
      leaveTypeCode: lt.shortName, ltName: lt.name,
      fromDate, toDate, days, halfDay, fixedDays,
      approvedBy: String(ap.emp.id), approvedByName: ap.emp.fullName, approvedDate,
      recommendedBy: reco ? String(reco.id) : null, recommendedByName: reco?.fullName || '', recommendedDate,
    });
  });
  return rows;
};

/* Super-Admin-only bulk posting of leave records (migration) — paste straight
   from Excel instead of posting them one at a time through Manual Posting. */
const LeaveManualBulkImportModal = ({ open, onClose, employees, allEmployees, leaveTypes, existingLeaves, calendar, formatDate, countDays, today, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,      setText]      = useState('');
  const [result,    setResult]    = useState(null);
  const [importing, setImporting] = useState(false);
  const [overrides, setOverrides] = useState({});   // 'p|name' / 'a|name' → chosen staff id
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dupPopup,   setDupPopup]   = useState(null);   // duplicate rows shown in a popup after Import
  const [editing,    setEditing]    = useState(null);   // { li, col } — the preview cell being edited
  const [editVal,    setEditVal]    = useState('');

  // Hooks before the early return (see Settings/BulkImportModal for why).
  const rows = useMemo(
    () => parsePaste(text, { employees: employees || [], allEmployees: allEmployees || [], leaveTypes: leaveTypes || [], existingLeaves, calendar, countDays, today, overrides }),
    [text, employees, allEmployees, leaveTypes, existingLeaves, calendar, countDays, today, overrides]);
  // Unresolved duplicate names (one entry per name + scope) for the popup.
  const ambigItems = useMemo(() => {
    const m = new Map();
    rows.forEach(r => { if (r.ambig && !m.has(r.ambig.k)) m.set(r.ambig.k, r.ambig); });
    return [...m.values()];
  }, [rows]);
  const valid = rows.filter(r => !r.invalid);
  // Duplicate / overlapping rows are not listed on the paste page — they appear in a popup after Import.
  const isDupRow = r => r.invalid === 'dup' || r.invalid === 'overlap';
  const dupRows = rows.filter(isDupRow);
  const shownRows = rows.filter(r => !isDupRow(r));
  const invalidCount = rows.length - valid.length - dupRows.length;
  const fixedCount = valid.filter(r => r.fixedDays).length;   // rows whose Days 0 was set to 1

  if (!open) return null;

  const handleClose = () => { setText(''); setResult(null); setImporting(false); setOverrides({}); setPickerOpen(false); setDupPopup(null); onClose(); };
  const handleImport = async () => {
    if (!valid.length || importing) return;
    setImporting(true);
    const dups = dupRows;
    try { setResult({ ...(await onImport(valid)), fixed: fixedCount }); if (dups.length) setDupPopup(dups); }
    finally { setImporting(false); }
  };

  // Double-click a preview cell to fix it: the new value is written back into that
  // cell of the pasted line, and the whole preview re-validates immediately.
  const commitEdit = () => {
    if (!editing) return;
    const { li, col } = editing;
    const lines = text.split('\n');
    const cells = (lines[li] ?? '').replace(/\r$/, '').split('\t');
    while (cells.length <= col) cells.push('');
    cells[col] = editVal.trim();
    lines[li] = cells.join('\t');
    setText(lines.join('\n'));
    setEditing(null);
  };
  // col = column index in the pasted line (0 Person … 9 Half Day?)
  const ecell = (r, col, content, style, colSpan) => {
    const on = editing && editing.li === r.li && editing.col === col;
    return (
      <td style={{ ...style, cursor:'text' }} colSpan={colSpan} title={L('सम्पादन गर्न डबल क्लिक','Double-click to edit')}
        onDoubleClick={() => { setEditing({ li: r.li, col }); setEditVal(r.cells?.[col] ?? ''); }}>
        {on ? (
          <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') setEditing(null); }}
            style={{ width:'100%', minWidth:80, font:'inherit', padding:'2px 6px', border:'1.5px solid #1a56db', borderRadius:4, outline:'none', background:'#fff', color:'#111827' }} />
        ) : content}
      </td>
    );
  };

  const reason = k => ({
    'staff'           : L('कर्मचारी फेला परेन','Staff not found (in the staff you can post for)'),
    'staff-ambiguous' : L('एउटै नामका धेरै कर्मचारी — Staff ID छान्नुस्','Several staff share this name — choose the Staff ID'),
    'leave'           : L('बिदा प्रकार फेला परेन','Leave type not found'),
    'date'            : L('अमान्य मिति','Invalid date'),
    'range'           : L('अन्त मिति सुरु मितिभन्दा अघि','To Date is before From Date'),
    'half'            : L('Half Day Yes/No मात्र','Half Day must be Yes or No'),
    'approver-missing': L('स्वीकृत गर्ने (Approved By) आवश्यक छ','Approved By is required'),
    'approver-ambiguous': L('Approved By — एउटै नामका धेरै, Staff ID छान्नुस्','Approved By — several staff share this name, choose the ID'),
    'reco-ambiguous'  : L('Recommended By — एउटै नामका धेरै, Staff ID छान्नुस्','Recommended By — several staff share this name, choose the ID'),
    'approver'        : L('Approved By कर्मचारी फेला परेन वा दोहोरो नाम','Approved By not found (or several share that name)'),
    'reco'            : L('Recommended By कर्मचारी फेला परेन वा दोहोरो नाम','Recommended By not found (or several share that name)'),
    'days'            : L('अमान्य दिन','Invalid Days'),
    'dup'             : L('उही बिदा पहिले नै दर्ता छ (दोहोरो)','Duplicate — identical leave already recorded'),
    'overlap'         : L('ती मितिमा अर्को बिदा पहिले नै छ','Another leave already exists on those days'),
  }[k]);
  const th = { textAlign:'left', padding:'6px 10px', fontSize:12, fontWeight:700, color:'#374151', background:'#efefef', borderBottom:'2px solid #dedede', position:'sticky', top:0, whiteSpace:'nowrap' };
  const td = { padding:'5px 10px', fontSize:12.5, borderBottom:'1px solid #f3f4f6', whiteSpace:'nowrap' };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" style={{ maxWidth:1000, width:'96%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {L('बिदा म्यानुअल पोस्टिङ','Leave Manual Posting')}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div>
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
                ✅ {result.added} {L('पोस्ट भयो','posted')}
                {result.failed > 0 && `, ${result.failed} ${L('सेभ हुन सकेन','failed to save')}`}
              </div>
              {result.fixed > 0 && (
                <div style={{ marginTop:8, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 12px', color:'#92400e', fontSize:12.5 }}>
                  ℹ {result.fixed} {L('पङ्क्तिमा दिन 0 थियो (एउटै मिति) — 1 बनाइयो','row(s) had Days = 0 on a single date and were saved as 1 day')}
                </div>
              )}
              {result.notes?.length > 0 && (
                <ul style={{ fontSize:12.5, color:'#991b1b', marginTop:10, paddingLeft:18 }}>
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
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
                  placeholder={'Person<Tab>From Date<Tab>To Date<Tab>Days<Tab>Leave<Tab>Approved By<Tab>Approved Date<Tab>Recommended By<Tab>Recommended Date<Tab>Half Day?\nIshwor Rawal\t2083/04/04\t2083/04/04\t1\tHome leave\tUmesh Pd. Neupane\t2083/04/05\t\t\tNo'}
                  style={{ width:'100%', fontFamily:'monospace', fontSize:12.5, resize:'vertical', boxSizing:'border-box', whiteSpace:'pre' }}
                />
              </div>
              <div style={{ fontSize:12.5, color:'#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${valid.length} ${L('पङ्क्ति फेला परे','rows detected')}${dupRows.length ? ` · ${dupRows.length} ${L('दोहोरो (छोडिने, आयात पछि देखिन्छ)','duplicate (skipped — shown after import)')}` : ''}${invalidCount ? ` · ${invalidCount} ${L('अमान्य','invalid (will be skipped)')}` : ''}`
                  : L(`कोलम: व्यक्ति, मिति देखि, मिति सम्म, दिन, बिदा, स्वीकृत गर्ने, स्वीकृत मिति, सिफारिस गर्ने, सिफारिस मिति, आधा दिन। मिति ${calendar === 'np' ? 'बि.सं.' : 'ई.सं.'} मा।`,
                      `Columns: Person, From Date, To Date, Days, Leave, Approved By, Approved Date, Recommended By, Recommended Date, Half Day?. Dates in ${calendar === 'np' ? 'BS' : 'AD'} (YYYY/MM/DD). Posted as Approved manual entries, exactly like Manual Posting.`)}
              </div>
              {fixedCount > 0 && (
                <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 12px', marginBottom:8, fontSize:12.5, color:'#92400e' }}>
                  ℹ {fixedCount} {L('पङ्क्तिमा दिन 0 थियो (एउटै मिति) — 1 दिन बनाइयो','row(s) had Days = 0 on a single date — converted to 1 day')}
                </div>
              )}
              {ambigItems.length > 0 && (
                <div style={{ display:'flex', alignItems:'center', gap:10, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 12px', marginBottom:8, fontSize:12.5, color:'#92400e' }}>
                  <span>⚠ {ambigItems.length} {L('नाम एकभन्दा बढी कर्मचारीसँग मिल्छ','duplicate name(s) match more than one staff member')}</span>
                  <button className="btn btn-primary" style={{ marginLeft:'auto', height:28, padding:'0 12px', fontSize:12 }} onClick={() => setPickerOpen(true)}>
                    {L('Staff ID छान्नुस्','Assign Staff ID')}
                  </button>
                </div>
              )}
              {shownRows.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:300, overflow:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>{L('व्यक्ति','Person')}</th>
                        <th style={th}>{L('मिति देखि','From')}</th>
                        <th style={th}>{L('मिति सम्म','To')}</th>
                        <th style={th}>{L('दिन','Days')}</th>
                        <th style={th}>{L('बिदा','Leave')}</th>
                        <th style={th}>{L('स्वीकृत गर्ने','Approved By')}</th>
                        <th style={th}>{L('स्वीकृत मिति','Appr. Date')}</th>
                        <th style={th}>{L('सिफारिस गर्ने','Recommended By')}</th>
                        <th style={th}>{L('आधा दिन','Half Day?')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r, i) => r.invalid ? (
                        <React.Fragment key={i}>
                          <tr style={{ background:'#fff5f5', color:'#991b1b' }}>
                            {[0,1,2,3,4,5,6,7,9].map(col => ecell(r, col, r.cells?.[col] || <span style={{ color:'#fca5a5' }}>—</span>, td))}
                          </tr>
                          <tr style={{ background:'#fff5f5', color:'#991b1b' }}>
                            <td style={{ ...td, whiteSpace:'normal', fontSize:12, paddingTop:0 }} colSpan={9}>
                              ⚠ {reason(r.invalid)}{r.hint ? ` — ${L('के यो हो?','did you mean')}: ${r.hint}` : ''}
                              <span style={{ color:'#b45309', marginLeft:8 }}>{L('(सच्याउन सेलमा डबल क्लिक गर्नुस्)','(double-click a cell to fix it)')}</span>
                            </td>
                          </tr>
                        </React.Fragment>
                      ) : (
                        <tr key={i}>
                          {ecell(r, 0, r.empName, { ...td, fontWeight:600 })}
                          {ecell(r, 1, formatDate(r.fromDate), td)}
                          {ecell(r, 2, formatDate(r.toDate), td)}
                          {ecell(r, 3, r.days, { ...td, fontWeight:700, color:'#0369a1' })}
                          {ecell(r, 4, r.ltName, td)}
                          {ecell(r, 5, r.approvedByName, td)}
                          {ecell(r, 6, formatDate(r.approvedDate), td)}
                          {ecell(r, 7, r.recommendedByName || '—', td)}
                          {ecell(r, 9, r.halfDay ? 'Yes' : 'No', td)}
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
                {importing ? `⏳ ${L('पोस्ट हुँदैछ...','Posting...')}` : `${L('आयात गर्नुस्','Import')} ${valid.length > 0 ? `${valid.length} ${L('पङ्क्ति','Rows')}` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
      {dupPopup && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={e => { e.stopPropagation(); setDupPopup(null); }}>
          <div className="modal" style={{ maxWidth: 640, width: '94%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠ {L('दोहोरो प्रविष्टि','Duplicate Entries')} ({dupPopup.length})</h2>
              <button className="modal-close" onClick={() => setDupPopup(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 360, overflow: 'auto' }}>
              <div style={{ fontSize: 12.5, color: '#92400e', marginBottom: 8 }}>{L('यी पङ्क्ति पहिले नै दर्ता भइसकेकाले पोस्ट गरिएन।','These rows were NOT posted — a leave already exists for them.')}</div>
              <ul style={{ fontSize: 12.5, paddingLeft: 18, margin: 0 }}>
                {dupPopup.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{r.cells?.[0]}</strong> · {r.cells?.[1]}{r.cells?.[2] && r.cells[2] !== r.cells[1] ? ` → ${r.cells[2]}` : ''} · {r.cells?.[4]} — <span style={{ color: '#991b1b' }}>{reason(r.invalid)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-footer"><button className="btn btn-primary" onClick={() => setDupPopup(null)}>OK</button></div>
          </div>
        </div>
      )}
      {pickerOpen && (
        <DuplicateStaffPicker
          items={ambigItems}
          onPick={(k, e) => setOverrides(o => ({ ...o, [k]: e.id }))}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
};

export default LeaveManualBulkImportModal;

import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

// English or Nepali (सबै / पुरुष / महिला), plus common spellings.
const GENDERS = {
  all: 'All', 'सबै': 'All',
  male: 'Male', 'पुरुष': 'Male', 'पुरूष': 'Male', 'लोग्ने': 'Male',
  female: 'Female', 'महिला': 'Female', 'स्त्री': 'Female', 'श्रीमती': 'Female',
};
const genderOf = raw => GENDERS[String(raw || 'all').replace(/[​-‍﻿]/g, '').normalize('NFC').trim().toLowerCase()];
const YES = /^(yes|y|true|1|छ|हो)$/i;
const NO  = /^(no|n|false|0|छैन|होइन|)$/i;

/* Columns (tab-separated, as copied from Excel):
   Name | Short Name | Days | Gender | Accumulate | Enable Count Holiday |
   Enable Count Weekend | Enable Balance Remaining | [Max Accumulate Days]
   → Leave Name | Short Name | Days per Year | Leave for Gender | Carry Forward |
     Reduce Public Holiday | Reduce Weekend | Provide Only on Balance.
   Max Accumulate Days is optional; blank = no cap (null, as the app treats it).
   Staff Mode = All, Service Period = No, Auto Accumulate = No. */
const parsePaste = (text) => {
  const rows = [];
  text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).forEach(line => {
    const c = line.split('\t').map(x => x.trim());
    const name = c[0], shortName = c[1];
    if (!name) return;
    if (/^(leave\s*)?name$/i.test(name)) return; // header row
    const bad = (why) => rows.push({ name, shortName, invalid: why });

    if (!shortName) return bad('short');
    const days = Number(c[2]);
    if (c[2] === '' || c[2] === undefined || !Number.isFinite(days) || days < 0) return bad('days');
    const gender = genderOf(c[3]);
    if (!gender) return bad('gender');
    const flags = [c[4], c[5], c[6], c[7]];
    if (flags.some(f => !YES.test(f || '') && !NO.test(f || ''))) return bad('flag');
    const [carryForward, reducePublicHoliday, reduceWeekend, provideOnlyOnBalance] = flags.map(f => YES.test(f || ''));

    let maxAccumulateDays = null;
    if (c[8]) {
      const mx = Number(c[8]);
      if (!Number.isFinite(mx) || mx < 0) return bad('max');
      maxAccumulateDays = mx;
    }
    rows.push({
      name, shortName, daysPerYear: days, genderFor: [gender],
      carryForward, maxAccumulateDays: carryForward ? maxAccumulateDays : null,
      reducePublicHoliday, reduceWeekend, provideOnlyOnBalance,
    });
  });
  return rows;
};

/* Super-Admin-only bulk add for Leave Types — paste from Excel. */
const LeaveTypeBulkImportModal = ({ open, onClose, existing, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,      setText]      = useState('');
  const [result,    setResult]    = useState(null);
  const [importing, setImporting] = useState(false);
  // Carry Forward drives the Previous Year Opening grid and the year-end balance
  // transfer, so a sheet where every row says "Accumulate = Yes" silently turned
  // it on for every leave type. Off by default: rows import with Carry Forward
  // = No unless this box is ticked.
  const [useAccum, setUseAccum] = useState(false);

  // Hooks before the early return (see BulkImportModal for why).
  const parsed = useMemo(() => parsePaste(text), [text]);
  const rows = useMemo(() => parsed.map(r => (r.invalid || useAccum) ? r : { ...r, carryForward: false, maxAccumulateDays: null }), [parsed, useAccum]);
  const valid = rows.filter(r => !r.invalid);
  const invalidCount = rows.length - valid.length;

  if (!open) return null;

  const handleClose = () => { setText(''); setResult(null); setImporting(false); setUseAccum(false); onClose(); };
  const handleImport = async () => {
    if (!valid.length || importing) return;
    setImporting(true);
    try { setResult(await onImport(valid)); }
    finally { setImporting(false); }
  };

  const names  = new Set((existing || []).map(d => String(d.name ?? '').trim().toLowerCase()));
  const shorts = new Set((existing || []).map(d => String(d.shortName ?? '').trim().toLowerCase()));
  const clash = r => names.has(r.name.toLowerCase()) || shorts.has(r.shortName.toLowerCase());
  const reason = k => ({
    short : L('छोटो नाम चाहिन्छ','Short Name is required'),
    days  : L('दिन अमान्य','Invalid Days'),
    gender: L('अमान्य लिङ्ग (All/Male/Female)','Invalid gender (All/Male/Female)'),
    flag  : L('Yes/No मात्र हुनुपर्छ','Yes/No columns must be Yes or No'),
    max   : L('अधिकतम जम्मा दिन अमान्य','Invalid Max Accumulate Days'),
  }[k]);
  const yn = v => v ? 'Yes' : 'No';
  const th = { textAlign:'left', padding:'6px 10px', fontSize:12, fontWeight:700, color:'#374151', background:'#efefef', borderBottom:'2px solid #dedede', position:'sticky', top:0, whiteSpace:'nowrap' };
  const td = { padding:'5px 10px', fontSize:12.5, borderBottom:'1px solid #f3f4f6', whiteSpace:'nowrap' };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" style={{ maxWidth: 900, width: '95%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {L('बिदा प्रकार','Leave Type')}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
              ✅ {result.added} {L('थपियो','added')}
              {result.skipped > 0 && `, ${result.skipped} ${L('स्किप गरियो (नाम वा छोटो नाम पहिले नै अवस्थित)','skipped (name or short name already exists)')}`}
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
                  placeholder={'Name<Tab>Short Name<Tab>Days<Tab>Gender<Tab>Accumulate<Tab>Enable Count Holiday<Tab>Enable Count Weekend<Tab>Enable Balance Remaining\nHome leave\tHL\t19\tAll\tYes\tYes\tYes\tNo'}
                  style={{ width:'100%', fontFamily:'monospace', fontSize:12.5, resize:'vertical', boxSizing:'border-box' }}
                />
              </div>
              <div style={{ fontSize:12.5, color:'#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${valid.length} ${L('पङ्क्ति फेला परे','rows detected')}${invalidCount ? ` · ${invalidCount} ${L('अमान्य','invalid (will be skipped)')}` : ''}`
                  : L('कोलम: नाम, छोटो नाम, दिन, लिङ्ग, ढुवानी, सा.छुट्टी घटाउने, सप्ताहन्त घटाउने, ब्यालेन्समा मात्र।',
                      'Columns: Name, Short Name, Days, Gender, Accumulate (Carry Forward), Enable Count Holiday (Reduce Public Holiday), Enable Count Weekend (Reduce Weekend), Enable Balance Remaining (Provide Only on Balance). Optional 9th column: Max Accumulate Days. Staff Mode = All; Service Period and Auto Accumulate = No.')}
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'#374151', marginBottom:8, cursor:'pointer' }}>
                <input type="checkbox" checked={useAccum} onChange={e => setUseAccum(e.target.checked)} style={{ accentColor:'#1a56db' }} />
                {L('एक्सेलको Accumulate कोलमलाई ढुवानी (Carry Forward) को रूपमा लागू गर्नुस् (नत्र सबै "No" हुन्छ)',
                   'Apply the Accumulate column as Carry Forward (unchecked: every leave imports with Carry Forward = No)')}
              </label>
              {rows.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:280, overflow:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>{L('बिदाको नाम','Leave Name')}</th>
                        <th style={th}>{L('छोटो','Short')}</th>
                        <th style={th}>{L('दिन/वर्ष','Days/Yr')}</th>
                        <th style={th}>{L('लिङ्ग','Gender')}</th>
                        <th style={th}>{L('ढुवानी','Carry Fwd')}</th>
                        <th style={th}>{L('सा.छुट्टी','Red. PH')}</th>
                        <th style={th}>{L('सप्ताहन्त','Red. Wknd')}</th>
                        <th style={th}>{L('ब्यालेन्स मात्र','Bal. Only')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => r.invalid ? (
                        <tr key={i} style={{ background:'#fff5f5', color:'#991b1b' }}>
                          <td style={td}>{r.name}</td>
                          <td style={td} colSpan={7}>{reason(r.invalid)}</td>
                        </tr>
                      ) : (
                        <tr key={i} style={clash(r) ? { opacity:.5 } : undefined}>
                          <td style={{ ...td, fontWeight:600 }}>
                            {r.name}
                            {clash(r) && <span style={{ color:'#9ca3af', fontWeight:400 }}> ({L('पहिले नै छ','exists')})</span>}
                          </td>
                          <td style={td}>{r.shortName}</td>
                          <td style={{ ...td, fontWeight:700, color:'#0369a1' }}>{r.daysPerYear}</td>
                          <td style={td}>{r.genderFor[0]}</td>
                          <td style={td}>{yn(r.carryForward)}</td>
                          <td style={td}>{yn(r.reducePublicHoliday)}</td>
                          <td style={td}>{yn(r.reduceWeekend)}</td>
                          <td style={td}>{yn(r.provideOnlyOnBalance)}</td>
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

export default LeaveTypeBulkImportModal;

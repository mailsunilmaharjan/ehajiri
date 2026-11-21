import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

/* Normalises "6:00", "06:00", "6:00:00", "6.30" → "HH:MM"; null if not a time. */
const toHHMM = (v) => {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
};

/* Grace column is a duration written like a time ("0:00", "0:15") → minutes.
   A bare number ("10") is taken as minutes. */
const graceToMinutes = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/* Same formula as the Add/Edit Shift form (end before start = overnight). */
const calcHours = (start, end) => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return Math.round(diff / 60 * 10) / 10;
};

/* Columns (tab-separated, as copied from Excel):
   Shift Name | Start Time | End Time | Grace Time | Default (Yes/NO)
   A header row (first line whose Start Time isn't a valid time) is ignored. */
const parsePaste = (text) => {
  const rows = [];
  text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).forEach(line => {
    const c = line.split('\t').map(x => x.trim());
    const name = c[0];
    const startTime = toHHMM(c[1]);
    const endTime = toHHMM(c[2]);
    if (!name) return;
    if (!startTime || !endTime) {
      // Header row ("Shift Name  Start Time *  ...") — silently skip; anything else is flagged
      if (/^shift\s*name/i.test(name)) return;
      rows.push({ name, invalid: true, raw: c });
      return;
    }
    const gracePeriodStart = graceToMinutes(c[3]);
    rows.push({
      name, startTime, endTime,
      workHours: calcHours(startTime, endTime),
      gracePeriodStart,
      gracePeriodEnd: 0,
      makeDefault: /^(yes|y|true|1|छ)$/i.test(c[4] || ''),
    });
  });
  return rows;
};

/* Super-Admin-only bulk add for Shifts — paste straight from Excel. Name is
   used for both the Nepali and English name; hours are calculated from the
   start/end times. */
const ShiftBulkImportModal = ({ open, onClose, existingShifts, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,      setText]      = useState('');
  const [result,    setResult]    = useState(null);
  const [importing, setImporting] = useState(false);

  // Hooks before the early return (see BulkImportModal for why).
  const rows = useMemo(() => parsePaste(text), [text]);
  const valid = rows.filter(r => !r.invalid);
  const invalidCount = rows.length - valid.length;

  if (!open) return null;

  const handleClose = () => { setText(''); setResult(null); setImporting(false); onClose(); };
  const handleImport = async () => {
    if (!valid.length || importing) return;
    setImporting(true);
    try { setResult(await onImport(valid)); }
    finally { setImporting(false); }
  };

  const existing = new Set((existingShifts || []).map(s => String(s.name ?? '').trim().toLowerCase()));
  const hasDefault = valid.some(r => r.makeDefault);
  const th = { textAlign: 'left', padding: '6px 10px', fontSize: 12, fontWeight: 700, color: '#374151', background: '#efefef', borderBottom: '2px solid #dedede', position: 'sticky', top: 0 };
  const td = { padding: '5px 10px', fontSize: 12.5, borderBottom: '1px solid #f3f4f6' };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {L('सिफ्ट','Shift')}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div>
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
                ✅ {result.added} {L('थपियो','added')}
                {result.skipped > 0 && `, ${result.skipped} ${L('स्किप गरियो','skipped')}`}
              </div>
              {result.notes?.length > 0 && (
                <ul style={{ fontSize:12.5, color:'#6b7280', marginTop:10, paddingLeft:18 }}>
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">{L('एक्सेलबाट पेस्ट गर्नुस्','Paste from Excel')}</label>
                <textarea
                  autoFocus
                  className="form-control"
                  rows={7}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={'Shift Name<Tab>Start Time<Tab>End Time<Tab>Grace Time<Tab>Default\nShift 1\t6:00\t16:00\t0:00\tYes'}
                  style={{ width:'100%', fontFamily:'monospace', fontSize:12.5, resize:'vertical', boxSizing:'border-box' }}
                />
              </div>
              <div style={{ fontSize:12.5, color:'#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${valid.length} ${L('पङ्क्ति फेला परे','rows detected')}${invalidCount ? ` · ${invalidCount} ${L('अमान्य','invalid (will be skipped)')}` : ''}`
                  : L('कोलम: सिफ्ट नाम, सुरु समय, अन्त समय, ग्रेस समय, डिफल्ट — एक्सेलबाट कपी गरेर पेस्ट गर्नुस्।','Columns: Shift Name, Start Time, End Time, Grace Time, Default — copy from Excel and paste here.')}
              </div>
              {hasDefault && (
                <div style={{ fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'6px 10px', marginBottom:8 }}>
                  ⭐ {L('"Yes" डिफल्ट भएको सिफ्ट पहिले नै डिफल्ट सिफ्ट नभएमा मात्र डिफल्ट बन्छ (र सबै कर्मचारीमा लागू हुन्छ)।',
                       'A shift marked Default = Yes becomes the default (applied to all staff) only if no default shift exists yet.')}
                </div>
              )}
              {rows.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:260, overflow:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>{L('सिफ्ट नाम','Shift Name')}</th>
                        <th style={th}>{L('सुरु','Start')}</th>
                        <th style={th}>{L('अन्त','End')}</th>
                        <th style={th}>{L('घण्टा','Hours')}</th>
                        <th style={th}>{L('ग्रेस','Grace')}</th>
                        <th style={th}>{L('डिफल्ट','Default')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => r.invalid ? (
                        <tr key={i} style={{ background:'#fff5f5', color:'#991b1b' }}>
                          <td style={td}>{r.name}</td>
                          <td style={td} colSpan={5}>{L('अमान्य समय','Invalid start/end time')}</td>
                        </tr>
                      ) : (
                        <tr key={i} style={existing.has(r.name.toLowerCase()) ? { opacity:.5 } : undefined}>
                          <td style={{ ...td, fontWeight:600 }}>
                            {r.name}
                            {existing.has(r.name.toLowerCase()) && <span style={{ color:'#9ca3af', fontWeight:400 }}> ({L('पहिले नै छ','exists')})</span>}
                          </td>
                          <td style={td}>{r.startTime}</td>
                          <td style={td}>{r.endTime}</td>
                          <td style={{ ...td, fontWeight:700, color:'#1a56db' }}>{r.workHours}h</td>
                          <td style={td}>{r.gracePeriodStart}m</td>
                          <td style={td}>{r.makeDefault ? '⭐' : '—'}</td>
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

export default ShiftBulkImportModal;

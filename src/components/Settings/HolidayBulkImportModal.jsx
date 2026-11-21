import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { toAdISO } from '../../utils/bulkDate.js';

const GENDERS = {
  all: 'All', 'सबै': 'All',
  male: 'Male', 'पुरुष': 'Male', 'पुरूष': 'Male',
  female: 'Female', 'महिला': 'Female', 'स्त्री': 'Female',
  other: 'Other', 'अन्य': 'Other',
};

/* Columns (tab-separated, as copied from Excel): Name | From Date | To Date | Gender
   Gender is optional (blank = All). Header row is skipped. All other holiday
   fields (branch, department, religion, handicapped) are set to All. */
const parsePaste = (text, calendar) => {
  const rows = [];
  text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).forEach(line => {
    const c = line.split('\t').map(x => x.trim());
    const name = c[0];
    if (!name) return;
    const startDate = toAdISO(c[1], calendar);
    const endDate = c[2] ? toAdISO(c[2], calendar) : startDate;
    if (!startDate || !endDate) {
      if (/^(holiday\s*)?name$/i.test(name)) return; // header row
      rows.push({ name, invalid: L_INVALID_DATE });
      return;
    }
    if (endDate < startDate) { rows.push({ name, invalid: L_END_BEFORE }); return; }
    const g = GENDERS[String(c[3] || 'all').replace(/[​-‍﻿]/g, '').normalize('NFC').trim().toLowerCase()];
    if (!g) { rows.push({ name, invalid: L_BAD_GENDER }); return; }
    const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    rows.push({ name, startDate, endDate, days, gender: [g] });
  });
  return rows;
};
const L_INVALID_DATE = 'date', L_END_BEFORE = 'range', L_BAD_GENDER = 'gender';

/* Super-Admin-only bulk add for Public Holidays — paste from Excel. */
const HolidayBulkImportModal = ({ open, onClose, existingHolidays, calendar, formatDate, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,      setText]      = useState('');
  const [result,    setResult]    = useState(null);
  const [importing, setImporting] = useState(false);

  // Hooks before the early return (see BulkImportModal for why).
  const rows = useMemo(() => parsePaste(text, calendar), [text, calendar]);
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

  const taken = new Set((existingHolidays || []).map(h => h.startDate));
  const reason = k => k === L_INVALID_DATE ? L('अमान्य मिति','Invalid date')
    : k === L_END_BEFORE ? L('अन्त मिति सुरु मितिभन्दा अघि','To Date is before From Date')
    : L('अमान्य लिङ्ग (All/Male/Female/Other)','Invalid gender (All/Male/Female/Other)');
  const th = { textAlign:'left', padding:'6px 10px', fontSize:12, fontWeight:700, color:'#374151', background:'#efefef', borderBottom:'2px solid #dedede', position:'sticky', top:0 };
  const td = { padding:'5px 10px', fontSize:12.5, borderBottom:'1px solid #f3f4f6' };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {L('सार्वजनिक छुट्टी','Public Holiday')}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div>
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
                ✅ {result.added} {L('थपियो','added')}
                {result.skipped > 0 && `, ${result.skipped} ${L('स्किप गरियो (त्यही मितिमा छुट्टी पहिले नै छ)','skipped (a holiday already exists on that date)')}`}
              </div>
              {result.notes?.length > 0 && (
                <ul style={{ fontSize:12.5, color:'#6b7280', marginTop:10, paddingLeft:18 }}>
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
                  placeholder={'Name<Tab>From Date<Tab>To Date<Tab>Gender\nFagu Purnima\t2083/12/07\t2083/12/07\tAll'}
                  style={{ width:'100%', fontFamily:'monospace', fontSize:12.5, resize:'vertical', boxSizing:'border-box' }}
                />
              </div>
              <div style={{ fontSize:12.5, color:'#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${valid.length} ${L('पङ्क्ति फेला परे','rows detected')}${invalidCount ? ` · ${invalidCount} ${L('अमान्य','invalid (will be skipped)')}` : ''}`
                  : L(`कोलम: नाम, सुरु मिति, अन्त मिति, लिङ्ग — मिति ${calendar === 'np' ? 'बि.सं.' : 'ई.सं.'} मा (YYYY/MM/DD)।`,
                      `Columns: Name, From Date, To Date, Gender — dates in ${calendar === 'np' ? 'BS' : 'AD'} (YYYY/MM/DD). Branch, Department, Religion and Handicapped are set to All.`)}
              </div>
              {rows.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, maxHeight:280, overflow:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>{L('नाम','Name')}</th>
                        <th style={th}>{L('सुरु मिति','From Date')}</th>
                        <th style={th}>{L('अन्त मिति','To Date')}</th>
                        <th style={th}>{L('दिन','Days')}</th>
                        <th style={th}>{L('लिङ्ग','Gender')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => r.invalid ? (
                        <tr key={i} style={{ background:'#fff5f5', color:'#991b1b' }}>
                          <td style={td}>{r.name}</td>
                          <td style={td} colSpan={4}>{reason(r.invalid)}</td>
                        </tr>
                      ) : (
                        <tr key={i} style={taken.has(r.startDate) ? { opacity:.5 } : undefined}>
                          <td style={{ ...td, fontWeight:600 }}>
                            {r.name}
                            {taken.has(r.startDate) && <span style={{ color:'#9ca3af', fontWeight:400 }}> ({L('पहिले नै छ','date taken')})</span>}
                          </td>
                          <td style={td}>{formatDate(r.startDate)}</td>
                          <td style={td}>{formatDate(r.endDate)}</td>
                          <td style={{ ...td, fontWeight:700, color:'#0e9f6e' }}>{r.days}</td>
                          <td style={td}>{r.gender[0]}</td>
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

export default HolidayBulkImportModal;

import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

/* Parses a block of text pasted from Excel: one row per line, columns
   separated by the tab character Excel puts between cells when you copy a
   range and paste it anywhere that accepts plain text. */
const parsePaste = (text, hasShortName, nextRankingOrder) => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map((line, i) => {
    const cols = line.split('\t').map(c => c.trim());
    const row = { name: cols[0] || '' };
    if (hasShortName && cols[1]) row.shortName = cols[1];
    const rankingCol = hasShortName ? cols[2] : cols[1];
    const parsedRank = Number(rankingCol);
    row.rankingOrder = Number.isFinite(parsedRank) && rankingCol ? parsedRank : nextRankingOrder + i;
    return row;
  }).filter(r => r.name);
};

/* Super-Admin-only bulk add for SetupSection lists (Branch/Department/Post/
   Grade) — paste straight from an Excel selection instead of adding one row
   at a time through the normal Add modal. */
const BulkImportModal = ({ open, onClose, title, hasShortName, nextRankingOrder, onImport }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [text,   setText]   = useState('');
  const [result, setResult] = useState(null); // { added, skipped } once imported

  if (!open) return null;

  const rows = useMemo(() => parsePaste(text, hasShortName, nextRankingOrder), [text, hasShortName, nextRankingOrder]);

  const handleClose = () => { setText(''); setResult(null); onClose(); };
  const handleImport = () => {
    if (!rows.length) return;
    setResult(onImport(rows));
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 {L('बल्क आयात','Bulk Import')} — {title}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body">
          {result ? (
            <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
              padding:'12px 14px', color:'#065f46', fontSize:13.5, fontWeight:600 }}>
              ✅ {result.added} {L('थपियो','added')}
              {result.skipped > 0 && `, ${result.skipped} ${L('स्किप गरियो (पहिले नै अवस्थित)','skipped (already exist)')}`}
            </div>
          ) : (
            <>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">
                  {L('एक्सेलबाट पेस्ट गर्नुस्','Paste from Excel')}
                </label>
                <textarea
                  autoFocus
                  className="form-control"
                  rows={10}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={hasShortName
                    ? L('एक हरेक लाइनमा: नाम<Tab>संक्षिप्त नाम', 'One per line: Name<Tab>Short Name (Short Name optional)')
                    : L('एक हरेक लाइनमा नाम','One name per line')}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: rows.length ? 8 : 0 }}>
                {rows.length > 0
                  ? `${rows.length} ${L('पङ्क्ति फेला परे','rows detected')}`
                  : L('एक्सेलबाट सेल छान्नुस्, कपी गर्नुस्, र यहाँ पेस्ट गर्नुस्।','Select cells in Excel, copy, and paste them here.')}
              </div>
              {rows.length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 160, overflowY: 'auto' }}>
                  {rows.slice(0, 5).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10,
                      padding: '6px 12px', fontSize: 12.5, borderBottom: i < Math.min(rows.length, 5) - 1 ? '1px solid #f3f4f6' : 'none' }}>
                      <span style={{ fontWeight: 600, color: '#1f2937' }}>{r.name}</span>
                      <span style={{ color: '#9ca3af' }}>
                        {[r.shortName, `#${r.rankingOrder}`].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                  {rows.length > 5 && (
                    <div style={{ padding: '6px 12px', fontSize: 11.5, color: '#9ca3af', textAlign: 'center' }}>
                      + {rows.length - 5} {L('थप','more')}
                    </div>
                  )}
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
              <button className="btn btn-outline" onClick={handleClose}>{L('रद्द गर्नुस्','Cancel')}</button>
              <button className="btn btn-primary" disabled={!rows.length} onClick={handleImport}>
                {L('आयात गर्नुस्','Import')} {rows.length > 0 ? `${rows.length} ${L('पङ्क्ति','Rows')}` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkImportModal;

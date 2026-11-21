import React from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

/* Popup for bulk imports: when a pasted name matches several staff, let the user
   pick the right one by Staff ID. The pick applies to every row using that name.
   items: [{ k, name, role, cands: [staff…] }]  (k = unique key of name + scope)
   onPick(k, staff) is called on a click; the parent stores it and re-parses, so a
   resolved name drops out of `items` and the popup closes itself when none are left. */
const ROLE_LABEL = {
  p: ['व्यक्ति', 'Person'],
  a: ['स्वीकृत/सिफारिस गर्ने', 'Approved / Recommended By'],
};

export default function DuplicateStaffPicker({ items, onPick, onClose }) {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  if (!items.length) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 3000 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620, width: '94%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 15 }}>👥 {L('एउटै नाम — Staff ID छान्नुस्', 'Same name — choose the Staff ID')}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 10 }}>
            {L('यी नाम एकभन्दा बढी कर्मचारीसँग मिल्छ। सही कर्मचारी छान्नुस् — सो नाम भएका सबै पङ्क्तिमा लागू हुन्छ।',
               'These names match more than one staff member. Pick the right person — your choice applies to every row using that name.')}
            <br />{L('सुझाव: एक्सेलमा नामपछि [ID] राख्नुस्, जस्तै', 'Tip: put the ID after the name in Excel, e.g.')} <b>Alina Shakya [256]</b>
          </div>
          {items.map(it => (
            <div key={it.k} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ background: '#fffbeb', padding: '7px 12px', fontSize: 13, fontWeight: 700, color: '#92400e', borderBottom: '1px solid #fde68a' }}>
                “{it.name}” <span style={{ fontWeight: 500, color: '#b45309', fontSize: 11.5 }}>· {L(...ROLE_LABEL[it.role] || ROLE_LABEL.p)} · {it.cands.length} {L('मिल्दो', 'matches')}</span>
              </div>
              {it.cands.map(e => (
                <button key={e.id} type="button" onClick={() => onPick(it.k, e)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, textAlign: 'left',
                    padding: '8px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = '#eff6ff')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = '#fff')}>
                  <span style={{ minWidth: 62, fontWeight: 800, color: '#1a56db' }}>ID {e.employeeId || e.id}</span>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{String(e.fullName || '').replace(/\s*\[[^\]]*\]\s*$/, '')}</span>
                  <span style={{ color: '#6b7280', marginLeft: 'auto' }}>
                    {[e.position, e.department, e.branch].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{L('पछि गर्छु', 'Later')}</button>
        </div>
      </div>
    </div>
  );
}

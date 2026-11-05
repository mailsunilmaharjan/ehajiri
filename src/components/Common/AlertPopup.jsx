import React from 'react';

/**
 * Small blocking message popup — e.g. "Duplicate, Already saved same data"
 * when the server refuses a Leave / Office Visit save (see
 * server/services/leaveVisitConflicts.js). Renders above any open modal.
 *
 *   alert   { title, msg, detail? } or null (hidden)
 *   onClose called by OK / ✕
 */
const AlertPopup = ({ alert, onClose }) => {
  if (!alert) return null;
  return (
    <div className="modal-overlay" style={{ zIndex: 20000 }} onClick={e => e.stopPropagation()}>
      <div className="modal modal-sm" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ color: '#991b1b' }}>⚠️ {alert.title || 'Not Saved'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px',
            fontSize: 14, fontWeight: 600, color: '#991b1b', lineHeight: 1.7 }}>
            {alert.msg}
          </div>
          {alert.detail && <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>{alert.detail}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
};

/** Builds the popup payload from a rejected save (api client error with .status). */
export const alertFromSaveError = (err, fmtDate = (d) => d) => {
  const c = err?.data?.conflict;
  const detail = c
    ? `${c.type === 'visit' ? 'Office Visit' : ('Leave' + (c.leaveTypeCode ? ` (${c.leaveTypeCode})` : ''))}: ${fmtDate(c.fromDate)}${c.toDate && c.toDate !== c.fromDate ? ' → ' + fmtDate(c.toDate) : ''}`
    : null;
  return { title: err?.status === 409 ? 'Duplicate or Conflicting Entry' : 'Not Saved', msg: err?.message || 'Save failed', detail };
};

export default AlertPopup;

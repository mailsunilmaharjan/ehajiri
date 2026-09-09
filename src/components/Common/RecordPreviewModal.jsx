import React from 'react';
import Avatar from './Avatar.jsx';

/* ═══════════════════════════════════════════════════════════
   RecordPreviewModal — shared "view details" card for Leave /
   Office Visit application previews. Replaces the old plain
   label-over-value grid with a header banner (avatar, name,
   status) plus a softer field-card grid below.

   Props:
     icon, title, id      header line — "{icon} {title} #{id}"
     avatarPhoto, avatarName
     subtitle             small line under the name (e.g. leave type · days)
     statusBadge          node, shown top-right of the header
     fields               [{ icon, label, value }]
     sections             [{ label, value }] — long-text blocks (reason, etc.)
     onClose, closeLabel
════════════════════════════════════════════════════════════ */
const RecordPreviewModal = ({
  icon, title, id, onClose, closeLabel = 'Close',
  avatarPhoto, avatarName, subtitle, statusBadge,
  fields = [], sections = [], actions = null,
}) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal modal-md" onClick={e => e.stopPropagation()} style={{ overflow: 'hidden', padding: 0 }}>
      <div className="modal-header">
        <h2>{icon} {title} #{id}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      {/* Identity strip — plain/light instead of a colored banner, matching
          the rest of the app's minimal modal style (see Add Staff Management). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 22px', borderBottom: '1px solid #eef1f5', background: '#fafbfc',
      }}>
        {avatarName && <Avatar photo={avatarPhoto} name={avatarName} size={40} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{avatarName}</div>
          {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {statusBadge && <div style={{ flexShrink: 0 }}>{statusBadge}</div>}
      </div>

      <div className="modal-body" style={{ padding: '18px 22px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {fields.filter(f => f && f.value !== undefined && f.value !== null && f.value !== '').map((f, i) => (
            <div key={i} style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 10, padding: '8px 12px' }}>
              <div style={{
                fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '.4px', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {f.icon && <span>{f.icon}</span>} {f.label}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1f2937' }}>{f.value}</div>
            </div>
          ))}
        </div>

        {sections.filter(s => s && s.value).map((s, i) => (
          <div key={i} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 11, fontSize: 13, lineHeight: 1.5 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>{closeLabel}</button>
        {actions}
      </div>
    </div>
  </div>
);

export default RecordPreviewModal;

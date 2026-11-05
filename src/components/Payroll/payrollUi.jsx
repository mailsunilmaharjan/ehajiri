import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';

/* Small shared pieces for the Payroll screens (same look as PayrollItems / PayrollTaxSlab). */

export const money = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

/** Calendar-aware date field — Nepali or English per Settings → Default Calendar. Value is always an AD ISO string. */
export const DateInput = ({ value, onChange, error }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDatePicker value={value} onChange={onChange} error={error} />;
  return <EnglishDatePicker value={value} onChange={onChange} error={error} />;
};

export const inputStyle = { height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' };
export const labelStyle = { fontSize: 12, fontWeight: 600, color: '#374151' };

export const Field = ({ label, required, hint, children, style }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
    <label style={labelStyle}>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>
    {children}
    {hint && <span style={{ fontSize: 11, color: '#6b7280' }}>{hint}</span>}
  </div>
);

export const TextIn = (p) => <input {...p} style={{ ...inputStyle, ...(p.style || {}) }} />;
export const SelectIn = ({ children, ...p }) => <select {...p} style={{ ...inputStyle, padding: '0 8px', ...(p.style || {}) }}>{children}</select>;

export const PageHeader = ({ title, back = '/payroll/dashboard', children }) => {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => navigate(back)} title="Back"
          style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>{title}</h1>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
};

export const PrimaryBtn = ({ children, ...p }) => (
  <button {...p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#1a56db', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: p.disabled ? 'default' : 'pointer', opacity: p.disabled ? 0.6 : 1, ...(p.style || {}) }}>{children}</button>
);
export const GhostBtn = ({ children, ...p }) => (
  <button {...p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fff', color: '#374151', border: '1px solid #d1d5db',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: p.disabled ? 'default' : 'pointer', opacity: p.disabled ? 0.6 : 1, ...(p.style || {}) }}>{children}</button>
);

export const Modal = ({ title, onClose, children, footer, wide }) => (
  <div className="modal-overlay">
    <div className="modal" style={wide ? { maxWidth: 860, width: '94vw' } : { maxWidth: 520, width: '94vw' }} onClick={e => e.stopPropagation()}>
      <div className="modal-header"><h2>{title}</h2><button className="modal-close" onClick={onClose}>✕</button></div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 16, flexWrap: 'wrap' }}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)}
        style={{ padding: '9px 16px', border: 'none', background: value === t.key ? '#e0e7f0' : 'transparent', color: value === t.key ? '#1a56db' : '#374151',
          fontWeight: 700, fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0' }}>{t.label}</button>
    ))}
  </div>
);

export const Pill = ({ text, bg, color }) => (
  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: bg, color }}>{text}</span>
);
export const STATUS_PILL = {
  draft: ['#fef9c3', '#854d0e'], approved: ['#dbeafe', '#1e40af'], locked: ['#d1fae5', '#065f46'],
  pending: ['#fef9c3', '#854d0e'], running: ['#dbeafe', '#1e40af'], closed: ['#d1fae5', '#065f46'], rejected: ['#fee2e2', '#991b1b'], cancelled: ['#f3f4f6', '#6b7280'],
  active: ['#d1fae5', '#065f46'],
};
export const StatusPill = ({ status }) => { const [bg, color] = STATUS_PILL[status] || ['#f3f4f6', '#374151']; return <Pill text={status} bg={bg} color={color} />; };

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((msg, type = 'success') => { setToast({ msg, type }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 3500); }, []);
  const node = toast && (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
      background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4', color: toast.type === 'error' ? '#dc2626' : '#065f46',
      border: `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
      {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
    </div>
  );
  return [show, node];
}

/** Today as YYYY-MM-DD in local time. */
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

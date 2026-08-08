import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import api, { apiUrl } from '../../api/client.js';
import AppFooter from '../Layout/AppFooter.jsx';

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ── Update License Modal ───────────────────────────────────────────────────── */
const UpdateLicenseModal = ({ onClose, onSuccess }) => {
  const [keyInput,   setKeyInput]   = useState('');
  const [activating, setActivating] = useState(false);
  const [msg,        setMsg]        = useState(null);

  const activate = async () => {
    if (!keyInput.trim()) { setMsg({ type: 'error', text: 'Please paste the license key.' }); return; }
    setActivating(true); setMsg(null);
    try {
      const res = await api.post('/license/activate', { key: keyInput.trim() });
      setMsg({ type: 'success', text: `✅ ${res.message} — Licensed to: ${res.client}` });
      setKeyInput('');
      setTimeout(() => { onSuccess(); onClose(); }, 1400);
    } catch (e) {
      setMsg({ type: 'error', text: `❌ ${e.message || 'Activation failed'}` });
    } finally { setActivating(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: 'min(520px,100%)',
        boxShadow: '0 20px 60px rgba(0,0,0,.2)', overflow: 'hidden',
        animation: 'fadeUp .2s ease-out' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>🔄 Update License</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            fontSize: 20, cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ padding: '20px 22px' }}>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Paste the license key you received from the License Admin portal.
          </p>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            License Key
          </label>
          <textarea
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            rows={5}
            placeholder="EHAJ-eyJ... paste your license key here"
            style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8,
              padding: '10px 12px', fontSize: 12, fontFamily: 'monospace',
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              color: '#1e40af', letterSpacing: '.3px' }}
            onFocus={e => e.target.style.borderColor = '#1a56db'}
            onBlur={e  => e.target.style.borderColor = '#d1d5db'}
            autoFocus
          />
          {msg && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              background: msg.type === 'success' ? '#f0fdf4' : '#fff5f5',
              border: `1px solid ${msg.type === 'success' ? '#86efac' : '#fca5a5'}`,
              color: msg.type === 'success' ? '#065f46' : '#dc2626' }}>
              {msg.text}
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', background: 'white', border: '1.5px solid #e5e7eb',
              borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={activate} disabled={activating || !keyInput.trim()}
            style={{ padding: '9px 22px',
              background: activating || !keyInput.trim() ? '#93c5fd' : '#1a56db',
              color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: activating || !keyInput.trim() ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px rgba(26,86,219,.25)', transition: 'all .15s' }}>
            {activating ? '⏳ Activating...' : '✅ Activate License'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── License Preview Modal (double-click) ───────────────────────────────────── */
const LicensePreviewModal = ({ row, status, onClose }) => {
  if (!row) return null;

  const daysLeft = status?.expires
    ? Math.max(0, Math.ceil((new Date(status.expires) - new Date()) / 86400000))
    : null;
  const daysColor = daysLeft > 30 ? '#059669' : daysLeft > 7 ? '#d97706' : '#dc2626';

  const Field = ({ label, value, accent }) => (
    <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '10px 0' }}>
      <div style={{ width: 140, fontSize: 12, fontWeight: 600, color: '#9ca3af', flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent || '#1f2937', flex: 1 }}>{value || '—'}</div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: 'min(560px,100%)',
        boxShadow: '0 20px 60px rgba(0,0,0,.2)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(135deg,#1a56db,#7e3af2)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>🔑 License Detail</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.2)', border: 'none',
            borderRadius: 6, padding: '4px 10px', fontSize: 16, cursor: 'pointer', color: 'white' }}>✕</button>
        </div>
        {/* Status banner */}
        <div style={{ background: '#f0fdf4', borderBottom: '1px solid #86efac',
          padding: '10px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 20,
            padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>● ACTIVE</span>
          <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
            Licensed to: <strong>{status?.client}</strong>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 900, color: daysColor }}>
            {daysLeft} <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>days left</span>
          </span>
        </div>
        {/* Fields */}
        <div style={{ padding: '4px 22px 8px' }}>
          <Field label="License ID"   value={status?.licenseId} accent="#6b7280" />
          <Field label="Client"       value={status?.client} />
          <Field label="Email"        value={status?.email}     accent="#1a56db" />
          <Field label="Type"         value={status?.type ? status.type.charAt(0).toUpperCase() + status.type.slice(1) : '—'} accent="#7e3af2" />
          <Field label="Issued Date"  value={fmtDate(status?.issuedAt)} />
          <Field label="Expiry Date"  value={fmtDate(status?.expires)}  accent={daysColor} />
          <Field label="Max Users"    value={status?.maxUsers} />
          <Field label="Max Staff"    value={status?.maxStaff} />
          <Field label="Max Devices"  value={status?.maxDevices} />
          {status?.features?.length > 0 && (
            <div style={{ borderBottom: '1px solid #f3f4f6', padding: '10px 0' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>Features</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {status.features.map(f => (
                  <span key={f} style={{ background: '#eff6ff', color: '#1a56db',
                    borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 22px', background: '#f3f4f6', border: 'none',
              borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Distributor Detail Modal ────────────────────────────────────────────────── */
const DISTRIBUTOR = {
  name    : 'Planet Infosys Pvt. Ltd.',
  address : 'UNpark, Lalitpur, Nepal',
  phone1  : '01-5269837',
  phone2  : '9801135101',
  website : 'http://www.planetinfosys.com.np',
  email   : 'info.planetinfosys@gmail.com',
  role    : 'Software Developer & Distributor',
  product : 'eHajiri TMS — Attendance & Leave Management System',
};

const DistributorModal = ({ onClose }) => (
  <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)',
    zIndex:1050, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
    onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background:'#fff', borderRadius:14, width:'min(480px,100%)',
      boxShadow:'0 20px 60px rgba(0,0,0,.2)', overflow:'hidden',
      animation:'slideUp .2s ease' }}>

      {/* Header */}
      <div style={{ padding:'18px 22px', background:'linear-gradient(135deg,#1a56db,#7e3af2)',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>🏢 {DISTRIBUTOR.name}</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.7)', marginTop:2 }}>{DISTRIBUTOR.role}</div>
        </div>
        <button onClick={onClose}
          style={{ background:'rgba(255,255,255,.2)', border:'none', borderRadius:6,
            padding:'4px 10px', fontSize:16, cursor:'pointer', color:'#fff' }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ padding:'18px 22px' }}>
        {/* Product */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8,
          padding:'10px 14px', marginBottom:16, fontSize:12, color:'#1e40af', fontWeight:600 }}>
          📦 {DISTRIBUTOR.product}
        </div>

        {[
          { icon:'📍', label:'Address', value: DISTRIBUTOR.address },
          { icon:'📞', label:'Phone',   value: `${DISTRIBUTOR.phone1}  |  ${DISTRIBUTOR.phone2}` },
          { icon:'✉️', label:'Email',   value: DISTRIBUTOR.email,   link: `mailto:${DISTRIBUTOR.email}` },
          { icon:'🌐', label:'Website', value: DISTRIBUTOR.website, link: DISTRIBUTOR.website },
        ].map(({ icon, label, value, link }) => (
          <div key={label} style={{ display:'flex', alignItems:'flex-start', gap:12,
            borderBottom:'1px solid #f3f4f6', padding:'10px 0' }}>
            <span style={{ fontSize:16, lineHeight:1.4, flexShrink:0 }}>{icon}</span>
            <div style={{ minWidth:70, fontSize:12, fontWeight:600, color:'#9ca3af', paddingTop:2 }}>{label}</div>
            {link
              ? <a href={link} target="_blank" rel="noreferrer"
                  style={{ fontSize:13, fontWeight:600, color:'#1a56db', textDecoration:'none' }}
                  onMouseEnter={e => e.target.style.textDecoration='underline'}
                  onMouseLeave={e => e.target.style.textDecoration='none'}>
                  {value}
                </a>
              : <span style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{value}</span>
            }
          </div>
        ))}

        {/* Copyright */}
        <div style={{ marginTop:14, textAlign:'center', fontSize:11, color:'#9ca3af' }}>
          © 2026 Planet Infosys Pvt. Ltd. — All rights reserved.
        </div>
      </div>

      <div style={{ padding:'12px 22px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'flex-end' }}>
        <button onClick={onClose}
          style={{ padding:'8px 22px', background:'#f3f4f6', border:'none',
            borderRadius:8, fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
          Close
        </button>
      </div>
    </div>
  </div>
);

/* ── Main Page ───────────────────────────────────────────────────────────────── */
const LicensePage = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [showUpdate,   setShowUpdate]   = useState(false);
  const [previewRow,   setPreviewRow]   = useState(null);
  const [showDistrib,  setShowDistrib]  = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const d = await api.get('/license/status');
      setStatus(d);
    } catch { setStatus({ licensed: false }); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const daysLeft = status?.expires
    ? Math.max(0, Math.ceil((new Date(status.expires) - new Date()) / 86400000))
    : null;

  /* ── DataGrid row ── */
  const gridRow = status?.licensed
    ? [{
        id:       1,
        licenseId: status.licenseId ? status.licenseId.slice(0, 13) + '…' : '—',
        client:    status.client   || '—',
        email:     status.email    || '—',
        type:      status.type     || '—',
        issuedAt:  status.issuedAt || '—',
        expires:   status.expires  || '—',
        daysLeft:  daysLeft,
        maxUsers:  status.maxUsers || '—',
        maxStaff:    status.maxStaff || '—',
        maxDevices:  status.maxDevices || '—',
        status:      'Active',
        distributor: 'Planet Infosys Pvt. Ltd.',
      }]
    : [];

  /* ── Columns — no SN, no Features ── */
  const columns = [
    { field: 'licenseId', header: 'License ID',  width: 140,
      render: v => <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#f3f4f6', padding: '2px 7px', borderRadius: 4 }}>{v}</span> },
    { field: 'client',    header: 'Client',      width: 160,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'email',     header: 'Email',       width: 190,
      render: v => v !== '—' ? <span style={{ color: '#1a56db', fontSize: 12 }}>{v}</span> : <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'type',      header: 'Type',        width: 100,
      render: v => v !== '—'
        ? <span style={{ background: '#eff6ff', color: '#1a56db', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{v}</span>
        : <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'issuedAt',  header: 'Issued Date', width: 110, render: v => fmtDate(v) },
    { field: 'expires',   header: 'Expiry Date', width: 110, render: v => fmtDate(v) },
    { field: 'daysLeft',  header: 'Days Left',   width: 90,
      render: v => {
        if (v === null) return <span style={{ color: '#d1d5db' }}>—</span>;
        const color = v > 30 ? '#059669' : v > 7 ? '#d97706' : '#dc2626';
        return <span style={{ fontWeight: 800, color }}>{v}</span>;
      }},
    { field: 'maxUsers',  header: 'Max Users',   width: 90,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'maxStaff',  header: 'Max Staff',   width: 90,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'maxDevices', header: 'Max Devices', width: 100,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'status',    header: 'Status',      width: 90,
      render: () => (
        <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 20,
          padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>● Active</span>
      )},
    { field: 'distributor', header: 'Distributed by', width: 190, filterable: false, sortable: false,
      render: () => (
        <button
          onClick={e => { e.stopPropagation(); setShowDistrib(true); }}
          style={{ display:'inline-flex', alignItems:'center', gap:6,
            background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:20,
            padding:'3px 12px', fontSize:12, fontWeight:700, color:'#1a56db',
            cursor:'pointer', transition:'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.background='#dbeafe'; e.currentTarget.style.borderColor='#93c5fd'; }}
          onMouseLeave={e => { e.currentTarget.style.background='#eff6ff'; e.currentTarget.style.borderColor='#bfdbfe'; }}>
          🏢 Planet Infosys Pvt. Ltd.
        </button>
      )},
  ];

  /* ── Summary badges ── */
  const badges = status?.licensed
    ? [
        { label: 'Status',    val: 'Active',               bg: '#d1fae5', color: '#065f46' },
        { label: 'Type',      val: status.type || '—',     bg: '#eff6ff', color: '#1e40af' },
        { label: 'Days Left', val: daysLeft ?? '—',
          bg:    daysLeft > 30 ? '#d1fae5' : daysLeft > 7 ? '#fef3c7' : '#fee2e2',
          color: daysLeft > 30 ? '#065f46' : daysLeft > 7 ? '#92400e' : '#991b1b' },
        { label: 'Max Users', val: status.maxUsers || '—', bg: '#ede9fe', color: '#5b21b6' },
        { label: 'Max Staff', val: status.maxStaff || '—', bg: '#e0f2fe', color: '#0369a1' },
        { label: 'Max Devices', val: status.maxDevices || '—', bg: '#fdf4ff', color: '#86198f' },
      ]
    : [];

  return (
    <div className="page-container" style={{ display:'flex', flexDirection:'column', minHeight:'calc(100vh - 60px)' }}>

      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔑 {L('लाइसेन्स व्यवस्थापन', 'License Management')}</h1>
          <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {badges.map(({ label, val, bg, color }) => (
              <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                background: bg, color, borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>
                {label}: <strong style={{ fontSize: 14 }}>{val}</strong>
              </span>
            ))}
            {!loading && !status?.licensed && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#fee2e2', color: '#991b1b', borderRadius: 6, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>
                ⚠️ No Active License
              </span>
            )}
          </div>
        </div>

        {/* Action buttons — top right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href={apiUrl('/downloads/android-apk')}
            title={L('एन्ड्रोइड एपको लागि एपीके फाइल डाउनलोड गर्नुहोस्', 'Download the Android app (.apk)')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '8px 18px', height: 36,
              background: 'linear-gradient(135deg,#3ddc84,#0f9d58)',
              color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,157,88,.35)',
              textDecoration: 'none', transition: 'all .15s' }}>
            🤖 {L('एन्ड्रोइड एप डाउनलोड', 'Download Android App')}
          </a>
          <button
            onClick={() => setShowUpdate(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '8px 18px', height: 36,
              background: 'linear-gradient(135deg,#1a56db,#7e3af2)',
              color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,86,219,.35)',
              transition: 'all .15s' }}>
            🔄 {status?.licensed ? 'Update License' : 'Activate License'}
          </button>
        </div>
      </div>

      {/* ── DataGrid ── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          Loading license info...
        </div>
      ) : (
        <DataGrid
          columns={columns}
          data={gridRow}
          defaultPageSize={10}
          showSearch={false}
          showCheckbox={false}
          showFilterButton={false}
          compact={true}
          rowKey="id"
          onRowDoubleClick={() => gridRow.length && setPreviewRow(gridRow[0])}
        />
      )}

      {/* ── Modals ── */}
      {showUpdate && (
        <UpdateLicenseModal
          onClose={() => setShowUpdate(false)}
          onSuccess={fetchStatus}
        />
      )}
      {previewRow && (
        <LicensePreviewModal
          row={previewRow}
          status={status}
          onClose={() => setPreviewRow(null)}
        />
      )}
      {showDistrib && <DistributorModal onClose={() => setShowDistrib(false)} />}

      <div style={{ flex: 1 }} />
      <AppFooter />

    </div>
  );
};

export default LicensePage;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import { useModalDrag } from '../../hooks/useModalDrag.js';

// ── TOTP helpers ──────────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function genSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out;
}
function b32decode(s) {
  const clean = s.toUpperCase().replace(/=+$/, '');
  const out = []; let bits = 0, val = 0;
  for (const ch of clean) { const idx = B32.indexOf(ch); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return new Uint8Array(out);
}
async function computeTOTP(secret) {
  const step = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8); new DataView(buf).setUint32(4, step >>> 0);
  const key = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = mac[19] & 0xf;
  const code = (((mac[off] & 0x7f) << 24) | ((mac[off+1] & 0xff) << 16) | ((mac[off+2] & 0xff) << 8) | (mac[off+3] & 0xff)) % 1_000_000;
  return String(code).padStart(6, '0');
}

// eg. mail.sunilmaharjan@gmail.com → maixxxxxxxx an@gmail.com
function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 0) return email;
  const local  = email.slice(0, at);
  const domain = email.slice(at);           // includes @
  const head   = local.slice(0, 3);
  const tail   = local.slice(-2);
  return `${head}xxxxxxxx${tail}${domain}`;
}

const EMPTY = { noteName: '', noteType: 'normal', noteDetails: '', usernameTitle: '', username: '', password: '', securityType: 'normal', totpSecret: '', remarks: '', visibility: 'private' };

// ══════════════════════════════════════════════════════════════════════════════
//  Gmail Setup Popup — separate modal on top of the note form
// ══════════════════════════════════════════════════════════════════════════════
const GmailSetupModal = ({ onClose, onSaved }) => {
  const [config,        setConfig]        = useState(null);   // { gmailAccount, isSet }
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [inputGmail,    setInputGmail]    = useState('');
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState('');

  // SuperAdmin unlock flow
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminUser,     setAdminUser]     = useState('');
  const [adminPass,     setAdminPass]     = useState('');
  const [adminErr,      setAdminErr]      = useState('');
  const [adminChecking, setAdminChecking] = useState(false);
  const [unlocked,      setUnlocked]      = useState(false);

  const { overlayProps, modalProps } = useModalDrag(onClose);

  useEffect(() => {
    api.get('/staff-notes/totp-config')
      .then(d => { setConfig(d); setInputGmail(d.gmailAccount || ''); })
      .catch(() => setConfig({ gmailAccount: null, isSet: false }))
      .finally(() => setLoadingConfig(false));
  }, []);

  const saveGmail = async () => {
    if (!inputGmail.trim()) { setErr('Enter your Gmail address'); return; }
    setSaving(true); setErr('');
    try {
      const endpoint = (config?.isSet && unlocked) ? 'put' : 'post';
      const body = endpoint === 'put'
        ? { gmailAccount: inputGmail.trim(), adminUsername: adminUser, adminPassword: adminPass }
        : { gmailAccount: inputGmail.trim() };
      const data = await api[endpoint]('/staff-notes/totp-config', body);
      setConfig(data);
      onSaved(data.gmailAccount);
      onClose();
    } catch (e) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const verifyAdmin = async () => {
    if (!adminUser || !adminPass) { setAdminErr('Enter credentials'); return; }
    setAdminChecking(true); setAdminErr('');
    try {
      // Verify by attempting the PUT with a blank gmailAccount to test creds
      await api.put('/staff-notes/totp-config', { gmailAccount: config.gmailAccount || '', adminUsername: adminUser, adminPassword: adminPass });
      setUnlocked(true); setShowAdminForm(false);
    } catch (e) {
      setAdminErr(e.message || 'Invalid credentials');
    } finally {
      setAdminChecking(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} {...overlayProps}>
      <div className="modal modal-sm" {...modalProps}>
        <div className="modal-header">
          <h2>📧 Gmail for Google Authenticator</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loadingConfig ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>Loading…</div>
          ) : (
            <>
              {/* Already set + locked */}
              {config?.isSet && !unlocked && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 18 }}>✅</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46' }}>Gmail is set</div>
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{maskEmail(config.gmailAccount)}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 18 }}>🔒</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                    This Gmail is locked. SuperAdmin login required to change it.
                  </div>

                  {!showAdminForm ? (
                    <button onClick={() => setShowAdminForm(true)} style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      🔑 Change (SuperAdmin required)
                    </button>
                  ) : (
                    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#9a3412', marginBottom: 10 }}>🔐 SuperAdmin Verification</div>
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label className="form-label">Username</label>
                        <input className="form-control" value={adminUser} placeholder="SuperAdmin username"
                          onChange={e => setAdminUser(e.target.value)} autoFocus />
                      </div>
                      <div className="form-group" style={{ marginBottom: 10 }}>
                        <label className="form-label">Password</label>
                        <input className="form-control" type="password" value={adminPass} placeholder="SuperAdmin password"
                          onChange={e => setAdminPass(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && verifyAdmin()} />
                      </div>
                      {adminErr && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{adminErr}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setShowAdminForm(false); setAdminErr(''); }} style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={verifyAdmin} disabled={adminChecking} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                          {adminChecking ? '…' : 'Verify'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Unlocked for editing */}
              {config?.isSet && unlocked && (
                <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#713f12', marginBottom: 14 }}>
                  🔓 Unlocked by SuperAdmin — you can now change the Gmail
                </div>
              )}

              {/* Input (new or unlocked) */}
              {(!config?.isSet || unlocked) && (
                <div className="form-group">
                  <label className="form-label required">Gmail Account</label>
                  <input className="form-control" type="email" value={inputGmail}
                    placeholder="yourname@gmail.com"
                    onChange={e => setInputGmail(e.target.value)}
                    autoFocus={!config?.isSet} />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                    This appears as the account label in Google Authenticator. Shared across all your encrypted notes.
                  </div>
                </div>
              )}

              {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{err}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
                <button onClick={onClose} style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {config?.isSet && !unlocked ? 'Close' : 'Cancel'}
                </button>
                {(!config?.isSet || unlocked) && (
                  <button onClick={saveGmail} disabled={saving} style={{ background: '#1a56db', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                    {saving ? 'Saving…' : (config?.isSet ? 'Update Gmail' : 'Set Gmail')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
//  Main StaffNotes page
// ══════════════════════════════════════════════════════════════════════════════
const StaffNotes = () => {
  const { t } = useLanguage();
  const { currentUser, isAdmin } = useAuth();

  const [notes,       setNotes]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editRow,     setEditRow]     = useState(null);
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [showPwd,     setShowPwd]     = useState(false);
  const [err,         setErr]         = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  // Gmail config (per-user, shared)
  const [gmailAccount,     setGmailAccount]     = useState('');
  const [showGmailPopup,   setShowGmailPopup]   = useState(false);

  // TOTP live ticker
  const [totpCode, setTotpCode] = useState('');
  const [totpSecs, setTotpSecs] = useState(30);
  const tickRef = useRef(null);

  // QR code
  const [qrDataUrl, setQrDataUrl] = useState('');

  // OTP verify
  const [otpInput,    setOtpInput]    = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpError,    setOtpError]    = useState('');
  const [otpChecking, setOtpChecking] = useState(false);
  const [setupDone,   setSetupDone]   = useState(false);

  const { overlayProps, modalProps } = useModalDrag(() => close());

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try { setLoading(true); setNotes(await api.get('/staff-notes')); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Load saved gmail on mount
  useEffect(() => {
    api.get('/staff-notes/totp-config')
      .then(d => { if (d.gmailAccount) setGmailAccount(d.gmailAccount); })
      .catch(() => {});
  }, []);

  // ── TOTP live ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(tickRef.current);
    if (form.securityType !== 'encrypt' || !form.totpSecret) { setTotpCode(''); return; }
    const tick = async () => {
      setTotpSecs(30 - (Math.floor(Date.now() / 1000) % 30));
      try { setTotpCode(await computeTOTP(form.totpSecret)); } catch {}
    };
    tick(); tickRef.current = setInterval(tick, 1000);
    return () => clearInterval(tickRef.current);
  }, [form.securityType, form.totpSecret]);

  // ── QR code ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (form.securityType !== 'encrypt' || !form.totpSecret) { setQrDataUrl(''); return; }
    const label   = gmailAccount ? encodeURIComponent(gmailAccount) : 'user';
    const otpauth = `otpauth://totp/eHajiri%20TMS:${label}?secret=${form.totpSecret}&issuer=eHajiri%20TMS`;
    QRCode.toDataURL(otpauth, { width: 200, margin: 2, color: { dark: '#111827', light: '#ffffff' } })
      .then(url => setQrDataUrl(url)).catch(() => setQrDataUrl(''));
  }, [form.securityType, form.totpSecret, gmailAccount]);

  // ── Auto-gen secret when Encrypt first selected ────────────────────────────
  useEffect(() => {
    if (form.securityType === 'encrypt' && !form.totpSecret)
      setForm(p => ({ ...p, totpSecret: genSecret() }));
  }, [form.securityType]);

  // ── When Encrypt is selected, show Gmail popup if needed ──────────────────
  const prevSecurityType = useRef('normal');
  useEffect(() => {
    if (form.securityType === 'encrypt' && prevSecurityType.current !== 'encrypt') {
      // Show Gmail popup so user can confirm/set their Gmail
      setShowGmailPopup(true);
    }
    prevSecurityType.current = form.securityType;
  }, [form.securityType]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const resetOtp = () => { setOtpInput(''); setOtpVerified(false); setOtpError(''); };

  const openAdd = () => {
    setEditRow(null); setForm(EMPTY); setShowPwd(false); resetOtp(); setSetupDone(false);
    prevSecurityType.current = 'normal'; setErr(''); setShowModal(true);
  };

  const openEdit = (row) => {
    setEditRow(row);
    setForm({
      noteName:      row.noteName      || '',
      noteType:      row.noteType      || 'normal',
      noteDetails:   row.noteDetails   || '',
      usernameTitle: row.usernameTitle || '',
      username:      row.username      || '',
      password:      row.password      || '',
      securityType:  row.securityType  || 'normal',
      totpSecret:    row.totpSecret    || '',
      remarks:       row.remarks       || '',
      visibility:    row.visibility    || 'private',
    });
    setShowPwd(false); resetOtp();
    // For edit, assume QR was already set up (user has it in their app)
    setSetupDone(row.securityType === 'encrypt' && !!row.totpSecret);
    prevSecurityType.current = row.securityType || 'normal';
    setErr(''); setShowModal(true);
  };

  const close = () => { setShowModal(false); setEditRow(null); };

  const regenerateSecret = () => {
    setForm(p => ({ ...p, totpSecret: genSecret() }));
    resetOtp(); setSetupDone(false);
  };

  const verifyOtp = async () => {
    if (!otpInput || !form.totpSecret) return;
    setOtpChecking(true); setOtpError('');
    try {
      const expected = await computeTOTP(form.totpSecret);
      if (otpInput.replace(/\s/g, '') === expected) {
        setOtpVerified(true); setSetupDone(true); setOtpError('');
      } else {
        setOtpError('❌ Invalid OTP — check Google Authenticator and try again');
      }
    } catch { setOtpError('Verification failed'); }
    finally { setOtpChecking(false); }
  };

  const save = async () => {
    if (!form.noteName.trim()) { setErr('Note Name is required'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        noteName:      form.noteName.trim(),
        noteType:      form.noteType,
        noteDetails:   form.noteType === 'normal'     ? form.noteDetails   : null,
        usernameTitle: form.noteType === 'credential' ? form.usernameTitle : null,
        username:      form.noteType === 'credential' ? form.username      : null,
        password:      form.noteType === 'credential' ? form.password      : null,
        securityType:  form.noteType === 'credential' ? form.securityType  : 'normal',
        totpSecret:    (form.noteType === 'credential' && form.securityType === 'encrypt') ? form.totpSecret : null,
        gmailAccount:  (form.noteType === 'credential' && form.securityType === 'encrypt') ? gmailAccount    : null,
        remarks:       form.remarks,
        visibility:    form.visibility === 'public' ? 'public' : 'private',
      };
      if (editRow) {
        const u = await api.put(`/staff-notes/${editRow.id}`, payload);
        setNotes(p => p.map(n => n.id === editRow.id ? u : n));
      } else {
        const c = await api.post('/staff-notes', payload);
        setNotes(p => [c, ...p]);
      }
      close();
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  // A "public" note is visible to everyone but only its own owner — or an
  // admin/superAdmin — can edit/delete it (enforced server-side too — this
  // just keeps the UI from offering a button that would just 404).
  const isOwner = (row) => isAdmin || !row.userId || String(row.userId) === String(currentUser?.id);

  const del = async (id) => {
    if (!confirm('Delete this note?')) return;
    try { await api.delete(`/staff-notes/${id}`); setNotes(p => p.filter(n => n.id !== id)); }
    catch (e) { alert(e.message); }
  };

  // Bulk delete — called by DataGrid's built-in confirm dialog. Silently
  // skips any selected note that isn't the current user's (a public note of
  // someone else's could otherwise be checked alongside their own).
  const bulkDelete = async (ids) => {
    const byId = new Map(notes.map(n => [n.id, n]));
    const ownedIds = ids.filter(id => isOwner(byId.get(id) || {}));
    try {
      await Promise.all(ownedIds.map(id => api.delete(`/staff-notes/${id}`)));
      setNotes(p => p.filter(n => !ownedIds.includes(n.id)));
      setSelectedIds([]);
      if (ownedIds.length < ids.length) alert(`${ids.length - ownedIds.length} note(s) skipped — you can only delete your own notes.`);
    } catch (e) { alert(e.message); }
  };

  // Encrypt Note shortcut — opens edit modal forced to credential + encrypt
  const encryptNote = (row) => {
    openEdit({
      ...row,
      noteType:     'credential',
      securityType: 'encrypt',
    });
  };

  // ── Grid columns ──────────────────────────────────────────────────────────
  const columns = [
    {
      field: 'noteName', header: 'Note', width: 200,
      render: (v, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{row.noteType === 'credential' ? '🔑' : '📝'}</span>
          <div style={{ minWidth: 0, fontWeight: 600 }}>{v}</div>
        </div>
      ),
    },
    {
      field: 'ownerName', header: 'Posted By', width: 150,
      render: v => v || <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'noteType', header: 'Note Type', width: 170, align: 'center',
      render: v => (
        <span style={{
          padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: v === 'credential' ? '#dbeafe' : '#f0fdf4',
          color:      v === 'credential' ? '#1e40af' : '#065f46',
        }}>
          {v === 'credential' ? '🔑 Username Password' : '📄 Normal'}
        </span>
      ),
    },
    {
      field: 'visibility', header: 'Visibility', width: 110, align: 'center', sortable: false,
      render: v => (
        <span style={{
          padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: v === 'public' ? '#d1fae5' : '#fde8ef',
          color:      v === 'public' ? '#065f46' : '#be185d',
        }}>
          {v === 'public' ? '🌐 Public' : '🔒 Private'}
        </span>
      ),
    },
    {
      field: 'noteDetails', header: 'Note Details', width: 240,
      render: v => {
        if (!v) return <span style={{ color: '#d1d5db' }}>—</span>;
        if (v.length <= 42) return <span>{v}</span>;
        return (
          <HoverCard
            trigger={<span style={{ cursor: 'default' }}>{v.slice(0, 42)}…</span>}
            content={<div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>}
            maxWidth={380}
          />
        );
      },
    },
    {
      field: 'id', header: '', width: 90, sortable: false, filterable: false,
      render: (_, row) => isOwner(row) ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={e => { e.stopPropagation(); openEdit(row); }}
            style={{ background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✏️</button>
          <button onClick={e => { e.stopPropagation(); del(row.id); }}
            style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 5, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>🗑️</button>
        </div>
      ) : null,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📝 My Notes</h1>
      </div>

      <DataGrid
        columns={columns} data={notes} rowKey="id"
        showCheckbox={true}
        searchPlaceholder="Search notes…"
        onRowDoubleClick={(row) => { if (isOwner(row)) openEdit(row); }}
        onSelectionChange={setSelectedIds}
        onDeleteSelected={bulkDelete}
        selectionActions={
          selectedIds.length === 1 && isOwner(notes.find(n => n.id === selectedIds[0]) || {}) && (
            <button
              onClick={() => openEdit(notes.find(n => n.id === selectedIds[0]))}
              style={{ background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ✏️ Edit
            </button>
          )
        }
        contextMenu={[
          { label: '＋ Add New Note',   icon: '➕', onClick: ()    => openAdd() },
          'divider',
          { label: 'Edit Note',          icon: '✏️', onClick: (row) => { if (isOwner(row)) openEdit(row); else alert('You can only edit your own notes.'); } },
          { label: 'Delete Note',        icon: '🗑️', onClick: (row) => { if (isOwner(row)) del(row.id); else alert('You can only delete your own notes.'); }, className: 'danger' },
          'divider',
          { label: '🔐 Encrypt Note',   icon: '🔐', onClick: (row) => { if (isOwner(row)) encryptNote(row); else alert('You can only edit your own notes.'); } },
        ]}
        toolbar={
          <button onClick={openAdd} style={{ background: '#1a56db', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ＋ Add Note
          </button>
        }
      />

      {/* ── Gmail Setup Popup ── */}
      {showGmailPopup && (
        <GmailSetupModal
          onClose={() => setShowGmailPopup(false)}
          onSaved={(gmail) => { setGmailAccount(gmail); setShowGmailPopup(false); }}
        />
      )}

      {/* ── Note Form Modal ── */}
      {showModal && (
        <div className="modal-overlay" {...overlayProps}>
          <div className="modal modal-md" {...modalProps}>

            <div className="modal-header">
              <h2>{editRow ? '✏️ Edit Note' : '＋ Add Note'}</h2>
              <button className="modal-close" onClick={close}>✕</button>
            </div>

            <div className="modal-body">

              {/* Note Name */}
              <div className="form-group">
                <label className="form-label required">Note Name</label>
                <input className="form-control" value={form.noteName} placeholder="Enter note name"
                  onChange={e => set('noteName', e.target.value)} />
              </div>

              {/* Note Type */}
              <div className="form-group">
                <label className="form-label">Note Type</label>
                <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
                  {[['normal', '📄 Normal'], ['credential', '🔑 Username Password']].map(([val, lbl]) => (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                      <input type="radio" name="noteType" value={val} checked={form.noteType === val} onChange={() => set('noteType', val)} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>

              {/* Visibility — private (only you) vs public (every staff member can see
                  it, but only you can still edit/delete it). Defaults to private. */}
              <div className="form-group">
                <label className="form-label">Visibility</label>
                <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                  {[
                    ['private', '🔒 Private', 'Only visible to you', '#be185d', '#fde8ef'],
                    ['public',  '🌐 Public',  'Visible to every staff member', '#065f46', '#d1fae5'],
                  ].map(([val, lbl, hint, color, bg]) => (
                    <button key={val} type="button" onClick={() => set('visibility', val)}
                      style={{
                        flex: 1, textAlign: 'left', padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        border: `2px solid ${form.visibility === val ? color : '#e5e7eb'}`,
                        background: form.visibility === val ? bg : '#fff',
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: form.visibility === val ? color : '#374151' }}>{lbl}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Normal: Note Details */}
              {form.noteType === 'normal' && (
                <div className="form-group">
                  <label className="form-label">Note Details</label>
                  <textarea className="form-control" rows={4} value={form.noteDetails}
                    placeholder="Enter note details…" onChange={e => set('noteDetails', e.target.value)} />
                </div>
              )}

              {/* Credential fields */}
              {form.noteType === 'credential' && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Username Title</label>
                      <input className="form-control" value={form.usernameTitle} placeholder="e.g. Email, Login ID"
                        onChange={e => set('usernameTitle', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Username</label>
                      <input className="form-control" value={form.username} placeholder="Enter username"
                        onChange={e => set('username', e.target.value)} />
                    </div>
                  </div>

                  {/* Security Type */}
                  <div className="form-group">
                    <label className="form-label">Security Type</label>
                    <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
                      {[['normal', '🔓 Normal'], ['encrypt', '🔐 Encrypt']].map(([val, lbl]) => (
                        <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                          <input type="radio" name="securityType" value={val}
                            checked={form.securityType === val}
                            onChange={() => { set('securityType', val); resetOtp(); setSetupDone(false); }} />
                          {lbl}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Normal security */}
                  {form.securityType === 'normal' && (
                    <div className="form-group">
                      <label className="form-label">Password</label>
                      <div style={{ position: 'relative' }}>
                        <input className="form-control" type={showPwd ? 'text' : 'password'}
                          value={form.password} placeholder="Enter password" style={{ paddingRight: 38 }}
                          onChange={e => set('password', e.target.value)} />
                        <button onClick={() => setShowPwd(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#6b7280' }}>
                          {showPwd ? '🙈' : '👁️'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Encrypt: Google Authenticator block */}
                  {form.securityType === 'encrypt' && (
                    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 18, marginBottom: 16 }}>

                      {/* Gmail display (read-only, set via popup) */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>📧 Gmail Account</div>
                          <div style={{ fontSize: 13, color: gmailAccount ? '#111827' : '#9ca3af', fontStyle: gmailAccount ? 'normal' : 'italic' }}>
                            {gmailAccount ? maskEmail(gmailAccount) : 'Not set yet'}
                          </div>
                        </div>
                        <button onClick={() => setShowGmailPopup(true)}
                          style={{ background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {gmailAccount ? '🔒 Manage' : '+ Set Gmail'}
                        </button>
                      </div>

                      {/* First-time QR setup */}
                      {!setupDone && (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', marginBottom: 12 }}>📱 Setup Google Authenticator</div>
                          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 14 }}>
                            <div style={{ background: '#fff', border: '2px solid #bae6fd', borderRadius: 8, padding: 8, flexShrink: 0 }}>
                              {qrDataUrl
                                ? <img src={qrDataUrl} alt="QR Code" width={160} height={160} style={{ display: 'block' }} />
                                : <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>Generating…</div>
                              }
                            </div>
                            <div style={{ flex: 1 }}>
                              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
                                <li>Open Google Authenticator app</li>
                                <li>Tap <strong>＋</strong> → <strong>Scan QR code</strong></li>
                                <li>Scan the QR code on the left</li>
                                <li>Enter the 6-digit code below to verify</li>
                              </ol>
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Manual setup key:</div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <code style={{ fontSize: 11, background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: 4, letterSpacing: 1, flex: 1, wordBreak: 'break-all' }}>{form.totpSecret}</code>
                                  <button onClick={regenerateSecret} style={{ background: '#0369a1', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>🔄 New</button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* OTP verify */}
                          <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 8, padding: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', marginBottom: 8 }}>✅ Enter OTP to verify setup</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input className="form-control"
                                value={otpInput}
                                onChange={e => { setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                                placeholder="6-digit code" maxLength={6}
                                style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 4, textAlign: 'center', maxWidth: 160 }}
                                onKeyDown={e => e.key === 'Enter' && verifyOtp()} />
                              <button onClick={verifyOtp} disabled={otpInput.length !== 6 || otpChecking}
                                style={{ background: otpInput.length === 6 ? '#0369a1' : '#e2e8f0', color: otpInput.length === 6 ? '#fff' : '#94a3b8', border: 'none', borderRadius: 7, padding: '0 18px', fontSize: 13, fontWeight: 600, cursor: otpInput.length === 6 ? 'pointer' : 'default' }}>
                                {otpChecking ? '…' : 'Verify'}
                              </button>
                            </div>
                            {otpError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{otpError}</div>}
                          </div>
                        </>
                      )}

                      {/* After setup: live code + OTP gate for password */}
                      {setupDone && (
                        <>
                          {/* Live ticker */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                            <div>
                              <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 600, marginBottom: 2 }}>Current Code</div>
                              <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 800, letterSpacing: 6, color: totpSecs <= 5 ? '#dc2626' : '#0369a1' }}>
                                {totpCode ? `${totpCode.slice(0,3)} ${totpCode.slice(3)}` : '— — —'}
                              </div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Expires</div>
                              <div style={{ width: 38, height: 38, borderRadius: '50%', background: totpSecs <= 5 ? '#fee2e2' : '#dbeafe', color: totpSecs <= 5 ? '#dc2626' : '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>
                                {totpSecs}s
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✅ Google Authenticator active</div>
                          </div>

                          {/* OTP gate */}
                          {!otpVerified ? (
                            <div style={{ background: '#fff', border: '1px dashed #bae6fd', borderRadius: 8, padding: 14 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 8 }}>🔒 Enter OTP to view / edit password</div>
                              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <input className="form-control"
                                  value={otpInput}
                                  onChange={e => { setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                                  placeholder="6-digit code from Google Authenticator"
                                  maxLength={6}
                                  style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 3, textAlign: 'center' }}
                                  onKeyDown={e => e.key === 'Enter' && verifyOtp()} />
                                <button onClick={verifyOtp} disabled={otpInput.length !== 6 || otpChecking}
                                  style={{ background: otpInput.length === 6 ? '#0369a1' : '#e2e8f0', color: otpInput.length === 6 ? '#fff' : '#94a3b8', border: 'none', borderRadius: 7, padding: '0 18px', fontSize: 13, fontWeight: 600, cursor: otpInput.length === 6 ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                                  {otpChecking ? '…' : 'Unlock'}
                                </button>
                              </div>
                              {otpError && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{otpError}</div>}
                              <div style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 7, background: '#f8fafc', color: '#94a3b8', fontSize: 13, letterSpacing: 4 }}>🔒 •••••••••••••</div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ color: '#059669', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>🔓 OTP verified — password unlocked</div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Password</label>
                                <div style={{ position: 'relative' }}>
                                  <input className="form-control" type={showPwd ? 'text' : 'password'}
                                    value={form.password} placeholder="Enter password" style={{ paddingRight: 38 }}
                                    onChange={e => set('password', e.target.value)} />
                                  <button onClick={() => setShowPwd(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#6b7280' }}>
                                    {showPwd ? '🙈' : '👁️'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Remarks */}
              <div className="form-group">
                <label className="form-label">Remarks</label>
                <input className="form-control" value={form.remarks} placeholder="Optional remarks"
                  onChange={e => set('remarks', e.target.value)} />
              </div>

              {err && <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>{err}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
                <button onClick={close} style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={save} disabled={saving} style={{ background: '#1a56db', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : (editRow ? 'Update' : 'Save')}
                </button>
              </div>

            </div>{/* modal-body */}
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffNotes;

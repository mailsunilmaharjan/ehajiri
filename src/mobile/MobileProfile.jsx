import React, { useRef, useState } from 'react';
import api, { setToken } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import Avatar from '../components/Common/Avatar.jsx';
import { Icon, Sheet, useMT } from './kit.jsx';
import { clearLoginSecret } from '../utils/native.js';

/* My profile on the phone: photo, details, email and password — the same three things the website's Profile page offers. */

// shrink a picked photo to a small JPEG before upload (the server rejects anything over ~300 KB)
const downscale = (file, max = 256) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that picture')); };
  img.src = url;
});

export default function MobileProfile() {
  const mt = useMT();
  const fd = useDateFormat();
  const { currentUser, updateCurrentUser } = useAuth();
  const fileRef = useRef(null);
  const [sheet, setSheet] = useState(null);       // 'email' | 'password' | 'photo'
  const [email, setEmail] = useState(currentUser?.email || '');
  const [pw, setPw] = useState({ old: '', n1: '', n2: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);           // { ok, text } shown on the page
  const [err, setErr] = useState('');

  const flashTimer = useRef(null);
  const flash = (ok, text) => { clearTimeout(flashTimer.current); setMsg({ ok, text }); flashTimer.current = setTimeout(() => setMsg(null), 3500); };
  const close = () => { setSheet(null); setErr(''); setPw({ old: '', n1: '', n2: '' }); };

  const pickPhoto = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return flash(false, 'Please choose a picture');
    setBusy(true);
    try {
      const photo = await downscale(f);
      const { profilePhoto } = await api.put('/auth/profile-photo', { photo });
      updateCurrentUser({ profilePhoto }); flash(true, 'Profile picture updated');
    } catch (x) { flash(false, x.message || 'Could not save the picture'); } finally { setBusy(false); setSheet(null); }
  };
  const removePhoto = async () => {
    setBusy(true);
    try { const { profilePhoto } = await api.put('/auth/profile-photo', { photo: null }); updateCurrentUser({ profilePhoto }); flash(true, 'Picture removed'); }
    catch (x) { flash(false, x.message || 'Failed'); } finally { setBusy(false); setSheet(null); }
  };
  const saveEmail = async () => {
    const v = email.trim().toLowerCase();
    if (!v.includes('@')) return setErr('Enter a valid email address');
    setBusy(true); setErr('');
    try { const r = await api.put('/auth/profile-email', { email: v }); updateCurrentUser({ email: r.email }); flash(true, 'Email updated'); close(); }
    catch (x) { setErr(x.message || 'Could not update the email'); } finally { setBusy(false); }
  };
  const savePw = async () => {
    if (!pw.old) return setErr('Enter your current password');
    if (pw.n1.length < 8) return setErr('New password must be at least 8 characters');
    if (pw.n1 !== pw.n2) return setErr('The new passwords do not match');
    setBusy(true); setErr('');
    try {
      const r = await api.post('/auth/change-password', { oldPassword: pw.old, newPassword: pw.n1 });
      clearLoginSecret();                          // the saved fingerprint sign-in would hold the OLD password
      if (r?.token) setToken(r.token);          // keep this phone signed in (older sessions are signed out)
      flash(true, 'Password changed'); close();
    } catch (x) { setErr(x.message || 'Could not change the password'); } finally { setBusy(false); }
  };

  const u = currentUser || {};
  const rows = [['Employee ID', u.employeeId], ['Department', u.department], ['Branch', u.branch], ['Designation', u.position],
    ['Joined', u.joinDate ? fd(String(u.joinDate).slice(0, 10)) : ''], ['Phone', u.phone], ['Email', u.email]].filter(r => r[1]);

  return (
    <div className="m-page">
      {msg && <div className={msg.ok ? 'm-okbox' : 'm-err'}>{msg.text}</div>}
      <div className="m-card" style={{ textAlign: 'center', paddingTop: 22 }}>
        <button className="m-avatar-edit" onClick={() => setSheet('photo')} aria-label="Change photo">
          <Avatar photo={u.profilePhoto} name={u.fullName} size={96} preview={false} />
          <span className="m-cam"><Icon name="plus" size={16} /></span>
        </button>
        <h2 style={{ margin: '12px 0 2px', fontSize: 20 }}>{u.fullName}</h2>
        <div className="m-muted">{[u.position, u.department].filter(Boolean).join(' · ')}</div>
      </div>

      <div className="m-card m-flat" style={{ padding: '4px 16px' }}>
        {rows.map(([k, v]) => <div key={k} className="m-kv"><span>{k}</span><b style={{ textAlign: 'right', wordBreak: 'break-word' }}>{v}</b></div>)}
      </div>

      <div className="m-card m-flat">
        <button className="m-list-item" onClick={() => { setEmail(u.email || ''); setErr(''); setSheet('email'); }}><span className="m-list-ico"><Icon name="msg" size={20} /></span><span className="m-grow"><b>Change email</b></span><Icon name="chev" size={18} /></button>
        <button className="m-list-item" onClick={() => { setErr(''); setSheet('password'); }}><span className="m-list-ico"><Icon name="user" size={20} /></span><span className="m-grow"><b>Change password</b></span><Icon name="chev" size={18} /></button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />

      {sheet === 'photo' && (
        <Sheet title="Profile picture" onClose={close}>
          <button className="m-btn m-block" disabled={busy} onClick={() => fileRef.current?.click()}>📷 Take or choose a picture</button>
          {u.profilePhoto && <button className="m-btn m-block m-ghost" style={{ marginTop: 10, color: 'var(--m-bad)', borderColor: 'var(--m-bad)' }} disabled={busy} onClick={removePhoto}>Remove picture</button>}
        </Sheet>
      )}
      {sheet === 'email' && (
        <Sheet title="Change email" onClose={close} footer={<><button className="m-btn m-ghost" onClick={close}>{mt('Cancel')}</button><button className="m-btn" disabled={busy} onClick={saveEmail}>{busy ? '…' : 'Save'}</button></>}>
          <div className="m-field"><label>Email</label><input className="m-input" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="m-muted" style={{ fontSize: 12 }}>This is also the email you sign in with.</div>
          {err && <div className="m-err" style={{ marginTop: 10 }}>{err}</div>}
        </Sheet>
      )}
      {sheet === 'password' && (
        <Sheet title="Change password" onClose={close} footer={<><button className="m-btn m-ghost" onClick={close}>{mt('Cancel')}</button><button className="m-btn" disabled={busy} onClick={savePw}>{busy ? '…' : 'Save'}</button></>}>
          <div className="m-field"><label>Current password</label><input className="m-input" type="password" autoComplete="current-password" value={pw.old} onChange={e => setPw(p => ({ ...p, old: e.target.value }))} /></div>
          <div className="m-field"><label>New password (8+ characters)</label><input className="m-input" type="password" autoComplete="new-password" value={pw.n1} onChange={e => setPw(p => ({ ...p, n1: e.target.value }))} /></div>
          <div className="m-field"><label>Repeat new password</label><input className="m-input" type="password" autoComplete="new-password" value={pw.n2} onChange={e => setPw(p => ({ ...p, n2: e.target.value }))} /></div>
          {err && <div className="m-err">{err}</div>}
        </Sheet>
      )}
    </div>
  );
}

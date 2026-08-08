import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import Avatar from './Avatar.jsx';
import api from '../../api/client.js';

/** Downscale a picked image file to a small square-ish JPEG data URL so it
    can ship inline in every list/chat/message payload it appears in. */
const readAndDownscale = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const max = 256;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';           // transparent PNGs → white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image file')); };
  img.src = url;
});

/* ═══════════════════════════════════════════════════════════
   ProfileTab — shared by Settings (admin) and the standalone
   /profile page (every role): own info + change password.
════════════════════════════════════════════════════════════ */
const ProfileTab = ({ currentUser, showToast }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { t } = useLanguage();
  const { updateCurrentUser } = useAuth();

  const [pwForm,   setPwForm]   = useState({ old:'', new1:'', new2:'' });
  const [pwSaving, setPwSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const fileRef = useRef(null);

  const [emailForm,   setEmailForm]   = useState(currentUser?.email || '');
  const [emailSaving, setEmailSaving] = useState(false);
  // Stays in sync if currentUser changes out from under this field (e.g.
  // after a successful save below re-populates it from the server).
  useEffect(() => { setEmailForm(currentUser?.email || ''); }, [currentUser?.email]);
  const emailDirty = emailForm.trim().toLowerCase() !== (currentUser?.email || '').toLowerCase();

  const saveEmail = async () => {
    const next = emailForm.trim().toLowerCase();
    if (!next) return showToast(L('इमेल आवश्यक छ','Email is required'), 'error');
    if (!next.includes('@')) return showToast(L('मान्य इमेल राख्नुहोस्','Enter a valid email address'), 'error');
    setEmailSaving(true);
    try {
      const { email } = await api.put('/auth/profile-email', { email: next });
      updateCurrentUser({ email });
      showToast(L('इमेल परिवर्तन भयो','Email updated'));
    } catch (e) {
      showToast(e.message || L('इमेल सेभ भएन','Failed to update email'), 'error');
    } finally { setEmailSaving(false); }
  };

  const savePhoto = async (photo) => {
    setPhotoSaving(true);
    try {
      const { profilePhoto } = await api.put('/auth/profile-photo', { photo });
      updateCurrentUser({ profilePhoto });
      showToast(photo
        ? L('प्रोफाइल फोटो परिवर्तन भयो','Profile picture updated')
        : L('प्रोफाइल फोटो हटाइयो','Profile picture removed'));
    } catch (e) {
      showToast(e.message || L('फोटो सेभ भएन','Failed to save photo'), 'error');
    } finally { setPhotoSaving(false); }
  };

  const handlePickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                    // same file can be re-picked later
    if (!file) return;
    if (!file.type.startsWith('image/'))
      return showToast(L('कृपया फोटो फाइल छान्नुहोस्','Please choose an image file'), 'error');
    try {
      const dataUrl = await readAndDownscale(file);
      await savePhoto(dataUrl);
    } catch (err) {
      showToast(err.message || L('फोटो पढ्न सकिएन','Could not read that image'), 'error');
    }
  };

  const handleChangePw = async () => {
    if (!pwForm.old)  return showToast(L('पुरानो पासवर्ड आवश्यक छ','Old password is required'), 'error');
    if (!pwForm.new1) return showToast(L('नयाँ पासवर्ड आवश्यक छ','New password is required'), 'error');
    if (pwForm.new1 !== pwForm.new2) return showToast(L('नयाँ पासवर्ड मेल खाएन','New passwords do not match'), 'error');
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', { oldPassword: pwForm.old, newPassword: pwForm.new1 });
      showToast(L('पासवर्ड सफलतापूर्वक परिवर्तन भयो','Password changed successfully'));
      setPwForm({ old:'', new1:'', new2:'' });
    } catch (e) {
      showToast(e.message || L('पासवर्ड परिवर्तन भएन','Password change failed'), 'error');
    } finally { setPwSaving(false); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div className="card">
        <div className="card-header"><h3>👤 {t('Profile')}</h3></div>
        <div className="card-body">
          <div style={{ display:'flex', alignItems:'center', gap:20, marginBottom:24, background:'#f8fafc', borderRadius:12, padding:20 }}>
            {/* Clickable avatar with camera badge — opens the file picker */}
            <div style={{ position:'relative', flexShrink:0 }}>
              <div
                onClick={() => !photoSaving && fileRef.current?.click()}
                title={L('प्रोफाइल फोटो परिवर्तन','Change profile picture')}
                style={{ cursor: photoSaving ? 'wait' : 'pointer', opacity: photoSaving ? 0.6 : 1 }}>
                <Avatar photo={currentUser?.profilePhoto} name={currentUser?.fullName} size={72}
                  style={{ border:'2px solid #dbeafe', boxShadow:'0 2px 8px rgba(26,86,219,.15)' }} />
              </div>
              <button
                onClick={() => !photoSaving && fileRef.current?.click()}
                title={L('प्रोफाइल फोटो परिवर्तन','Change profile picture')}
                style={{ position:'absolute', right:-2, bottom:-2, width:26, height:26,
                  borderRadius:'50%', border:'2px solid #fff', background:'#1a56db', color:'#fff',
                  fontSize:13, display:'flex', alignItems:'center', justifyContent:'center',
                  cursor: photoSaving ? 'wait' : 'pointer', padding:0 }}>
                📷
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handlePickPhoto}
                style={{ display:'none' }} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:20, fontWeight:700, overflowWrap:'break-word' }}>{currentUser?.fullName}</div>
              <div style={{ fontSize:13, color:'#6b7280', overflowWrap:'break-word' }}>{currentUser?.email}</div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>{currentUser?.employeeId} · {currentUser?.department}</div>
              <div style={{ marginTop:6, display:'flex', gap:12 }}>
                <span
                  onClick={() => !photoSaving && fileRef.current?.click()}
                  style={{ fontSize:12, fontWeight:600, color:'#1a56db', cursor:'pointer' }}>
                  {photoSaving ? L('सेभ हुँदैछ…','Saving…') : `📷 ${L('फोटो परिवर्तन','Change Photo')}`}
                </span>
                {currentUser?.profilePhoto && !photoSaving && (
                  <span onClick={() => savePhoto(null)}
                    style={{ fontSize:12, fontWeight:600, color:'#dc2626', cursor:'pointer' }}>
                    🗑 {L('फोटो हटाउनुहोस्','Remove Photo')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {[
              [L('पूरा नाम','Full Name'),    currentUser?.fullName],
              [L('मोबाइल','Mobile'),          currentUser?.phone],
              [L('विभाग','Department'),       currentUser?.department],
              [L('पद','Position'),            currentUser?.position],
              [L('प्रवेश मिति','Join Date'), currentUser?.joinDate],
            ].map(([label, value], i) => (
              <div key={i}>
                <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{label}</div>
                <div style={{ fontSize:14, fontWeight:500, color:'#1f2937', padding:'8px 12px', background:'#f9fafb', borderRadius:6, border:'1px solid #e5e7eb', minHeight:38 }}>
                  {value || <span style={{ color:'#9ca3af' }}>—</span>}
                </div>
              </div>
            ))}

            {/* Email — the only field on this page that's actually editable
                (besides photo/password below); must stay unique across every
                staff member in this company (server enforces it, this is
                just the friendly error). */}
            <div>
              <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{L('इमेल','Email')}</div>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  type="email"
                  className="form-control"
                  style={{ fontSize:14, flex:1, minWidth:0 }}
                  value={emailForm}
                  onChange={e => setEmailForm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && emailDirty && !emailSaving) saveEmail(); }}
                  placeholder={L('इमेल ठेगाना','Email address')}
                />
                <button className="btn btn-primary btn-sm" onClick={saveEmail}
                  disabled={emailSaving || !emailDirty}
                  style={{ flexShrink:0 }}>
                  {emailSaving ? L('सेभ हुँदैछ…','Saving…') : `💾 ${L('सेभ','Save')}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>🔑 {L('पासवर्ड परिवर्तन','Change Password')}</h3></div>
        <div className="card-body">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, maxWidth:720 }}>
            <div>
              <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{L('पुरानो पासवर्ड','Old Password')}</div>
              <input type="password" className="form-control" placeholder="••••••••"
                value={pwForm.old} onChange={e => setPwForm(f => ({ ...f, old: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{L('नयाँ पासवर्ड','New Password')}</div>
              <input type="password" className="form-control" placeholder="••••••••"
                value={pwForm.new1} onChange={e => setPwForm(f => ({ ...f, new1: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{L('नयाँ पासवर्ड पुष्टि','Verify New Password')}</div>
              <input type="password" className="form-control" placeholder="••••••••"
                value={pwForm.new2} onChange={e => setPwForm(f => ({ ...f, new2: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop:16 }}>
            <button className="btn btn-primary" onClick={handleChangePw} disabled={pwSaving}>
              {pwSaving ? L('परिवर्तन हुँदैछ...','Updating...') : `🔑 ${L('पासवर्ड परिवर्तन गर्नुहोस्','Change Password')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileTab;

import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import api from '../../api/client.js';

/* ═══════════════════════════════════════════════════════════
   ProfileTab — shared by Settings (admin) and the standalone
   /profile page (every role): own info + change password.
════════════════════════════════════════════════════════════ */
const ProfileTab = ({ currentUser, showToast }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { t } = useLanguage();

  const [pwForm,   setPwForm]   = useState({ old:'', new1:'', new2:'' });
  const [pwSaving, setPwSaving] = useState(false);

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
            <div style={{ width:72, height:72, borderRadius:'50%', background:'#dbeafe', color:'#1a56db', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, fontWeight:800 }}>{currentUser?.avatar}</div>
            <div>
              <div style={{ fontSize:20, fontWeight:700 }}>{currentUser?.fullName}</div>
              <div style={{ fontSize:13, color:'#6b7280' }}>{currentUser?.email}</div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>{currentUser?.employeeId} · {currentUser?.department}</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {[
              [L('पूरा नाम','Full Name'),    currentUser?.fullName],
              [L('इमेल','Email'),             currentUser?.email],
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

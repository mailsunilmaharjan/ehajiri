import React, { useEffect, useState } from 'react';
import { biometricAvailable, hasLoginSecret, clearLoginSecret, isNative, nativePlugin } from '../utils/native.js';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useMissingAttendanceApply } from '../context/MissingAttendanceApplyContext.jsx';
import Avatar from '../components/Common/Avatar.jsx';
import { Icon, Sheet, useMT } from './kit.jsx';
import { useIsAdmin } from './MobileAdmin.jsx';

/* Profile, language, payslips, help and sign out. */
export default function MobileMore() {
  const mt = useMT();
  const navigate = useNavigate();
  const { currentUser, logout, canView } = useAuth();
  const { language, changeLanguage } = useLanguage();
  const isAdmin = useIsAdmin();
  const [diag, setDiag] = useState(null);
  const probeH = (v) => { const e = document.createElement('div'); e.style.cssText = `position:fixed;left:0;top:0;width:1px;height:${v};visibility:hidden`; document.body.appendChild(e); const h = Math.round(e.getBoundingClientRect().height); e.remove(); return h; };
  const setLayout = (m) => { try { if (m) localStorage.setItem('ehajiri_ios_h', m); else localStorage.removeItem('ehajiri_ios_h'); } catch { /* ignore */ } window.dispatchEvent(new Event('ehajiri:ios-h')); setTimeout(showDiag, 300); };
  const showDiag = () => {
    const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;padding-bottom:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px);visibility:hidden'; document.body.appendChild(probe);
    const cs = getComputedStyle(probe); const sb = cs.paddingBottom, st = cs.paddingTop; probe.remove();
    const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().bottom) : '-'; };
    setDiag([['Home Screen app', String(window.navigator.standalone === true)], ['Page height', window.innerHeight], ['Screen height', window.screen.height], ['Visible height', Math.round(window.visualViewport?.height || 0)], ['Page width', window.innerWidth], ['Screen width', window.screen.width], ['Safe area top', st], ['Safe area bottom', sb], ['App bottom edge', r('.m-app')], ['Tab bar bottom edge', r('.m-tabs')], ['Pixel ratio', window.devicePixelRatio], ['Layout now', (() => { try { return localStorage.getItem('ehajiri_ios_h') || 'standard'; } catch { return 'standard'; } })()], ['100vh', probeH('100vh')], ['100lvh', probeH('100lvh')], ['100dvh', probeH('100dvh')], ['Document height', document.documentElement.clientHeight], ['Scrolled', Math.round(window.scrollY)], ['Viewport top offset', Math.round(window.visualViewport?.offsetTop || 0)]]);
  };
  const { open: openMissing } = useMissingAttendanceApply();
  const [confirm, setConfirm] = useState(false);
  const [ver, setVer] = useState('');
  useEffect(() => { (async () => { try { const i = await nativePlugin('App')?.getInfo?.(); if (i?.version) setVer(`${i.version} (${i.build})`); } catch { /* ignore */ } })(); }, []);
  const [bio, setBio] = useState({ avail: false, on: false, note: '' });
  useEffect(() => { (async () => { const avail = await biometricAvailable(); const on = await hasLoginSecret(); setBio(b => ({ ...b, avail, on })); })(); }, []);
  const toggleBio = async () => {
    if (bio.on) { await clearLoginSecret(); localStorage.removeItem('ehajiri_bio_declined'); setBio(b => ({ ...b, on: false, note: 'Turned off' })); }
    else { localStorage.removeItem('ehajiri_bio_declined'); setBio(b => ({ ...b, note: 'Sign out and sign in again with your password, then choose Enable' })); }
  };

  const Item = ({ icon, label, sub, onClick, danger }) => (
    <button className="m-list-item" onClick={onClick}>
      <span className="m-list-ico" style={danger ? { background: '#fee2e2', color: '#991b1b' } : undefined}><Icon name={icon} size={21} /></span>
      <span className="m-grow"><b style={{ display: 'block', color: danger ? '#991b1b' : undefined }}>{label}</b>{sub && <span className="m-muted">{sub}</span>}</span>
      {!danger && <Icon name="chev" size={18} />}
    </button>
  );

  return (
    <>
      <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar photo={currentUser?.profilePhoto} name={currentUser?.fullName} size={64} preview={false} />
        <div className="m-grow">
          <b style={{ fontSize: 18, display: 'block' }}>{currentUser?.fullName}</b>
          <span className="m-muted" style={{ display: 'block' }}>{[currentUser?.position, currentUser?.department].filter(Boolean).join(' · ')}</span>
          {currentUser?.employeeId && <span className="m-chip" style={{ marginTop: 6 }}>ID {currentUser.employeeId}</span>}
        </div>
      </div>

      <div className="m-card m-flat">
        <Item icon="check" label={mt('Approvals')} sub={mt('Recommend, approve or reject requests')} onClick={() => navigate('/m/approvals')} />
        <Item icon="cal" label={mt('My Attendance')} onClick={() => navigate('/m/attendance')} />
        <Item icon="task" label={mt('Tasks')} onClick={() => navigate('/staff/task')} />
        {isAdmin && <Item icon="briefcase" label={mt('Device Management')} sub={mt('Attendance devices, status and actions')} onClick={() => navigate('/m/devices')} />}
        <Item icon="money" label={mt('My Payslips')} onClick={() => navigate('/payroll/my')} />
        {canView('missingAttendanceApply') && <Item icon="clock" label={mt('Missing punch')} onClick={() => openMissing()} />}
        <Item icon="user" label={mt('Profile')} onClick={() => navigate('/profile')} />
        {bio.avail && <Item icon="finger" label={mt('Fingerprint / face sign-in')} sub={bio.note ? mt(bio.note) : bio.on ? mt('On — tap to turn off') : mt('Off')} onClick={toggleBio} />}
        <Item icon="globe" label={mt('Screen info')} sub={mt('For support — shows your screen sizes')} onClick={showDiag} />
        <Item icon="help" label={mt('Help & Support')} sub="Ask a question or chat with support" onClick={() => window.dispatchEvent(new Event('ehajiri:open-help'))} />
      </div>

      <div className="m-h2">{mt('Language')}</div>
      <div className="m-seg">
        <button className={language === 'en' ? 'on' : ''} onClick={() => changeLanguage('en')}>English</button>
        <button className={language === 'np' ? 'on' : ''} onClick={() => changeLanguage('np')}>नेपाली</button>
      </div>

      <div className="m-card m-flat" style={{ marginTop: 6 }}>
        {isNative() && <Item icon="more" label={mt('Check for app update')} sub={ver ? `${mt('Installed version')} ${ver}` : undefined} onClick={() => window.dispatchEvent(new Event('ehajiri:check-update'))} />}
        <Item icon="out" label={mt('Sign out')} danger onClick={() => setConfirm(true)} />
      </div>
      <div className="m-muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 14 }}>eHajiri · {window.location.hostname}</div>

      {diag && (
        <Sheet title={mt('Screen info')} onClose={() => setDiag(null)}>
          {diag.map(([l, v]) => <div key={l} className="m-kv"><span className="m-muted">{l}</span><b>{String(v)}</b></div>)}
          <div className="m-h2" style={{ marginTop: 14 }}>{mt('Try a layout (iPhone Home Screen app)')}</div>
          <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="m-btn m-xs" onClick={() => setLayout('screen')}>A · Screen height</button>
            <button className="m-btn m-xs" onClick={() => setLayout('vh')}>B · 100vh</button>
            <button className="m-btn m-xs" onClick={() => setLayout('lvh')}>C · 100lvh</button>
            <button className="m-btn m-xs m-bad" onClick={() => setLayout('')}>Reset</button>
          </div>
          <p className="m-muted" style={{ fontSize: 12, marginTop: 10 }}>{mt('Take a screenshot of this and send it to support.')}</p>
        </Sheet>
      )}

      {confirm && (
        <Sheet title={mt('Sign out')} onClose={() => setConfirm(false)}
          footer={<><button className="m-btn m-ghost" onClick={() => setConfirm(false)}>{mt('Cancel')}</button>
            <button className="m-btn m-bad" onClick={() => { try { sessionStorage.setItem('ehajiri_no_autobio', '1'); } catch { /* ignore */ } logout(); navigate('/login'); }}>{mt('Sign out')}</button></>}>
          <p style={{ margin: 0 }}>You will need to sign in again to use eHajiri.</p>
        </Sheet>
      )}
    </>
  );
}

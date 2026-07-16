import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api from '../../api/client.js';
import './Login.css';

/* ── Subscription Expired / Activation screen ─────────────────────────────── */
const SubscriptionExpiredScreen = ({ settings }) => {
  // mode: null (steps view) | 'dealer' (Dealer Name/Username/Password form) | 'key' (paste-license-key form)
  const [mode, setMode] = useState(null);

  const [keyInput,  setKeyInput]  = useState('');
  const [activating, setActivating] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  const [dealerName, setDealerName] = useState('');
  const [dealerUser, setDealerUser] = useState('');
  const [dealerPass, setDealerPass] = useState('');
  const [dealerErrors, setDealerErrors] = useState({});

  const resetAll = () => {
    setMode(null); setMsg(null);
    setKeyInput('');
    setDealerName(''); setDealerUser(''); setDealerPass(''); setDealerErrors({});
  };

  const handleActivate = async () => {
    if (!keyInput.trim()) { setMsg({ type:'error', text:'Please paste the license key.' }); return; }
    setActivating(true); setMsg(null);
    try {
      const res = await api.post('/license/activate', { key: keyInput.trim() });
      setMsg({ type:'success', text: `✅ License activated successfully! Licensed to: ${res.client}` });
      // Reload after 1.5 s so the login form appears
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMsg({ type:'error', text: `❌ ${e.message || 'Activation failed. Check the license key.'}` });
    } finally { setActivating(false); }
  };

  const validateDealerForm = () => {
    const errors = {};
    if (!dealerName.trim()) errors.dealerName = 'Dealer name is required';
    if (!dealerUser.trim()) errors.dealerUser = 'Dealer username is required';
    if (!dealerPass)        errors.dealerPass = 'Dealer password is required';
    setDealerErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleDealerActivate = async () => {
    if (!validateDealerForm()) return;
    setActivating(true); setMsg(null);
    try {
      const res = await api.post('/license/dealer-activate', {
        dealerName : dealerName.trim(),
        username   : dealerUser.trim(),
        password   : dealerPass,
      });
      setMsg({ type:'success', text: `✅ License activated successfully! Licensed to: ${res.client}` });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMsg({ type:'error', text: `❌ ${e.message || 'Activation failed. Check the dealer credentials.'}` });
    } finally { setActivating(false); }
  };

  const fieldStyle = (hasError) => ({
    width:'100%', border:`1.5px solid ${hasError ? '#fca5a5' : '#d1d5db'}`, borderRadius:8,
    padding:'10px 12px', fontSize:13, outline:'none', boxSizing:'border-box', color:'#1f2937',
  });

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-bg-circle c1"></div>
        <div className="login-bg-circle c2"></div>
        <div className="login-bg-circle c3"></div>
      </div>
      <div className="login-card" style={{ flexDirection:'column', alignItems:'center', textAlign:'center', padding:'36px 28px', maxWidth:420, margin:'0 auto' }}>
        {/* Company logo */}
        {settings.companyLogo
          ? <img src={settings.companyLogo} alt="Logo" style={{ height:50, objectFit:'contain', marginBottom:14 }} />
          : null
        }

        {/* Lock icon */}
        <div style={{ width:68, height:68, borderRadius:'50%', background:'#fff5f5',
          border:'3px solid #fca5a5', display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:32, margin:'0 auto 16px' }}>
          🔒
        </div>

        <h2 style={{ fontSize:20, fontWeight:800, color:'#991b1b', marginBottom:8 }}>
          Subscription Expired
        </h2>
        <p style={{ fontSize:14, fontWeight:700, color:'#374151', marginBottom:6, lineHeight:1.5 }}>
          Subscription has been Expired,<br/>Contact to your Distributor
        </p>
        <p style={{ fontSize:12, color:'#9ca3af', marginBottom:20 }}>
          Your eHajiri TMS license is not active or has expired.
        </p>

        {mode === null ? (
          <>
            {/* Steps */}
            <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:10,
              padding:'14px 18px', marginBottom:20, textAlign:'left' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>
                To restore access:
              </div>
              <ol style={{ fontSize:12, color:'#6b7280', paddingLeft:18, lineHeight:2.1, margin:0 }}>
                <li>Contact your <strong>Dealer / Distributor</strong></li>
                <li>Get your Dealer Name, Username and Password</li>
                <li>Click <strong>Activation</strong> below and sign in as a dealer</li>
              </ol>
            </div>

            {/* Activation button */}
            <button
              onClick={() => { setMode('dealer'); setMsg(null); }}
              style={{ width:'100%', padding:'13px', background:'#52b02c', color:'white',
                border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer',
                boxShadow:'0 2px 8px rgba(82,176,44,.3)', display:'flex', alignItems:'center',
                justifyContent:'center', gap:8 }}>
              🔑 Activation
            </button>
          </>
        ) : mode === 'dealer' ? (
          <>
            {/* Dealer activation form */}
            <div style={{ textAlign:'left', marginBottom:8 }}>
              <button onClick={resetAll}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280',
                  fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                ← Back
              </button>
            </div>
            <div style={{ textAlign:'left', marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#1f2937', marginBottom:4 }}>
                🏷️ Dealer Activation
              </div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>
                Sign in with your dealer credentials to activate this installation
              </div>
            </div>

            <div style={{ textAlign:'left', marginBottom:12 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                Dealer Name
              </label>
              <input
                type="text"
                value={dealerName}
                onChange={e => { setDealerName(e.target.value); setDealerErrors(p => ({ ...p, dealerName:null })); }}
                placeholder="e.g. Planet Infosys"
                style={fieldStyle(dealerErrors.dealerName)}
                onFocus={e => e.target.style.borderColor='#52b02c'}
                onBlur={e  => e.target.style.borderColor = dealerErrors.dealerName ? '#fca5a5' : '#d1d5db'}
              />
              {dealerErrors.dealerName && (
                <div style={{ fontSize:11, color:'#dc2626', marginTop:4 }}>{dealerErrors.dealerName}</div>
              )}
            </div>

            <div style={{ textAlign:'left', marginBottom:12 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                Dealer Username
              </label>
              <input
                type="text"
                value={dealerUser}
                onChange={e => { setDealerUser(e.target.value); setDealerErrors(p => ({ ...p, dealerUser:null })); }}
                placeholder="Dealer username"
                style={fieldStyle(dealerErrors.dealerUser)}
                onFocus={e => e.target.style.borderColor='#52b02c'}
                onBlur={e  => e.target.style.borderColor = dealerErrors.dealerUser ? '#fca5a5' : '#d1d5db'}
              />
              {dealerErrors.dealerUser && (
                <div style={{ fontSize:11, color:'#dc2626', marginTop:4 }}>{dealerErrors.dealerUser}</div>
              )}
            </div>

            <div style={{ textAlign:'left', marginBottom:8 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                Dealer Password
              </label>
              <input
                type="password"
                value={dealerPass}
                onChange={e => { setDealerPass(e.target.value); setDealerErrors(p => ({ ...p, dealerPass:null })); }}
                placeholder="Dealer password"
                style={fieldStyle(dealerErrors.dealerPass)}
                onFocus={e => e.target.style.borderColor='#52b02c'}
                onBlur={e  => e.target.style.borderColor = dealerErrors.dealerPass ? '#fca5a5' : '#d1d5db'}
                onKeyDown={e => { if (e.key === 'Enter') handleDealerActivate(); }}
              />
              {dealerErrors.dealerPass && (
                <div style={{ fontSize:11, color:'#dc2626', marginTop:4 }}>{dealerErrors.dealerPass}</div>
              )}
            </div>

            {msg && (
              <div style={{ padding:'9px 12px', borderRadius:8, marginBottom:10, fontSize:12, fontWeight:600,
                textAlign:'left',
                background: msg.type==='success' ? '#f0fdf4' : '#fff5f5',
                border: `1px solid ${msg.type==='success' ? '#86efac' : '#fca5a5'}`,
                color: msg.type==='success' ? '#065f46' : '#dc2626' }}>
                {msg.text}
              </div>
            )}

            <button
              onClick={handleDealerActivate}
              disabled={activating}
              style={{ width:'100%', padding:'13px', border:'none', borderRadius:10,
                background: activating ? '#86efac' : '#52b02c',
                color:'white', fontSize:14, fontWeight:700,
                cursor: activating ? 'not-allowed' : 'pointer',
                boxShadow:'0 2px 8px rgba(82,176,44,.3)', transition:'all .15s', marginBottom:12 }}>
              {activating ? '⏳ Activating...' : '✅ Activate via Dealer'}
            </button>

            <div style={{ textAlign:'center' }}>
              <button
                onClick={() => { setMode('key'); setMsg(null); }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280',
                  fontSize:12, fontWeight:600, textDecoration:'underline' }}>
                Have a license key instead? Paste it here
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Inline paste-license-key form (fallback) */}
            <div style={{ textAlign:'left', marginBottom:8 }}>
              <button onClick={() => { setMode('dealer'); setMsg(null); setKeyInput(''); }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280',
                  fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                ← Back
              </button>
            </div>
            <div style={{ textAlign:'left', marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#1f2937', marginBottom:4 }}>
                🔑 Enter License Key
              </div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>
                Paste the key generated from the License Admin portal
              </div>
            </div>
            <textarea
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              rows={4}
              placeholder="EHAJ-eyJ... paste your license key here"
              style={{ width:'100%', border:'1.5px solid #d1d5db', borderRadius:8,
                padding:'10px 12px', fontSize:11, fontFamily:'monospace', resize:'vertical',
                outline:'none', boxSizing:'border-box', color:'#166534', letterSpacing:'.3px',
                marginBottom:10 }}
              onFocus={e => e.target.style.borderColor='#52b02c'}
              onBlur={e  => e.target.style.borderColor='#d1d5db'}
            />
            {msg && (
              <div style={{ padding:'9px 12px', borderRadius:8, marginBottom:10, fontSize:12, fontWeight:600,
                textAlign:'left',
                background: msg.type==='success' ? '#f0fdf4' : '#fff5f5',
                border: `1px solid ${msg.type==='success' ? '#86efac' : '#fca5a5'}`,
                color: msg.type==='success' ? '#065f46' : '#dc2626' }}>
                {msg.text}
              </div>
            )}
            <button
              onClick={handleActivate}
              disabled={activating || !keyInput.trim()}
              style={{ width:'100%', padding:'13px', border:'none', borderRadius:10,
                background: activating||!keyInput.trim() ? '#86efac' : '#52b02c',
                color:'white', fontSize:14, fontWeight:700,
                cursor: activating||!keyInput.trim() ? 'not-allowed' : 'pointer',
                boxShadow:'0 2px 8px rgba(82,176,44,.3)', transition:'all .15s' }}>
              {activating ? '⏳ Activating...' : '✅ Activate License'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ── License footer bar ────────────────────────────────────────────────────── */
const LicenseFooter = ({ info }) => {
  if (!info) return null;

  const daysLeft = info.expires
    ? Math.max(0, Math.ceil((new Date(info.expires) - new Date()) / 86400000))
    : null;

  const isExpired = daysLeft === 0;
  const isWarning = daysLeft !== null && daysLeft <= 30 && !isExpired;
  const dotColor  = isExpired ? '#f87171' : isWarning ? '#fbbf24' : '#4ade80';

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
             .replace(/ /g, '-');
  };

  const dim  = { fontSize: 11, color: 'rgba(255,255,255,.45)', fontWeight: 500 };
  const bold = { fontSize: 11, color: 'rgba(255,255,255,.80)', fontWeight: 700 };
  const sep  = <span style={{ color: 'rgba(255,255,255,.2)', margin: '0 12px' }}>|</span>;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexWrap: 'wrap', gap: '2px 0',
      padding: '10px 20px',
      zIndex: 50,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor,
        display: 'inline-block', marginRight: 8, flexShrink: 0,
        boxShadow: `0 0 6px ${dotColor}` }} />

      <span style={dim}>Remaining Days :&nbsp;</span>
      <span style={bold}>
        {isExpired ? 'Expired' : daysLeft !== null ? daysLeft : '—'}
      </span>

      {sep}

      <span style={dim}>Valid Date :&nbsp;</span>
      <span style={bold}>{fmtDate(info.expires)}</span>

      {sep}

      <span style={dim}>Distributed by :&nbsp;</span>
      <span style={bold}>{info.client || '—'}</span>
    </div>
  );
};

const ForgotPasswordModal = ({ onClose }) => {
  const [usernameInput, setUsernameInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleLookup = async () => {
    if (!usernameInput.trim()) return;
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: usernameInput.trim() });
      setResult({ sent: true });
    } catch (err) {
      setResult({ error: err.message || 'Failed to process request. Please contact your administrator.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: '28px 28px 24px',
        width: '100%', maxWidth: 380, boxShadow: '0 20px 50px rgba(0,0,0,.35)',
        animation: 'slideUp .25s ease',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>Forgot Password?</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Enter your email address to receive a password reset link</div>
          </div>
          <button onClick={onClose} style={{
            background: '#f3f4f6', border: 'none', borderRadius: '50%',
            width: 30, height: 30, cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280',
          }}>×</button>
        </div>

        {!result ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Email Address</label>
              <input
                type="email"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="Enter your email address"
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13,
                  outline: 'none', transition: 'border .15s',
                }}
                onFocus={e => e.target.style.borderColor = '#52b02c'}
                onBlur={e => e.target.style.borderColor = '#d1d5db'}
              />
            </div>
            <button
              onClick={handleLookup}
              disabled={loading || !usernameInput.trim()}
              style={{
                width: '100%', padding: '11px', border: 'none', borderRadius: 8,
                background: loading || !usernameInput.trim() ? '#86efac' : '#52b02c',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: loading || !usernameInput.trim() ? 'not-allowed' : 'pointer',
              }}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </>
        ) : result.sent ? (
          <div>
            <div style={{
              background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10,
              padding: '16px', marginBottom: 16, textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>
                Reset Link Sent!
              </div>
              <div style={{ fontSize: 12, color: '#374151' }}>
                A password reset link has been sent to your email. Click the link to set a new password. It expires in 1 hour.
              </div>
            </div>
            <button onClick={onClose} style={{
              width: '100%', padding: '10px', border: '1.5px solid #d1d5db',
              borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600,
              color: '#374151', cursor: 'pointer',
            }}>Close</button>
          </div>
        ) : (
          <div>
            <div style={{
              background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 10,
              padding: '14px 16px', marginBottom: 14, fontSize: 13, color: '#991b1b',
            }}>
              {result.error}
            </div>
            <button onClick={() => setResult(null)} style={{
              width: '100%', padding: '10px', border: '1.5px solid #d1d5db',
              borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600,
              color: '#374151', cursor: 'pointer',
            }}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  );
};

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [adContent, setAdContent] = useState(null);
  const [adSlide, setAdSlide] = useState(0);
  const { login, error, licenseError, licenseChecked, currentUser } = useAuth();
  const { t, language, changeLanguage } = useLanguage();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const emailRef = useRef(null);

  useEffect(() => { if (currentUser) navigate('/dashboard'); }, [currentUser]);

  useEffect(() => {
    if (licenseChecked && !licenseError) {
      emailRef.current?.focus();
    }
  }, [licenseChecked, licenseError]);

  useEffect(() => {
    const saved = localStorage.getItem('ehajiri_remember');
    if (saved) {
      try {
        const { username: u, password: p } = JSON.parse(saved);
        setUsername(u); setPassword(p); setRememberMe(true);
      } catch { localStorage.removeItem('ehajiri_remember'); }
    }
  }, []);

  useEffect(() => {
    api.get('/license/status')
      .then(d => setLicenseInfo(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const base = import.meta.env.VITE_LICENSE_ADMIN_URL || 'http://localhost:3000';
    fetch(`${base}/api/settings/advertisement`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAdContent(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const images = adContent?.adImages;
    if (!images || images.length < 2 || adContent?.adSlideAutoplay === false) return;
    const ms = Math.max(2, Number(adContent?.adSlideInterval) || 5) * 1000;
    const id = setInterval(() => setAdSlide(s => (s + 1) % images.length), ms);
    return () => clearInterval(id);
  }, [adContent]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 500));
    const ok = await login(username, password);
    setLoading(false);
    if (ok) {
      if (rememberMe) {
        localStorage.setItem('ehajiri_remember', JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem('ehajiri_remember');
      }
      navigate('/dashboard');
    }
  };

  /* ── Waiting for license check ── */
  if (!licenseChecked) {
    return (
      <div style={{ position: 'fixed', inset: 0,
        background: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#52b02c 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ width: 44, height: 44, border: '4px solid rgba(255,255,255,.2)',
          borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 13, fontWeight: 600 }}>
          Verifying license...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ── Subscription Expired / No License Screen ── */
  if (licenseError) {
    return <SubscriptionExpiredScreen settings={settings} />;
  }

  const companyName    = language === 'np' ? settings.companyNameNp    : settings.companyNameEn;
  const companyAddress = language === 'np' ? settings.companyAddressNp : settings.companyAddressEn;

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-bg-circle c1"></div>
        <div className="login-bg-circle c2"></div>
        <div className="login-bg-circle c3"></div>
      </div>

      <div className="login-card">

        {/* ── Left panel: advertisement (content managed via LicenseAdmin) ── */}
        {adContent?.adImages?.length ? (
          <div className="login-left" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
            {adContent.adImages.map((src, i) => (
              <img key={i} src={src} alt="Advertisement"
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'cover', display: 'block',
                  opacity: i === adSlide ? 1 : 0,
                  transition: 'opacity 0.6s ease',
                }} />
            ))}
            {adContent.adImages.length > 1 && (
              <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6, zIndex: 1 }}>
                {adContent.adImages.map((_, i) => (
                  <span key={i} onClick={() => setAdSlide(i)} style={{
                    width: i === adSlide ? 18 : 7, height: 7, borderRadius: 4, cursor: 'pointer',
                    background: i === adSlide ? '#fff' : 'rgba(255,255,255,.45)',
                    transition: 'all 0.3s ease',
                  }} />
                ))}
              </div>
            )}
          </div>
        ) : (
        <div className="login-left">
          <div className="adv-tagline">
            {adContent?.adTitle || <>Smart <span>Attendance</span><br />Management<br />System</>}
          </div>
          <p className="adv-desc">
            {adContent?.adDescription || 'Streamline your workforce management with real-time attendance tracking, automated reports, and seamless ZKTeco device integration.'}
          </p>

          <div className="adv-features">
            {(adContent?.adFeatures || [
              { icon: '⏱️', title: 'Real-Time Tracking',  desc: 'Live attendance sync with biometric devices' },
              { icon: '📊', title: 'Automated Reports',   desc: 'Daily, monthly & custom payroll-ready exports' },
              { icon: '🏢', title: 'Multi-Department',    desc: 'Manage shifts, leaves & overtime with ease' },
              { icon: '🔒', title: 'Secure & Reliable',   desc: 'Role-based access with full audit trail' },
            ]).map((f, i) => (
              <div className="adv-feature-item" key={i}>
                <div className="adv-feature-icon">{f.icon}</div>
                <div className="adv-feature-text">
                  <strong>{f.title}</strong>
                  <span>{f.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="adv-footer">
            {adContent?.adFooter || 'eHajiri TMS  ·  Trusted by organizations across Nepal'}
          </div>
        </div>
        )}

        {/* ── Right panel: logo + company + form ── */}
        <div className="login-right">

          {/* Brand block */}
          <div className="login-right-brand">
            {settings.companyLogo ? (
              <div className="login-logo-wrap">
                <img src={settings.companyLogo} alt="Company Logo" className="login-logo-img" />
              </div>
            ) : (
              <div className="login-logo">EH</div>
            )}

            <h1 className="login-title">{companyName}</h1>
            {companyAddress && (
              <p className="login-subtitle">{companyAddress}</p>
            )}

            <div className="login-app-badge">
              <span className="badge-name">eHajiri</span>
              <span className="badge-tms">TMS</span>
              <span className="badge-sep">·</span>
              <span className="badge-sub">
                {language === 'np' ? 'हाजिरी व्यवस्थापन' : 'Time Management'}
              </span>
            </div>
          </div>

          {/* Form */}
          <div className="login-right-title">{t('Sign in to your account')}</div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="login-error">
                <span>⚠️</span> {error}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div className="login-input-wrap">
                <span className="login-input-icon">✉️</span>
                <input
                  ref={emailRef}
                  type="email"
                  className="form-control login-input"
                  placeholder="Enter email address"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Password')}</label>
              <div className="login-input-wrap">
                <span className="login-input-icon">🔒</span>
                <input
                  type={showPass ? 'text' : 'password'}
                  className="form-control login-input"
                  placeholder={t('Enter password')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button type="button" className="login-eye" onClick={() => setShowPass(p => !p)}>
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#52b02c', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>Remember Password</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 12, color: '#52b02c', fontWeight: 600, cursor: 'pointer',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                }}>
                Forgot Password?
              </button>
            </div>

            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? (
                <><span className="spinner-sm animate-spin"></span> {t('Please wait...')}</>
              ) : (
                <><span>🔐</span> {t('Login')}</>
              )}
            </button>
          </form>
        </div>

      </div>

      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
      <LicenseFooter info={licenseInfo} />
    </div>
  );
};

export default Login;

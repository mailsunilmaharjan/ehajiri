import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import {
  biometricAvailable, biometricConfirm, clearLoginSecret, currentTenantSlug, forgetCompany, getRememberedCompany,
  loadLoginSecret, rememberCompany, saveLoginSecret,
} from '../utils/native.js';
import { Icon, Sheet, Spinner, useMT } from './kit.jsx';
import './mobile.css';

/* Phone sign-in. Same account system as the website: the shared hub finds your company from your email and
   takes you to it. On top of that this screen (1) remembers the company and username on this phone, (2) can sign in
   with fingerprint / face instead of typing the password, and (3) shows the advertisement banners. */
export default function MobileLogin() {
  const mt = useMT();
  const navigate = useNavigate();
  const { login, error, licenseError, licenseChecked, licenseDistributor, currentUser } = useAuth();
  const { language, changeLanguage } = useLanguage();
  const saved = useRef(getRememberedCompany()).current;            // { sub, nameEn, nameNp, logo, username }
  const [username, setUsername] = useState(saved?.username || '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState(null);
  const [ads, setAds] = useState({ adImages: [] });
  const [slide, setSlide] = useState(0);
  const adX = useRef(null);
  const [bio, setBio] = useState(false);                          // fingerprint/face sign-in is set up and usable
  const [bioMsg, setBioMsg] = useState('');
  const [offer, setOffer] = useState(null);                       // { username, password } waiting for "enable fingerprint?" answer
  const tried = useRef(false);
  const hold = useRef(false);                                  // keep this page open while the 'enable fingerprint?' question is pending

  useEffect(() => { if (currentUser && !offer && !hold.current) navigate('/m/home', { replace: true }); }, [currentUser, offer, navigate]);
  useEffect(() => { api.get('/auth/branding').then(setBrand).catch(() => {}); }, []);
  useEffect(() => { api.get('/auth/advertisement').then(d => { if (d?.adImages?.length) setAds(d); }).catch(() => {}); }, []);
  useEffect(() => {
    const n = ads.adImages.length;
    if (n < 2 || ads.adSlideAutoplay === false) return undefined;
    const id = setInterval(() => setSlide(s => (s + 1) % n), Math.max(2, Number(ads.adSlideInterval) || 4) * 1000);
    return () => clearInterval(id);
  }, [ads]);

  // On the shared hub with a remembered company: go straight to that company's own sign-in page.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (saved?.sub && !currentTenantSlug() && !p.get('et') && !p.get('switch')) window.location.replace(`/t/${saved.sub}/login`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // arriving from the hub's "this account belongs to another company" redirect: prefill the email
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const et = p.get('et');
    if (!et) return;
    p.delete('et');
    window.history.replaceState({}, '', window.location.pathname + (p.toString() ? `?${p}` : ''));
    api.get(`/auth/resolve-redirect-token?t=${encodeURIComponent(et)}`).then(r => { if (r.email) setUsername(r.email); }).catch(() => {});
  }, []);

  const finish = () => navigate('/m/home', { replace: true });

  const doLogin = async (u, pw, fromBio) => {
    setBusy(true);
    const ok = await login(u, pw);
    setBusy(false);
    if (!ok) { if (fromBio) { await clearLoginSecret(); setBio(false); setBioMsg(mt('Your password has changed — please sign in with your password')); } return false; }
    // remember this company + username on the phone (a fresh branding read, now that we know which company it is)
    const sub = currentTenantSlug();
    {
      let b = brand;
      try { b = await api.get('/auth/branding'); } catch { /* keep what we have */ }
      rememberCompany({ sub, nameEn: b?.companyNameEn || '', nameNp: b?.companyNameNp || '', logo: b?.companyLogo && b.companyLogo.length < 200000 ? b.companyLogo : null, username: u, fullName: (() => { try { return JSON.parse(localStorage.getItem('current_user') || '{}').fullName || ''; } catch { return ''; } })() });
    }
    return true;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    const u = username.trim();
    hold.current = true;
    const ok = await doLogin(u, password, false);
    if (!ok) { hold.current = false; return; }
    if (!bio && !localStorage.getItem('ehajiri_bio_declined') && await biometricAvailable()) setOffer({ username: u, password });
    else { hold.current = false; finish(); }
  };

  const bioLogin = async () => {
    setBioMsg('');
    const r = await biometricConfirm('Sign in to eHajiri');
    if (!r.ok) return;                                   // cancelled / not confirmed: stay quietly on the password form
    const c = await loadLoginSecret();
    if (!c) { setBio(false); return; }
    if (await doLogin(c.username, c.password, true)) finish();
  };

  // set up the fingerprint button once we know this phone can do it and credentials were saved
  useEffect(() => {
    (async () => {
      if (!(await biometricAvailable())) return;
      const c = await loadLoginSecret();
      if (!c || (saved?.sub && c.sub && c.sub !== saved.sub)) return;
      setBio(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bio && licenseChecked && !licenseError && !tried.current && !currentUser) {
      tried.current = true;
      // after an explicit "Sign out" don't instantly sign back in: just show the fingerprint button
      let skip = false; try { skip = sessionStorage.getItem('ehajiri_no_autobio') === '1'; sessionStorage.removeItem('ehajiri_no_autobio'); } catch { /* ignore */ }
      if (!skip) bioLogin();
    }
  }, [bio, licenseChecked, licenseError]); // eslint-disable-line react-hooks/exhaustive-deps

  const answerOffer = async (yes) => {
    if (yes) await saveLoginSecret(offer.username, offer.password); else localStorage.setItem('ehajiri_bio_declined', '1');
    hold.current = false; setOffer(null); finish();
  };

  const company = (language === 'np' ? (brand?.companyNameNp || saved?.nameNp) : (brand?.companyNameEn || saved?.nameEn))
    || brand?.companyNameEn || brand?.companyNameNp || saved?.nameEn || saved?.nameNp || '';
  const logo = brand?.companyLogo || saved?.logo;
  const imgs = ads.adImages;

  return (
    <div className="m-app m-login-root" style={{ background: 'none' }}>
      <div className="m-login">
        {imgs.length > 0 && (
          <div className="m-ads" aria-label="Advertisement"
            onPointerDown={e => { adX.current = e.clientX; }}
            onPointerUp={e => {
              const x0 = adX.current; adX.current = null;
              if (x0 == null || imgs.length < 2) return;
              const dx = e.clientX - x0; const n = imgs.length;
              if (Math.abs(dx) > 40) setSlide(s => (s + (dx < 0 ? 1 : n - 1)) % n);          // swipe left = next, right = previous
              else { const r = e.currentTarget.getBoundingClientRect(); setSlide(s => (s + (e.clientX - r.left < r.width / 2 ? n - 1 : 1)) % n); } // tap left half = previous, right half = next
            }}
            onPointerCancel={() => { adX.current = null; }}>
            {imgs.map((src, i) => <img key={i} src={src} alt="" draggable={false} className={i === slide ? 'on' : ''} />)}
          </div>
        )}

        {imgs.length === 0 && (
          <div className="m-login-top">
            <div className="m-login-logo">{logo ? <img src={logo} alt="" /> : 'EH'}</div>
            <h1>{company || 'eHajiri'}</h1>
            <p className="m-tag">{mt('Your office, in your pocket')}</p>
          </div>
        )}

        {!licenseChecked ? (
          <div className="m-login-card" style={{ textAlign: 'center' }}><Spinner dark /><p className="m-muted" style={{ margin: '10px 0 0' }}>Checking…</p></div>
        ) : licenseError ? (
          <div className="m-login-card">
            <h2>Subscription expired</h2>
            <p className="m-muted">Please contact your distributor to renew.</p>
            {licenseDistributor?.distributorName && <p><b>{licenseDistributor.distributorName}</b>{licenseDistributor.distributorPhone ? <><br />📞 {licenseDistributor.distributorPhone}</> : null}</p>}
          </div>
        ) : (
          <form className="m-login-card" onSubmit={submit}>
            <div className="m-welcome">
              <span className="m-wav">{String(saved?.fullName || saved?.username || 'e').trim().charAt(0).toUpperCase()}</span>
              <h2 className="m-ell">{mt('Welcome')}{(saved?.fullName || saved?.username) ? `, ${saved.fullName || saved.username.split('@')[0]}` : ''}</h2>
              <div className="m-lang" role="group" aria-label="Language">
                <button type="button" className={language === 'en' ? 'on' : ''} onClick={() => changeLanguage('en')}>Eng</button>
                <button type="button" className={language === 'np' ? 'on' : ''} onClick={() => changeLanguage('np')}>नेपाली</button>
              </div>
            </div>
            {saved && currentTenantSlug() === (saved.sub || '') && (
              <div className="m-company-chip">
                <span className="m-grow m-ell">{company}</span>
                <button type="button" onClick={() => { forgetCompany(); clearLoginSecret(); window.location.replace('/login?switch=1'); }}>{mt('Change')}</button>
              </div>
            )}
            {error && <div className="m-err">{error}</div>}
            {bioMsg && <div className="m-err">{bioMsg}</div>}

            <div className="m-field m-lf"><label htmlFor="mu">{mt('Username or email')}</label>
              <input id="mu" className="m-input" placeholder={mt('Enter username or email')} type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></div>
            <div className="m-field m-lf"><label htmlFor="mp">{mt('Password')}</label>
              <div className="m-pw"><input id="mp" className="m-input" placeholder={mt('Enter password')} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={{ paddingRight: 70 }} />
                <button type="button" onClick={() => setShow(s => !s)}>{show ? mt('Hide') : mt('Show')}</button></div></div>
            <div className="m-actions">
              <button className="m-btn m-block m-signin" type="submit" disabled={busy || !username.trim() || !password}>{busy ? <span className="m-spin" /> : mt('Sign in')}</button>
              {bio && (
                <button type="button" className="m-bio-btn" onClick={bioLogin} disabled={busy} aria-label={mt('Sign in with fingerprint / face')}>
                  <span className="m-bio-ico"><Icon name="finger" size={26} /></span>
                  <small>{mt('Fingerprint / Face')}</small>
                </button>
              )}
            </div>
          </form>
        )}
        <div className="m-login-foot">eHajiri · Attendance &amp; HR</div>
      </div>

      {offer && (
        <Sheet title={mt('Sign in faster next time?')} onClose={() => answerOffer(false)}
          footer={<><button className="m-btn m-ghost" onClick={() => answerOffer(false)}>{mt('Not now')}</button><button className="m-btn" onClick={() => answerOffer(true)}>{mt('Enable')}</button></>}>
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <div className="m-bio-ico" style={{ margin: '0 auto 10px', width: 64, height: 64 }}><Icon name="finger" size={36} /></div>
            <p style={{ margin: 0 }}>{mt('Use your fingerprint or face instead of typing the password. Your password stays encrypted on this phone only.')}</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

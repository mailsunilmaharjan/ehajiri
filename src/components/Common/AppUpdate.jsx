import { useEffect, useState } from 'react';
import api, { apiUrl } from '../../api/client.js';
import { isNative, nativePlugin } from '../../utils/native.js';

/* App updates, inside the eHajiri Android app only (renders nothing in a browser). Mounted at the very top of the app, so it also
   works on the sign-in screen.
   - Web changes reach the phone by themselves (the app loads the live site); after one, a short "eHajiri was updated" note shows.
   - A NEW APK is announced by the server (see server/routes/mobileRelease.js: latest.json). Every open app compares its own
     versionCode with it - on launch, when it comes back to the foreground, every 6 hours, or on "Check for app update". */
export default function AppUpdate() {
  const [upd, setUpd] = useState(null);          // { versionName, versionCode, notes, mandatory } when a newer APK exists
  const [webNote, setWebNote] = useState('');    // site version, after the website itself changed
  const [msg, setMsg] = useState('');            // answer to a manual "check for update"

  useEffect(() => {
    if (!isNative()) return undefined;
    let alive = true;
    const App = nativePlugin('App');
    const say = (m) => { setMsg(m); setTimeout(() => alive && setMsg(''), 3500); };
    const check = async (manual) => {
      try {
        const info = await App?.getInfo?.();
        const cur = Number(info?.build) || 0;
        const lat = await api.get('/mobile/latest');
        if (!alive) return;
        if (cur > 0 && lat?.versionCode > cur) {
          const skipped = localStorage.getItem('ehajiri_upd_skip') === String(lat.versionCode);
          if (!skipped || lat.mandatory || manual === true) setUpd(lat);
        } else if (manual === true) say('You have the latest version');
      } catch { if (manual === true) say('Could not check — try again later'); }
      try {
        const h = await api.get('/health');
        const prev = localStorage.getItem('ehajiri_web_ver');
        if (h?.appVersion) {
          if (prev && prev !== h.appVersion) { setWebNote(h.appVersion); setTimeout(() => alive && setWebNote(''), 6000); }
          localStorage.setItem('ehajiri_web_ver', h.appVersion);
        }
      } catch { /* offline */ }
    };
    check();
    const timer = setInterval(check, 6 * 3600 * 1000);
    const onManual = () => check(true);
    window.addEventListener('ehajiri:check-update', onManual);
    let handle;
    Promise.resolve(App?.addListener?.('appStateChange', (s) => { if (s?.isActive) check(); }))
      .then(h => { if (alive) handle = h; else h?.remove?.(); }).catch(() => {});
    return () => { alive = false; clearInterval(timer); window.removeEventListener('ehajiri:check-update', onManual); try { handle?.remove?.(); } catch { /* ignore */ } };
  }, []);

  const install = () => {
    const url = window.location.origin + apiUrl('/mobile/apk');
    const B = nativePlugin('Browser');
    if (B?.open) B.open({ url }); else window.open(url, '_system');
  };
  const later = () => { if (upd && !upd.mandatory) localStorage.setItem('ehajiri_upd_skip', String(upd.versionCode)); setUpd(null); };

  if (!upd && !webNote && !msg) return null;
  return (
    <>
      {(webNote || msg) && <div className="m-toast" role="status" style={{ bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>{msg || `✨ eHajiri was updated to v${webNote}`}</div>}
      {upd && (
        <div className="m-pick-back" style={{ alignItems: 'center', padding: 20 }}>
          <div className="m-card" style={{ width: '100%', maxWidth: 420, margin: 0, textAlign: 'center', padding: 22 }}>
            <div style={{ fontSize: 46 }}>⬆️</div>
            <h3 style={{ margin: '6px 0 8px' }}>New version available{upd.versionName ? ` — v${upd.versionName}` : ''}</h3>
            {upd.notes && <p className="m-muted" style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{upd.notes}</p>}
            <p className="m-muted" style={{ fontSize: 12, margin: '0 0 14px' }}>Tap Update now, then open the downloaded file and choose Install. Your account and data stay as they are.</p>
            <div className="m-row" style={{ gap: 10 }}>
              {!upd.mandatory && <button className="m-btn m-ghost" style={{ flex: 1 }} onClick={later}>Later</button>}
              <button className="m-btn" style={{ flex: 1 }} onClick={install}>Update now</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

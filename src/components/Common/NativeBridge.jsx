import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { isNative, nativePlatform, nativePlugin, setPushToken } from '../../utils/native.js';

/* Renders nothing. Inside the eHajiri Android app it (1) marks the page as "native-app" so CSS can respect phone
   safe areas, (2) wires the Android back button to browser history, and (3) registers the phone for push
   notifications once someone is signed in, and opens the right page when a notification is tapped.
   In an ordinary browser it does nothing at all. */
export default function NativeBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const pathRef = useRef(location.pathname);
  useEffect(() => { pathRef.current = location.pathname; }, [location.pathname]);

  // once: native class + back button
  useEffect(() => {
    if (!isNative()) return undefined;
    document.documentElement.classList.add('native-app');
    const App = nativePlugin('App');
    let handle; let disposed = false;
    if (App?.addListener) {
      Promise.resolve(App.addListener('backButton', () => {
        const atRoot = ['/dashboard', '/login', '/'].includes(pathRef.current);
        if (atRoot) App.exitApp?.(); else navigate(-1);
      })).then(h => { if (disposed) { try { h?.remove?.(); } catch { /* ignore */ } } else handle = h; }).catch(() => {});
    }
    return () => { disposed = true; try { handle?.remove?.(); } catch { /* ignore */ } };
  }, [navigate]);

  // push registration while signed in
  const userId = currentUser?.id;
  useEffect(() => {
    if (!isNative() || !userId) return undefined;
    const Push = nativePlugin('PushNotifications');
    if (!Push) return undefined;
    const handles = [];
    let cancelled = false;
    // a listener whose attach finishes after cleanup must be removed straight away, or it leaks (and registers twice)
    const on = (evt, fn) => Promise.resolve(Push.addListener(evt, fn))
      .then(h => { if (cancelled) { try { h?.remove?.(); } catch { /* ignore */ } } else handles.push(h); }).catch(() => {});
    (async () => {
      // Without Firebase set up, Push.register() kills the whole Android app natively (uncatchable from JS).
      // So only touch the plugin once the server confirms push is configured.
      try { const st = await api.get('/push/status'); if (!st?.enabled) return; } catch { return; }
      if (cancelled) return;
      // a high-importance channel so every alert plays the phone's notification sound (like SMS / WhatsApp)
      try { await Push.createChannel?.({ id: 'ehajiri_alerts', name: 'eHajiri alerts', description: 'Leave, visit, message and task alerts', importance: 5, visibility: 1, vibration: true, lights: true }); } catch { /* older app build */ }
      await on('registration', async (t) => {
        if (cancelled || !t?.value) return;
        setPushToken(t.value);
        try { await api.post('/push/register', { token: t.value, platform: nativePlatform(), deviceName: 'eHajiri app', appVersion: '1.0' }); } catch { /* retried next launch */ }
      });
      await on('registrationError', () => { /* Firebase not configured in this build: app works without push */ });
      await on('pushNotificationActionPerformed', (a) => {
        const p = a?.notification?.data?.path;
        if (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//')) navigate(p);
      });
      try {
        let perm = await Push.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await Push.requestPermissions();
        if (perm.receive === 'granted' && !cancelled) await Push.register();
      } catch { /* push unavailable — ignore */ }
    })();
    return () => { cancelled = true; handles.forEach(h => { try { h?.remove?.(); } catch { /* ignore */ } }); };
  }, [userId, navigate]);

  return null;
}

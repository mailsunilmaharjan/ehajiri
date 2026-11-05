import api from '../api/client.js';

/* Bridge to the eHajiri Android app (a Capacitor shell that loads this same web app). In a normal browser every
   function here is a harmless no-op. Plugins are reached through window.Capacitor, which the app injects. */

export const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
};
export const nativePlatform = () => { try { return window.Capacitor?.getPlatform?.() || 'web'; } catch { return 'web'; } };
export const nativePlugin = (name) => { try { return window.Capacitor?.Plugins?.[name] || null; } catch { return null; } };

/** True inside the Android app, on an iPhone, or in any browser opened with ?mobile=1 (handy for testing; ?mobile=0 turns it off again).
 *  Desktop users never see the phone layout unless they ask for it this way. */
export const isMobileMode = () => {
  try {
    if (isNative()) return true;
    const q = new URLSearchParams(window.location.search).get('mobile');
    if (q === '1') sessionStorage.setItem('ehajiri_mobile', '1');
    if (q === '0') { sessionStorage.removeItem('ehajiri_mobile'); sessionStorage.setItem('ehajiri_phone_off', '1'); }
    if (sessionStorage.getItem('ehajiri_mobile') === '1') return true;
    // iPhone Safari / Home-Screen app: there is no iPhone app, so the phone layout switches on by itself (?mobile=0 opts out)
    if (sessionStorage.getItem('ehajiri_phone_off') !== '1' && /iPhone|iPod/.test(navigator.userAgent || '')) return true;
    return false;
  } catch { return false; }
};

/** Ask the phone for fingerprint / face / screen-lock confirmation. Resolves { ok:true } when confirmed (or when the phone has
 *  no biometric plugin / no lock set up, so staff are never locked out), { ok:false, reason } when cancelled or failed. */
export async function biometricConfirm(reason = 'Confirm it is you') {
  const B = nativePlugin('BiometricAuthNative');
  if (!isNative() || !B?.internalAuthenticate) return { ok: true, skipped: true };   // browser or an older app build
  try {
    await B.internalAuthenticate({ reason, androidTitle: 'eHajiri attendance', androidSubtitle: reason, cancelTitle: 'Cancel', allowDeviceCredential: true });
    return { ok: true };
  } catch (e) {
    const code = String(e?.code || '');
    if (/NotAvailable|NotEnrolled|NoDeviceCredential|PasscodeNotSet|notSupported/i.test(code)) return { ok: true, skipped: true };
    return { ok: false, reason: e?.message || 'Not confirmed' };
  }
}

/* ---- remembered company / username + fingerprint-face sign-in (phone app only) ----
   The password is only ever stored in the phone's Keystore-backed secure storage, and only after the person says yes. */
const CRED_KEY = 'ehajiri_login';
const COMPANY_KEY = 'ehajiri_m_company';
export const getRememberedCompany = () => { try { return JSON.parse(localStorage.getItem(COMPANY_KEY) || 'null'); } catch { return null; } };
export const rememberCompany = (c) => { try { localStorage.setItem(COMPANY_KEY, JSON.stringify(c)); } catch { /* storage full: skip the logo */ try { localStorage.setItem(COMPANY_KEY, JSON.stringify({ ...c, logo: null })); } catch { /* ignore */ } } };
export const forgetCompany = () => { try { localStorage.removeItem(COMPANY_KEY); } catch { /* ignore */ } };
/** The /t/<company> part of the address, or '' on the shared hub. */
export const currentTenantSlug = () => (window.location.pathname.match(/^\/t\/([^/]+)/) || [])[1] || '';

export async function biometricAvailable() {
  const B = nativePlugin('BiometricAuthNative'); const S = nativePlugin('SecureStorage');
  if (!isNative() || !B?.internalAuthenticate || !B?.checkBiometry || !S?.internalGetItem) return false;
  try { const r = await B.checkBiometry(); return !!r?.isAvailable; } catch { return false; }
}
export async function saveLoginSecret(username, password) {
  const S = nativePlugin('SecureStorage'); if (!S?.internalSetItem) return false;
  try { await S.internalSetItem({ prefixedKey: CRED_KEY, data: JSON.stringify({ username, password, sub: currentTenantSlug() }) }); return true; } catch { return false; }
}
export async function loadLoginSecret() {
  const S = nativePlugin('SecureStorage'); if (!S?.internalGetItem) return null;
  try { const r = await S.internalGetItem({ prefixedKey: CRED_KEY }); return r?.data ? JSON.parse(r.data) : null; } catch { return null; }
}
export async function hasLoginSecret() { return !!(await loadLoginSecret()); }
export async function clearLoginSecret() {
  const S = nativePlugin('SecureStorage'); if (!S?.internalRemoveItem) return;
  try { await S.internalRemoveItem({ prefixedKey: CRED_KEY }); } catch { /* ignore */ }
}

let pushToken = null;
export const setPushToken = (t) => { pushToken = t; };

/** Ask the server to stop sending this phone the signed-in user's notifications. Call BEFORE the session token is cleared. */
export function unregisterPush() {
  const t = pushToken;
  if (!t) return;
  pushToken = null;
  api.post('/push/unregister', { token: t }).catch(() => {});
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { SubscriptionExpiredScreen } from './Login.jsx';
import api from '../../api/client.js';

// Landed here from LicenseAdmin's Tenant Companies grid — "Open Software
// (Admin/Super Admin)" mints a short-lived signed-email token and always
// points at the shared hub's own /sso-login (there's no per-tenant
// subdomain to embed in that link anymore), carrying only ?token=. This
// page exchanges it: found locally → applies the session directly and
// heads to the dashboard; belongs to a different tenant → one more
// same-origin path redirect to that tenant's own /t/<subdomain>/sso-login,
// reusing the SAME token (any tenant process can verify it independently —
// see authGuard.js's verifySsoToken).
const SsoLogin = () => {
  const navigate = useNavigate();
  const { applySsoSession } = useAuth();
  const { settings } = useSettings();
  const [error, setError] = useState('');
  const [licenseErr, setLicenseErr] = useState(null); // { name, contactName, phone, email } once set

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setError('Missing sign-in link'); return; }

    api.get(`/auth/sso-exchange?token=${encodeURIComponent(token)}`)
      .then(async (result) => {
        if (result.redirect && result.subdomain) {
          const t = result.token || token;
          window.location.href = `/t/${result.subdomain}/sso-login?token=${encodeURIComponent(t)}`;
          return;
        }
        await applySsoSession(result);
        navigate('/dashboard', { replace: true });
      })
      .catch((err) => {
        const data = err?.data || {};
        // Non-superAdmin hitting an expired tenant via this link — same
        // block/messaging as a normal blocked login, not a generic "link
        // invalid" error (this link itself is fine, the subscription isn't).
        if (data.licenseError) {
          setLicenseErr({
            name: data.distributorName || '', contactName: data.distributorContactName || '',
            phone: data.distributorPhone || '', email: data.distributorEmail || '',
          });
          return;
        }
        setError(data.error || err?.message || 'This sign-in link is invalid or has expired');
      });
  }, []);

  if (licenseErr) return <SubscriptionExpiredScreen settings={settings} distributor={licenseErr} />;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f3f4f6', fontFamily: 'inherit',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '36px 44px', textAlign: 'center',
        boxShadow: '0 4px 24px rgba(0,0,0,.08)', maxWidth: 380,
      }}>
        {error ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#991b1b', marginBottom: 6 }}>{error}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Go back to LicenseAdmin and try again.</div>
          </>
        ) : (
          <>
            <div style={{
              width: 32, height: 32, margin: '0 auto 16px', borderRadius: '50%',
              border: '3px solid #e8f0fe', borderTopColor: '#1a56db',
              animation: 'ehSsoSpin 0.8s linear infinite',
            }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1f2937' }}>Signing you in…</div>
          </>
        )}
      </div>
      <style>{'@keyframes ehSsoSpin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
};

export default SsoLogin;

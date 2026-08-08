import React from 'react';
import { useAuth } from '../../context/AuthContext.jsx';

// Shown once after a successful login when the active license is within its
// last 30 days — informational only (dismissable), not a block like
// SubscriptionExpiredScreen. Rendered globally in App.jsx so it appears
// regardless of which page the user lands on after logging in.
const LicenseWarningModal = () => {
  const { licenseWarning, dismissLicenseWarning } = useAuth();
  if (!licenseWarning) return null;

  const { expiresAt, daysLeft, distributorName, distributorContactName, distributorPhone, distributorEmail } = licenseWarning;
  const hasDistributor = distributorName || distributorContactName || distributorPhone || distributorEmail;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: '28px 26px', maxWidth: 400,
        width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,.2)',
      }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fffbeb',
          border: '3px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, margin: '0 auto 14px' }}>
          ⏰
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>
          Subscription Expiring Soon
        </h3>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', marginBottom: 14, lineHeight: 1.5 }}>
          Your subscription {daysLeft <= 0 ? 'expires today' : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
          {expiresAt ? ` (${expiresAt})` : ''}. Please renew soon to avoid interruption.
        </p>
        {hasDistributor && (
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '12px 18px', marginBottom: 18, textAlign: 'left', fontSize: 13, color: '#374151' }}>
            <div style={{ display: 'flex', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, width: 100 }}>Distributor</span>
              <span>: {distributorName || '—'}</span>
            </div>
            <div style={{ display: 'flex', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, width: 100 }}>Phone no</span>
              <span>: {distributorPhone || '—'}</span>
            </div>
            <div style={{ display: 'flex', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, width: 100 }}>Name</span>
              <span>: {distributorContactName || '—'}</span>
            </div>
            <div style={{ display: 'flex' }}>
              <span style={{ fontWeight: 700, width: 100 }}>Email</span>
              <span>: {distributorEmail || '—'}</span>
            </div>
          </div>
        )}
        <button onClick={dismissLicenseWarning} style={{
          width: '100%', padding: '11px', background: '#1a56db', color: 'white',
          border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>
          OK, got it
        </button>
      </div>
    </div>
  );
};

export default LicenseWarningModal;

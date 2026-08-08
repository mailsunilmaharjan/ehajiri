import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';

// Moved here from the Login page's fixed-bottom bar — shown instead on the
// Dashboard, in-flow at the bottom of the page, reflecting whatever license
// is actually active for the logged-in tenant (GET /license/status, the
// same endpoint the Login page's Subscription Expired screen already uses).
const LicenseStatusBar = () => {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get('/license/status').then(setInfo).catch(() => {});
  }, []);

  if (!info || (!info.expires && !info.client)) return null;

  const daysLeft = info.expires
    ? Math.max(0, Math.ceil((new Date(info.expires) - new Date()) / 86400000))
    : null;

  const isExpired = daysLeft === 0 || info.expired;
  const isWarning = daysLeft !== null && daysLeft <= 30 && !isExpired;
  const dotColor  = isExpired ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e';

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
             .replace(/ /g, '-');
  };

  const dim  = { fontSize: 11, color: '#9ca3af', fontWeight: 500 };
  const bold = { fontSize: 11, color: '#374151', fontWeight: 700 };
  const sep  = <span style={{ color: '#e5e7eb', margin: '0 12px' }}>|</span>;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexWrap: 'wrap', gap: '2px 0',
      padding: '14px 20px', marginTop: 'auto',
      borderTop: '1px solid #e5e7eb',
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

export default LicenseStatusBar;

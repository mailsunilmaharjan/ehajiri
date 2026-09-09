import React from 'react';

/* Branded loading state for report pages — shown while a report's data is
   still being fetched, so a slow load reads as "working" instead of a blank/
   stuck screen. Mirrors the app's own topbar brand mark (see TopMenu.css's
   .tm-logo) so it's recognizable as "the app is doing something", not a
   generic spinner. */
const LoadingIndicator = ({ label = 'Loading data…' }) => (
  <div style={{ textAlign: 'center', padding: '70px 20px' }}>
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #1a56db, #7e3af2)',
          color: 'white', fontSize: 14, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(26,86,219,.35)',
          animation: 'ehLoadPulse 1.4s ease-in-out infinite',
        }}>EH</div>
        <span style={{ fontSize: 16, fontWeight: 700 }}>
          <span style={{ color: '#111827' }}>eHajiri</span>{' '}
          <span style={{ color: '#1a56db' }}>TMS</span>
        </span>
      </div>
      <div style={{ width: 220, height: 5, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
        <div style={{
          width: '40%', height: '100%', borderRadius: 3,
          background: 'linear-gradient(90deg, #1a56db, #7e3af2)',
          animation: 'ehLoadSlide 1.1s ease-in-out infinite',
        }} />
      </div>
      <div style={{ fontSize: 12.5, color: '#9ca3af', fontWeight: 600 }}>{label}</div>
    </div>
    <style>{`
      @keyframes ehLoadPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      @keyframes ehLoadSlide { 0% { transform: translateX(-140%); } 50% { transform: translateX(160%); } 100% { transform: translateX(400%); } }
    `}</style>
  </div>
);

export default LoadingIndicator;

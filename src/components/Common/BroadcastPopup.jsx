import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';

// Announcements broadcast from LicenseAdmin (Message Broadcasting → eHajiri Web application).
// Shown one after another right after login; each one only once per browser tab session per user.
const BroadcastPopup = () => {
  const { currentUser } = useAuth();
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!currentUser) { setQueue([]); return; }
    let cancelled = false;
    api.get('/broadcast').then(rows => {
      if (cancelled || !Array.isArray(rows)) return;
      const unseen = rows.filter(b => {
        try { return sessionStorage.getItem(`bc_seen_${currentUser.id}_${b.id}`) !== '1'; } catch { return true; }
      });
      setQueue(unseen);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const b = queue[0];
  if (!currentUser || !b) return null;

  const close = () => {
    try { sessionStorage.setItem(`bc_seen_${currentUser.id}_${b.id}`, '1'); } catch { /* private mode */ }
    setQueue(q => q.slice(1));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.62)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.4)' }}>
        <div style={{ background: 'linear-gradient(135deg,#1a56db,#7e3af2)', color: '#fff', padding: '14px 20px', fontWeight: 700, fontSize: 15, borderRadius: '16px 16px 0 0' }}>
          📢 {b.title || 'Announcement'}
        </div>
        {b.image && <img src={b.image} alt="" style={{ display: 'block', width: '100%', maxHeight: '60vh', objectFit: 'contain', background: '#f8fafc' }} />}
        {b.message && <div style={{ padding: '18px 22px', fontSize: 14, lineHeight: 1.7, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{b.message}</div>}
        <div style={{ padding: '12px 20px 18px', textAlign: 'right' }}>
          <button type="button" onClick={close} style={{ background: '#1a56db', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 26px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            OK{queue.length > 1 ? ` (${queue.length - 1} more)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BroadcastPopup;

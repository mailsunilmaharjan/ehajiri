import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { tripTracker } from '../../utils/tripTracker.js';
import { isMobileMode } from '../../utils/native.js';

/**
 * Keeps the Field Visit route tracker in step with the server's open trip, app-wide
 * (so tracking continues when a task panel is closed or the page is changed), and
 * shows a small always-visible chip while location is being recorded — staff can
 * see at a glance that tracking is on, and it disappears the moment they check in
 * at the office. Renders nothing when no trip is open.
 */
const TripTrackerHost = ({ bottom = 24, left = 150 }) => {
  const { currentUser } = useAuth();
  const [st, setSt] = useState(tripTracker.getStatus());

  useEffect(() => tripTracker.subscribe(setSt), []);

  useEffect(() => {
    // The mobile app captures GPS ONLY at the Check out / Check in taps — no continuous route recording.
    if (!currentUser?.id || isMobileMode()) { tripTracker.stop(); return undefined; }
    tripTracker.sync();
    const t = setInterval(() => tripTracker.sync(), 5 * 60 * 1000);
    const onFocus = () => tripTracker.sync();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [currentUser?.id]);

  if (!st.tracking) return null;
  return (
    <div title="Your location is recorded while this field visit trip is open, until you check in at the office."
      style={{ position: 'fixed', bottom, left, zIndex: 1500, display: 'inline-flex', alignItems: 'center', gap: 6,
        background: st.error ? '#fef3c7' : '#dcfce7', color: st.error ? '#92400e' : '#166534',
        border: `1px solid ${st.error ? '#fcd34d' : '#86efac'}`, borderRadius: 16, padding: '5px 12px',
        fontSize: 12, fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.error ? '#f59e0b' : '#16a34a' }} />
      📡 Tracking field visit{st.error ? ` — ${st.error}` : ''}
    </div>
  );
};

export default TripTrackerHost;

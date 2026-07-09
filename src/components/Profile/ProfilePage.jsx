import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import ProfileTab from '../Common/ProfileTab.jsx';

/**
 * Self-service profile page — reachable by every role from the user
 * dropdown (unlike the admin-only Settings → Profile tab this reuses).
 */
const ProfilePage = () => {
  const { currentUser } = useAuth();
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <ProfileTab currentUser={currentUser} showToast={showToast} />

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'danger' ? '#dc2626' : '#059669',
          color: 'white', padding: '10px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,.15)',
        }}>
          {toast.type === 'danger' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default ProfilePage;

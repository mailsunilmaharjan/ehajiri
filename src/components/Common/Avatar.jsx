import React from 'react';

/* ═══════════════════════════════════════════════════════════
   Avatar — one circle for the whole app.
   Renders the person's uploaded profile photo (users.profile_photo,
   a small data-URL set from the Profile page) when there is one,
   otherwise falls back to the familiar gradient initial circle.

   Props:
     photo    data-URL string or null
     name     full name — first letter becomes the fallback initial
     size     px (default 40)
     style    extra styles merged onto the circle
════════════════════════════════════════════════════════════ */
const Avatar = ({ photo, name, size = 40, style = {} }) => {
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    ...style,
  };

  if (photo) {
    return (
      <div style={{ ...base, background: '#e5e7eb' }}>
        <img
          src={photo}
          alt={name || 'avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  return (
    <div style={{
      ...base,
      background: 'linear-gradient(135deg,#3b82f6,#1a56db)', color: '#fff',
      fontWeight: 700, fontSize: Math.round(size * 0.4),
    }}>
      {initial}
    </div>
  );
};

export default Avatar;

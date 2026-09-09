import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

const PREVIEW = 168;

/* ═══════════════════════════════════════════════════════════
   Avatar — one circle for the whole app.
   Renders the person's uploaded profile photo (users.profile_photo,
   a small data-URL set from the Profile page) when there is one,
   otherwise falls back to the familiar gradient initial circle.
   Hovering any avatar (grid cell, dropdown row, chip, ...) pops up a
   larger preview near it so a small thumbnail is never the only way to
   see the photo — portalled to document.body like HoverCard, so it
   isn't clipped by a scrollable grid wrapper.

   Props:
     photo    data-URL string or null
     name     full name — first letter becomes the fallback initial
     size     px (default 40)
     style    extra styles merged onto the circle
════════════════════════════════════════════════════════════ */
const Avatar = ({ photo, name, size = 40, style = {} }) => {
  const [show, setShow] = useState(false);
  const [pos,  setPos]  = useState(null);
  const ref = useRef(null);

  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', cursor: 'zoom-in',
    ...style,
  };

  const openPreview = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - PREVIEW / 2), window.innerWidth - PREVIEW - 8);
    const opensUp = rect.top > PREVIEW + 16;
    setPos({ left, top: opensUp ? rect.top - PREVIEW - 10 : rect.bottom + 10 });
    setShow(true);
  };
  const closePreview = () => setShow(false);

  const previewNode = show && pos && createPortal(
    <div style={{
      position: 'fixed', zIndex: 1000000, left: pos.left, top: pos.top,
      width: PREVIEW, height: PREVIEW, borderRadius: '50%', overflow: 'hidden',
      border: '3px solid #fff', boxShadow: '0 12px 32px rgba(0,0,0,.35)',
      background: photo ? '#e5e7eb' : 'linear-gradient(135deg,#3b82f6,#1a56db)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    }}>
      {photo
        ? <img src={photo} alt={name || 'avatar'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ color: '#fff', fontWeight: 800, fontSize: 68 }}>{initial}</span>}
    </div>,
    document.body
  );

  if (photo) {
    return (
      <>
        <div ref={ref} onMouseEnter={openPreview} onMouseLeave={closePreview}
          style={{ ...base, background: '#e5e7eb' }}>
          <img
            src={photo}
            alt={name || 'avatar'}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
        {previewNode}
      </>
    );
  }

  return (
    <>
      <div ref={ref} onMouseEnter={openPreview} onMouseLeave={closePreview}
        style={{
          ...base,
          background: 'linear-gradient(135deg,#3b82f6,#1a56db)', color: '#fff',
          fontWeight: 700, fontSize: Math.round(size * 0.4),
        }}>
        {initial}
      </div>
      {previewNode}
    </>
  );
};

export default Avatar;

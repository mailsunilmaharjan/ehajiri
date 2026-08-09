import React, { useState } from 'react';

// Shared hover-tooltip card — light background (never black/dark), border +
// soft shadow, for anything too long to show inline (a full staff list, a
// long note/description). Wrap the visible/truncated content as `trigger`;
// `content` is whatever should show on hover (a string or JSX).
const HoverCard = ({ trigger, content, minWidth = 200, maxWidth = 340, align = 'left' }) => {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {trigger}
      {show && (
        <div className="hover-card" style={{ position: 'absolute', zIndex: 300, top: '130%', minWidth, maxWidth,
          [align === 'right' ? 'right' : 'left']: 0,
          background: '#ffffff', color: '#1f2937', fontSize: 14, lineHeight: 1.8, padding: '10px 14px',
          borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 10px 28px rgba(0,0,0,.18)', whiteSpace: 'normal' }}>
          {content}
        </div>
      )}
    </span>
  );
};

export default HoverCard;

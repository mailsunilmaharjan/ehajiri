import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLeaveApply } from '../../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import { useManualPostingApply } from '../../context/ManualPostingApplyContext.jsx';

const GlobalFAB = () => {
  const location        = useLocation();
  const { open: openLeaveApply }       = useLeaveApply();
  const { open: openOfficeVisitApply } = useOfficeVisitApply();
  const { open: openManualPostingApply } = useManualPostingApply();
  const { canView, currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const fabRef = useRef(null);

  /* close on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (fabRef.current && !fabRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* close when route changes */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  if (!currentUser) return null;

  const actions = [
    canView('leaveApply') && {
      label:  'Apply Leave',
      icon:   '📝',
      color:  '#7c3aed',
      bg:     '#ede9fe',
      action: () => { setOpen(false); openLeaveApply(); },
    },
    canView('officeVisitApply') && {
      label:  'Apply Office Visit',
      icon:   '🏢',
      color:  '#0d9488',
      bg:     '#ccfbf1',
      action: () => { setOpen(false); openOfficeVisitApply(); },
    },
    canView('manualPostingApply') && {
      label:  'Inform Late In/Early Out',
      icon:   '⏱️',
      color:  '#f59e0b',
      bg:     '#fef3c7',
      action: () => { setOpen(false); openManualPostingApply(); },
    },
  ].filter(Boolean);

  if (actions.length === 0) return null;

  return (
    <div
      ref={fabRef}
      style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
        display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: 10,
      }}
    >
      {/* Action items */}
      {open && actions.map((a, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            animation: 'fabItemIn .15s ease both',
            animationDelay: `${i * 40}ms`,
          }}
        >
          {/* Label pill — also clickable, same action as the circle button */}
          <span
            onClick={a.action}
            title={a.label}
            style={{
              background: '#f3f4f6', color: '#1f2937', fontSize: 13, fontWeight: 600,
              padding: '6px 14px', borderRadius: 8, whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,.18)', border: '1px solid #e5e7eb',
              cursor: 'pointer', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
            onMouseLeave={e => e.currentTarget.style.background = '#f3f4f6'}
          >
            {a.label}
          </span>
          {/* Circle button */}
          <button
            onClick={a.action}
            title={a.label}
            style={{
              width: 44, height: 44, borderRadius: '50%', border: 'none',
              background: a.color, color: '#fff', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 3px 10px ${a.color}66`,
              transition: 'transform .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.12)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {a.icon}
          </button>
        </div>
      ))}

      {/* Main toggle button */}
      <button
        onClick={() => setOpen(p => !p)}
        title={open ? 'Close' : 'Apply Applications'}
        style={{
          width: 52, height: 52, borderRadius: '50%', border: 'none',
          background: open ? '#64748b' : '#7c3aed', color: '#fff',
          fontSize: 26, fontWeight: 300, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(124,58,237,.45)',
          transition: 'transform .25s, background .2s',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#6d28d9'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = '#7c3aed'; }}
      >
        +
      </button>

      <style>{`
        @keyframes fabItemIn {
          from { opacity: 0; transform: translateY(8px) scale(.95); }
          to   { opacity: 1; transform: translateY(0)   scale(1);   }
        }
      `}</style>
    </div>
  );
};

export default GlobalFAB;

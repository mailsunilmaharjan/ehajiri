import React from 'react';

// Crisp stroke-based icons for the report dropdown buttons (ViewHalfMonthlyBtn/
// ViewMonthlyBtn/ViewYearlyBtn) — replaces plain emoji, which render
// inconsistently across OS/browser emoji fonts and look muddy at this size.
// Same approach (and each icon's own fixed color) as TopMenu.jsx's MIcon.
const REPORT_ICON_PATHS = {
  bookOpen:   <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
  checkCircle:<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  barChart:   <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  repeat:     <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  calendar:   <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  clock:      <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  zap:        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
};
const REPORT_ICON_COLORS = {
  bookOpen: '#d97706', checkCircle: '#059669', barChart: '#4f46e5',
  repeat: '#2563eb', calendar: '#dc2626', clock: '#db2777', zap: '#f97316',
};
const ReportIcon = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={REPORT_ICON_COLORS[name] || 'currentColor'}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {REPORT_ICON_PATHS[name]}
  </svg>
);

export default ReportIcon;

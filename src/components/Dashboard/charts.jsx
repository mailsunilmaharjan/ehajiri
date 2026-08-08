import React, { useId, useState } from 'react';

/* ═══════════════════════════════════════════════════════
   Small, dependency-free chart primitives for the Dashboard.
   No charting library is installed in this app (confirmed) —
   these are hand-rolled SVG/CSS, matching the codebase's existing
   convention of small inline <svg> glyphs rather than a library.
═══════════════════════════════════════════════════════ */

// Ring/donut chart. segments: [{ label, value, color }]
export const Donut = ({ segments = [], size = 120, thickness = 14, centerLabel, centerSub }) => {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {total > 0 && segments.map((seg, i) => {
          if (!seg.value) return null;
          const dash = (seg.value / total) * c;
          const circle = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset} />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{centerLabel}</span>
        {centerSub && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 3 }}>{centerSub}</span>}
      </div>
    </div>
  );
};

// Legend rows to pair with a Donut — kept separate so callers control layout.
export const ChartLegend = ({ segments = [] }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    {segments.map((seg, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
        <span style={{ color: '#64748b', flex: 1 }}>{seg.label}</span>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>{seg.value}</span>
      </div>
    ))}
  </div>
);

// Vertical bar chart. data: [{ label, value, color }]
export const MiniBarChart = ({ data = [], height = 140 }) => {
  const max = Math.max(1, ...data.map(d => d.value || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '4px 2px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{d.value}</span>
          <div style={{ width: '100%', maxWidth: 34,
            height: Math.max(4, (d.value / max) * (height - 40)),
            background: `linear-gradient(180deg, ${d.color}, ${d.color}cc)`, borderRadius: 6 }} />
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
};

// Half-circle gauge donut — same stroke-dasharray-on-path technique as Donut,
// just applied to a semicircle arc (length π·r) instead of a full circle (2π·r).
// Hovering a segment shows a small dark tooltip with its label/value.
export const HalfDonut = ({ segments = [], size = 160, thickness = 16, centerLabel, centerSub }) => {
  const [hover, setHover] = useState(null); // { seg, x, y }
  const total  = segments.reduce((s, x) => s + (x.value || 0), 0);
  const r      = (size - thickness) / 2;
  const cx     = size / 2, cy = size / 2;
  const arcLen = Math.PI * r;
  const d      = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  let offset = 0;

  return (
    <div style={{ position: 'relative', width: size, height: size / 2 + 34 }}>
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`}>
        <path d={d} fill="none" stroke="#f1f5f9" strokeWidth={thickness} strokeLinecap="round" />
        {total > 0 && segments.map((seg, i) => {
          if (!seg.value) return null;
          const dash = (seg.value / total) * arcLen;
          const path = (
            <path key={i} d={d} fill="none" stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${arcLen - dash}`} strokeDashoffset={-offset}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => setHover({ seg, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
              onMouseMove={(e) => setHover({ seg, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
              onMouseLeave={() => setHover(null)} />
          );
          offset += dash;
          return path;
        })}
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '62%', textAlign: 'center', pointerEvents: 'none' }}>
        {centerSub && <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{centerSub}</div>}
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', lineHeight: 1.15 }}>{centerLabel}</div>
      </div>
      {hover && (
        <div style={{ position: 'absolute', left: hover.x, top: Math.max(0, hover.y - 44), transform: 'translateX(-50%)',
          background: '#1e293b', color: '#fff', borderRadius: 8, padding: '6px 11px', fontSize: 11.5,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10, boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>
          <div style={{ fontWeight: 700 }}>{hover.seg.label}</div>
          <div style={{ color: '#cbd5e1' }}>{hover.seg.value}</div>
        </div>
      )}
    </div>
  );
};

// Photo/initials avatar circle — moved here from Dashboard.jsx so AvatarStack
// (below) can reuse it; a `size` prop was added (default matches the original
// fixed 29px) since stacks/lists want different sizes than the original call sites.
export const Av = ({ name, photo, size = 29 }) => (
  photo ? (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
      overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f1f5f9' }}>
      <img src={photo} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  ) : (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#f1f5f9', color: '#64748b',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.41), fontWeight: 700, border: '1px solid #e2e8f0' }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
);

// Overlapping avatar stack with a "+N" overflow bubble. people: [{ id, name, photo }]
export const AvatarStack = ({ people = [], max = 4, size = 28 }) => {
  const shown    = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <div key={p.id ?? i} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: '50%',
          border: '2px solid #fff', boxShadow: '0 0 0 1px #e2e8f0', zIndex: shown.length - i }}>
          <Av name={p.name} photo={p.photo} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ marginLeft: -8, width: size, height: size, borderRadius: '50%',
          border: '2px solid #fff', background: '#e2e8f0', color: '#475569',
          fontSize: Math.round(size * 0.36), fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
          +{overflow}
        </div>
      )}
    </div>
  );
};

// Small vertical bar-strip severity indicator (e.g. how late someone is).
export const SeverityBars = ({ level = 0, max = 5, color = '#f59e0b' }) => (
  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
    {Array.from({ length: max }).map((_, i) => (
      <span key={i} style={{ width: 3, height: 6 + i * 2.5, borderRadius: 1,
        background: i < level ? color : '#e2e8f0' }} />
    ))}
  </div>
);

// Sparkline/area trend. points: [{ date, value }]
export const TrendLine = ({ points = [], color = '#3b82f6', height = 70 }) => {
  const gradId = `trendFill-${useId()}`;
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map(p => p.value));
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;
  const toY = (v) => height - (v / max) * (height - 10) - 5;
  const coords = points.map((p, i) => [i * stepX, toY(p.value)]);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0]},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill={color} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
};

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import { getTenantPrefix } from '../../utils/tenantPath.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import ContactFormModal, { CONTACT_EMPTY } from './ContactFormModal.jsx';

const FOLLOWUP_MEDIA_OPTIONS = ['Call', 'WhatsApp', 'Email', 'SMS', 'In-Person', 'Other'];
const FOLLOWUP_STATUS_OPTIONS = [
  { value:'Invitation Sent',       bg:'#ede9fe', color:'#5b21b6' },
  { value:'Confirmed Attendance',  bg:'#f0fdf4', color:'#065f46' },
  { value:'Registered at Event',   bg:'#fffbeb', color:'#92400e' },
];
const EMPTY_FOLLOWUP_FORM = { conversation:'', media:[], statuses:[] };
const firstName = (fullName) => (fullName || 'Someone').trim().split(/\s+/)[0];

const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).split('T')[0];
  const [y, m, day] = s.split('-');
  return (y && m && day) ? `${day}-${m}-${y}` : s;
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
};

// Same downscale-to-JPEG-data-URL pattern used for profile photos / ID card
// scans elsewhere in the app (see ProfileTab.jsx) — kept larger (1000px) than
// an avatar thumbnail since this needs to stay legible as a document photo.
const readAndDownscale = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const max = 1000;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image file')); };
  img.src = url;
});

const Pill = ({ children, bg, color, size }) => (
  <span style={{ display:'inline-block', padding: size==='lg' ? '4px 12px' : '1px 8px',
    borderRadius:10, fontSize: size==='lg' ? 13.5 : 10.5,
    fontWeight:700, whiteSpace:'nowrap', background:bg, color }}>
    {children}
  </span>
);

const StatBox = ({ label, value, color, bg }) => (
  <div style={{ background:bg, borderRadius:8, padding:'6px 12px', flex:'1 1 110px',
    display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
    <span style={{ fontSize:9.5, fontWeight:700, color, textTransform:'uppercase', letterSpacing:.3 }}>{label}</span>
    <span style={{ fontSize:15, fontWeight:800, color }}>{value}</span>
  </div>
);

// Full-size image preview — browsers block window.open() on a data: URL
// (the format every image here is stored/uploaded as), so "View" opens this
// in-app overlay instead of trying to open a new tab.
const ImageLightbox = ({ src, onClose }) => (
  <div onClick={onClose} style={{
    position:'fixed', inset:0, zIndex:10000, background:'rgba(0,0,0,.85)',
    display:'flex', alignItems:'center', justifyContent:'center', padding:24, cursor:'zoom-out',
  }}>
    <img src={src} alt="Preview" style={{ maxWidth:'90vw', maxHeight:'90vh', borderRadius:8,
      boxShadow:'0 8px 40px rgba(0,0,0,.5)', objectFit:'contain' }} />
    <button onClick={onClose} style={{
      position:'fixed', top:20, right:24, background:'rgba(255,255,255,.15)', border:'none',
      borderRadius:8, width:36, height:36, color:'#fff', fontSize:18, cursor:'pointer' }}>
      ✕
    </button>
  </div>
);

// Colored ribbons falling from the top — shown for a few seconds the moment
// a winner is revealed (LuckyDrawModal, one-shot) or continuously for as
// long as a company's celebration is up (AppreciationCeremonyModal, loop).
// Pure CSS keyframe animation, randomized per ribbon.
const RibbonDrop = ({ loop = false }) => {
  const ribbons = useMemo(() => {
    const colors = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#a855f7', '#ec4899', '#facc15'];
    return Array.from({ length: 46 }, (_, i) => ({
      id: i, left: Math.random() * 100, color: colors[i % colors.length],
      delay: Math.random() * 0.5, duration: 2.4 + Math.random() * 1.6,
      width: 6 + Math.random() * 6,
    }));
  }, []);
  return (
    <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none', zIndex:6 }}>
      <style>{`
        @keyframes ldRibbonFall {
          0%   { transform: translateY(-40px) rotate(0deg); opacity:1; }
          100% { transform: translateY(115vh) rotate(720deg); opacity:.85; }
        }
      `}</style>
      {ribbons.map(r => (
        <div key={r.id} style={{
          position:'absolute', top:0, left:`${r.left}%`, width:r.width, height:r.width * 2.4,
          background:r.color, borderRadius:2,
          animation:`ldRibbonFall ${r.duration}s ease-in ${r.delay}s ${loop ? 'infinite' : 'forwards'}`,
        }} />
      ))}
    </div>
  );
};

// Balloons floating up from the bottom of the screen — shown continuously
// for as long as a company's celebration is up in the Appreciation Ceremony
// (only call site, so always loops). Pure CSS keyframe animation, randomized
// per balloon (same approach as RibbonDrop above, just rising instead of falling).
const BalloonRise = () => {
  const balloons = useMemo(() => {
    const colors = ['#f43f5e', '#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ec4899', '#facc15'];
    return Array.from({ length: 16 }, (_, i) => ({
      id: i, left: Math.random() * 96, color: colors[i % colors.length],
      delay: Math.random() * 0.5, duration: 3.4 + Math.random() * 1.6,
      size: 44 + Math.random() * 24,
    }));
  }, []);
  return (
    <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none', zIndex:6 }}>
      <style>{`
        @keyframes acBalloonRise {
          0%   { transform: translateY(15vh) translateX(0) rotate(-4deg); opacity:0; }
          12%  { opacity:1; }
          50%  { transform: translateY(-55vh) translateX(16px) rotate(4deg); }
          100% { transform: translateY(-130vh) translateX(-12px) rotate(-4deg); opacity:.9; }
        }
      `}</style>
      {balloons.map(b => (
        <div key={b.id} style={{
          position:'absolute', bottom:0, left:`${b.left}%`, width:b.size, height:b.size * 1.2,
          animation:`acBalloonRise ${b.duration}s ease-out ${b.delay}s infinite`,
        }}>
          <div style={{ width:'100%', height:'100%', borderRadius:'50% 50% 50% 50% / 60% 60% 40% 40%',
            background:b.color, boxShadow:'inset -7px -7px 12px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.2)' }} />
          <div style={{ width:2, height:24, background:'rgba(255,255,255,.55)', margin:'0 auto' }} />
        </div>
      ))}
    </div>
  );
};

// How long a spin visibly runs before the winner is revealed — deliberately
// long (vs. a quick snap) so the room has time to watch it decelerate and
// build suspense. PrizeWheel's own CSS transition duration below must match
// this exactly, since the reveal is driven by a setTimeout of the same length.
const SPIN_DURATION_MS = 9000;

// The wheel's on-screen size, responsive to whatever room the center column
// actually has (full-screen mode leaves a lot of it) — computed once and
// recalculated on resize, rather than a fixed size that looks tiny on a big
// screen or overflows a small one. All of PrizeWheel's internal geometry
// below scales off this one number (see `scale`), so it stays proportional
// at any size instead of just stretching the outer box.
const useWheelSize = () => {
  const compute = () => {
    if (typeof window === 'undefined') return 480;
    const availH = window.innerHeight - 180;  // header + winner-card breathing room
    const availW = window.innerWidth - 760;   // the two 300px/340px side panels + gaps
    return Math.round(Math.max(380, Math.min(820, availH, availW)));
  };
  const [size, setSize] = useState(compute);
  useEffect(() => {
    const onResize = () => setSize(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
};

// The actual spinning prize wheel — N equal segments (alternating colors),
// a fixed pointer at the top, a center "SPIN" hub button, and a slow
// ease-out CSS rotation so it visibly decelerates into the winning segment
// instead of snapping straight there. Every measurement is proportional to
// `size` (base design was 300px) so a bigger wheel keeps the same look.
const PrizeWheel = ({ items, labelOf, wheelApiRef, onSpinClick, spinning }) => {
  const n = items.length;
  const anglePerSeg = n > 0 ? 360 / n : 0;
  const wheelRef = useRef(null);
  const rotationRef = useRef(0);
  const size = useWheelSize();
  const scale = size / 300;
  const center = size / 2;

  useEffect(() => {
    wheelApiRef.current = {
      spinTo: (index) => {
        const targetMid = index * anglePerSeg + anglePerSeg / 2;
        const spins = 14; // more full rotations = longer visible spin, more suspense
        const current = rotationRef.current;
        // land targetMid under the fixed top pointer, always spinning FORWARD
        // (never backward) from wherever the wheel currently sits.
        const currentMod = ((current % 360) + 360) % 360;
        const needed = ((360 - targetMid) - currentMod + 360) % 360;
        rotationRef.current = current + spins * 360 + needed;
        if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
      },
    };
  }); // eslint-disable-line

  // ZKTeco green + gold — brand primary alternating with a "prize" accent,
  // instead of a dark/black wheel.
  const colors = ['#facc15', '#00A651'];
  const gradient = n > 0
    ? `conic-gradient(from 0deg, ${items.map((_, i) => `${colors[i % 2]} ${i * anglePerSeg}deg ${(i + 1) * anglePerSeg}deg`).join(',')})`
    : '#e5e7eb';

  return (
    <div style={{ position:'relative', width:size, height:size, margin:'0 auto', flexShrink:0 }}>
      <div style={{ position:'absolute', top:-6 * scale, left:'50%', transform:'translateX(-50%)', zIndex:3,
        width:0, height:0, borderLeft:`${15 * scale}px solid transparent`, borderRight:`${15 * scale}px solid transparent`,
        borderTop:`${24 * scale}px solid #dc2626`, filter:'drop-shadow(0 2px 3px rgba(0,0,0,.25))' }} />
      <div ref={wheelRef} style={{
        width:'100%', height:'100%', borderRadius:'50%', position:'relative',
        background:gradient, border:`${6 * scale}px solid #fff`,
        boxShadow:`0 0 0 ${3 * scale}px #00A651, 0 10px 30px rgba(0,166,81,.25)`,
        transition: spinning ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12,0.67,0.14,1)` : 'none',
      }}>
        {/* Segment dividers — a thin line from hub to rim at each segment
            boundary, same "spoke" positioning trick the labels below use. */}
        {n > 1 && Array.from({ length: n }, (_, i) => i * anglePerSeg).map(boundary => (
          <div key={boundary} style={{
            position:'absolute', left:center, top:center, width:0, height:0,
            transform:`rotate(${boundary}deg)`,
          }}>
            <div style={{ position:'absolute', left:-1 * scale, top:0, width:2 * scale, height:150 * scale,
              background:'rgba(255,255,255,.55)' }} />
          </div>
        ))}
        {items.map((it, i) => {
          const mid = i * anglePerSeg + anglePerSeg / 2;
          // Radial "spoke" label — rotated so it runs from near the hub out
          // to the rim (like a wheel-of-fortune wheel), not tangent to the
          // rim. mid=0 is straight up, so subtracting 90° points the label's
          // natural left-to-right reading direction outward along that spoke.
          let rotate = mid - 90;
          const norm = ((rotate % 360) + 360) % 360;
          // Past a 90° tilt the label would read upside-down — swap to the
          // other end of the same spoke line (180° away) so every label
          // stays within a readable ±90° tilt all the way around the wheel.
          const flip = norm > 90 && norm < 270;
          if (flip) rotate += 180;
          return (
            <div key={i} style={{
              position:'absolute', left:center, top:center, width:0, height:0,
              transform:`rotate(${rotate}deg)`,
            }}>
              <div style={{
                position:'absolute', top:0, [flip ? 'right' : 'left']:0,
                transform:'translateY(-50%)',
                // Starts just clear of the SPIN hub (its radius is 43*scale)
                // so the button never covers the first letter, and reaches
                // out to just inside the rim.
                [flip ? 'paddingRight' : 'paddingLeft']: 50 * scale,
                width:100 * scale,
                fontSize: (n > 24 ? 8 : n > 12 ? 9.5 : 12) * scale, fontWeight:800,
                color: colors[i % 2] === '#facc15' ? '#78350f' : '#fff',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                textAlign: flip ? 'right' : 'left',
              }}>
                {labelOf(it)}
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={onSpinClick} disabled={spinning || n === 0}
        style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          width:86 * scale, height:86 * scale, borderRadius:'50%', background:'#00A651', border:`${3 * scale}px solid #fff`,
          boxShadow:'0 2px 10px rgba(0,166,81,.4)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:4, textAlign:'center',
          fontSize:12 * scale, fontWeight:800, color:'#fff', lineHeight:1.3, cursor: (spinning || n === 0) ? 'default' : 'pointer' }}>
        🎡<br />{spinning ? '...' : 'SPIN'}
      </button>
    </div>
  );
};

// Full-screen "Coupon Lucky Draw" / "Spin Lucky Draw" — an actual spinning
// prize wheel that decelerates into one random winner, a confetti/ribbon
// drop on reveal, a live Winners list (left) and the full entry list
// (right), both as DataGrids. Esc (and ✕) closes it.
//
// Winners are saved (onWinnerWon) the moment they're revealed and excluded
// from the pool the wheel spins over — so a name/company that has already
// won can't come up again on the next spin, and the Winners list survives
// closing and reopening this screen.
const LuckyDrawModal = ({ event, icon, subtitle, items, labelOf, winnerInfoOf, rowLabelOf, itemKeyOf,
  winners, onWinnerWon, onReset, onResetCoupons, emptyLabel, onClose, showToast, organizerTagline, organizerWebsite }) => {
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState(null); // the winning item itself (not an index — the pool shrinks after each win)
  const [resetting, setResetting] = useState(false);
  const [resettingCoupons, setResettingCoupons] = useState(false);
  // Which confirmation card is up, if any — a plain in-screen card, not
  // window.confirm(): a native blocking dialog forces Chrome/Firefox to exit
  // the Fullscreen API first, which fires the fullscreenchange listener below
  // and closes this whole screen the instant either reset is clicked.
  const [confirmAction, setConfirmAction] = useState(null); // 'winners' | 'coupons' | null
  // The wheel stays mounted the whole time (winner card just overlays on
  // top of it) so its rotation/API ref survives across repeated spins —
  // unmounting it between spins would reset rotationRef to 0 and drop the
  // in-flight wheelApiRef, breaking "Spin Again".
  const wheelApiRef = useRef(null);
  const containerRef = useRef(null);

  const remainingItems = useMemo(
    () => items.filter(it => !winners.some(w => w.itemKey === itemKeyOf(it))),
    [items, winners, itemKeyOf]
  );
  const listRows = useMemo(() => items.map(it => {
    const key = itemKeyOf(it);
    return { key, it, won: winners.some(w => w.itemKey === key) };
  }), [items, winners, itemKeyOf]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (confirmAction) setConfirmAction(null); else onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmAction]);

  // True OS/browser fullscreen (hides the address bar/tab strip too, not
  // just filling the viewport) — requested the moment this screen mounts,
  // exited again on close. Falls back silently to the existing fixed
  // full-viewport overlay if the browser blocks it (still covers the whole
  // page either way). A fullscreenchange listener closes this screen if
  // fullscreen is exited some other way (Esc, F11, browser UI) so the two
  // states never drift apart.
  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    const onFsChange = () => { if (!document.fullscreenElement) onClose(); };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []); // eslint-disable-line

  const handleSpin = () => {
    if (spinning) return;
    if (!remainingItems.length) { setWinner(null); return; } // pool exhausted — drop the stale winner card, reveal the "everyone's won" message instead of silently doing nothing
    setWinner(null);
    setSpinning(true);
    const idx = Math.floor(Math.random() * remainingItems.length);
    const won = remainingItems[idx];
    wheelApiRef.current?.spinTo(idx);
    setTimeout(() => {
      setSpinning(false);
      setWinner(won);
      // saveLuckyDrawWinner (the onWinnerWon this is wired to) already
      // updates the list optimistically and handles its own failure toast —
      // never rejects, so no try/catch needed here.
      onWinnerWon(itemKeyOf(won), winnerInfoOf(won));
    }, SPIN_DURATION_MS);
  };

  const doResetWinners = async () => {
    setResetting(true);
    try {
      await onReset();
      setWinner(null);
    } catch (e) {
      showToast?.(e.message || 'Reset failed', '#dc2626');
    } finally {
      setResetting(false);
    }
  };

  const doResetCoupons = async () => {
    setResettingCoupons(true);
    try {
      await onResetCoupons();
      setWinner(null);
    } catch (e) {
      showToast?.(e.message || 'Reset failed', '#dc2626');
    } finally {
      setResettingCoupons(false);
    }
  };

  const confirmActionNow = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === 'winners') doResetWinners();
    else if (action === 'coupons') doResetCoupons();
  };

  const info = winner ? winnerInfoOf(winner) : null;

  return (
    <div ref={containerRef} style={{ position:'fixed', inset:0, zIndex:20000, background:'#f3f4f6', color:'#111827',
      display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {winner && <RibbonDrop />}

      {confirmAction && (
        <div style={{ position:'absolute', inset:0, zIndex:9, background:'rgba(0,0,0,.45)',
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', color:'#111827', borderRadius:14, padding:'24px 28px',
            maxWidth:400, textAlign:'center', boxShadow:'0 12px 40px rgba(0,0,0,.35)' }}>
            <div style={{ fontSize:15, fontWeight:800 }}>
              {confirmAction === 'winners'
                ? `Clear all ${winners.length} winner${winners.length === 1 ? '' : 's'} and start this draw over?`
                : 'Reset & regenerate all coupon numbers?'}
            </div>
            <div style={{ fontSize:12.5, color:'#6b7280', marginTop:8, lineHeight:1.5 }}>
              {confirmAction === 'winners'
                ? "This can't be undone."
                : "Every coupon number and any saved Coupon Lucky Draw winners are cleared, then everyone currently checked in is handed a fresh sequential number. This can't be undone."}
            </div>
            <div style={{ display:'flex', gap:10, marginTop:20, justifyContent:'center' }}>
              <button onClick={() => setConfirmAction(null)}
                style={{ padding:'9px 20px', borderRadius:9, border:'1px solid #e5e7eb', background:'#f9fafb',
                  color:'#374151', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmActionNow}
                style={{ padding:'9px 20px', borderRadius:9, border:'none', background:'#dc2626',
                  color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                🔄 {confirmAction === 'winners' ? 'Reset' : 'Reset & Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position:'absolute', top:18, right:20, display:'flex', gap:8, zIndex:7 }}>
        {isAdmin && onResetCoupons && (
          <button onClick={() => { if (!spinning) setConfirmAction('coupons'); }} disabled={resettingCoupons || spinning}
            title="Clear every coupon number and winner, then reassign fresh numbers to everyone checked in"
            style={{ display:'flex', alignItems:'center', gap:6, background:'#fff', border:'1px solid #fca5a5',
              borderRadius:8, padding:'0 14px', height:38, color:'#b91c1c', fontSize:12, fontWeight:700,
              cursor: (resettingCoupons || spinning) ? 'default' : 'pointer', boxShadow:'0 1px 4px rgba(0,0,0,.08)' }}>
            🔄 Reset Coupons
          </button>
        )}
        <button onClick={onClose} style={{ background:'#fff',
          border:'1px solid #e5e7eb', borderRadius:8, width:38, height:38, color:'#374151', fontSize:18,
          cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,.08)' }}>
          ✕
        </button>
      </div>

      <div style={{ textAlign:'center', padding:'18px 60px 8px', flexShrink:0, borderBottom:'3px solid #00A651' }}>
        <div style={{ fontSize:19, fontWeight:800, color:'#111827' }}>{event.name}</div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{fmtDate(event.eventDate)}</div>
        {settings.companyNameEn && (
          <div style={{ fontSize:11.5, color:'#374151', marginTop:4, lineHeight:1.4 }}>
            <span style={{ color:'#9ca3af' }}>Organized by</span>{' '}
            <span style={{ fontWeight:800, color:'#00843d' }}>{settings.companyNameEn}</span>
            {organizerTagline && <div style={{ color:'#6b7280' }}>{organizerTagline}</div>}
            {organizerWebsite && <div style={{ color:'#6b7280' }}>{organizerWebsite}</div>}
          </div>
        )}
        <div style={{ fontSize:12.5, color:'#00843d', marginTop:6, fontWeight:700 }}>
          {icon} {subtitle} — {items.length} {items.length === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      <div style={{ flex:1, display:'grid', gridTemplateColumns:'300px 1fr 340px', minHeight:0, overflow:'hidden' }}>
        {/* Left — Winners so far */}
        <div style={{ borderRight:'1px solid #e5e7eb', background:'#fff', padding:'14px 14px 0',
          display:'flex', flexDirection:'column', minHeight:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8, flexShrink:0 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'#92400e', textTransform:'uppercase', letterSpacing:'.5px' }}>
              🏆 Winners ({winners.length})
            </div>
            {winners.length > 0 && (
              <button onClick={() => { if (!spinning) setConfirmAction('winners'); }} disabled={resetting || spinning}
                title="Clear all winners and start this draw over"
                style={{ padding:'3px 9px', borderRadius:6, border:'1px solid #fca5a5', background:'#fef2f2',
                  color:'#b91c1c', fontSize:10.5, fontWeight:700, cursor: (resetting || spinning) ? 'default' : 'pointer', flexShrink:0 }}>
                🔄 Reset
              </button>
            )}
          </div>
          <div className="dg-fixed-height" style={{ height:'calc(100% - 24px)' }}>
            <DataGrid
              columns={[
                { field:'label', header:'Winner', render:(_, r) => (
                  <div>
                    <div style={{ fontWeight:700, fontSize:12.5 }}>{r.label}</div>
                    {r.subtitle1 && <div style={{ fontSize:10.5, color:'#6b7280', marginTop:1 }}>{r.subtitle1}</div>}
                  </div>
                ) },
                { field:'wonAt', header:'Time', width:64, align:'center',
                  render:v => v ? new Date(v).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—' },
              ]}
              data={winners} rowKey="id" compact showSearch={false} showCheckbox={false}
              showFilterButton={false} defaultPageSize={50}
            />
          </div>
        </div>

        {/* Center — Wheel. PrizeWheel is ALWAYS mounted (just hidden behind
            an overlay when there's a winner card or an exhausted-pool
            message to show) — never conditionally removed from the tree,
            since unmounting it resets its internal rotation ref, breaking
            "always spin forward" continuity across repeated spins. The
            winner card takes priority over the exhausted-pool message: the
            very last entry in the pool still needs its own reveal, even
            though the pool is already empty by the time that reveal fires. */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'6px 20px', minHeight:0, position:'relative' }}>
          <div style={{ visibility: (winner || remainingItems.length === 0) ? 'hidden' : 'visible' }}>
            <PrizeWheel items={remainingItems} labelOf={labelOf} spinning={spinning} wheelApiRef={wheelApiRef} onSpinClick={handleSpin} />
          </div>
          {winner ? (
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
              textAlign:'center', background:'linear-gradient(135deg,#f59e0b,#d97706)',
              borderRadius:20, padding:'26px 44px', boxShadow:'0 10px 34px rgba(217,119,6,.35)', zIndex:7, maxWidth:'88vw' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#fff', letterSpacing:'1px', textTransform:'uppercase' }}>🎉 Winner</div>
              <div style={{ fontSize:26, fontWeight:800, color:'#fff', marginTop:8 }}>{info.title}</div>
              {info.subtitle1 && <div style={{ fontSize:15, fontWeight:700, color:'rgba(255,255,255,.95)', marginTop:4 }}>{info.subtitle1}</div>}
              {info.subtitle2 && <div style={{ fontSize:12.5, color:'rgba(255,255,255,.85)', marginTop:2 }}>{info.subtitle2}</div>}
              <button onClick={handleSpin}
                style={{ marginTop:18, padding:'10px 28px', borderRadius:10, border:'none',
                  background:'#00A651', color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                🎰 Spin Again
              </button>
            </div>
          ) : remainingItems.length === 0 && (
            <div style={{ position:'absolute', color:'#9ca3af', fontSize:14, textAlign:'center', maxWidth:320 }}>
              {items.length === 0 ? emptyLabel : '🎉 Everyone has already won — no entries left to spin.'}
            </div>
          )}
        </div>

        {/* Right — Full entry list */}
        <div style={{ borderLeft:'1px solid #e5e7eb', background:'#fff', padding:'14px 14px 0',
          display:'flex', flexDirection:'column', minHeight:0 }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8, flexShrink:0 }}>
            {icon} Full List ({items.length})
          </div>
          <div className="dg-fixed-height" style={{ height:'calc(100% - 24px)' }}>
            <DataGrid
              columns={[
                { field:'entry', header:'Entry', render:(_, r) => (
                  <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>{rowLabelOf(r.it)}</div>
                ) },
                { field:'won', header:'Status', width:82, align:'center',
                  render:(_, r) => r.won
                    ? <Pill bg="#fef3c7" color="#92400e">🏆 Won</Pill>
                    : <Pill bg="#f0fdf4" color="#065f46">In Draw</Pill> },
              ]}
              data={listRows} rowKey="key" compact showCheckbox={false} showFilterButton={false} defaultPageSize={13}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// Full-screen "Appreciation Ceremony" — a sequential caller for recognizing
// every checked-in company one at a time (not a random draw): current
// company shown large/bold, the next one previewed underneath so the
// presenter/audience can see who's up next. Same fullscreen/Esc/branding
// scaffold as LuckyDrawModal above, but with its own uploadable background
// theme (persisted per-event via PATCH /:id/appreciation-theme) since this
// screen is meant to be projected and companies vary event to event.
const AppreciationCeremonyModal = ({ event, themeImage, companies, statusByCompany, onMarkDone, onDeleteCompany, onRestoreCompany, isAdmin, attendeeNamesOf, workScopeOf, onClose, onThemeChange, showToast, organizerTagline, organizerWebsite }) => {
  const { settings } = useSettings();
  // Companies the admin has removed from THIS ceremony's caller list simply
  // vanish from it — the underlying guest check-in data is untouched, this
  // is purely a "don't call this one" overlay (see onDeleteCompany).
  const activeCompanies = useMemo(
    () => companies.filter(c => !statusByCompany[c]?.removed),
    [companies, statusByCompany]
  );
  const [index, setIndex] = useState(0);
  const [uploadingTheme, setUploadingTheme] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  // Company pending a remove confirmation — a plain in-screen card, not
  // window.confirm(): a native blocking dialog forces Chrome/Firefox to exit
  // the Fullscreen API first, which fires the fullscreenchange listener below
  // and closes this whole screen the instant Delete is clicked.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

  // A company removed mid-ceremony (by another admin session, or this one)
  // can shrink the list out from under the current index — keep it in range
  // instead of pointing past the end or at a stale removed entry.
  useEffect(() => {
    setIndex(i => Math.min(i, Math.max(0, activeCompanies.length - 1)));
  }, [activeCompanies.length]);

  // Balloons/ribbons stay up for as long as the presenter lingers on this
  // company — cleared only by actually moving on (Next/Previous, an arrow
  // key, or picking a different company from the list), not on a timer.
  useEffect(() => { setCelebrating(false); }, [index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (confirmDelete) setConfirmDelete(null); else onClose(); }
      else if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, activeCompanies.length - 1));
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, activeCompanies.length, confirmDelete]);

  // True OS/browser fullscreen — same rationale as LuckyDrawModal.
  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    const onFsChange = () => { if (!document.fullscreenElement) onClose(); };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []); // eslint-disable-line

  const handleThemeFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingTheme(true);
    try {
      const dataUrl = await readAndDownscale(file);
      const saved = await api.patch(`/events/${event.id}/appreciation-theme`, { image: dataUrl });
      onThemeChange(saved.appreciationThemeImage);
      showToast('Theme updated');
    } catch (err) { showToast?.(err.message || 'Invalid image', '#dc2626'); }
    finally { setUploadingTheme(false); }
  };

  const current = activeCompanies[index] || null;
  const next = activeCompanies[index + 1] || null;
  const hasTheme = !!themeImage;
  const currentDone = current ? !!statusByCompany[current]?.done : false;

  const handleDone = () => {
    if (!current) return;
    onMarkDone(current, true);
    setCelebrating(true);
  };

  const confirmDeleteNow = () => {
    if (confirmDelete) onDeleteCompany(confirmDelete);
    setConfirmDelete(null);
  };

  return (
    <div ref={containerRef} style={{
      position:'fixed', inset:0, zIndex:20000, overflow:'hidden',
      display:'flex', flexDirection:'column', color:'#fff',
      background: hasTheme
        ? `linear-gradient(rgba(0,20,10,.62),rgba(0,20,10,.72)), url(${themeImage}) center/cover no-repeat`
        : 'linear-gradient(135deg,#00351d,#00611f 45%,#00A651)',
    }}>
      {celebrating && <BalloonRise />}
      {celebrating && <RibbonDrop loop />}

      {confirmDelete && (
        <div style={{ position:'absolute', inset:0, zIndex:9, background:'rgba(0,0,0,.55)',
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', color:'#111827', borderRadius:14, padding:'24px 28px',
            maxWidth:380, textAlign:'center', boxShadow:'0 12px 40px rgba(0,0,0,.35)' }}>
            <div style={{ fontSize:15, fontWeight:800 }}>Remove "{confirmDelete}"?</div>
            <div style={{ fontSize:12.5, color:'#6b7280', marginTop:8, lineHeight:1.5 }}>
              This removes them from this Appreciation Ceremony only — their check-in record is unaffected.
            </div>
            <div style={{ display:'flex', gap:10, marginTop:20, justifyContent:'center' }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ padding:'9px 20px', borderRadius:9, border:'1px solid #e5e7eb', background:'#f9fafb',
                  color:'#374151', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmDeleteNow}
                style={{ padding:'9px 20px', borderRadius:9, border:'none', background:'#dc2626',
                  color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                🗑️ Remove
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ position:'absolute', top:18, right:20, display:'flex', gap:8, zIndex:7 }}>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleThemeFile} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploadingTheme}
          style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,.14)',
            border:'1px solid rgba(255,255,255,.3)', borderRadius:8, padding:'8px 14px', color:'#fff',
            fontSize:12.5, fontWeight:700, cursor: uploadingTheme ? 'default' : 'pointer', backdropFilter:'blur(4px)' }}>
          🖼️ {uploadingTheme ? 'Uploading…' : (hasTheme ? 'Change Theme' : 'Upload Theme')}
        </button>
        <button onClick={onClose} style={{ background:'rgba(255,255,255,.14)',
          border:'1px solid rgba(255,255,255,.3)', borderRadius:8, width:38, height:38, color:'#fff', fontSize:18,
          cursor:'pointer', backdropFilter:'blur(4px)' }}>
          ✕
        </button>
      </div>

      <div style={{ textAlign:'center', padding:'22px 60px 10px', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:800 }}>{event.name}</div>
        <div style={{ fontSize:12.5, color:'rgba(255,255,255,.75)', marginTop:2 }}>{fmtDate(event.eventDate)}</div>
        {settings.companyNameEn && (
          <div style={{ fontSize:11.5, color:'rgba(255,255,255,.85)', marginTop:6, lineHeight:1.4 }}>
            <span style={{ color:'rgba(255,255,255,.6)' }}>Organized by</span>{' '}
            <span style={{ fontWeight:800 }}>{settings.companyNameEn}</span>
            {organizerTagline && <div style={{ color:'rgba(255,255,255,.65)' }}>{organizerTagline}</div>}
            {organizerWebsite && <div style={{ color:'rgba(255,255,255,.65)' }}>{organizerWebsite}</div>}
          </div>
        )}
        <div style={{ fontSize:12.5, marginTop:8, fontWeight:700, color:'#c8f7d9' }}>
          🎪 Appreciation Ceremony
        </div>
      </div>

      <div style={{ flex:1, display:'grid', gridTemplateColumns:'300px 1fr', minHeight:0, overflow:'hidden' }}>
        {/* Every attended company, always visible, not just current+next —
            including ones an admin removed from the calling list (shown
            grayed-out with a Restore option instead of vanishing outright,
            so removing one is never a dead end). Clicking an active row
            jumps straight to it. */}
        <div style={{ borderRight:'1px solid rgba(255,255,255,.18)', background:'rgba(0,0,0,.22)',
          backdropFilter:'blur(3px)', padding:'14px 12px 0', display:'flex', flexDirection:'column', minHeight:0 }}>
          <div style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,.75)', textTransform:'uppercase',
            letterSpacing:'.5px', marginBottom:8, flexShrink:0 }}>
            🏢 Attended Companies ({companies.length})
          </div>
          <div style={{ flex:1, overflowY:'auto', paddingBottom:14, minHeight:0 }}>
            {companies.length === 0 ? (
              <div style={{ fontSize:12.5, color:'rgba(255,255,255,.55)', padding:'8px 4px' }}>
                No companies have checked in yet.
              </div>
            ) : companies.map((c, i) => {
              const removed = !!statusByCompany[c]?.removed;
              const done = !!statusByCompany[c]?.done;
              const activeIndex = activeCompanies.indexOf(c);
              const isCurrent = !removed && activeIndex === index;
              return (
                <div key={c} onClick={() => { if (!removed) setIndex(activeIndex); }} style={{
                  display:'flex', alignItems:'center', gap:8, padding:'8px 9px', borderRadius:8,
                  marginBottom:5, cursor: removed ? 'default' : 'pointer', opacity: removed ? .55 : 1,
                  background: isCurrent ? 'rgba(255,255,255,.18)' : 'transparent',
                  border: isCurrent ? '1px solid rgba(255,255,255,.4)' : '1px solid transparent',
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:'#fff', whiteSpace:'nowrap',
                      overflow:'hidden', textOverflow:'ellipsis', textDecoration: removed ? 'line-through' : 'none' }}>
                      {i + 1}. {c}
                    </div>
                  </div>
                  {removed
                    ? <Pill bg="rgba(220,38,38,.22)" color="#fecaca">🚫 Removed</Pill>
                    : done
                    ? <Pill bg="#d1fae5" color="#065f46">✅ Done</Pill>
                    : <Pill bg="rgba(255,255,255,.16)" color="rgba(255,255,255,.8)">⏳ Pending</Pill>}
                  {isAdmin && (removed ? (
                    <button onClick={(e) => { e.stopPropagation(); onRestoreCompany(c); }}
                      title="Restore to this ceremony"
                      style={{ background:'rgba(16,185,129,.2)', border:'1px solid rgba(16,185,129,.45)',
                        borderRadius:6, width:24, height:24, color:'#a7f3d0', fontSize:12, cursor:'pointer',
                        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      ↩️
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(c); }}
                      title="Remove from this ceremony"
                      style={{ background:'rgba(220,38,38,.18)', border:'1px solid rgba(220,38,38,.4)',
                        borderRadius:6, width:24, height:24, color:'#fecaca', fontSize:12, cursor:'pointer',
                        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      🗑️
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:0, padding:'10px 40px', position:'relative' }}>
          {companies.length === 0 ? (
            <div style={{ fontSize:16, color:'rgba(255,255,255,.75)', textAlign:'center' }}>
              No companies have checked in yet.
            </div>
          ) : activeCompanies.length === 0 ? (
            <div style={{ fontSize:16, color:'rgba(255,255,255,.75)', textAlign:'center', maxWidth:420 }}>
              Every attended company has been removed from this ceremony.
              <div style={{ fontSize:13, color:'rgba(255,255,255,.55)', marginTop:8 }}>
                Use ↩️ on the list to the left to bring one back.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize:14, fontWeight:700, letterSpacing:'2px', textTransform:'uppercase', color:'rgba(255,255,255,.7)' }}>
                Now Appreciating
              </div>
              <div style={{ fontSize:'clamp(32px, 5vw, 68px)', fontWeight:800, textAlign:'center', margin:'10px 0', lineHeight:1.15,
                textShadow:'0 4px 24px rgba(0,0,0,.35)', maxWidth:'92vw' }}>
                {current}
              </div>
              {attendeeNamesOf(current) && (
                <div style={{ fontSize:16, fontWeight:600, color:'rgba(255,255,255,.9)', marginTop:2, textAlign:'center' }}>
                  {attendeeNamesOf(current)}
                </div>
              )}
              {workScopeOf(current) && (
                <div style={{ fontSize:13, color:'rgba(255,255,255,.65)', marginTop:4, textAlign:'center' }}>
                  {workScopeOf(current)}
                </div>
              )}

              <button onClick={handleDone} disabled={currentDone}
                style={{ marginTop:22, display:'flex', alignItems:'center', gap:8, padding:'11px 28px', borderRadius:11,
                  border:'none', background: currentDone ? 'rgba(255,255,255,.18)' : '#facc15',
                  color: currentDone ? 'rgba(255,255,255,.7)' : '#78350f', fontSize:14, fontWeight:800,
                  cursor: currentDone ? 'default' : 'pointer',
                  boxShadow: currentDone ? 'none' : '0 4px 16px rgba(250,204,21,.4)' }}>
                {currentDone ? '✅ Appreciated' : '✅ Done'}
              </button>

              <div style={{ marginTop:26, display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                opacity: next ? 1 : 0, transition:'opacity .2s' }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'rgba(255,255,255,.5)' }}>
                  Next
                </div>
                <div style={{ fontSize:22, fontWeight:700, color:'rgba(255,255,255,.8)' }}>
                  {next || '—'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', gap:16, padding:'18px 20px 26px' }}>
        <button onClick={() => setIndex(i => Math.max(i - 1, 0))} disabled={index === 0 || activeCompanies.length === 0}
          style={{ padding:'11px 22px', borderRadius:10, border:'1px solid rgba(255,255,255,.35)',
            background:'rgba(255,255,255,.12)', color:'#fff', fontSize:13.5, fontWeight:700,
            cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? .45 : 1 }}>
          ◀ Previous
        </button>
        <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,.75)', minWidth:70, textAlign:'center' }}>
          {activeCompanies.length > 0 ? `${index + 1} / ${activeCompanies.length}` : '0 / 0'}
        </div>
        <button onClick={() => setIndex(i => Math.min(i + 1, activeCompanies.length - 1))}
          disabled={index >= activeCompanies.length - 1}
          style={{ padding:'11px 26px', borderRadius:10, border:'none',
            background:'#00A651', color:'#fff', fontSize:13.5, fontWeight:800,
            cursor: index >= activeCompanies.length - 1 ? 'default' : 'pointer',
            opacity: index >= activeCompanies.length - 1 ? .45 : 1,
            boxShadow: index >= activeCompanies.length - 1 ? 'none' : '0 3px 12px rgba(0,166,81,.4)' }}>
          Next ▶
        </button>
      </div>
    </div>
  );
};

const EMPTY_QA = { question:'', option1:'', option2:'', option3:'', option4:'', correctOption:null };
const QA_OPT_LABEL = ['A', 'B', 'C', 'D'];
// Kahoot-style distinct, high-contrast colors — one per answer option — used
// in the audience-facing Present view so each option reads at a glance.
const QA_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];

const winnerLineOf = (q) => {
  if (!q.winnerCompany && !q.winnerName) return null;
  return { company: q.winnerCompany || null, guest: q.winnerName || null };
};

// Full-screen "Question Lucky Draw" — multiple rounds per event, navigable
// with Next/Back arrows (oldest → newest). Authoring a question (create or
// edit its text/options/correct answer) is Admin/Super Admin only — anyone
// else with page access can still run a round already sent (record the
// winner, mark complete). A separate "Present" view — big type, one color
// per option, a Check Answer reveal — is meant to be shown to the room,
// distinct from this screen's own admin controls.
const QaDrawModal = ({ event, qaDraws, guests, onCreate, onUpdate, onDelete, onClose, showToast, organizerTagline, organizerWebsite }) => {
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const chronological = useMemo(() => [...qaDraws].sort((a, b) => a.id - b.id), [qaDraws]);
  const companies = useMemo(() => [...new Set(
    (guests || []).filter(g => g.attended && g.organization).map(g => g.organization)
  )].sort(), [guests]);

  const [viewId, setViewId] = useState(() => {
    const activeRound = qaDraws.find(q => !q.completed);
    return (activeRound || chronological[chronological.length - 1] || null)?.id ?? null;
  });
  const [composing, setComposing] = useState(chronological.length === 0);
  const [composeForm, setComposeForm] = useState({ ...EMPTY_QA });
  const [editingContent, setEditingContent] = useState(false);
  const [editForm, setEditForm] = useState({ ...EMPTY_QA });
  const [winnerCompanyDraft, setWinnerCompanyDraft] = useState('');
  const [winnerNameDraft, setWinnerNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Present to Room is the default view for everyone the moment there's a
  // question to show — the backstage Manage screen (edit, winner, complete,
  // new/delete) is only ever reachable via the ⚙️ Manage button inside
  // Present view, which is itself only rendered for admin/superAdmin. A
  // non-admin therefore has no way to leave Present view at all when a
  // round exists — matches the question authoring being admin-only too.
  const [presenting, setPresenting] = useState(chronological.length > 0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const viewIndex = chronological.findIndex(q => q.id === viewId);
  const current = !composing && viewIndex >= 0 ? chronological[viewIndex] : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setWinnerCompanyDraft(current?.winnerCompany || '');
    setWinnerNameDraft(current?.winnerName || '');
    setEditingContent(false);
    setSelectedOption(null);
    setRevealed(false);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = () => { if (viewIndex > 0) { setComposing(false); setViewId(chronological[viewIndex - 1].id); } };
  const goNext = () => { if (viewIndex < chronological.length - 1) { setComposing(false); setViewId(chronological[viewIndex + 1].id); } };

  const send = async () => {
    if (!composeForm.question.trim()) return;
    if (![composeForm.option1, composeForm.option2, composeForm.option3, composeForm.option4].every(o => o.trim())) return;
    setSaving(true);
    try {
      const saved = await onCreate(composeForm);
      if (saved) { setComposeForm({ ...EMPTY_QA }); setComposing(false); setViewId(saved.id); }
    } finally { setSaving(false); }
  };

  const openEdit = () => {
    if (!current) return;
    setEditForm({ question: current.question, option1: current.option1, option2: current.option2,
      option3: current.option3, option4: current.option4, correctOption: current.correctOption });
    setEditingContent(true);
  };
  const saveEdit = async () => {
    if (!current) return;
    if (!editForm.question.trim()) return;
    if (![editForm.option1, editForm.option2, editForm.option3, editForm.option4].every(o => o.trim())) return;
    setSaving(true);
    try { await onUpdate(current.id, editForm); setEditingContent(false); }
    finally { setSaving(false); }
  };

  const saveWinner = async () => {
    if (!current) return;
    setSaving(true);
    try { await onUpdate(current.id, { winnerCompany: winnerCompanyDraft, winnerName: winnerNameDraft }); }
    finally { setSaving(false); }
  };
  const markComplete = async () => {
    if (!current) return;
    setSaving(true);
    try { await onUpdate(current.id, { winnerCompany: winnerCompanyDraft, winnerName: winnerNameDraft, completed: true }); }
    finally { setSaving(false); }
  };

  const NavArrows = ({ dark }) => (
    <>
      <button onClick={goBack} disabled={viewIndex <= 0} title="Previous question"
        style={{ padding:'6px 12px', borderRadius:8, border: dark ? '1px solid rgba(255,255,255,.3)' : '1px solid #d1d5db',
          background: dark ? 'rgba(255,255,255,.08)' : '#fff', color: dark ? '#fff' : '#374151',
          fontSize:14, fontWeight:800, cursor: viewIndex <= 0 ? 'default' : 'pointer', opacity: viewIndex <= 0 ? .4 : 1 }}>
        ◀ Back
      </button>
      <span style={{ fontSize:12, fontWeight:700, color: dark ? 'rgba(255,255,255,.7)' : '#6b7280' }}>
        Round {viewIndex + 1} / {chronological.length}
      </span>
      <button onClick={goNext} disabled={viewIndex >= chronological.length - 1} title="Next question"
        style={{ padding:'6px 12px', borderRadius:8, border: dark ? '1px solid rgba(255,255,255,.3)' : '1px solid #d1d5db',
          background: dark ? 'rgba(255,255,255,.08)' : '#fff', color: dark ? '#fff' : '#374151',
          fontSize:14, fontWeight:800, cursor: viewIndex >= chronological.length - 1 ? 'default' : 'pointer',
          opacity: viewIndex >= chronological.length - 1 ? .4 : 1 }}>
        Next ▶
      </button>
    </>
  );

  const winner = current ? winnerLineOf(current) : null;

  // ── Present view — the audience-facing "user view", big type, one color
  // per option, tap to select then reveal (blinks the correct one). ──
  if (presenting && current) {
    return (
      <div style={{ position:'fixed', inset:0, zIndex:20000, background:'#111827', color:'#fff',
        display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <style>{`
          @keyframes qaBlink {
            0%, 100% { box-shadow: 0 6px 18px rgba(0,0,0,.35), 0 0 0 6px rgba(255,255,255,.95); }
            50%      { box-shadow: 0 6px 18px rgba(0,0,0,.35), 0 0 0 6px rgba(255,255,255,0); }
          }
          .qa-blink { animation: qaBlink .9s ease-in-out infinite; }
        `}</style>
        <div style={{ position:'absolute', top:18, right:20, zIndex:7, display:'flex', gap:8 }}>
          {isAdmin && (
            <button onClick={() => setPresenting(false)} title="Manage this draw (Admin)"
              style={{ padding:'0 14px', height:38, background:'rgba(255,255,255,.1)',
                border:'1px solid rgba(255,255,255,.25)', borderRadius:8, color:'#fff', fontSize:12.5, fontWeight:700,
                cursor:'pointer' }}>
              ⚙️ Manage
            </button>
          )}
          <button onClick={onClose} title="Close"
            style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.25)', borderRadius:8,
              width:38, height:38, color:'#fff', fontSize:16, cursor:'pointer' }}>
            ✕
          </button>
        </div>

        <div style={{ textAlign:'center', padding:'26px 100px 6px', flexShrink:0 }}>
          <div style={{ fontSize:15, color:'rgba(255,255,255,.65)' }}>{event.name}</div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,.5)', marginTop:4 }}>
            🏆 Winner: {winner ? `${winner.company || ''}${winner.company && winner.guest ? ' — ' : ''}${winner.guest || ''}` : '—'}
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:14, marginTop:12 }}>
            <NavArrows dark />
          </div>
        </div>

        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'10px 80px 30px', minHeight:0 }}>
          <div style={{ fontSize:'clamp(22px,3.6vw,40px)', fontWeight:800, textAlign:'center', marginBottom:30, maxWidth:1000, lineHeight:1.3 }}>
            {current.question}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, width:'100%', maxWidth:880 }}>
            {[current.option1, current.option2, current.option3, current.option4].map((opt, i) => {
              const isCorrect = current.correctOption === i + 1;
              const isSelected = selectedOption === i + 1;
              const showBlink = revealed && isCorrect;
              const showWrong = revealed && isSelected && !isCorrect;
              return (
                <button key={i} onClick={() => !revealed && setSelectedOption(i + 1)}
                  className={showBlink ? 'qa-blink' : ''}
                  style={{ padding:'22px 22px', borderRadius:16, border: isSelected && !revealed ? '4px solid #fff' : '4px solid transparent',
                    background: QA_COLORS[i], color:'#fff', fontSize:20, fontWeight:800, textAlign:'left',
                    cursor: revealed ? 'default' : 'pointer', opacity: showWrong ? .4 : 1,
                    display:'flex', alignItems:'center', gap:14, boxShadow: showBlink ? undefined : '0 6px 18px rgba(0,0,0,.3)' }}>
                  <span style={{ width:38, height:38, borderRadius:'50%', background:'rgba(255,255,255,.25)',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:16 }}>
                    {QA_OPT_LABEL[i]}
                  </span>
                  <span style={{ lineHeight:1.3 }}>{opt}</span>
                  {showBlink && <span style={{ marginLeft:'auto', fontSize:24, flexShrink:0 }}>✓</span>}
                  {showWrong && <span style={{ marginLeft:'auto', fontSize:24, flexShrink:0 }}>✗</span>}
                </button>
              );
            })}
          </div>
          {!revealed ? (
            <button onClick={() => setRevealed(true)} disabled={current.correctOption == null}
              title={current.correctOption == null ? 'No correct answer set for this question yet' : undefined}
              style={{ marginTop:32, padding:'15px 46px', borderRadius:14, border:'none', background:'#00A651', color:'#fff',
                fontSize:17, fontWeight:800, cursor: current.correctOption == null ? 'default' : 'pointer',
                opacity: current.correctOption == null ? .5 : 1 }}>
              ✅ Check Answer
            </button>
          ) : (
            <button onClick={() => { setRevealed(false); setSelectedOption(null); }}
              style={{ marginTop:32, padding:'13px 38px', borderRadius:14, border:'1px solid rgba(255,255,255,.4)',
                background:'transparent', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer' }}>
              🔄 Reset
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:20000, background:'#f3f4f6', color:'#111827',
      display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <button onClick={onClose} style={{ position:'absolute', top:18, right:20, background:'#fff',
        border:'1px solid #e5e7eb', borderRadius:8, width:38, height:38, color:'#374151', fontSize:18,
        cursor:'pointer', zIndex:7, boxShadow:'0 1px 4px rgba(0,0,0,.08)' }}>
        ✕
      </button>

      <div style={{ textAlign:'center', padding:'22px 60px 8px', flexShrink:0, borderBottom:'3px solid #00A651' }}>
        <div style={{ fontSize:19, fontWeight:800, color:'#111827' }}>{event.name}</div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{fmtDate(event.eventDate)}</div>
        {settings.companyNameEn && (
          <div style={{ fontSize:11.5, color:'#374151', marginTop:4, lineHeight:1.4 }}>
            <span style={{ color:'#9ca3af' }}>Organized by</span>{' '}
            <span style={{ fontWeight:800, color:'#00843d' }}>{settings.companyNameEn}</span>
            {organizerTagline && <div style={{ color:'#6b7280' }}>{organizerTagline}</div>}
            {organizerWebsite && <div style={{ color:'#6b7280' }}>{organizerWebsite}</div>}
          </div>
        )}
        <div style={{ fontSize:12.5, color:'#00843d', marginTop:6, fontWeight:700 }}>❓ Question Lucky Draw</div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'10px 20px 24px' }}>
        <div style={{ maxWidth:560, margin:'0 auto' }}>
          {chronological.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:14, marginBottom:16, flexWrap:'wrap' }}>
              <NavArrows />
              {isAdmin && (
                <button onClick={() => setComposing(true)} disabled={composing}
                  style={{ padding:'6px 14px', borderRadius:8, border:'1px solid #93c5fd', background:'#eff6ff',
                    color:'#1d4ed8', fontSize:12.5, fontWeight:700, cursor: composing ? 'default' : 'pointer', opacity: composing ? .5 : 1 }}>
                  + New Question
                </button>
              )}
            </div>
          )}

          {composing ? (
            isAdmin ? (
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'#374151' }}>Send a new question</div>
                  {chronological.length > 0 && (
                    <button onClick={() => setComposing(false)}
                      style={{ background:'none', border:'none', color:'#6b7280', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                      Cancel
                    </button>
                  )}
                </div>
                <textarea value={composeForm.question} onChange={e => setComposeForm(f => ({ ...f, question:e.target.value }))}
                  placeholder="Question" rows={2}
                  style={{ width:'100%', padding:'12px 14px', borderRadius:10, border:'1px solid #d1d5db',
                    background:'#fff', color:'#111827', fontSize:14.5, fontWeight:600, resize:'vertical' }} />
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12 }}>
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <input type="radio" name="compose-correct-option" checked={composeForm.correctOption === i + 1}
                        onChange={() => setComposeForm(f => ({ ...f, correctOption: i + 1 }))}
                        title="Mark as correct answer"
                        style={{ width:18, height:18, flexShrink:0, cursor:'pointer', accentColor:'#10b981' }} />
                      <button type="button" onClick={() => setComposeForm(f => ({ ...f, correctOption: i + 1 }))}
                        title="Mark as correct answer"
                        style={{ width:28, height:28, borderRadius:'50%', flexShrink:0, cursor:'pointer',
                          border: `1.5px solid ${composeForm.correctOption === i + 1 ? '#10b981' : '#d1d5db'}`,
                          background: composeForm.correctOption === i + 1 ? '#10b981' : '#fff',
                          color: composeForm.correctOption === i + 1 ? '#fff' : '#374151', fontSize:11, fontWeight:800 }}>
                        {QA_OPT_LABEL[i]}
                      </button>
                      <input value={composeForm[`option${i + 1}`]} onChange={e => setComposeForm(f => ({ ...f, [`option${i + 1}`]: e.target.value }))}
                        placeholder={`Option ${QA_OPT_LABEL[i]}`}
                        style={{ flex:1, padding:'10px 12px', borderRadius:9, border:'1px solid #d1d5db',
                          background:'#fff', color:'#111827', fontSize:13.5 }} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:10.5, color:'#9ca3af', marginTop:8 }}>
                  Check the correct answer — needed for "Check Answer" in Present view.
                </div>
                <button onClick={send} disabled={saving}
                  style={{ marginTop:16, width:'100%', padding:'13px 0', borderRadius:12, border:'none',
                    background:'#1a56db', color:'#fff', fontSize:14.5, fontWeight:800, cursor:'pointer' }}>
                  📤 Send Question
                </button>
              </div>
            ) : (
              <div style={{ textAlign:'center', color:'#9ca3af', fontSize:13.5, padding:'40px 0' }}>
                No questions yet — ask an Admin to add one.
              </div>
            )
          ) : current && (
            <div>
              <div style={{ background:'#fff', border:'1px solid #e5e7eb',
                borderRadius:16, padding:'22px 24px', boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px' }}>
                    Question {current.completed && <span style={{ color:'#059669' }}>· ✅ Completed</span>}
                  </div>
                  {isAdmin && !editingContent && (
                    <button onClick={openEdit}
                      style={{ background:'none', border:'1px solid #d1d5db', borderRadius:7, padding:'3px 10px',
                        color:'#374151', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                      ✏️ Edit
                    </button>
                  )}
                </div>

                {editingContent ? (
                  <div style={{ marginTop:10 }}>
                    <textarea value={editForm.question} onChange={e => setEditForm(f => ({ ...f, question:e.target.value }))}
                      rows={2} style={{ width:'100%', padding:'12px 14px', borderRadius:10, border:'1px solid #d1d5db',
                        background:'#fff', color:'#111827', fontSize:14.5, fontWeight:600, resize:'vertical' }} />
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12 }}>
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <input type="radio" name="edit-correct-option" checked={editForm.correctOption === i + 1}
                            onChange={() => setEditForm(f => ({ ...f, correctOption: i + 1 }))}
                            title="Mark as correct answer"
                            style={{ width:18, height:18, flexShrink:0, cursor:'pointer', accentColor:'#10b981' }} />
                          <button type="button" onClick={() => setEditForm(f => ({ ...f, correctOption: i + 1 }))}
                            title="Mark as correct answer"
                            style={{ width:28, height:28, borderRadius:'50%', flexShrink:0, cursor:'pointer',
                              border: `1.5px solid ${editForm.correctOption === i + 1 ? '#10b981' : '#d1d5db'}`,
                              background: editForm.correctOption === i + 1 ? '#10b981' : '#fff',
                              color: editForm.correctOption === i + 1 ? '#fff' : '#374151', fontSize:11, fontWeight:800 }}>
                            {QA_OPT_LABEL[i]}
                          </button>
                          <input value={editForm[`option${i + 1}`]} onChange={e => setEditForm(f => ({ ...f, [`option${i + 1}`]: e.target.value }))}
                            placeholder={`Option ${QA_OPT_LABEL[i]}`}
                            style={{ flex:1, padding:'10px 12px', borderRadius:9, border:'1px solid #d1d5db',
                              background:'#fff', color:'#111827', fontSize:13.5 }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:8, marginTop:14 }}>
                      <button onClick={() => setEditingContent(false)}
                        style={{ flex:1, padding:'10px 0', borderRadius:10, border:'1px solid #d1d5db',
                          background:'#fff', color:'#374151', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                        Cancel
                      </button>
                      <button onClick={saveEdit} disabled={saving}
                        style={{ flex:1, padding:'10px 0', borderRadius:10, border:'none',
                          background:'#1a56db', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                        💾 Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize:19, fontWeight:800, color:'#111827', marginTop:6, lineHeight:1.4 }}>{current.question}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:18 }}>
                      {[current.option1, current.option2, current.option3, current.option4].map((opt, i) => (
                        <div key={i} style={{
                          display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:10,
                          background: current.correctOption === i + 1 ? '#ecfdf5' : '#f9fafb',
                          border: `1.5px solid ${current.correctOption === i + 1 ? '#10b981' : '#e5e7eb'}`,
                        }}>
                          <span style={{ width:26, height:26, borderRadius:'50%', background:'#eef2ff', color:'#1a56db',
                            display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 }}>
                            {QA_OPT_LABEL[i]}
                          </span>
                          <span style={{ fontSize:13.5, fontWeight:600, color:'#111827' }}>{opt}</span>
                          {current.correctOption === i + 1 && <span style={{ marginLeft:'auto', fontSize:15, color:'#059669' }}>✓</span>}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setPresenting(true)}
                      style={{ marginTop:16, width:'100%', padding:'11px 0', borderRadius:10, border:'none',
                        background:'#111827', color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                      🖥️ Present to Room
                    </button>
                  </>
                )}
              </div>

              {/* Winner is always shown/editable on every round's page, whether
                  active or already completed — a company picked from this
                  event's checked-in companies, plus the specific guest's name. */}
              <div style={{ marginTop:18 }}>
                <div style={{ fontSize:11.5, fontWeight:700, color:'#6b7280', marginBottom:6 }}>🏆 Winner</div>
                <SearchableSelect value={winnerCompanyDraft} onChange={setWinnerCompanyDraft}
                  options={companies.map(c => ({ value:c, label:c }))}
                  placeholder="— Select winning company —" />
                <input value={winnerNameDraft} onChange={e => setWinnerNameDraft(e.target.value)}
                  placeholder="Guest name…" style={{ width:'100%', marginTop:8, padding:'11px 14px', borderRadius:10,
                    border:'1px solid #d1d5db', background:'#fff', color:'#111827', fontSize:14, boxSizing:'border-box' }} />
                <button onClick={saveWinner} disabled={saving}
                  style={{ marginTop:8, width:'100%', padding:'10px 0', borderRadius:10, border:'1px solid #d1d5db',
                    background:'#fff', color:'#374151', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                  Save Winner
                </button>
                {!current.completed && (
                  <button onClick={markComplete} disabled={saving || (!winnerCompanyDraft.trim() && !winnerNameDraft.trim())}
                    style={{ marginTop:10, width:'100%', padding:'13px 0', borderRadius:12, border:'none',
                      background: (winnerCompanyDraft.trim() || winnerNameDraft.trim()) ? '#059669' : '#d1d5db', color:'#fff',
                      fontSize:14.5, fontWeight:800,
                      cursor: (winnerCompanyDraft.trim() || winnerNameDraft.trim()) ? 'pointer' : 'default' }}>
                    ✅ Mark as Completed
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => onDelete(current.id)}
                    style={{ marginTop:10, width:'100%', padding:'9px 0', borderRadius:10, border:'1px solid #fecaca',
                      background:'#fef2f2', color:'#dc2626', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    🗑 Delete This Round
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const EMPTY_EVENT = { name:'', eventDate:'', venue:'', description:'', invitationImage:'',
  photoGalleryFacebook:'', photoGalleryGoogleDrive:'', photoGalleryInstagram:'', photoGalleryTiktok:'' };
const EMPTY_GUEST = { contactId:null, contactPersonId:null, name:'', contact:'', organization:'', invited:true, confirmed:false,
  attended:false, checkedInAt:null, invitationSent:false, invitationPhoto:'', remark:'', expectedGuests:1, participantCount:'' };
const EMPTY_PRODUCT = { productName:'', quantity:1, sentOut:false, returned:false, remark:'' };
const EMPTY_GIFT = { giftName:'', recipientName:'', quantity:1, remark:'' };
const EMPTY_AWARD = { awardName:'', recipientName:'', remark:'' };

// ── Generic small modal shell (used by every Add/Edit form below) ──────────
const FormModal = ({ title, onClose, onSubmit, saving, children, wide, extraWide }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: extraWide ? 880 : (wide ? 560 : 440), width:'94vw' }}>
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {children}
      </div>
      <div className="modal-footer">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save'}
        </button>
      </div>
    </div>
  </div>
);

const Field = ({ label, required, children }) => (
  <div className="form-group">
    <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
      {label}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
    </label>
    {children}
  </div>
);

const Toggle = ({ value, onChange, label, onColor='#059669' }) => (
  <div onClick={() => onChange(!value)} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none' }}>
    <div style={{ width:38, height:21, background: value ? onColor : '#d1d5db', borderRadius:11,
      position:'relative', transition:'background .15s', flexShrink:0 }}>
      <div style={{ position:'absolute', top:2, left: value ? 19 : 2, width:17, height:17,
        background:'#fff', borderRadius:'50%', transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.25)' }} />
    </div>
    <span style={{ fontSize:12.5, fontWeight:600, color: value ? '#111827' : '#6b7280' }}>{label}</span>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
//  Event Detail — Guests / Products / Gifts / Awards tabs
// ══════════════════════════════════════════════════════════════════════════
// Same "Company name if company, else Person name" convention as
// StaffContact.jsx's own displayName() — kept in sync since Guests link
// into that same staff_contacts data.
const contactDisplayName = (c) => c.contactInfo === 'company' ? (c.companyName || '—') : (c.personName || '—');
const contactDisplayPhone = (c) => c.contactInfo === 'company' ? (c.companyPhone || '') : (c.mobile1 || '');
const contactDisplayOrg = (c) => c.contactInfo === 'company' ? (c.companyName || '') : (c.office || '');

const EventDetail = ({ event, onBack, onEventChanged, showToast }) => {
  const { settings } = useSettings();
  // Guest Registration permission — Add/Edit are one combined "edit" grant
  // (matches the app-wide convention, see Role & Permission Management's own
  // legend: "Edit — can add or modify records"); Delete is separate and, per
  // this page's own default permissions, off for every non-admin role.
  const { canEdit: canEditPage, canDelete: canDeletePage, isAdmin } = useAuth();
  const canEditGuests = canEditPage('eventVisitorRegistration');
  const canDeleteGuests = canDeletePage('eventVisitorRegistration');
  const [tab, setTab] = useState('guests');
  const [imagePreview, setImagePreview] = useState(null);
  const [showCouponDraw, setShowCouponDraw] = useState(false);
  const [showCompanyDraw, setShowCompanyDraw] = useState(false);
  const [showQaDraw, setShowQaDraw] = useState(false);
  const [showAppreciation, setShowAppreciation] = useState(false);
  // Local mirror of event.appreciationThemeImage — EventDetail doesn't own
  // activeEvent (that lives in the parent list page, which never passed a
  // way to update it back), so an uploaded theme is tracked here instead of
  // waiting on a round-trip through the parent. Resyncs whenever a different
  // event is opened.
  const [appreciationTheme, setAppreciationTheme] = useState(event.appreciationThemeImage || null);
  useEffect(() => { setAppreciationTheme(event.appreciationThemeImage || null); }, [event.id]); // eslint-disable-line
  const [guests, setGuests] = useState([]);
  const [qaDraws, setQaDraws] = useState([]);
  const [luckyDrawWinners, setLuckyDrawWinners] = useState([]);
  const [appreciationStatus, setAppreciationStatus] = useState([]); // [{ company, done, removed }]
  const [products, setProducts] = useState([]);
  const [gifts, setGifts] = useState([]);
  const [awards, setAwards] = useState([]);
  const [contacts, setContacts] = useState([]); // Staff → Contact database, for "Link to Contact"
  const [loading, setLoading] = useState(true);
  const [guestFilter, setGuestFilter] = useState('all'); // all | invited | confirmed | attended | uncalled

  const [guestModal, setGuestModal] = useState(null);
  const [productModal, setProductModal] = useState(null);
  const [giftModal, setGiftModal] = useState(null);
  const [awardModal, setAwardModal] = useState(null);
  const [saving, setSaving] = useState(false);

  // Followup History — per guest
  const [followupModal, setFollowupModal] = useState(null); // { guest, list, loading }
  const [addFollowupModal, setAddFollowupModal] = useState(false);
  const [editingFollowupId, setEditingFollowupId] = useState(null); // null = creating new
  const [followupForm, setFollowupForm] = useState({ ...EMPTY_FOLLOWUP_FORM });
  const [followupSaving, setFollowupSaving] = useState(false);
  const toggleFollowupMedia = (m) => setFollowupForm(f => ({ ...f,
    media: f.media.includes(m) ? f.media.filter(x => x !== m) : [...f.media, m] }));
  const toggleFollowupStatus = (s) => setFollowupForm(f => ({ ...f,
    statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s] }));

  // Right-side guest panel — Post/Mobile/Email for whichever guest is
  // currently open. Only known once fetched from its linked Contact Person
  // (same as the Edit form's own linkedPersonInfo, but scoped to the panel).
  // Also fetches the FULL company roster (not just whoever's already a
  // guest) so the tab bar can show everyone, same as the Edit modal's own
  // "Guests From this Company" grid.
  const [panelPersonInfo, setPanelPersonInfo] = useState(null);
  const [panelCompanyPersons, setPanelCompanyPersons] = useState([]);
  const [previewPersonId, setPreviewPersonId] = useState(null); // set when a tab with no guest record yet is clicked
  useEffect(() => {
    const g = followupModal?.guest;
    setPreviewPersonId(null);
    if (!g?.contactId) { setPanelPersonInfo(null); setPanelCompanyPersons([]); return; }
    api.get(`/contacts/${g.contactId}/persons`).then(list => {
      setPanelCompanyPersons(list);
      const p = g.contactPersonId ? list.find(x => x.id === g.contactPersonId) : null;
      setPanelPersonInfo(p ? { post:p.post||'', mobile1:p.mobile1||'', mobile2:p.mobile2||'', email:p.email||'' } : null);
    }).catch(() => { setPanelPersonInfo(null); setPanelCompanyPersons([]); });
  }, [followupModal?.guest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contact Person picker — opens when a Company contact is linked, so the
  // actual attendee is one specific person at that company (reusing Staff →
  // Contact's own Contact Persons sub-records), not the company name itself.
  const [personPickerModal, setPersonPickerModal] = useState(null); // { contact, persons, loading, editing }
  const [personSaving, setPersonSaving] = useState(false);

  // Full details (Post, Mobile 2, Email — not stored on the guest row itself)
  // of whichever contact/person is currently linked to the open Guest form,
  // shown in the "Staff Information"-style read-only card.
  const [linkedPersonInfo, setLinkedPersonInfo] = useState(null);
  useEffect(() => {
    const contactId = guestModal?.form?.contactId;
    const contactPersonId = guestModal?.form?.contactPersonId;
    if (!guestModal || !contactId) { setLinkedPersonInfo(null); return; }
    if (contactPersonId) {
      api.get(`/contacts/${contactId}/persons`).then(list => {
        const p = list.find(x => x.id === contactPersonId);
        if (p) setLinkedPersonInfo({ name:p.name, post:p.post||'', mobile1:p.mobile1||'', mobile2:p.mobile2||'', email:p.email||'' });
      }).catch(() => {});
    } else {
      const c = contacts.find(x => x.id === contactId);
      if (c) setLinkedPersonInfo({ name:contactDisplayName(c), post:'', mobile1:c.mobile1||'', mobile2:c.mobile2||'', email:c.email||'' });
    }
  }, [guestModal?.form?.contactId, guestModal?.form?.contactPersonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full company roster (every Contact Person on file for this company, not
  // just whoever already happens to be a guest for this event) — shown in
  // the modal's "Guests From this Company" grid so staff can see everyone,
  // pick who to check status for, without it being capped by who's already
  // been added here.
  const [companyPersons, setCompanyPersons] = useState([]);
  const [selectedRosterPersonId, setSelectedRosterPersonId] = useState(null);
  useEffect(() => {
    const contactId = guestModal?.form?.contactId;
    setSelectedRosterPersonId(null);
    if (!contactId) { setCompanyPersons([]); return; }
    api.get(`/contacts/${contactId}/persons`).then(setCompanyPersons).catch(() => setCompanyPersons([]));
  }, [guestModal?.form?.contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Scan to Check In" QR — one per (event, company), regenerated whenever a
  // Company (not a personal contact — self check-in only makes sense for a
  // company's own attendees) is linked in the open Guest form. Only
  // auto-pops up while EDITING an existing guest (guestModal.id set) — for
  // a brand new guest the company was just picked a second ago and there's
  // nothing to scan yet, so it's generated quietly and shown on demand via
  // the "📱 View QR" button instead of interrupting the Add Guest form.
  const [companyQr, setCompanyQr] = useState(null); // { dataUrl, url, organization } | null
  const [showQrPopup, setShowQrPopup] = useState(false);
  useEffect(() => {
    const contactId = guestModal?.form?.contactId;
    if (!guestModal || !contactId) { setCompanyQr(null); setShowQrPopup(false); return; }
    const c = contacts.find(x => x.id === contactId);
    if (!c || c.contactInfo !== 'company') { setCompanyQr(null); setShowQrPopup(false); return; }
    const isEditingExisting = !!guestModal.id;
    let cancelled = false;
    api.get(`/events/${event.id}/checkin-token?contactId=${contactId}`).then(async ({ token }) => {
      if (cancelled) return;
      const url = `${window.location.origin}${getTenantPrefix()}/checkin/${token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 180, margin: 1, color: { dark:'#111827', light:'#ffffff' } });
      if (!cancelled) {
        setCompanyQr({ dataUrl, url, organization: c.companyName });
        if (isEditingExisting) setShowQrPopup(true);
      }
    }).catch(() => { if (!cancelled) setCompanyQr(null); });
    return () => { cancelled = true; };
  }, [guestModal?.form?.contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Right-click "Show QR Guest Registration" — independent of the Add/Edit
  // modal, generates and pops the same company check-in QR straight from a
  // grid row.
  const showQrForRow = async (row) => {
    if (!row.contactId) { showToast('This guest isn\'t linked to a company — no check-in QR to show', '#dc2626'); return; }
    const c = contacts.find(x => x.id === row.contactId);
    if (!c || c.contactInfo !== 'company') { showToast('Check-in QR is only available for guests linked to a company', '#dc2626'); return; }
    try {
      const { token } = await api.get(`/events/${event.id}/checkin-token?contactId=${row.contactId}`);
      const url = `${window.location.origin}${getTenantPrefix()}/checkin/${token}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 180, margin: 1, color: { dark:'#111827', light:'#ffffff' } });
      setCompanyQr({ dataUrl, url, organization: c.companyName });
      setShowQrPopup(true);
    } catch (e) { showToast(e.message || 'Failed to generate QR', '#dc2626'); }
  };

  // Live check-in: while editing an existing guest, poll for their
  // attended/checkedInAt state every few seconds so a self-check-in from the
  // QR flow (someone else's phone, no page reload here) shows up on its own.
  useEffect(() => {
    if (!guestModal?.id) return;
    const gid = guestModal.id;
    const iv = setInterval(async () => {
      try {
        const fresh = await api.get(`/events/${event.id}/guests`);
        const g = fresh.find(x => x.id === gid);
        if (g) {
          setGuests(fresh);
          setGuestModal(m => (m && m.id === gid && (m.form.attended !== g.attended || m.form.checkedInAt !== g.checkedInAt))
            ? { ...m, form: { ...m.form, attended: g.attended, checkedInAt: g.checkedInAt, confirmed: g.confirmed } }
            : m);
        }
      } catch { /* transient — try again next tick */ }
    }, 4000);
    return () => clearInterval(iv);
  }, [guestModal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, p, gi, aw, c, qa, ldw, apst] = await Promise.all([
        api.get(`/events/${event.id}/guests`),
        api.get(`/events/${event.id}/products`),
        api.get(`/events/${event.id}/gifts`),
        api.get(`/events/${event.id}/awards`),
        api.get('/contacts').catch(() => []),
        api.get(`/events/${event.id}/qa-draws`).catch(() => []),
        api.get(`/events/${event.id}/lucky-draw-winners`).catch(() => []),
        api.get(`/events/${event.id}/appreciation-status`).catch(() => []),
      ]);
      setGuests(g); setProducts(p); setGifts(gi); setAwards(aw); setContacts(c); setQaDraws(qa); setLuckyDrawWinners(ldw); setAppreciationStatus(apst);
    } catch (e) { showToast(e.message || 'Failed to load', '#dc2626'); }
    finally { setLoading(false); }
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const guestToForm = (r) => ({
    contactId: r.contactId || null, contactPersonId: r.contactPersonId || null,
    name: r.name, contact: r.contact || '', organization: r.organization || '',
    invited: r.invited, confirmed: r.confirmed, attended: r.attended, checkedInAt: r.checkedInAt || null,
    invitationSent: r.invitationSent, invitationPhoto: r.invitationPhoto || '', remark: r.remark || '',
    expectedGuests: r.expectedGuests ?? '', participantCount: r.participantCount ?? '',
    luckyDrawNo: r.luckyDrawNo ?? null,
  });

  // Shared by both "picked from the dropdown" (looked up from contacts
  // state) and "just created via + New" (already have the fresh object,
  // can't rely on contacts state having caught up to it yet in the same tick).
  const applyContact = async (c) => {
    if (!c) {
      setGuestModal(m => ({ ...m, form: { ...m.form, contactId: null, contactPersonId: null } }));
      return;
    }
    if (c.contactInfo !== 'company') {
      // Personal contact — it already represents one person, fill directly.
      setGuestModal(m => ({
        ...m,
        form: {
          ...m.form, contactId: c.id, contactPersonId: null,
          name: contactDisplayName(c), contact: contactDisplayPhone(c) || m.form.contact,
          organization: contactDisplayOrg(c) || m.form.organization,
          // One named person picked = 1 counted guest, same as typing a Name manually.
          expectedGuests: m.form.expectedGuests === '' ? 1 : m.form.expectedGuests,
        },
      }));
      return;
    }
    // Company contact — drill down to which person at that company is
    // actually attending, via the same Contact Persons Staff → Contact uses.
    setPersonPickerModal({ contact: c, persons: [], loading: true, editing: null });
    try {
      const persons = await api.get(`/contacts/${c.id}/persons`);
      setPersonPickerModal({ contact: c, persons, loading: false,
        editing: persons.length === 0 ? { id:null, name:'', post:'', email:'', mobile1:'', mobile2:'' } : null });
    } catch (e) {
      showToast(e.message || 'Failed to load contact persons', '#dc2626');
      setPersonPickerModal(null);
    }
  };

  const applyContactPick = (contactIdStr) => {
    applyContact(contacts.find(x => String(x.id) === contactIdStr) || null);
  };

  // "+ New" next to Select Company — create a brand new Company contact
  // (same /api/contacts the Contact page itself uses) without leaving the
  // Add Guest flow, then immediately link it same as picking an existing one.
  const [newCompanyModal, setNewCompanyModal] = useState(false);
  const handleNewCompanySaved = (contact) => {
    setContacts(p => [contact, ...p]);
    setNewCompanyModal(false);
    applyContact(contact);
  };

  // A person already linked to a guest FOR THIS EVENT — excludes whichever
  // guest is currently open for edit, so re-picking your own existing link
  // isn't flagged as a duplicate of itself.
  const isPersonAlreadyGuest = (personId) =>
    guests.some(g => g.contactPersonId === personId && g.id !== (guestModal?.id ?? null));

  const pickExistingPerson = (p) => {
    if (isPersonAlreadyGuest(p.id)) { showToast('Duplicate data Already Registered', '#dc2626'); return; }
    setPersonPickerModal(m => ({ ...m, editing:
      { id:p.id, name:p.name||'', post:p.post||'', email:p.email||'', mobile1:p.mobile1||'', mobile2:p.mobile2||'',
        department:p.department||'', ext:p.ext||'' } }));
  };

  const savePersonAndApply = async () => {
    if (!personPickerModal?.editing) return;
    const f = personPickerModal.editing;
    if (!f.name.trim()) { showToast('Name is required', '#dc2626'); return; }
    setPersonSaving(true);
    try {
      const companyId = personPickerModal.contact.id;
      const payload = { name:f.name.trim(), post:f.post||null, department:f.department||null,
        mobile1:f.mobile1||null, mobile2:f.mobile2||null, email:f.email||null, ext:f.ext||null };
      const saved = f.id
        ? await api.put(`/contacts/${companyId}/persons/${f.id}`, payload)
        : await api.post(`/contacts/${companyId}/persons`, payload);
      setGuestModal(m => ({
        ...m,
        form: {
          ...m.form, contactId: companyId, contactPersonId: saved.id,
          name: saved.name, contact: saved.mobile1 || saved.mobile2 || m.form.contact,
          organization: personPickerModal.contact.companyName || m.form.organization,
          // One named contact person picked = 1 counted guest, same as typing a Name manually.
          expectedGuests: m.form.expectedGuests === '' ? 1 : m.form.expectedGuests,
        },
      }));
      setPersonPickerModal(null);
      showToast(f.id ? 'Contact person updated' : 'Contact person added');
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setPersonSaving(false); }
  };

  // ── Followup History / right-side guest detail panel ──
  const openFollowups = async (guest) => {
    setFollowupModal({ guest, list: [], loading: true });
    setFollowupForm({ ...EMPTY_FOLLOWUP_FORM });
    try {
      const list = await api.get(`/events/${event.id}/guests/${guest.id}/followups`);
      setFollowupModal({ guest, list, loading: false });
    } catch (e) { showToast(e.message || 'Failed to load followups', '#dc2626'); setFollowupModal(null); }
  };
  // Row click on the grid opens this same panel — click the already-open
  // guest's row again to close it, same toggle convention as Staff → Contact.
  const openGuestPanel = (guest) => {
    if (followupModal && followupModal.guest.id === guest.id) { setFollowupModal(null); return; }
    openFollowups(guest);
  };
  // A tab in the panel for someone who isn't a guest yet ("preview" state) —
  // clicking + New there adds them as a real guest first (same company,
  // linked to their existing Contact Person), then opens straight into the
  // normal Followup History view for them, same as any other guest.
  const addGuestFromPreview = async (person) => {
    const parent = followupModal?.guest;
    if (!parent) return null;
    try {
      const saved = await api.post(`/events/${event.id}/guests`, {
        contactId: parent.contactId, contactPersonId: person.id, name: person.name,
        contact: person.mobile1 || '', organization: parent.organization,
        invited: true, expectedGuests: 1,
      });
      setGuests(p => [saved, ...p]);
      setPreviewPersonId(null);
      await openFollowups(saved);
      return saved;
    } catch (e) { showToast(e.message || 'Failed to add guest', '#dc2626'); return null; }
  };
  const openEditFollowup = (f) => {
    setEditingFollowupId(f.id);
    setFollowupForm({
      conversation: f.note || '',
      media: f.followUpVia ? f.followUpVia.split(',').map(s => s.trim()).filter(Boolean) : [],
      statuses: f.status ? f.status.split(',').map(s => s.trim()).filter(Boolean) : [],
    });
    setAddFollowupModal(true);
  };
  // Invited/Invitation Sent/Confirmed/Registered no longer have manual
  // toggles in the guest form — checking a status on a Followup entry is
  // now what flips these flags, so they always reflect the actual last
  // contact. Only ever turns a flag ON (unchecking a status on a later
  // followup doesn't retroactively undo an earlier one).
  const syncGuestStatusFromFollowup = async (statuses) => {
    const g = followupModal?.guest;
    if (!g) return;
    const patch = {};
    if (statuses.includes('Invitation Sent') && !g.invitationSent) patch.invitationSent = true;
    if (statuses.includes('Confirmed Attendance') && !g.confirmed) patch.confirmed = true;
    if (statuses.includes('Registered at Event') && !g.attended) patch.attended = true;
    if (Object.keys(patch).length === 0) return;
    try {
      const saved = await api.put(`/events/${event.id}/guests/${g.id}`, {
        contactId: g.contactId, contactPersonId: g.contactPersonId, name: g.name, contact: g.contact,
        organization: g.organization, invited: g.invited, confirmed: g.confirmed, attended: g.attended,
        invitationSent: g.invitationSent, invitationPhoto: g.invitationPhoto, remark: g.remark,
        expectedGuests: g.expectedGuests, participantCount: g.participantCount,
        ...patch,
      });
      setGuests(p => p.map(x => x.id === saved.id ? saved : x));
      setFollowupModal(m => (m && m.guest.id === saved.id) ? { ...m, guest: saved } : m);
    } catch (e) { /* non-fatal — the followup itself already saved fine */ }
  };
  const saveFollowup = async () => {
    if (!followupForm.conversation.trim() || !followupModal) return;
    setFollowupSaving(true);
    try {
      const payload = {
        note: followupForm.conversation.trim(),
        followUpVia: followupForm.media.length ? followupForm.media.join(', ') : null,
        status: followupForm.statuses.length ? followupForm.statuses.join(', ') : null,
      };
      if (editingFollowupId) {
        const saved = await api.put(`/events/${event.id}/guests/${followupModal.guest.id}/followups/${editingFollowupId}`, payload);
        setFollowupModal(m => ({ ...m, list: m.list.map(x => x.id === saved.id ? saved : x) }));
      } else {
        const saved = await api.post(`/events/${event.id}/guests/${followupModal.guest.id}/followups`, payload);
        setFollowupModal(m => ({ ...m, list: [saved, ...m.list] }));
        setGuests(p => p.map(g => g.id === followupModal.guest.id ? { ...g, followupCount: (g.followupCount || 0) + 1 } : g));
      }
      await syncGuestStatusFromFollowup(followupForm.statuses);
      setFollowupForm({ ...EMPTY_FOLLOWUP_FORM });
      setEditingFollowupId(null);
      setAddFollowupModal(false);
    } catch (e) { showToast(e.message || 'Failed to save followup', '#dc2626'); }
    finally { setFollowupSaving(false); }
  };
  const deleteFollowup = async (f) => {
    if (!window.confirm('Delete this followup entry?')) return;
    try {
      await api.delete(`/events/${event.id}/guests/${followupModal.guest.id}/followups/${f.id}`);
      setFollowupModal(m => ({ ...m, list: m.list.filter(x => x.id !== f.id) }));
      setGuests(p => p.map(g => g.id === followupModal.guest.id ? { ...g, followupCount: Math.max(0, (g.followupCount || 0) - 1) } : g));
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  const invitedCount   = guests.filter(g => g.invited).length;
  const confirmedCount = guests.filter(g => g.confirmed).length;
  const attendedCount  = guests.filter(g => g.attended).length;
  const uncalledCount  = guests.filter(g => g.attended && !g.invited).length;
  const totalInvitedNo    = guests.reduce((sum, g) => sum + (Number(g.expectedGuests) || 0), 0);
  const totalConfirmedGuestNo = guests.filter(g => g.attended)
    .reduce((sum, g) => sum + (Number(g.participantCount) || 0), 0);
  const companiesCount   = new Set(guests.map(g => g.organization).filter(Boolean)).size;
  const unattendantCount = guests.filter(g => !g.attended).length;

  const filteredGuests = guests.filter(g => {
    if (guestFilter === 'invited')   return g.invited;
    if (guestFilter === 'confirmed') return g.confirmed;
    if (guestFilter === 'attended')  return g.attended;
    if (guestFilter === 'uncalled')  return g.attended && !g.invited;
    if (guestFilter === 'notYet')    return !g.confirmed;
    if (guestFilter === 'invitationNotSent') return !g.invitationSent;
    return true;
  });

  // Lucky Draw — coupons are checked-in guests who actually hold a draw
  // number; the company draw only makes sense among companies that showed
  // up (an org with zero attended guests couldn't have won anything).
  const luckyCoupons = guests
    .filter(g => g.luckyDrawNo != null)
    .map(g => ({ no: g.luckyDrawNo, name: g.name, org: g.organization || '—' }))
    .sort((a, b) => a.no - b.no);
  const luckyCompanies = [...new Set(
    guests.filter(g => g.attended && g.organization).map(g => g.organization)
  )].sort();
  // The company draw's pool is deduplicated organizations (so one company
  // can't win twice just for sending several people) — this fills in WHICH
  // checked-in guest(s) that company actually sent, for display alongside
  // the winning company name.
  const attendeeNamesOf = (orgName) => guests
    .filter(g => g.attended && g.organization === orgName)
    .map(g => g.name)
    .join(', ');
  // e.g. "ZKTeco Authorized Distributor for Nepal" — shown as a tagline
  // under the winner's company name, when that company's own Contact record
  // has one set (Work Scope with Us, from Staff → Contact).
  const workScopeOf = (orgName) => contacts.find(c => c.companyName === orgName)?.workScope || '';
  const appreciationStatusByCompany = useMemo(
    () => Object.fromEntries(appreciationStatus.map(s => [s.company, s])),
    [appreciationStatus]
  );
  // This tenant's own self-listed Contact record (if they've added themselves
  // as a Company contact under their own Settings → Company Information
  // name) — the QR popup's "Organized by" block reads its Work Scope tagline
  // and Company Phone from here, alongside Settings' own Phone/Address/Website.
  const organizerContact = contacts.find(c => c.companyName === settings.companyNameEn);

  // ── Guest save/delete ──
  const saveGuest = async () => {
    const f = guestModal.form;
    if (!f.name.trim()) { showToast('Name is required', '#dc2626'); return; }
    // Final duplicate guard — same linked contact (company person, or a
    // personal contact) already registered as a different guest on this
    // event. Covers cases beyond the person-picker list (e.g. a personal
    // contact linked straight from Select Company, no picker involved).
    if (f.contactId) {
      const isDup = guests.some(g =>
        g.id !== (guestModal.id ?? null) && g.contactId === f.contactId &&
        (f.contactPersonId ? g.contactPersonId === f.contactPersonId : !g.contactPersonId)
      );
      if (isDup) { showToast('Duplicate data Already Registered', '#dc2626'); return; }
    }
    setSaving(true);
    try {
      let saved;
      if (guestModal.id) {
        saved = await api.put(`/events/${event.id}/guests/${guestModal.id}`, f);
        setGuests(p => p.map(r => r.id === saved.id ? saved : r));
      } else {
        saved = await api.post(`/events/${event.id}/guests`, f);
        setGuests(p => [saved, ...p]);
      }
      setGuestModal(null);
      showToast(`✅ Successfully Registered ${saved.name}, ${saved.organization || '—'} — ${fmtDateTime(new Date())}`);
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setSaving(false); }
  };
  const deleteGuest = async (row) => {
    if (!window.confirm(`Remove "${row.name}" from the guest list?`)) return;
    try {
      await api.delete(`/events/${event.id}/guests/${row.id}`);
      setGuests(p => p.filter(r => r.id !== row.id));
      showToast('Guest removed');
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };
  // Quick check-in toggle: one click flips a guest's Registered state, no
  // modal — stays editable even after being checked in (un-check to correct
  // a mistake), not a one-way action.
  const toggleAttended = async (row, nextValue) => {
    if (!nextValue && !window.confirm(`Mark "${row.name}" as NOT checked in?`)) return;
    try {
      const saved = await api.put(`/events/${event.id}/guests/${row.id}`, { ...row, attended: nextValue });
      setGuests(p => p.map(r => r.id === saved.id ? saved : r));
      showToast(nextValue ? `${row.name} checked in` : `${row.name} un-checked`);
      return saved;
    } catch (e) { showToast(e.message || 'Update failed', '#dc2626'); }
  };

  // Same toggle, reachable from inside the Add/Edit Guest form itself (not
  // just the grid's own Registered column) — previously the only way to
  // undo an accidental "Registered at Event" was to close the form and find
  // the row in the grid. Only applies to an already-saved guest; a brand
  // new, not-yet-saved one has no attended state to flip yet.
  const toggleAttendedInForm = async () => {
    const row = guests.find(g => g.id === guestModal?.id);
    if (!row) return;
    const saved = await toggleAttended(row, !row.attended);
    if (saved) {
      setGuestModal(m => (m && m.id === saved.id)
        ? { ...m, form: { ...m.form, attended: saved.attended, checkedInAt: saved.checkedInAt, confirmed: saved.confirmed } }
        : m);
    }
  };

  // WhatsApp thank-you — click-to-chat only (no Business API on file for
  // this tenant, matching the Task page's own WhatsApp buttons), so
  // "sending" opens a pre-filled wa.me chat to the guest's own number; the
  // user still presses Send themselves. WhatsApp's own click-to-chat link
  // format has no way to attach an image, so the invitation graphic isn't
  // included here — only the thank-you text.
  const sendWhatsAppTo = (phone, message, missingLabel) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) { showToast(`No mobile number on file for ${missingLabel}`, '#dc2626'); return false; }
    const target = digits.length === 10 ? `977${digits}` : digits;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    return true;
  };
  // Logs the send (for the grid's "times sent" count) only once the compose
  // window actually opened — a missing phone number shouldn't count as a send.
  const sendThankYouWhatsApp = async (row) => {
    const organizer = settings.companyNameEn || 'Us';
    // *bold*/_italic_ is WhatsApp's own message markup — rendered as actual
    // bold/italic once sent, not just plain asterisks/underscores in the chat.
    let message = `*Dear ${row.name},*\n\nThank you for visiting\n_${event.name},_\n\n*Organized by*\n${organizer}.\nWe hope you enjoyed it!`;
    if (row.luckyDrawNo != null) {
      message += `\n\n*Lucky Draw No:* #${String(row.luckyDrawNo).padStart(3, '0')}\nLucky Draw will be at the last of this event, before Dinner.`;
    }
    if (!sendWhatsAppTo(row.contact, message, row.name)) return;
    try {
      const { whatsappSentCount } = await api.post(`/events/${event.id}/guests/${row.id}/whatsapp-sent`);
      setGuests(p => p.map(g => g.id === row.id ? { ...g, whatsappSentCount } : g));
    } catch { /* the message already opened — a failed count log isn't worth interrupting the user over */ }
  };

  // ── Product save/delete ──
  const saveProduct = async () => {
    const f = productModal.form;
    if (!f.productName.trim()) { showToast('Product Name is required', '#dc2626'); return; }
    setSaving(true);
    try {
      if (productModal.id) {
        const saved = await api.put(`/events/${event.id}/products/${productModal.id}`, f);
        setProducts(p => p.map(r => r.id === saved.id ? saved : r));
      } else {
        const saved = await api.post(`/events/${event.id}/products`, f);
        setProducts(p => [saved, ...p]);
      }
      setProductModal(null);
      showToast('Product saved');
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setSaving(false); }
  };
  const deleteProduct = async (row) => {
    if (!window.confirm(`Remove "${row.productName}" from the checklist?`)) return;
    try {
      await api.delete(`/events/${event.id}/products/${row.id}`);
      setProducts(p => p.filter(r => r.id !== row.id));
      showToast('Product removed');
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  // ── Gift save/delete ──
  const saveGift = async () => {
    const f = giftModal.form;
    if (!f.giftName.trim()) { showToast('Gift Name is required', '#dc2626'); return; }
    setSaving(true);
    try {
      if (giftModal.id) {
        const saved = await api.put(`/events/${event.id}/gifts/${giftModal.id}`, f);
        setGifts(p => p.map(r => r.id === saved.id ? saved : r));
      } else {
        const saved = await api.post(`/events/${event.id}/gifts`, f);
        setGifts(p => [saved, ...p]);
      }
      setGiftModal(null);
      showToast('Gift saved');
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setSaving(false); }
  };
  const deleteGift = async (row) => {
    if (!window.confirm(`Remove "${row.giftName}"?`)) return;
    try {
      await api.delete(`/events/${event.id}/gifts/${row.id}`);
      setGifts(p => p.filter(r => r.id !== row.id));
      showToast('Gift removed');
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  // ── Award save/delete ──
  const saveAward = async () => {
    const f = awardModal.form;
    if (!f.awardName.trim()) { showToast('Award Name is required', '#dc2626'); return; }
    setSaving(true);
    try {
      if (awardModal.id) {
        const saved = await api.put(`/events/${event.id}/awards/${awardModal.id}`, f);
        setAwards(p => p.map(r => r.id === saved.id ? saved : r));
      } else {
        const saved = await api.post(`/events/${event.id}/awards`, f);
        setAwards(p => [saved, ...p]);
      }
      setAwardModal(null);
      showToast('Award saved');
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setSaving(false); }
  };
  const deleteAward = async (row) => {
    if (!window.confirm(`Remove "${row.awardName}"?`)) return;
    try {
      await api.delete(`/events/${event.id}/awards/${row.id}`);
      setAwards(p => p.filter(r => r.id !== row.id));
      showToast('Award removed');
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  // ── Question Lucky Draw save/update/delete ──
  const createQaDraw = async (form) => {
    try {
      const saved = await api.post(`/events/${event.id}/qa-draws`, form);
      setQaDraws(p => [saved, ...p]);
      showToast('Question sent');
      return saved;
    } catch (e) { showToast(e.message || 'Send failed', '#dc2626'); }
  };
  const updateQaDraw = async (id, payload) => {
    try {
      const saved = await api.put(`/events/${event.id}/qa-draws/${id}`, payload);
      setQaDraws(p => p.map(q => q.id === saved.id ? saved : q));
      if (payload.completed) showToast('Marked as completed');
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
  };
  const deleteQaDraw = async (id) => {
    try {
      await api.delete(`/events/${event.id}/qa-draws/${id}`);
      setQaDraws(p => p.filter(q => q.id !== id));
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  // ── Coupon/Spin Lucky Draw winners — added to the list (and excluded from
  // the wheel) THE MOMENT a spin reveals one, optimistically, before the
  // server round-trip even resolves. The wheel/winners list must never
  // depend on network timing mid-event: a slow or briefly-unreachable API
  // shouldn't stall the reveal or let the same person be spun again. The
  // POST persists it in the background so it survives closing/reopening the
  // draw; on failure the optimistic entry is kept (still correct for the
  // rest of this live session) and a toast flags that it may not have saved.
  const saveLuckyDrawWinner = async (drawType, itemKey, info) => {
    const optimistic = {
      id: `local-${Date.now()}-${itemKey}`, eventId: event.id, drawType, itemKey,
      label: info.title, subtitle1: info.subtitle1 || null, subtitle2: info.subtitle2 || null,
      wonAt: new Date().toISOString(),
    };
    setLuckyDrawWinners(p => [...p, optimistic]);
    try {
      const saved = await api.post(`/events/${event.id}/lucky-draw-winners`, {
        drawType, itemKey, label: info.title, subtitle1: info.subtitle1 || null, subtitle2: info.subtitle2 || null,
      });
      setLuckyDrawWinners(p => p.map(w => w.id === optimistic.id ? saved : w));
    } catch (e) {
      showToast(`Winner shown but not saved — ${e.message || 'connection issue'}. It'll be lost if you close and reopen the draw.`, '#dc2626');
    }
  };

  // "Reset" on the draw screen — clears every saved winner for one draw
  // type, reopening its pool for a fresh run.
  const resetLuckyDrawWinners = async (drawType) => {
    await api.delete(`/events/${event.id}/lucky-draw-winners?drawType=${drawType}`);
    setLuckyDrawWinners(p => p.filter(w => w.drawType !== drawType));
  };

  // Admin/Super Admin only — wipes every guest's coupon number for this
  // event (and any saved Coupon Lucky Draw winners, now stale since the
  // numbers they reference no longer match anyone), then the server hands
  // fresh sequential numbers to everyone currently checked in.
  const resetCoupons = async () => {
    const freshGuests = await api.post(`/events/${event.id}/guests/reset-coupons`, {});
    setGuests(freshGuests);
    setLuckyDrawWinners(p => p.filter(w => w.drawType !== 'coupon'));
  };

  // Appreciation Ceremony — "Done" checkmark and Admin/Super Admin-only
  // "remove from ceremony", both applied optimistically (same rationale as
  // saveLuckyDrawWinner above: never let a network round-trip stall a live,
  // projected screen) and persisted in the background via
  // event_appreciation_status (see server/routes/events.js).
  const markAppreciationDone = async (company, done) => {
    setAppreciationStatus(p => {
      const existing = p.find(s => s.company === company);
      return existing
        ? p.map(s => s.company === company ? { ...s, done } : s)
        : [...p, { company, done, removed: false }];
    });
    try {
      await api.patch(`/events/${event.id}/appreciation-status`, { company, done });
    } catch (e) {
      showToast(`Marked done but not saved — ${e.message || 'connection issue'}.`, '#dc2626');
    }
  };

  const deleteAppreciationCompany = async (company) => {
    setAppreciationStatus(p => {
      const existing = p.find(s => s.company === company);
      return existing
        ? p.map(s => s.company === company ? { ...s, removed: true } : s)
        : [...p, { company, done: false, removed: true }];
    });
    try {
      await api.delete(`/events/${event.id}/appreciation-status?company=${encodeURIComponent(company)}`);
    } catch (e) {
      showToast(e.message || 'Remove failed', '#dc2626');
    }
  };

  // Undoes a previous removal — a removed company still shows in the list
  // (marked "Removed") rather than disappearing outright, precisely so this
  // stays reachable instead of being a one-way, unrecoverable action.
  const restoreAppreciationCompany = async (company) => {
    setAppreciationStatus(p => p.map(s => s.company === company ? { ...s, removed: false } : s));
    try {
      await api.patch(`/events/${event.id}/appreciation-status/restore`, { company });
    } catch (e) {
      showToast(e.message || 'Restore failed', '#dc2626');
    }
  };

  const TABS = [
    { key:'guests',   label:'👥 Guests & Visitor Registration', count: guests.length },
    { key:'products', label:'📦 Products Checklist',            count: products.length },
    { key:'gifts',    label:'🎁 Gift Hampers',                  count: gifts.length },
    { key:'awards',   label:'🏆 Awards',                        count: awards.length },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <div>
          <button onClick={onBack} style={{ background:'none', border:'none', color:'#1a56db',
            fontSize:12.5, fontWeight:600, cursor:'pointer', padding:0, marginBottom:6 }}>
            ← Back to Events
          </button>
          <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:'#111827' }}>🎪 {event.name}</h1>
          <div style={{ fontSize:12.5, color:'#6b7280', marginTop:4 }}>
            📅 {fmtDate(event.eventDate)}{event.venue && <> &nbsp;·&nbsp; 📍 {event.venue}</>}
          </div>
          {(event.invitationImage || event.photoGalleryFacebook || event.photoGalleryGoogleDrive || event.photoGalleryInstagram || event.photoGalleryTiktok) && (
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap' }}>
              {event.invitationImage && (
                <button onClick={() => setImagePreview(event.invitationImage)}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:7,
                    border:'1px solid #dbeafe', background:'#eff6ff', color:'#1e40af', fontSize:11.5, fontWeight:700, cursor:'pointer' }}>
                  📇 View Invitation
                </button>
              )}
              {[
                { url: event.photoGalleryFacebook,   label: 'Facebook',     icon: '📘' },
                { url: event.photoGalleryGoogleDrive, label: 'Google Drive', icon: '📁' },
                { url: event.photoGalleryInstagram,   label: 'Instagram',    icon: '📷' },
                { url: event.photoGalleryTiktok,      label: 'TikTok',       icon: '🎵' },
              ].filter(g => g.url).map(g => (
                <a key={g.label} href={g.url} target="_blank" rel="noreferrer"
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:7,
                    border:'1px solid #e5e7eb', background:'#f9fafb', color:'#374151', fontSize:11.5, fontWeight:700, textDecoration:'none' }}>
                  {g.icon} {g.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          <button onClick={() => setShowAppreciation(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:9,
              border:'none', background:'linear-gradient(135deg,#0f766e,#0d9488)', color:'#fff',
              fontSize:12.5, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(13,148,136,.3)' }}>
            🎪 Appreciation Ceremony
          </button>
          <button onClick={() => setShowCouponDraw(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:9,
              border:'none', background:'linear-gradient(135deg,#00A651,#00843d)', color:'#fff',
              fontSize:12.5, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(0,132,61,.3)' }}>
            🎟️ Coupon Lucky Draw
          </button>
          <button onClick={() => setShowCompanyDraw(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:9,
              border:'none', background:'linear-gradient(135deg,#3ba55c,#00A651)', color:'#fff',
              fontSize:12.5, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(0,166,81,.3)' }}>
            🎡 Spin Lucky Draw
          </button>
          <button onClick={() => setShowQaDraw(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:9,
              border:'none', background:'linear-gradient(135deg,#00A651,#006e34)', color:'#fff',
              fontSize:12.5, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(0,110,52,.3)' }}>
            ❓ Question Lucky Draw
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        <StatBox label="Invitations Sent"  value={invitedCount}   color="#1e40af" bg="#eff6ff" />
        <StatBox label="Confirmed"         value={confirmedCount} color="#065f46" bg="#f0fdf4" />
        <StatBox label="Registered (Attended)" value={attendedCount} color="#92400e" bg="#fffbeb" />
        <StatBox label="Uncalled Guests"   value={uncalledCount}  color="#7c2d12" bg="#fff7ed" />
        <StatBox label="Total No. of Guest"      value={totalInvitedNo}       color="#5b21b6" bg="#f5f3ff" />
        <StatBox label="No. of Companies"        value={companiesCount}       color="#0e7490" bg="#ecfeff" />
        <StatBox label="Unattendant Guest"       value={unattendantCount}     color="#b45309" bg="#fffbeb" />
        <StatBox label="Total Confirmed Guest"   value={totalConfirmedGuestNo} color="#9f1239" bg="#fff1f2" />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, borderBottom:'2px solid #eef1f5', marginBottom:16, flexWrap:'wrap' }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            style={{ padding:'9px 16px', border:'none', background:'none', cursor:'pointer',
              fontSize:13, fontWeight:700, color: tab===tb.key ? '#1a56db' : '#6b7280',
              borderBottom: tab===tb.key ? '2px solid #1a56db' : '2px solid transparent', marginBottom:-2 }}>
            {tb.label} <span style={{ color:'#9ca3af', fontWeight:600 }}>({tb.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'#9ca3af' }}>Loading…</div>
      ) : (
        <>
          {/* ── Guests tab ── */}
          {tab === 'guests' && (
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {[
                    { key:'all', label:'All' }, { key:'invited', label:'Invited' },
                    { key:'confirmed', label:'Confirmed' }, { key:'attended', label:'Attended' },
                    { key:'uncalled', label:'Uncalled' }, { key:'notYet', label:'Not Yet' },
                    { key:'invitationNotSent', label:'Invitation Not Send' },
                  ].map(f => (
                    <button key={f.key} onClick={() => setGuestFilter(f.key)}
                      style={{ padding:'5px 12px', borderRadius:16, fontSize:11.5, fontWeight:700, cursor:'pointer',
                        border: guestFilter===f.key ? '1.5px solid #1a56db' : '1px solid #d1d5db',
                        background: guestFilter===f.key ? '#eff6ff' : '#fff',
                        color: guestFilter===f.key ? '#1a56db' : '#6b7280' }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {canEditGuests && (
                  <button onClick={() => setGuestModal({ id:null, form:{ ...EMPTY_GUEST } })}
                    style={{ padding:'7px 16px', borderRadius:8, border:'none', background:'#1a56db',
                      color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                    + Add Guest
                  </button>
                )}
              </div>
              <DataGrid
                columns={[
                  { field:'name', header:'Name', width:150, render:(_,r) => (
                    <span style={{ fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                      {r.contactId && <span title="Linked to Contact database">🔗</span>}
                      {r.name}
                      {r.followupCount > 0 && (
                        <span title={`${r.followupCount} followup${r.followupCount === 1 ? '' : 's'}`}
                          style={{ background:'#ede9fe', color:'#5b21b6', borderRadius:8, padding:'0 5px',
                            fontSize:10, fontWeight:700 }}>💬{r.followupCount}</span>
                      )}
                    </span>
                  ) },
                  { field:'organization', header:'Organization', fill:true, render:v => v
                    ? <span style={{ fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>{v}</span>
                    : '—' },
                  { field:'contact', header:'Contact', width:110, render:v => v || '—' },
                  { field:'invited', header:'Invited', width:85, align:'center',
                    render:(_,r) => r.invited
                      ? <Pill bg="#eff6ff" color="#1e40af">Invited</Pill>
                      : <Pill bg="#fff7ed" color="#7c2d12">Uncalled</Pill> },
                  { field:'invitationSent', header:'Invitation', width:120, align:'center',
                    render:(_,r) => r.invitationSent
                      ? <Pill bg="#ede9fe" color="#5b21b6">✉ Sent {fmtDate(r.invitationSentAt)}</Pill>
                      : <Pill bg="#f3f4f6" color="#6b7280">Not Sent</Pill> },
                  { field:'expectedGuests', header:'Invited No.', width:110, align:'center',
                    render:v => v != null ? <span style={{ fontWeight:700, color:'#5b21b6' }}>{v}</span> : <span style={{ color:'#d1d5db' }}>—</span> },
                  { field:'confirmed', header:'Confirmed', width:100, align:'center',
                    render:(_,r) => r.confirmed
                      ? <Pill bg="#f0fdf4" color="#065f46">✓ Confirmed</Pill>
                      : <Pill bg="#f3f4f6" color="#6b7280">Not Yet</Pill> },
                  { field:'attended', header:'Registered', width:150, align:'center',
                    render:(_,r) => r.attended
                      ? (
                        <button onClick={() => toggleAttended(r, false)} title="Click to un-register"
                          style={{ padding:'3px 10px', borderRadius:6, border:'1px solid #fde68a',
                            background:'#fffbeb', color:'#92400e', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          ✓ {fmtDateTime(r.checkedInAt)}
                        </button>
                      )
                      : (
                        <button onClick={() => toggleAttended(r, true)}
                          style={{ padding:'3px 10px', borderRadius:6, border:'1px solid #93c5fd',
                            background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          Check In
                        </button>
                      ) },
                  { field:'participantCount', header:'Attend', width:90, align:'center',
                    render:(v, r) => r.attended
                      ? <span style={{ fontWeight:700, color:'#92400e' }}>Yes{v != null ? ` (${v})` : ''}</span>
                      : <span style={{ color:'#9ca3af' }}>Not Yet</span> },
                ]}
                data={filteredGuests} rowKey="id" defaultPageSize={100} striped autoWidth
                onRowClick={openGuestPanel}
                onRowDoubleClick={canEditGuests ? (r) => setGuestModal({ id:r.id, form:guestToForm(r) }) : undefined}
                contextMenu={[
                  ...(canEditGuests ? [
                    { label:'Add New Guest', icon:'➕', onClick:() => setGuestModal({ id:null, form:{ ...EMPTY_GUEST } }) },
                    { label:'Edit', icon:'✏️', onClick:(row) => setGuestModal({ id:row.id, form:guestToForm(row) }) },
                  ] : []),
                  ...(canDeleteGuests ? [{ label:'Delete', icon:'🗑', className:'danger', onClick:(row) => deleteGuest(row) }] : []),
                  ...(canEditGuests || canDeleteGuests ? ['divider'] : []),
                  { label:'Show QR Guest Registration', icon:'📱', onClick:(row) => showQrForRow(row) },
                  { label:'Followup', icon:'💬', onClick:(row) => openFollowups(row) },
                  { label:'Whatsapp Message', icon:'📱', onClick:(row) => sendThankYouWhatsApp(row) },
                ]}
              />
            </div>
          )}

          {/* ── Products checklist tab ── */}
          {tab === 'products' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
                <button onClick={() => setProductModal({ id:null, form:{ ...EMPTY_PRODUCT } })}
                  style={{ padding:'7px 16px', borderRadius:8, border:'none', background:'#1a56db',
                    color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                  + Add Product
                </button>
              </div>
              <DataGrid
                columns={[
                  { field:'productName', header:'Product', width:180, render:(_,r) => <span style={{ fontWeight:600 }}>{r.productName}</span> },
                  { field:'quantity', header:'Qty', width:70, align:'center' },
                  { field:'sentOut', header:'Sent Out', width:150, align:'center',
                    render:(_,r) => r.sentOut
                      ? <Pill bg="#fffbeb" color="#92400e">✓ {fmtDateTime(r.sentOutAt)}</Pill>
                      : <Pill bg="#f3f4f6" color="#6b7280">Not Sent</Pill> },
                  { field:'returned', header:'Returned', width:150, align:'center',
                    render:(_,r) => r.returned
                      ? <Pill bg="#f0fdf4" color="#065f46">✓ {fmtDateTime(r.returnedAt)}</Pill>
                      : <Pill bg="#f3f4f6" color="#6b7280">Not Returned</Pill> },
                  { field:'remark', header:'Remark', width:180, render:v => v || '—' },
                  { field:'actions', header:'Actions', width:90, sortable:false, filterable:false,
                    render:(_,r) => (
                      <div className="dg-actions">
                        <button className="dg-action-btn edit" title="Edit"
                          onClick={() => setProductModal({ id:r.id, form:{ productName:r.productName, quantity:r.quantity, sentOut:r.sentOut, returned:r.returned, remark:r.remark||'' } })}>✏️</button>
                        <button className="dg-action-btn delete" title="Remove" onClick={() => deleteProduct(r)}>🗑</button>
                      </div>
                    ) },
                ]}
                data={products} rowKey="id" defaultPageSize={100} striped
                onRowDoubleClick={(r) => setProductModal({ id:r.id, form:{ productName:r.productName, quantity:r.quantity, sentOut:r.sentOut, returned:r.returned, remark:r.remark||'' } })}
              />
            </div>
          )}

          {/* ── Gift Hampers tab ── */}
          {tab === 'gifts' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
                <button onClick={() => setGiftModal({ id:null, form:{ ...EMPTY_GIFT } })}
                  style={{ padding:'7px 16px', borderRadius:8, border:'none', background:'#1a56db',
                    color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                  + Add Gift
                </button>
              </div>
              <DataGrid
                columns={[
                  { field:'giftName', header:'Gift', width:180, render:(_,r) => <span style={{ fontWeight:600 }}>{r.giftName}</span> },
                  { field:'recipientName', header:'Recipient', width:180, render:v => v || '—' },
                  { field:'quantity', header:'Qty', width:70, align:'center' },
                  { field:'givenAt', header:'Given At', width:160, render:v => fmtDateTime(v) },
                  { field:'remark', header:'Remark', width:180, render:v => v || '—' },
                  { field:'actions', header:'Actions', width:90, sortable:false, filterable:false,
                    render:(_,r) => (
                      <div className="dg-actions">
                        <button className="dg-action-btn edit" title="Edit"
                          onClick={() => setGiftModal({ id:r.id, form:{ giftName:r.giftName, recipientName:r.recipientName||'', quantity:r.quantity, remark:r.remark||'' } })}>✏️</button>
                        <button className="dg-action-btn delete" title="Remove" onClick={() => deleteGift(r)}>🗑</button>
                      </div>
                    ) },
                ]}
                data={gifts} rowKey="id" defaultPageSize={15} striped
                onRowDoubleClick={(r) => setGiftModal({ id:r.id, form:{ giftName:r.giftName, recipientName:r.recipientName||'', quantity:r.quantity, remark:r.remark||'' } })}
              />
            </div>
          )}

          {/* ── Awards tab ── */}
          {tab === 'awards' && (
            <div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}>
                <button onClick={() => setAwardModal({ id:null, form:{ ...EMPTY_AWARD } })}
                  style={{ padding:'7px 16px', borderRadius:8, border:'none', background:'#1a56db',
                    color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                  + Add Award
                </button>
              </div>
              <DataGrid
                columns={[
                  { field:'awardName', header:'Award', width:180, render:(_,r) => <span style={{ fontWeight:600 }}>{r.awardName}</span> },
                  { field:'recipientName', header:'Recipient', width:180, render:v => v || '—' },
                  { field:'givenAt', header:'Given At', width:160, render:v => fmtDateTime(v) },
                  { field:'remark', header:'Remark', width:180, render:v => v || '—' },
                  { field:'actions', header:'Actions', width:90, sortable:false, filterable:false,
                    render:(_,r) => (
                      <div className="dg-actions">
                        <button className="dg-action-btn edit" title="Edit"
                          onClick={() => setAwardModal({ id:r.id, form:{ awardName:r.awardName, recipientName:r.recipientName||'', remark:r.remark||'' } })}>✏️</button>
                        <button className="dg-action-btn delete" title="Remove" onClick={() => deleteAward(r)}>🗑</button>
                      </div>
                    ) },
                ]}
                data={awards} rowKey="id" defaultPageSize={15} striped
                onRowDoubleClick={(r) => setAwardModal({ id:r.id, form:{ awardName:r.awardName, recipientName:r.recipientName||'', remark:r.remark||'' } })}
              />
            </div>
          )}
        </>
      )}

      {/* ── Guest modal ── */}
      {guestModal && (
        <FormModal title={guestModal.id ? '✏️ Edit Guest' : '+ Add Guest'} onClose={() => setGuestModal(null)} onSubmit={saveGuest} saving={saving} extraWide>
          <div style={{ display:'grid', gridTemplateColumns:'62% 38%', gap:20 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:12, minWidth:0 }}>
          <Field label="Select Company">
            <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
              <div style={{ flex:1 }}>
                <SearchableSelect value={guestModal.form.contactId ? String(guestModal.form.contactId) : ''}
                  onChange={applyContactPick} autoOpen={!guestModal.id}
                  options={contacts.map(c => ({ value:String(c.id), label:`${contactDisplayName(c)}${contactDisplayOrg(c) && contactDisplayOrg(c) !== contactDisplayName(c) ? ' — ' + contactDisplayOrg(c) : ''}` }))}
                  placeholder="— Not linked, type name/contact manually below —" />
              </div>
              <button type="button" onClick={() => setNewCompanyModal(true)}
                style={{ flexShrink:0, height:36, padding:'0 14px', borderRadius:7, border:'1.5px solid #1a56db',
                  background:'#fff', color:'#1a56db', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                + New
              </button>
            </div>
          </Field>

          {guestModal.form.contactId && companyPersons.length > 1 ? (
            <div style={{ background:'#eef2ff', border:'1px solid #e0e7ff', borderRadius:10, padding:'12px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px' }}>
                  👥 Guests From this Company ({companyPersons.length})
                </div>
                {companyQr && (
                  <button type="button" onClick={() => setShowQrPopup(true)}
                    style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6,
                      border:'1px solid #c7d2fe', background:'#fff', color:'#1a56db', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                    📱 View QR
                  </button>
                )}
              </div>
              <DataGrid
                columns={[
                  { field:'name', header:'Name', fill:true },
                  { field:'post', header:'Post', width:100, render:v => v || '—' },
                  { field:'mobile1', header:'Mobile 1', width:100, render:v => v || '—' },
                  { field:'email', header:'Email', width:140, render:v => v || '—' },
                ]}
                data={companyPersons} rowKey="id" showSearch={false} showFooter={false}
                showCheckbox={false} showFilterButton={false} compact autoWidth
                onRowClick={p => setSelectedRosterPersonId(id => id === p.id ? null : p.id)}
              />
              {selectedRosterPersonId && (() => {
                const person = companyPersons.find(p => p.id === selectedRosterPersonId);
                const matchedGuest = guests.find(g => g.contactPersonId === selectedRosterPersonId);
                return (
                  <div style={{ marginTop:10, background:'#fff', border:'1px solid #c7d2fe', borderRadius:8, padding:'10px 12px' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#1e40af', marginBottom:6 }}>{person?.name} — Status</div>
                    {matchedGuest ? (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {matchedGuest.invited
                          ? <Pill bg="#eff6ff" color="#1e40af">Invited Guest</Pill>
                          : <Pill bg="#fff7ed" color="#7c2d12">Uncalled</Pill>}
                        {matchedGuest.invitationSent
                          ? <Pill bg="#ede9fe" color="#5b21b6">Invitation Send</Pill>
                          : <Pill bg="#f3f4f6" color="#6b7280">Invitation Not Send</Pill>}
                        {matchedGuest.confirmed
                          ? <Pill bg="#f0fdf4" color="#065f46">Confirmed attendance</Pill>
                          : <Pill bg="#f3f4f6" color="#6b7280">Not Confirmed</Pill>}
                        {matchedGuest.attended
                          ? <Pill bg="#fffbeb" color="#92400e">Register at Event</Pill>
                          : <Pill bg="#f3f4f6" color="#6b7280">Not Registered</Pill>}
                      </div>
                    ) : (
                      <div style={{ fontSize:12, color:'#9ca3af' }}>Not yet added as a guest for this event.</div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : guestModal.form.contactId ? (
            <div style={{ background:'#eef2ff', border:'1px solid #e0e7ff', borderRadius:10, padding:'12px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px' }}>
                  👤 Contact Information
                </div>
                {companyQr && (
                  <button type="button" onClick={() => setShowQrPopup(true)}
                    style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6,
                      border:'1px solid #c7d2fe', background:'#fff', color:'#1a56db', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                    📱 View QR
                  </button>
                )}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                {[
                  ['Name', guestModal.form.name || '—'],
                  ['Post', linkedPersonInfo?.post || '—'],
                  ['Mobile 1', linkedPersonInfo?.mobile1 || guestModal.form.contact || '—'],
                  ['Mobile 2', linkedPersonInfo?.mobile2 || '—'],
                  ['Email', linkedPersonInfo?.email || '—'],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <Field label="Name" required>
                <input className="form-control" value={guestModal.form.name}
                  onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, name:e.target.value,
                    // A single name entered with no Invited No. set yet defaults to 1 guest —
                    // covers legacy rows from before expectedGuests existed, not just new ones.
                    expectedGuests: (e.target.value && m.form.expectedGuests === '') ? 1 : m.form.expectedGuests } }))} />
              </Field>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ flex:1 }}><Field label="Contact">
                  <input className="form-control" value={guestModal.form.contact}
                    onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, contact:e.target.value } }))} />
                </Field></div>
                <div style={{ flex:1 }}><Field label="Organization">
                  <input className="form-control" value={guestModal.form.organization}
                    onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, organization:e.target.value } }))} />
                </Field></div>
              </div>
            </>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:10, background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px' }}>
            {/* Invited/Invitation Sent/Confirmed/Registered are no longer set
                here — they're driven by the Status checked on a Followup
                entry (guest panel → + New) instead, so they always reflect
                the actual last contact rather than a manual toggle someone
                forgot to flip. Invited No. and Attended in Event stay here
                since neither has a Followup equivalent. */}
            <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:10, width:170 }}>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>Invited No.</div>
                  <input type="number" min="0" inputMode="numeric" placeholder="Invited No."
                    value={guestModal.form.expectedGuests}
                    onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, expectedGuests:e.target.value } }))}
                    style={{ width:'100%', padding:'5px 9px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12 }} />
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>Attended in Event</div>
                  <input type="number" min="0" inputMode="numeric"
                    placeholder={guestModal.form.attended ? 'Attended in Event' : 'Check in first'}
                    value={guestModal.form.participantCount} disabled={!guestModal.form.attended}
                    title={guestModal.form.attended ? '' : 'Enabled once Registered at Event is set via a Followup'}
                    onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, participantCount:e.target.value } }))}
                    style={{ width:'100%', padding:'5px 9px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12,
                      background: guestModal.form.attended ? '#fff' : '#f3f4f6',
                      color: guestModal.form.attended ? '#111827' : '#9ca3af',
                      cursor: guestModal.form.attended ? 'text' : 'not-allowed' }} />
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10, flex:1, minWidth:170 }}>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>Registered at Event</div>
                  {guestModal.id == null ? (
                    <div style={{ padding:'5px 9px', borderRadius:6, border:'1px solid #e5e7eb', background:'#f9fafb',
                      fontSize:12, fontWeight:600, color:'#9ca3af' }}>
                      Save the guest first
                    </div>
                  ) : guestModal.form.attended ? (
                    <button type="button" onClick={toggleAttendedInForm} title="Click to un-register"
                      style={{ width:'100%', padding:'5px 9px', borderRadius:6, border:'1px solid #fde68a',
                        background:'#fffbeb', color:'#92400e', fontSize:12, fontWeight:700, cursor:'pointer',
                        textAlign:'left' }}>
                      ✓ {fmtDateTime(guestModal.form.checkedInAt)} — click to remove
                    </button>
                  ) : (
                    <button type="button" onClick={toggleAttendedInForm}
                      style={{ width:'100%', padding:'5px 9px', borderRadius:6, border:'1px solid #93c5fd',
                        background:'#eff6ff', color:'#1d4ed8', fontSize:12, fontWeight:700, cursor:'pointer',
                        textAlign:'left' }}>
                      Not checked in — click to Check In
                    </button>
                  )}
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>Lucky Draw Coupon No.</div>
                  <div style={{ padding:'5px 9px', borderRadius:6, border:'1px solid #e5e7eb', background:'#f9fafb',
                    fontSize:12, fontWeight:700, color: guestModal.form.luckyDrawNo != null ? '#92400e' : '#9ca3af' }}>
                    {guestModal.form.luckyDrawNo != null ? `#${String(guestModal.form.luckyDrawNo).padStart(3, '0')}` : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Field label="Remark">
            <textarea className="form-control" rows={2} value={guestModal.form.remark}
              onChange={e => setGuestModal(m => ({ ...m, form:{ ...m.form, remark:e.target.value } }))} />
          </Field>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:0 }}>
            {event.invitationImage && (
              <img src={event.invitationImage} alt="Event Invitation" onClick={() => setImagePreview(event.invitationImage)}
                style={{ width:'100%', height:'auto', borderRadius:8, border:'1px solid #e5e7eb', cursor:'zoom-in', display:'block' }} />
            )}
          </div>
          </div>
        </FormModal>
      )}

      {/* ── "Scan to Check In" QR popup — pops up the moment a Company is
           selected; the small button next to Select Company reopens it. ── */}
      {showQrPopup && companyQr && (
        <div className="modal-overlay" onClick={() => setShowQrPopup(false)}>
          {/* One continuous unit, not two separate cards with a gap between
              them — the QR side's right corners and the Event Invitation
              side's left corners are squared off so they read as one piece,
              with a thin divider line marking the seam. The Invitation panel
              still gets its own close button and fills completely
              (object-fit:cover) with no blank space. */}
          {/* One shared box-shadow on this outer wrapper (not on each inner
              panel) so the merged pair reads as a single frame — an
              independent shadow per panel was what looked like a "frame"
              around the invitation side specifically. */}
          <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'stretch',
            maxWidth: event.invitationImage ? 900 : 460, width:'94vw', maxHeight:'90vh', boxShadow:'var(--shadow-xl)', borderRadius:'var(--radius-lg)' }}>
            <div className="modal" style={{ flex: event.invitationImage ? '1 1 460px' : '1 1 100%', minWidth:320, maxWidth:460,
              boxShadow:'none', display:'flex', flexDirection:'column',
              ...(event.invitationImage ? { borderTopRightRadius:0, borderBottomRightRadius:0 } : {}) }}>
              <div className="modal-header" style={{ borderBottom:'none' }}>
                <h2>📱 Scan to Check In</h2>
              </div>
              {/* Top content flows naturally (Welcome/Event/Venue pinned at
                  the top, bigger type); the "Organized by" block gets
                  marginTop:'auto' to soak up whatever space is left and sit
                  flush at the bottom of the card instead of needing the
                  whole block artificially centered. */}
              <div className="modal-body" style={{ textAlign:'center', padding:'10px 20px', flex:1, display:'flex', flexDirection:'column' }}>
                <div style={{ fontSize:14, color:'#6b7280' }}>Welcome to</div>
                <div style={{ fontSize:20, fontWeight:800, color:'#111827', marginTop:2 }}>{event.name}</div>
                {event.venue && <div style={{ fontSize:13, color:'#6b7280', marginTop:1 }}>📍 {event.venue}</div>}
                {/* marginTop:'auto' pushes the QR block down from the top
                    text, sharing the available slack space with the
                    "Organized by" block's own auto margin below — the two
                    auto margins split the extra room roughly evenly, so the
                    QR/Lucky-Draw block settles toward the middle instead of
                    sitting right under Welcome/Event/Venue. */}
                <img src={companyQr.dataUrl} alt="Check-in QR" style={{ width:180, height:180, display:'block', margin:'auto auto 0', borderRadius:8 }} />
                <div style={{ fontSize:13.5, fontWeight:800, color:'#111827', marginTop:6 }}>{companyQr.organization || 'This Company'}</div>
                <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>Guest Registration Online</div>
                <div style={{ marginTop:8, padding:'6px 16px', background:'#fffbeb', border:'1px solid #fde68a',
                  borderRadius:8, fontSize:13.5, fontWeight:700, color:'#92400e', lineHeight:1.35 }}>
                  🎟️ Lucky Draw Coupon No. will be shared automatically<br />
                  Keep it safe &amp; win a gift! 🎁
                </div>
                {settings.companyNameEn && (
                  <div style={{ marginTop:'auto', paddingTop:6, fontSize:12.5, color:'#111827', lineHeight:1.4 }}>
                    <div style={{ color:'#374151' }}>Organized by</div>
                    <div style={{ fontSize:15, fontWeight:800, color:'#000' }}>{settings.companyNameEn}</div>
                    {(settings.companyPhone || organizerContact?.companyPhone) && (
                      <div>
                        {settings.companyPhone && <>Phone: {settings.companyPhone}</>}
                        {settings.companyPhone && organizerContact?.companyPhone && ' | '}
                        {organizerContact?.companyPhone && <>Mobile: {organizerContact.companyPhone}</>}
                      </div>
                    )}
                    {settings.companyAddressEn && <div>Address: {settings.companyAddressEn}</div>}
                    {settings.companyWebsite && <div>{settings.companyWebsite}</div>}
                  </div>
                )}
              </div>
              {/* Done button only shown when this is the only panel (no
                  Invitation image) — with one, its own ✕ already closes the
                  whole popup, so a second close control here was redundant. */}
              {!event.invitationImage && (
                <div className="modal-footer">
                  <button className="btn btn-primary" onClick={() => setShowQrPopup(false)}>Done</button>
                </div>
              )}
            </div>
            {event.invitationImage && (
              // object-fit:cover always fills this panel completely, no
              // matter how tall the QR side ends up being (it stretches to
              // match via align-items:stretch) — a fixed-width/aspect-ratio
              // approach kept leaving blank space whenever the QR side's
              // height changed for unrelated reasons (e.g. a longer event
              // name wrapping to 2 lines). object-position:'top' means any
              // cropping happens at the bottom, keeping the logo/headline
              // (top of a typical flyer) intact.
              <div className="modal" style={{ flex:'1 1 380px', minWidth:260, maxWidth:480, position:'relative', overflow:'hidden', padding:0,
                boxShadow:'none', borderTopLeftRadius:0, borderBottomLeftRadius:0, borderLeft:'1px solid #e5e7eb' }}>
                <button className="modal-close" onClick={() => setShowQrPopup(false)}
                  style={{ position:'absolute', top:10, right:10, zIndex:2, background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,.15)' }}>✕</button>
                <img src={event.invitationImage} alt="Event Invitation" onClick={() => setImagePreview(event.invitationImage)}
                  style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'top', cursor:'zoom-in', display:'block' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── New Company (Contact) modal, launched from the guest modal's "+ New" ── */}
      {newCompanyModal && (
        <ContactFormModal
          initial={{ ...CONTACT_EMPTY, contactInfo: 'company' }}
          onClose={() => setNewCompanyModal(false)}
          onSaved={handleNewCompanySaved}
        />
      )}

      {/* ── Right-side guest detail panel — opens on a single row click,
           same fixed-overlay convention as Staff → Contact's DetailPanel
           (doesn't shrink the grid, just overlays on top of it). Replaces
           the old centered Followup History modal and the grid's separate
           Actions column — Edit/WhatsApp/QR/Delete/Followup all live here. ── */}
      {followupModal && (() => {
        const r = followupModal.guest;
        // Tabs show EVERY Contact Person on file for this company (same
        // roster as the Edit modal's "Guests From this Company" grid), not
        // just whoever already happens to be a guest for this event. A tab
        // with a matching guest record switches the whole panel to their
        // own record; one without shows a "not yet added" preview instead.
        const people = panelCompanyPersons.length ? panelCompanyPersons : (r.contactPersonId
          ? [{ id:r.contactPersonId, name:r.name }] : []);
        const previewPerson = previewPersonId ? people.find(p => p.id === previewPersonId) : null;
        const active = { post:panelPersonInfo?.post, mobile1:panelPersonInfo?.mobile1 || r.contact,
          mobile2:panelPersonInfo?.mobile2, email:panelPersonInfo?.email };
        return (
          <div style={{
            position:'fixed', top:60, right:0, bottom:0, width:560, zIndex:51,
            background:'#fff', boxShadow:'-6px 0 24px rgba(0,0,0,.15)', borderLeft:'1px solid #dedede',
            display:'flex', flexDirection:'column', overflow:'hidden',
          }}>
            {/* Header */}
            <div style={{ background:'#fff', flexShrink:0, padding:'16px 16px 14px', borderBottom:'1px solid #e5e7eb', position:'relative' }}>
              <button onClick={() => setFollowupModal(null)}
                style={{ position:'absolute', top:10, right:10, background:'rgba(0,0,0,.06)',
                  border:'none', borderRadius:6, width:26, height:26, cursor:'pointer',
                  fontSize:14, color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>
                ✕
              </button>
              <div style={{ fontSize:17, fontWeight:800, color:'#111827', lineHeight:1.3, paddingRight:30 }}>
                {r.organization || r.name}
              </div>
              <div style={{ display:'flex', gap:20, marginTop:10 }}>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px' }}>Invited No.</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'#5b21b6' }}>{r.expectedGuests ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px' }}>Total Confirmed</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'#92400e' }}>{r.participantCount ?? '—'}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                {r.invited
                  ? <Pill size="lg" bg="#eff6ff" color="#1e40af">Invited</Pill>
                  : <Pill size="lg" bg="#fff7ed" color="#7c2d12">Uncalled</Pill>}
                {r.invitationSent
                  ? <Pill size="lg" bg="#ede9fe" color="#5b21b6">✉ Sent {fmtDate(r.invitationSentAt)}</Pill>
                  : <Pill size="lg" bg="#f3f4f6" color="#6b7280">Invitation Not Sent</Pill>}
                {r.confirmed
                  ? <Pill size="lg" bg="#f0fdf4" color="#065f46">✓ Confirmed</Pill>
                  : <Pill size="lg" bg="#f3f4f6" color="#6b7280">Not Confirmed</Pill>}
                {r.attended
                  ? <Pill size="lg" bg="#fffbeb" color="#92400e">✓ Registered {fmtDateTime(r.checkedInAt)}</Pill>
                  : <Pill size="lg" bg="#f3f4f6" color="#6b7280">Not Registered</Pill>}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
              {/* Guest tabs — every Contact Person on file for this company;
                  clicking one with a real guest record switches the whole
                  panel to their own record, clicking one without shows a
                  "not yet added" preview instead. */}
              {people.length > 1 && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:10, borderBottom:'1px solid #eef1f5', paddingBottom:8 }}>
                  {people.map(p => {
                    const matchedGuest = guests.find(g => g.contactPersonId === p.id);
                    const isActive = previewPersonId ? previewPersonId === p.id : (matchedGuest ? matchedGuest.id === r.id : p.id === r.contactPersonId);
                    return (
                      <button key={p.id}
                        onClick={() => matchedGuest ? (matchedGuest.id !== r.id && openFollowups(matchedGuest)) : setPreviewPersonId(p.id)}
                        style={{ padding:'5px 12px', borderRadius:16, fontSize:12, fontWeight:700, cursor:'pointer',
                          border: isActive ? '1.5px solid #1a56db' : '1px solid #d1d5db',
                          background: isActive ? '#eff6ff' : '#fff',
                          color: isActive ? '#1a56db' : '#6b7280' }}>
                        👤 {p.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {previewPerson ? (
                <>
                  <div style={{ background:'#f9fafb', border:'1px dashed #d1d5db', borderRadius:10, padding:'12px 14px', textAlign:'center', marginBottom:16 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:4 }}>{previewPerson.name}</div>
                    <div style={{ fontSize:12, color:'#9ca3af' }}>Not yet added as a guest for this event.</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px' }}>
                      💬 Followup History
                    </div>
                    <button onClick={() => addGuestFromPreview(previewPerson)}
                      style={{ padding:'4px 12px', borderRadius:6, border:'none', background:'#1a56db',
                        color:'#fff', fontSize:11.5, fontWeight:700, cursor:'pointer' }}>
                      + New
                    </button>
                  </div>
                  <div style={{ textAlign:'center', color:'#9ca3af', padding:20, fontSize:13 }}>No followup entries yet</div>
                </>
              ) : (
              <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16,
                background:'#eff6ff', border:'1px solid #dbeafe', borderRadius:10, padding:'12px 14px' }}>
                <div>
                  <div style={{ fontSize:10, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Post</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{active.post || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Mobile 1</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{active.mobile1 || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Mobile 2</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{active.mobile2 || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Email</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1f2937', wordBreak:'break-word' }}>{active.email || '—'}</div>
                </div>
              </div>

              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px' }}>
                  💬 Followup History
                </div>
                <button onClick={() => { setFollowupForm({ ...EMPTY_FOLLOWUP_FORM }); setEditingFollowupId(null); setAddFollowupModal(true); }}
                  style={{ padding:'4px 12px', borderRadius:6, border:'none', background:'#1a56db',
                    color:'#fff', fontSize:11.5, fontWeight:700, cursor:'pointer' }}>
                  + New
                </button>
              </div>

              {followupModal.loading ? (
                <div style={{ textAlign:'center', color:'#9ca3af', padding:20 }}>Loading…</div>
              ) : followupModal.list.length === 0 ? (
                <div style={{ textAlign:'center', color:'#9ca3af', padding:20, fontSize:13 }}>No followup entries yet</div>
              ) : (
                <DataGrid
                  columns={[
                    { field:'createdAt', header:'Date', width:110, render:v => <span style={{ whiteSpace:'nowrap' }}>{fmtDateTime(v)}</span> },
                    { field:'followUpVia', header:'Foll. Media', width:100, render:v => v || '—' },
                    { field:'createdByName', header:'Follow up by', fill:true, render:(v, f) => {
                      const name = <span style={{ color:'#1a56db', fontWeight:600 }}>{firstName(v)}</span>;
                      return f.note ? <HoverCard arrow content={f.note} trigger={name} /> : name;
                    } },
                    { field:'actions', header:'', width:56, sortable:false, filterable:false,
                      render:(_, f) => (
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => openEditFollowup(f)}
                            style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:12 }}>✏️</button>
                          <button onClick={() => deleteFollowup(f)}
                            style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:12 }}>🗑</button>
                        </div>
                      ) },
                  ]}
                  data={followupModal.list} rowKey="id" showSearch={false} showFooter={false}
                  showCheckbox={false} showFilterButton={false} compact autoWidth
                />
              )}

              <div style={{ marginTop:16, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'#92400e', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>Remark</div>
                <div style={{ fontSize:13, color:'#1f2937', wordBreak:'break-word' }}>{r.remark || '—'}</div>
              </div>

              {followupModal.list.length > 0 && (
                <div style={{ marginTop:12, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 14px' }}>
                  <div style={{ fontSize:10, color:'#065f46', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:2 }}>
                    📝 Latest Followup Conversation
                  </div>
                  <div style={{ fontSize:13, color:'#1f2937', wordBreak:'break-word' }}>{followupModal.list[0].note || '—'}</div>
                </div>
              )}
              </>
              )}
            </div>

            {/* Actions */}
            <div style={{ padding:'10px 16px', borderTop:'1px solid #f3f4f6', display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
              <button onClick={() => showQrForRow(r)}
                style={{ flex:1, minWidth:80, padding:'7px 0', borderRadius:8, border:'1px solid #d1d5db',
                  background:'#fff', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                📱 QR
              </button>
              <button onClick={() => sendThankYouWhatsApp(r)}
                style={{ flex:1, minWidth:80, padding:'7px 0', borderRadius:8, border:'1px solid #bbf7d0',
                  background:'#f0fdf4', color:'#166534', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                📤 WhatsApp
              </button>
              {canEditGuests && (
                <button onClick={() => setGuestModal({ id:r.id, form:guestToForm(r) })}
                  style={{ flex:1, minWidth:80, padding:'7px 0', borderRadius:8, border:'1px solid #d1d5db',
                    background:'#fff', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  ✏️ Edit
                </button>
              )}
              {canDeleteGuests && (
                <button onClick={() => { setFollowupModal(null); deleteGuest(r); }}
                  style={{ flex:1, minWidth:80, padding:'7px 0', borderRadius:8, border:'1px solid #fecaca',
                    background:'#fff5f5', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  🗑️ Delete
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Add Followup popup — opened via the panel's "+ New" button.
           Each section gets its own background tint so Media/Status/
           Conversation read as distinct steps rather than one long form. ── */}
      {addFollowupModal && (
        <div className="modal-overlay" onClick={() => setAddFollowupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth:440, width:'94vw' }}>
            <div className="modal-header">
              <h2>💬 {editingFollowupId ? 'Edit Followup' : 'New Followup'}</h2>
              <button className="modal-close" onClick={() => setAddFollowupModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ background:'#eff6ff', border:'1px solid #dbeafe', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#1e40af', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
                  📡 Follow by Media
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
                  {FOLLOWUP_MEDIA_OPTIONS.map(m => (
                    <label key={m} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12.5, color:'#1f2937', cursor:'pointer' }}>
                      <input type="checkbox" checked={followupForm.media.includes(m)} onChange={() => toggleFollowupMedia(m)} />
                      {m}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#065f46', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
                  ✅ Status
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {FOLLOWUP_STATUS_OPTIONS.map(o => (
                    <label key={o.value} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'#1f2937', cursor:'pointer' }}>
                      <input type="checkbox" checked={followupForm.statuses.includes(o.value)}
                        onChange={() => toggleFollowupStatus(o.value)} />
                      {o.value}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
                  📝 Followup Conversation
                </div>
                <textarea className="form-control" rows={3} placeholder="What was discussed…"
                  value={followupForm.conversation}
                  onChange={e => setFollowupForm(f => ({ ...f, conversation:e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setAddFollowupModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveFollowup} disabled={followupSaving || !followupForm.conversation.trim()}>
                {followupSaving ? 'Saving…' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Contact Person picker — Company contact selected in the Guest
           modal drills down to which person at that company is attending.
           Reuses Staff → Contact's own Contact Persons sub-records: pick an
           existing one (editable before confirming) or add a new one. ── */}
      {personPickerModal && (
        <div className="modal-overlay" onClick={() => setPersonPickerModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth:640, width:'94vw' }}>
            <div className="modal-header">
              <h2>👤 {personPickerModal.contact.companyName} — Contact Persons</h2>
              <button className="modal-close" onClick={() => setPersonPickerModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {personPickerModal.loading ? (
                <div style={{ textAlign:'center', color:'#9ca3af', padding:30 }}>Loading…</div>
              ) : personPickerModal.editing ? (
                // ── Editable details form (existing person confirmed, or a brand new one) ──
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <Field label="Name" required>
                    <input className="form-control" value={personPickerModal.editing.name}
                      onChange={e => setPersonPickerModal(m => ({ ...m, editing:{ ...m.editing, name:e.target.value } }))} />
                  </Field>
                  <div style={{ display:'flex', gap:12 }}>
                    <div style={{ flex:1 }}><Field label="Post"><input className="form-control" value={personPickerModal.editing.post}
                      onChange={e => setPersonPickerModal(m => ({ ...m, editing:{ ...m.editing, post:e.target.value } }))} /></Field></div>
                    <div style={{ flex:1 }}><Field label="Email"><input className="form-control" value={personPickerModal.editing.email}
                      onChange={e => setPersonPickerModal(m => ({ ...m, editing:{ ...m.editing, email:e.target.value } }))} /></Field></div>
                  </div>
                  <div style={{ display:'flex', gap:12 }}>
                    <div style={{ flex:1 }}><Field label="Mobile 1"><input className="form-control" value={personPickerModal.editing.mobile1}
                      onChange={e => setPersonPickerModal(m => ({ ...m, editing:{ ...m.editing, mobile1:e.target.value } }))} /></Field></div>
                    <div style={{ flex:1 }}><Field label="Mobile 2"><input className="form-control" value={personPickerModal.editing.mobile2}
                      onChange={e => setPersonPickerModal(m => ({ ...m, editing:{ ...m.editing, mobile2:e.target.value } }))} /></Field></div>
                  </div>
                </div>
              ) : (
                // ── List of existing Contact Persons for this company ──
                <div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
                    {personPickerModal.persons.map(p => {
                      const isDup = isPersonAlreadyGuest(p.id);
                      return (
                        <div key={p.id} onClick={() => pickExistingPerson(p)}
                          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
                            background: isDup ? '#fef2f2' : '#f9fafb', border: `1px solid ${isDup ? '#fecaca' : '#e5e7eb'}`,
                            borderRadius:8, padding:'9px 12px', cursor: isDup ? 'not-allowed' : 'pointer', opacity: isDup ? .75 : 1 }}
                          onMouseEnter={e => { if (!isDup) e.currentTarget.style.background='#eff6ff'; }}
                          onMouseLeave={e => { if (!isDup) e.currentTarget.style.background='#f9fafb'; }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color: isDup ? '#991b1b' : '#111827' }}>{p.name}</div>
                            <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>
                              {[p.post, p.mobile1, p.email].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          {isDup
                            ? <span style={{ color:'#991b1b', fontSize:11.5, fontWeight:700 }}>✓ Already Registered</span>
                            : <span style={{ color:'#1a56db', fontSize:12, fontWeight:600 }}>Select →</span>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setPersonPickerModal(m => ({ ...m, editing:{ id:null, name:'', post:'', email:'', mobile1:'', mobile2:'' } }))}
                    style={{ width:'100%', padding:'9px 0', borderRadius:8, border:'1.5px dashed #93c5fd',
                      background:'#eff6ff', color:'#1d4ed8', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    + Add New Person
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {personPickerModal.editing && personPickerModal.persons.length > 0 && (
                <button className="btn btn-outline" onClick={() => setPersonPickerModal(m => ({ ...m, editing:null }))}>← Back to list</button>
              )}
              <button className="btn btn-outline" onClick={() => setPersonPickerModal(null)}>Cancel</button>
              {personPickerModal.editing && (
                <button className="btn btn-primary" onClick={savePersonAndApply} disabled={personSaving}>
                  {personSaving ? 'Saving…' : '💾 Use This Person'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Product modal ── */}
      {productModal && (
        <FormModal title={productModal.id ? '✏️ Edit Product' : '+ Add Product'} onClose={() => setProductModal(null)} onSubmit={saveProduct} saving={saving}>
          <div style={{ display:'flex', gap:12 }}>
            <Field label="Product Name" required>
              <input className="form-control" value={productModal.form.productName}
                onChange={e => setProductModal(m => ({ ...m, form:{ ...m.form, productName:e.target.value } }))} />
            </Field>
            <Field label="Quantity">
              <input type="number" min={1} className="form-control" value={productModal.form.quantity}
                onChange={e => setProductModal(m => ({ ...m, form:{ ...m.form, quantity:Number(e.target.value)||1 } }))} />
            </Field>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px' }}>
            <Toggle value={productModal.form.sentOut} label="Sent out to venue"
              onColor="#d97706" onChange={v => setProductModal(m => ({ ...m, form:{ ...m.form, sentOut:v } }))} />
            <Toggle value={productModal.form.returned} label="Returned to office"
              onColor="#059669" onChange={v => setProductModal(m => ({ ...m, form:{ ...m.form, returned:v } }))} />
          </div>
          <Field label="Remark">
            <textarea className="form-control" rows={2} value={productModal.form.remark}
              onChange={e => setProductModal(m => ({ ...m, form:{ ...m.form, remark:e.target.value } }))} />
          </Field>
        </FormModal>
      )}

      {/* ── Gift modal ── */}
      {giftModal && (
        <FormModal title={giftModal.id ? '✏️ Edit Gift' : '+ Add Gift'} onClose={() => setGiftModal(null)} onSubmit={saveGift} saving={saving}>
          <Field label="Gift Name" required>
            <input className="form-control" value={giftModal.form.giftName}
              onChange={e => setGiftModal(m => ({ ...m, form:{ ...m.form, giftName:e.target.value } }))} />
          </Field>
          <div style={{ display:'flex', gap:12 }}>
            <Field label="Recipient"><input className="form-control" value={giftModal.form.recipientName}
              onChange={e => setGiftModal(m => ({ ...m, form:{ ...m.form, recipientName:e.target.value } }))} /></Field>
            <Field label="Quantity">
              <input type="number" min={1} className="form-control" value={giftModal.form.quantity}
                onChange={e => setGiftModal(m => ({ ...m, form:{ ...m.form, quantity:Number(e.target.value)||1 } }))} />
            </Field>
          </div>
          <Field label="Remark">
            <textarea className="form-control" rows={2} value={giftModal.form.remark}
              onChange={e => setGiftModal(m => ({ ...m, form:{ ...m.form, remark:e.target.value } }))} />
          </Field>
        </FormModal>
      )}

      {/* ── Award modal ── */}
      {awardModal && (
        <FormModal title={awardModal.id ? '✏️ Edit Award' : '+ Add Award'} onClose={() => setAwardModal(null)} onSubmit={saveAward} saving={saving}>
          <Field label="Award Name" required>
            <input className="form-control" value={awardModal.form.awardName}
              onChange={e => setAwardModal(m => ({ ...m, form:{ ...m.form, awardName:e.target.value } }))} />
          </Field>
          <Field label="Recipient">
            <input className="form-control" value={awardModal.form.recipientName}
              onChange={e => setAwardModal(m => ({ ...m, form:{ ...m.form, recipientName:e.target.value } }))} />
          </Field>
          <Field label="Remark">
            <textarea className="form-control" rows={2} value={awardModal.form.remark}
              onChange={e => setAwardModal(m => ({ ...m, form:{ ...m.form, remark:e.target.value } }))} />
          </Field>
        </FormModal>
      )}

      {imagePreview && <ImageLightbox src={imagePreview} onClose={() => setImagePreview(null)} />}

      {showAppreciation && (
        <AppreciationCeremonyModal
          event={event} themeImage={appreciationTheme} onClose={() => setShowAppreciation(false)}
          companies={luckyCompanies} attendeeNamesOf={attendeeNamesOf} workScopeOf={workScopeOf}
          statusByCompany={appreciationStatusByCompany}
          onMarkDone={markAppreciationDone}
          onDeleteCompany={deleteAppreciationCompany}
          onRestoreCompany={restoreAppreciationCompany}
          isAdmin={isAdmin}
          onThemeChange={setAppreciationTheme}
          showToast={showToast}
          organizerTagline={organizerContact?.workScope}
          organizerWebsite={settings.companyWebsite}
        />
      )}

      {showCouponDraw && (
        <LuckyDrawModal
          event={event} icon="🎟️" subtitle="Coupon Lucky Draw" onClose={() => setShowCouponDraw(false)}
          items={luckyCoupons} emptyLabel="No guests have checked in yet — no coupons issued."
          labelOf={c => `#${String(c.no).padStart(3, '0')}`}
          itemKeyOf={c => String(c.no)}
          winnerInfoOf={c => ({ title: c.name, subtitle1: c.org, subtitle2: workScopeOf(c.org) })}
          rowLabelOf={c => (
            <>
              <span>#{String(c.no).padStart(3, '0')} — {c.name}</span>
              <span style={{ color:'#6b7280' }}>{c.org}</span>
            </>
          )}
          winners={luckyDrawWinners.filter(w => w.drawType === 'coupon')}
          onWinnerWon={(itemKey, info) => saveLuckyDrawWinner('coupon', itemKey, info)}
          onReset={() => resetLuckyDrawWinners('coupon')}
          onResetCoupons={resetCoupons}
          showToast={showToast}
          organizerTagline={organizerContact?.workScope}
          organizerWebsite={settings.companyWebsite}
        />
      )}

      {showCompanyDraw && (
        <LuckyDrawModal
          event={event} icon="🎡" subtitle="Spin Lucky Draw — Company" onClose={() => setShowCompanyDraw(false)}
          items={luckyCompanies} emptyLabel="No companies have checked in yet."
          labelOf={org => org}
          itemKeyOf={org => org}
          winnerInfoOf={org => ({ title: org, subtitle1: attendeeNamesOf(org), subtitle2: workScopeOf(org) })}
          rowLabelOf={org => (
            <div style={{ minWidth:0 }}>
              <div style={{ fontWeight:600 }}>{org}</div>
              {attendeeNamesOf(org) && (
                <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>{attendeeNamesOf(org)}</div>
              )}
            </div>
          )}
          winners={luckyDrawWinners.filter(w => w.drawType === 'company')}
          onWinnerWon={(itemKey, info) => saveLuckyDrawWinner('company', itemKey, info)}
          onReset={() => resetLuckyDrawWinners('company')}
          showToast={showToast}
          organizerTagline={organizerContact?.workScope}
          organizerWebsite={settings.companyWebsite}
        />
      )}

      {showQaDraw && (
        <QaDrawModal
          event={event} qaDraws={qaDraws} guests={guests} onClose={() => setShowQaDraw(false)}
          onCreate={createQaDraw} onUpdate={updateQaDraw} onDelete={deleteQaDraw} showToast={showToast}
          organizerTagline={organizerContact?.workScope} organizerWebsite={settings.companyWebsite}
        />
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  Main page — Events list
// ══════════════════════════════════════════════════════════════════════════
const EventVisitorRegistration = () => {
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeEvent, setActiveEvent] = useState(null);
  const [modal, setModal] = useState(null); // { id, form }
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [uploadingInvitation, setUploadingInvitation] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  // Module toggle (Settings → Role & Permission Management → Module
  // Controls), off by default for every role including Admin — checked
  // up front so a disabled module shows a clear message instead of the
  // page loading normally and every API call underneath it 503ing.
  const [moduleEnabled, setModuleEnabled] = useState(null); // null = still checking

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { setEvents(await api.get('/events')); }
    catch (e) { showToast(e.message || 'Failed to load', '#dc2626'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    api.get('/module-flags')
      .then(f => setModuleEnabled(!!f.guestRegistrationEnabled))
      .catch(() => setModuleEnabled(false));
  }, []);
  useEffect(() => { if (moduleEnabled) load(); }, [moduleEnabled, load]);

  const saveEvent = async () => {
    const f = modal.form;
    if (!f.name.trim()) { showToast('Event Name is required', '#dc2626'); return; }
    setSaving(true);
    try {
      if (modal.id) {
        const saved = await api.put(`/events/${modal.id}`, f);
        setEvents(p => p.map(r => r.id === saved.id ? { ...r, ...saved } : r));
        if (activeEvent?.id === saved.id) setActiveEvent(e => ({ ...e, ...saved }));
        showToast('Event updated');
      } else {
        const saved = await api.post('/events', f);
        setEvents(p => [{ ...saved, invitedCount:0, confirmedCount:0, attendedCount:0, uncalledCount:0 }, ...p]);
        showToast('Event created');
      }
      setModal(null);
    } catch (e) { showToast(e.message || 'Save failed', '#dc2626'); }
    finally { setSaving(false); }
  };

  const handleInvitationImageFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingInvitation(true);
    try {
      const dataUrl = await readAndDownscale(file);
      setModal(m => ({ ...m, form: { ...m.form, invitationImage: dataUrl } }));
    } catch (err) { showToast(err.message || 'Invalid image', '#dc2626'); }
    finally { setUploadingInvitation(false); }
  };

  const deleteEvent = async (row) => {
    if (!window.confirm(`Delete event "${row.name}"? This also removes all its guests, products, gifts and awards.`)) return;
    try {
      await api.delete(`/events/${row.id}`);
      setEvents(p => p.filter(r => r.id !== row.id));
      if (activeEvent?.id === row.id) setActiveEvent(null);
      showToast('Event deleted');
    } catch (e) { showToast(e.message || 'Delete failed', '#dc2626'); }
  };

  if (moduleEnabled === null) {
    return <div style={{ padding:60, textAlign:'center', color:'#9ca3af' }}>Loading…</div>;
  }
  if (moduleEnabled === false) {
    return (
      <div className="page-container">
        <div style={{ maxWidth:480, margin:'60px auto', textAlign:'center', background:'#fff7ed',
          border:'1px solid #fed7aa', borderRadius:12, padding:'32px 28px' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🎪</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#111827' }}>Guest Registration is disabled</div>
          <div style={{ fontSize:13, color:'#9a3412', marginTop:8, lineHeight:1.5 }}>
            {isAdmin
              ? <>Turn it on in Settings → Role & Permission Management → Module Controls.</>
              : <>Ask an Admin to enable it in Settings → Role &amp; Permission Management.</>}
          </div>
        </div>
      </div>
    );
  }

  if (activeEvent) {
    return (
      <div className="page-container">
        <EventDetail event={activeEvent} onBack={() => { setActiveEvent(null); load(); }} showToast={showToast} />
        {toast && (
          <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
            background:toast.color, color:'#fff', padding:'10px 20px', borderRadius:10,
            fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  const columns = [
    { field:'name', header:'Event Name', fill:true, render:(_,r) => (
      <span style={{ fontWeight:700, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
        🎪 {r.name}
      </span>
    ) },
    { field:'eventDate', header:'Date', width:110, render:v => fmtDate(v) },
    { field:'venue', header:'Venue', width:160, render:v => v || '—' },
    { field:'invitedCount', header:'Invitations Sent', width:130, align:'center',
      render:v => <Pill bg="#eff6ff" color="#1e40af">{v || 0}</Pill> },
    { field:'confirmedCount', header:'Confirmed', width:110, align:'center',
      render:v => <Pill bg="#f0fdf4" color="#065f46">{v || 0}</Pill> },
    { field:'attendedCount', header:'Registered', width:110, align:'center',
      render:v => <Pill bg="#fffbeb" color="#92400e">{v || 0}</Pill> },
    { field:'uncalledCount', header:'Uncalled', width:100, align:'center',
      render:v => <Pill bg="#fff7ed" color="#7c2d12">{v || 0}</Pill> },
    { field:'actions', header:'Actions', width:100, sortable:false, filterable:false,
      render:(_,r) => (
        <div className="dg-actions">
          <button className="dg-action-btn edit" title="Edit"
            onClick={e => { e.stopPropagation(); setModal({ id:r.id, form:{
              name:r.name, eventDate:r.eventDate?String(r.eventDate).split('T')[0]:'', venue:r.venue||'', description:r.description||'',
              invitationImage:r.invitationImage||'',
              photoGalleryFacebook:r.photoGalleryFacebook||'', photoGalleryGoogleDrive:r.photoGalleryGoogleDrive||'',
              photoGalleryInstagram:r.photoGalleryInstagram||'', photoGalleryTiktok:r.photoGalleryTiktok||'',
            } }); }}>✏️</button>
          <button className="dg-action-btn delete" title="Delete" onClick={e => { e.stopPropagation(); deleteEvent(r); }}>🗑</button>
        </div>
      ) },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">🎪 {t('Visitor Registration')}</h1>
        </div>
        <button onClick={() => setModal({ id:null, form:{ ...EMPTY_EVENT } })}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 18px',
            borderRadius:8, border:'none', background:'#1a56db', color:'#fff',
            fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.25)' }}>
          + New Event
        </button>
      </div>

      <div style={{ paddingBottom:24 }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'#9ca3af', fontSize:14 }}>Loading events…</div>
        ) : events.length === 0 ? (
          <div style={{ padding:60, textAlign:'center', color:'#9ca3af' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎪</div>
            <div style={{ fontWeight:600, fontSize:14, color:'#374151' }}>No events yet</div>
            <div style={{ fontSize:12, marginTop:6 }}>Create an event to start tracking invitations, visitor registration, products, gifts, and awards.</div>
          </div>
        ) : (
          <DataGrid
            columns={columns} data={events} rowKey="id" title="Events"
            onRowClick={(row) => setActiveEvent(row)}
            defaultPageSize={15} striped autoWidth
          />
        )}
      </div>

      {modal && (
        <FormModal title={modal.id ? '✏️ Edit Event' : '+ New Event'} onClose={() => setModal(null)} onSubmit={saveEvent} saving={saving} wide>
          <Field label="Event Name" required>
            <input className="form-control" value={modal.form.name}
              onChange={e => setModal(m => ({ ...m, form:{ ...m.form, name:e.target.value } }))} />
          </Field>
          <div style={{ display:'flex', gap:12 }}>
            <Field label="Event Date">
              <input type="date" className="form-control" value={modal.form.eventDate}
                onChange={e => setModal(m => ({ ...m, form:{ ...m.form, eventDate:e.target.value } }))} />
            </Field>
            <Field label="Venue">
              <input className="form-control" value={modal.form.venue}
                onChange={e => setModal(m => ({ ...m, form:{ ...m.form, venue:e.target.value } }))} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="form-control" rows={2} value={modal.form.description}
              onChange={e => setModal(m => ({ ...m, form:{ ...m.form, description:e.target.value } }))} />
          </Field>

          <Field label="Event Invitation">
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              {modal.form.invitationImage && (
                <img src={modal.form.invitationImage} alt="Event Invitation"
                  style={{ width:64, height:64, objectFit:'cover', borderRadius:8, border:'1px solid #e5e7eb' }} />
              )}
              <label style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff',
                fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }}>
                {uploadingInvitation ? 'Uploading…' : (modal.form.invitationImage ? 'Change Image' : '📷 Upload Image')}
                <input type="file" accept="image/*" style={{ display:'none' }} disabled={uploadingInvitation} onChange={handleInvitationImageFile} />
              </label>
              {modal.form.invitationImage && (
                <>
                  <button type="button" onClick={() => setImagePreview(modal.form.invitationImage)}
                    style={{ background:'none', border:'none', color:'#1a56db', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                    🔍 View
                  </button>
                  <button type="button" onClick={() => setModal(m => ({ ...m, form:{ ...m.form, invitationImage:'' } }))}
                    style={{ background:'none', border:'none', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                    Remove
                  </button>
                </>
              )}
            </div>
            <div style={{ fontSize:10.5, color:'#9ca3af', marginTop:3 }}>
              The invitation/advertisement graphic for this event — e.g. a workshop invitation card or mobile-friendly (WhatsApp/social) advertisement.
            </div>
          </Field>

          <div style={{ borderTop:'1px solid #e5e7eb', margin:'14px 0 12px', paddingTop:12 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:10 }}>📸 Photo Gallery Links</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
              <Field label="Facebook">
                <input className="form-control" placeholder="https://facebook.com/…" value={modal.form.photoGalleryFacebook}
                  onChange={e => setModal(m => ({ ...m, form:{ ...m.form, photoGalleryFacebook:e.target.value } }))} />
              </Field>
              <Field label="Google Drive">
                <input className="form-control" placeholder="https://drive.google.com/…" value={modal.form.photoGalleryGoogleDrive}
                  onChange={e => setModal(m => ({ ...m, form:{ ...m.form, photoGalleryGoogleDrive:e.target.value } }))} />
              </Field>
              <Field label="Instagram">
                <input className="form-control" placeholder="https://instagram.com/…" value={modal.form.photoGalleryInstagram}
                  onChange={e => setModal(m => ({ ...m, form:{ ...m.form, photoGalleryInstagram:e.target.value } }))} />
              </Field>
              <Field label="TikTok">
                <input className="form-control" placeholder="https://tiktok.com/…" value={modal.form.photoGalleryTiktok}
                  onChange={e => setModal(m => ({ ...m, form:{ ...m.form, photoGalleryTiktok:e.target.value } }))} />
              </Field>
            </div>
          </div>
        </FormModal>
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
          background:toast.color, color:'#fff', padding:'10px 20px', borderRadius:10,
          fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
          {toast.msg}
        </div>
      )}

      {imagePreview && <ImageLightbox src={imagePreview} onClose={() => setImagePreview(null)} />}
    </div>
  );
};

export default EventVisitorRegistration;

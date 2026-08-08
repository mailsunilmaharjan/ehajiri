import React from 'react';

const AppFooter = () => (
  <div style={{
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
    padding: '20px 32px 12px',
  }}>
    {/* Top row: brand + dev stack */}
    <div style={{ display:'flex', alignItems:'flex-start', gap:24, flexWrap:'wrap', marginBottom:16 }}>

      {/* Brand block */}
      <div style={{ minWidth:220 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <div style={{
            width:40, height:40, borderRadius:10,
            background:'linear-gradient(135deg,#1a56db,#7e3af2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'#fff', fontSize:16, fontWeight:800, flexShrink:0,
          }}>PI</div>
          <div>
            <div style={{ fontSize:14, fontWeight:800, color:'#1f2937' }}>Planet Infosys Pvt. Ltd.</div>
            <div style={{ fontSize:11, color:'#6b7280' }}>Software Development Company</div>
          </div>
        </div>
        <div style={{ fontSize:12, color:'#6b7280', lineHeight:1.8 }}>
          <div>📍 UNpark, Lalitpur, Nepal</div>
          <div>📞 01-5269837 &nbsp;|&nbsp; 9801135101</div>
          <div>
            🌐{' '}
            <a href="http://www.planetinfosys.com.np" target="_blank" rel="noreferrer"
              style={{ color:'#1a56db', textDecoration:'none', fontWeight:500 }}
              onMouseEnter={e => e.target.style.textDecoration='underline'}
              onMouseLeave={e => e.target.style.textDecoration='none'}>
              www.planetinfosys.com.np
            </a>
          </div>
        </div>
      </div>

      {/* Vertical divider */}
      <div style={{ width:1, background:'#e5e7eb', alignSelf:'stretch', flexShrink:0 }} />

      {/* Development Stack */}
      <div style={{ flex:1, minWidth:280 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'.5px' }}>
          🛠️ Development Stack
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {[
            { label:'React 18',       color:'#61dafb', bg:'#e0f7fd', desc:'Frontend UI'      },
            { label:'Vite 5',         color:'#a855f7', bg:'#f5f3ff', desc:'Build Tool'       },
            { label:'Node.js',        color:'#3c873a', bg:'#ecfdf5', desc:'Backend Runtime'  },
            { label:'Express 4',      color:'#374151', bg:'#f3f4f6', desc:'REST API'         },
            { label:'PostgreSQL 16',  color:'#336791', bg:'#eff6ff', desc:'Database'         },
            { label:'React Router 6', color:'#e11d48', bg:'#fff1f2', desc:'Routing'          },
            { label:'Concurrently',   color:'#f59e0b', bg:'#fffbeb', desc:'Dev Server'       },
          ].map(t => (
            <div key={t.label} style={{
              display:'flex', flexDirection:'column',
              background:t.bg, borderRadius:8,
              padding:'6px 12px', border:`1px solid ${t.color}22`,
            }}>
              <span style={{ fontSize:12, fontWeight:700, color:t.color }}>{t.label}</span>
              <span style={{ fontSize:10, color:'#6b7280', marginTop:1 }}>{t.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Copyright bar */}
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'10px 16px', background:'#f8fafc', borderRadius:8,
      border:'1px solid #e5e7eb', flexWrap:'wrap', gap:8,
    }}>
      <span style={{ fontSize:12, color:'#6b7280' }}>
        © 2026 <strong style={{ color:'#374151' }}>Planet Infosys Pvt. Ltd.</strong> — All rights reserved.
      </span>
      <span style={{ fontSize:11, color:'#9ca3af' }}>
        eHajiri TMS · Attendance &amp; Leave Management System
      </span>
    </div>
  </div>
);

export default AppFooter;

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { bsToAD } from '../../utils/dateUtils.js';
import ReportIcon from './ReportIcon.jsx';

const MONTHLY_REPORTS = (L) => [
  { icon:'bookOpen',    label:L('मासिक स्टाफ लेजर','Monthly Staff Ledger'),      path:'/attendance/reports/monthly/ledger' },
  { icon:'checkCircle', label:L('उपस्थित/अनुपस्थित रिपोर्ट','Present Absent Report'), path:'/attendance/reports/monthly/present-absent' },
  { icon:'barChart',    label:L('सारांश रिपोर्ट','Summary Report'),             path:'/attendance/reports/monthly/summary' },
  { icon:'repeat',      label:L('IN & OUT रिपोर्ट','IN & OUT Report'),          path:'/attendance/reports/monthly/in-out' },
  { icon:'calendar',    label:L('अनुपस्थित रिपोर्ट','Absent Report'),           path:'/attendance/reports/monthly/absent' },
  { icon:'clock',       label:L('ढिला/चाँडो रिपोर्ट','Late In Early Out Report'), path:'/attendance/reports/monthly/late-early' },
  { icon:'zap',         label:L('ओभरटाइम रिपोर्ट','Over Time Report'),         path:'/attendance/reports/monthly/overtime' },
];

/**
 * Navigation dropdown for all Monthly sub-report pages.
 * Props: year, month (BS when useNP, AD otherwise), useNP, currentPath
 */
const ViewMonthlyBtn = ({ year, month, useNP, currentPath = '' }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const monthlyReports = MONTHLY_REPORTS(L);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = (path) => {
    let adYear = year, adMonth = month;
    if (useNP) {
      const ad = bsToAD(year, month, 15);
      if (ad) { adYear = ad.getFullYear(); adMonth = ad.getMonth() + 1; }
    }
    navigate(`${path}?year=${adYear}&month=${adMonth}`);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display:'inline-flex',alignItems:'center',gap:7,padding:'7px 16px',height:36,
          background:open?'#1e40af':'#1a56db',color:'white',border:'none',borderRadius:8,
          fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 8px rgba(26,86,219,.3)',
          transition:'background .15s' }}>
        <svg viewBox="0 0 20 20" fill="white" width="14" height="14">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
        </svg>
        {L('मासिक रिपोर्टहरू हेर्नुहोस्','View Monthly Reports')}
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
          style={{ transform:open?'rotate(180deg)':'none',transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div style={{ position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:500,
          background:'white',border:'1px solid #e5e7eb',borderRadius:10,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)',overflow:'hidden',minWidth:270 }}>
          <div style={{ padding:'8px 14px',background:'#f9fafb',borderBottom:'1px solid #f3f4f6',
            fontSize:11,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'.5px' }}>
            {L('मासिक रिपोर्टहरू','Monthly Reports')}
          </div>
          {monthlyReports.map((r, i) => {
            const isActive = currentPath === r.path;
            return (
              <button key={r.path} onClick={() => go(r.path)}
                style={{ width:'100%',display:'flex',alignItems:'center',gap:9,padding:'8px 14px',
                  border:'none',borderBottom:i<monthlyReports.length-1?'1px solid #f0f0f0':'none',
                  textAlign:'left',cursor:'pointer',fontSize:13,transition:'background .1s',
                  background:isActive?'#eff6ff':'white',color:isActive?'#1e40af':'#374151',
                  fontWeight:isActive?700:500 }}>
                <ReportIcon name={r.icon} />
                <span style={{ flex:1,whiteSpace:'nowrap' }}>{r.label}</span>
                {isActive
                  ? <svg viewBox="0 0 20 20" fill="#1a56db" width="13" height="13" style={{ flexShrink:0 }}>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  : <svg viewBox="0 0 20 20" fill="#d1d5db" width="12" height="12" style={{ flexShrink:0 }}>
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                    </svg>
                }
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ViewMonthlyBtn;

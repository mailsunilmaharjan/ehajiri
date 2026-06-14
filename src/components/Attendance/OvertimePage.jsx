import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api             from '../../api/client.js';
import useDateFormat   from '../../hooks/useDateFormat.js';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';

const pad2   = (n) => String(Math.round(Math.abs(n))).padStart(2, '0');
const toHHMM = (m) => `${pad2(Math.floor(Math.abs(m) / 60))}:${pad2(Math.abs(m) % 60)}`;

/* Parse "HH:MM" → minutes */
const parseHHMM = (str) => {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

const STATUS_COLOR = {
  pending  : { bg:'#fef3c7', color:'#92400e', border:'#fde68a', label:'Pending'  },
  approved : { bg:'#d1fae5', color:'#065f46', border:'#6ee7b7', label:'Approved' },
  rejected : { bg:'#fee2e2', color:'#991b1b', border:'#fca5a5', label:'Rejected' },
};
const StatusBadge = ({ status }) => {
  const c = STATUS_COLOR[status] || STATUS_COLOR.pending;
  return (
    <span style={{ background:c.bg, color:c.color, border:`1px solid ${c.border}`,
      borderRadius:8, padding:'2px 10px', fontSize:11, fontWeight:700 }}>
      {c.label}
    </span>
  );
};

/* Signed OT cell: green for +, red for – */
const SignedOT = ({ value, formatted }) => {
  if (!formatted || formatted === '+00:00' || formatted === '-00:00') {
    return <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
  }
  const pos = value >= 0;
  return (
    <span style={{ fontSize:13, color: pos ? '#059669' : '#dc2626' }}>
      {formatted}
    </span>
  );
};

/* Portal tooltip — appears above the hovered element, avoids overflow clipping */
const OTTooltip = ({ text, children }) => {
  const [rect, setRect] = React.useState(null);
  if (!text) return <>{children}</>;
  return (
    <span style={{ position:'relative', display:'inline-flex', cursor:'help' }}
      onMouseEnter={e => setRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}>
      {children}
      {rect && createPortal(
        <div style={{
          position:'fixed',
          left: rect.left + rect.width / 2,
          top:  rect.top - 10,
          transform: 'translateX(-50%) translateY(-100%)',
          background:'#1e293b', color:'#f1f5f9',
          borderRadius:8, padding:'8px 14px',
          fontSize:12, lineHeight:1.6, fontWeight:500,
          maxWidth:320, whiteSpace:'pre-wrap',
          boxShadow:'0 6px 20px rgba(0,0,0,.3)',
          zIndex:999999, pointerEvents:'none',
          textAlign:'center',
        }}>
          {text}
          <div style={{
            position:'absolute', top:'100%', left:'50%',
            transform:'translateX(-50%)',
            width:0, height:0,
            borderLeft:'6px solid transparent',
            borderRight:'6px solid transparent',
            borderTop:'6px solid #1e293b',
          }} />
        </div>,
        document.body
      )}
    </span>
  );
};

const OvertimePage = () => {
  const { currentUser, isManager, canApprove } = useAuth();
  const { language }  = useLanguage();
  const { settings, updateSettings } = useSettings();
  const fd = useDateFormat();
  const L  = (np, en) => language === 'np' ? np : en;
  const useNP = settings.defaultCalendar === 'np';

  const now    = new Date();
  const today  = now.toISOString().split('T')[0];
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  const [startDate,  setStartDate]  = useState(firstOfMonth);
  const [endDate,    setEndDate]    = useState(today);
  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selected,   setSelected]   = useState(new Set()); // set of "empId-date" keys
  const [actionModal, setActionModal] = useState(null);
  const [comment,    setComment]    = useState('');
  const [toast,      setToast]      = useState(null);

  /* Manager-edited Approved OT values: key → minutes */
  const [editedOT, setEditedOT] = useState({});

  const [showAdvSearchModal, setShowAdvSearchModal] = useState(false);
  const [advFilters, setAdvFilters] = useState({ departments:[], branches:[], positions:[], grades:[], genders:[], modes:[], timingTypes:[] });

  const DEFAULT_OT_SETTINGS = {
    minOTBeforeIn  : '00:00',
    maxOTBeforeIn  : '00:00',
    minOTAfterOut  : '00:00',
    maxOTAfterOut  : '00:00',
    weekendPresent : 'ot',
    holidayPresent : 'ot',
  };
  const [showOTSettings,  setShowOTSettings]  = useState(false);
  /* Start with pure defaults — useEffect below syncs from API once loaded */
  const [otSettings,      setOtSettings]      = useState({ ...DEFAULT_OT_SETTINGS });
  const [otSettingsSaving,setOtSettingsSaving]= useState(false);

  /* Sync from API (overrides localStorage cache) — only trusted source is the DB */
  useEffect(() => {
    setOtSettings({ ...DEFAULT_OT_SETTINGS, ...(settings.ot_settings || {}) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ot_settings]);

  const saveOTSettings = async () => {
    setOtSettingsSaving(true);
    try {
      await api.put('/settings', { ot_settings: otSettings });
      updateSettings({ ot_settings: otSettings }); // keep context in sync
      showToast('OT Settings saved');
      setShowOTSettings(false);
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setOtSettingsSaving(false); }
  };

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(''); setSelected(new Set()); setEditedOT({});
    try {
      const res = await api.get(`/overtime?startDate=${startDate}&endDate=${endDate}`);
      setRecords(res.records || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let rs = filterStatus === 'all' ? records : records.filter(r => r.status === filterStatus);
    if (advFilters.departments.length) rs = rs.filter(r => advFilters.departments.includes(r.department  || ''));
    if (advFilters.branches.length)    rs = rs.filter(r => advFilters.branches.includes(r.branchShort   || ''));
    if (advFilters.positions.length)   rs = rs.filter(r => advFilters.positions.includes(r.position     || ''));
    if (advFilters.grades.length)      rs = rs.filter(r => advFilters.grades.includes(r.grade           || ''));
    if (advFilters.genders.length)     rs = rs.filter(r => advFilters.genders.includes(r.gender         || ''));
    if (advFilters.modes.length)       rs = rs.filter(r => advFilters.modes.includes(r.mode             || ''));
    if (advFilters.timingTypes.length) rs = rs.filter(r => advFilters.timingTypes.includes(r.timingType || ''));
    return rs;
  }, [records, filterStatus, advFilters]);

  const counts = useMemo(() => ({
    all     : records.length,
    pending : records.filter(r => r.status === 'pending').length,
    approved: records.filter(r => r.status === 'approved').length,
    rejected: records.filter(r => r.status === 'rejected').length,
  }), [records]);

  const totalApprovedOT = useMemo(() =>
    records.filter(r => r.status === 'approved')
           .reduce((s, r) => s + (r.approvedOTMins || 0), 0),
  [records]);

  const deptOpts       = useMemo(() => [...new Set(records.map(r=>r.department).filter(v=>v&&v!=='—'))].sort(), [records]);
  const branchOpts2    = useMemo(() => [...new Set(records.map(r=>r.branchShort).filter(v=>v&&v!=='—'))].sort(), [records]);
  const posOpts        = useMemo(() => [...new Set(records.map(r=>r.position).filter(v=>v&&v!=='—'))].sort(), [records]);
  const gradeOpts      = useMemo(() => [...new Set(records.map(r=>r.grade).filter(v=>v&&v!=='—'))].sort(), [records]);
  const modeOpts       = useMemo(() => [...new Set(records.map(r=>r.mode).filter(v=>v&&v!=='—'))].sort(), [records]);
  const timingTypeOpts = useMemo(() => [...new Set(records.map(r=>r.timingType).filter(v=>v&&v!=='—'))].sort(), [records]);
  const genderOpts     = ['male','female','other'];
  const activeFilterCount =
    advFilters.departments.length + advFilters.branches.length + advFilters.positions.length +
    advFilters.grades.length + advFilters.genders.length + advFilters.modes.length + advFilters.timingTypes.length;
  const clearAdvFilters = () => setAdvFilters({ departments:[], branches:[], positions:[], grades:[], genders:[], modes:[], timingTypes:[] });

  const [dayTypeFilter, setDayTypeFilter] = useState(''); // '' | 'weekend' | 'holiday'

  /* ── Apply OT settings to filtered records for display ── */
  const displayRecords = useMemo(() => {
    const cfg      = otSettings;
    const wkDays   = settings.defaultWeekends || ['Sat'];
    /* Map of date → holiday name for tooltip */
    const holMap   = new Map(
      (settings.publicHolidays || []).map(h => [
        (h.date || h.startDate || '').split('T')[0],
        h.name || h.title || 'Public Holiday',
      ])
    );
    const parseHM  = str => parseHHMM(str);

    const result = [];
    for (const r of filtered) {
      const isWeekend    = wkDays.includes(r.day);
      const holidayName  = holMap.get(r.date);
      const isHoliday    = !!holidayName;

      if (isWeekend || isHoliday) {
        const rule = isHoliday ? cfg.holidayPresent : cfg.weekendPresent;
        if (rule === 'leave') continue; // skip — next day leave

        /* Total working hours = OT (no shift comparison for weekend/holiday) */
        const inMins   = parseHM(r.timeIn);
        const outMins  = parseHM(r.timeOut);
        const workMins = outMins > inMins ? outMins - inMins : 0;

        result.push({
          ...r,
          otInINMins: 0,      otInOUTMins: 0,
          otInINFormatted: '+00:00', otInOUTFormatted: '+00:00',
          otMinutes: workMins, otFormatted: toHHMM(workMins),
          approvedOTMins: r.approvalId ? r.approvedOTMins : workMins,
          _dayType:     isHoliday ? 'holiday' : 'weekend',
          _holidayName: isHoliday ? holidayName : null,
          _tooltipOTOut: null,
          _tooltipOTIn:  null,
        });
        continue;
      }

      /* Regular weekday
         Late arrival (otInINMins < 0) is deducted from OT OUT.
         Early departure (otInOUTMins < 0) is deducted from OT IN.
         Then minimum threshold and cap are applied. */
      const lateMins    = Math.max(0, -r.otInINMins);    // mins staff was late to arrive
      const earlyOutMin = Math.max(0, -r.otInOUTMins);   // mins staff left early

      const effOTOut = Math.max(0, r.otInOUTMins - lateMins);
      const effOTIn  = Math.max(0, r.otInINMins  - earlyOutMin);

      const maxOut = parseHM(cfg.maxOTAfterOut);
      const maxIn  = parseHM(cfg.maxOTBeforeIn);
      const capOTOut = effOTOut >= parseHM(cfg.minOTAfterOut)
        ? (maxOut > 0 ? Math.min(effOTOut, maxOut) : effOTOut) : 0;
      const capOTIn  = effOTIn  >= parseHM(cfg.minOTBeforeIn)
        ? (maxIn  > 0 ? Math.min(effOTIn,  maxIn)  : effOTIn)  : 0;

      const net = capOTIn + capOTOut;

      /* Skip pending records that have no qualifying OT */
      if (net === 0 && r.status === 'pending') continue;

      /* OT IN display: show capped OT IN if positive, show raw lateness if negative,
         show — if early arrival didn't qualify */
      let dispOTIn, dispOTInFmt;
      if (capOTIn > 0) {
        dispOTIn = capOTIn;
        dispOTInFmt = `+${toHHMM(capOTIn)}`;
      } else if (r.otInINMins < 0) {
        dispOTIn = r.otInINMins;           // show late info in red
        dispOTInFmt = r.otInINFormatted;
      } else {
        dispOTIn = 0;
        dispOTInFmt = '+00:00';            // → SignedOT renders as —
      }

      result.push({
        ...r,
        otInINMins: dispOTIn, otInOUTMins: capOTOut,
        otInINFormatted:  dispOTInFmt,
        otInOUTFormatted: `+${toHHMM(capOTOut)}`,
        otMinutes: net, otFormatted: toHHMM(net),
        approvedOTMins: r.approvalId ? r.approvedOTMins : net,
        _tooltipOTIn: (maxIn > 0 && capOTIn > 0 && capOTIn < effOTIn)
          ? `You worked ${toHHMM(effOTIn)} before shift start\nMaximum OT IN is ${cfg.maxOTBeforeIn} as per setting`
          : null,
        _tooltipOTOut: (maxOut > 0 && capOTOut > 0 && capOTOut < effOTOut)
          ? `You worked ${toHHMM(effOTOut)} after shift end\nMaximum OT OUT is ${cfg.maxOTAfterOut} as per setting`
          : null,
      });
    }
    return result;
  }, [filtered, otSettings, settings.defaultWeekends, settings.publicHolidays]);

  const weekendCount = useMemo(() => displayRecords.filter(r => r._dayType === 'weekend').length, [displayRecords]);
  const holidayCount = useMemo(() => displayRecords.filter(r => r._dayType === 'holiday').length, [displayRecords]);

  const visibleRecords = useMemo(() => {
    if (!dayTypeFilter) return displayRecords;
    return displayRecords.filter(r => r._dayType === dayTypeFilter);
  }, [displayRecords, dayTypeFilter]);

  /* Get approved OT minutes for a record (edited or default) */
  const getApprovedOT = (rec) => {
    const key = `${rec.employeeId}-${rec.date}`;
    return key in editedOT ? editedOT[key] : rec.approvedOTMins;
  };

  /* ── Approve / Reject single record ── */
  const handleAction = async (type) => {
    const rec = actionModal?.rec;
    if (!rec) return;
    const approvedMins = getApprovedOT(rec);
    try {
      if (rec.approvalId) {
        await api.patch(`/overtime/${rec.approvalId}/${type}`, {
          approvedBy: currentUser.id, comment, approvedOTMins: approvedMins,
        });
      } else {
        await api.post('/overtime/approve-inline', {
          employeeId: rec.employeeId, date: rec.date,
          otMinutes: approvedMins, action: type,
          approvedBy: currentUser.id, comment,
        });
      }
      showToast(`OT ${type === 'approve' ? 'Approved' : 'Rejected'} — ${toHHMM(approvedMins)} recorded`);
      setActionModal(null); setComment('');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* ── Bulk approve / reject ── */
  const handleBulk = async (type) => {
    if (!selected.size) return;
    const recs = visibleRecords.filter(r => selected.has(`${r.employeeId}-${r.date}`));
    try {
      await api.post('/overtime/bulk-approve', {
        records   : recs.map(r => ({ employeeId: r.employeeId, date: r.date, otMinutes: getApprovedOT(r) })),
        action    : type,
        approvedBy: currentUser.id,
        comment   : '',
      });
      showToast(`${recs.length} OT record${recs.length!==1?'s':''} ${type==='approve'?'approved':'rejected'}`);
      setSelected(new Set());
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const toggleSelectAll = () => {
    const pendingKeys = visibleRecords.filter(r => r.status === 'pending').map(r => `${r.employeeId}-${r.date}`);
    if (pendingKeys.every(k => selected.has(k))) {
      setSelected(prev => { const n = new Set(prev); pendingKeys.forEach(k => n.delete(k)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); pendingKeys.forEach(k => n.add(k)); return n; });
    }
  };

  const DateInput = ({ value, onChange }) => {
    if (useNP) return <NepaliDatePicker value={value} onChange={onChange} maxToday={false} />;
    return (
      <input type="date" className="form-control" value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize:13, height:36 }} />
    );
  };

  const canAct = isManager || canApprove;

  /* ── Column definitions ── */
  const columns = [
    /* Staff — name + Post, Dept, Branch below */
    {
      field: 'fullName', header: L('नाम','Staff'), width: 170,
      render: (v, row) => (
        <div>
          <div style={{ fontWeight:700, fontSize:13, color:'#111827' }}>{v}</div>
          <div style={{ fontSize:10, color:'#9ca3af', marginTop:2,
            display:'flex', gap:4, flexWrap:'nowrap',
            overflow:'hidden', maxWidth:'100%' }}>
            {row.postShort   && row.postShort   !== '—' && (
              <span title={row.postShort}
                style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1 }}>
                {row.postShort}
              </span>
            )}
            {row.deptShort   && row.deptShort   !== '—' && (
              <span title={row.deptShort}
                style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:2, flexGrow:0 }}>
                · {row.deptShort}
              </span>
            )}
          </div>
        </div>
      ),
    },

    /* Shift — short name only */
    {
      field: 'shiftName', header: L('सिफ्ट','Shift'), width: 100,
      render: (v, row) => (
        <div style={{ fontSize:12 }}>
          <div style={{ fontWeight:600, color:'#374151' }}>{v}</div>
          <div style={{ color:'#9ca3af', fontSize:10 }}>{row.shiftStart} – {row.shiftEnd}</div>
        </div>
      ),
    },

    /* Date */
    {
      field: 'date', header: L('मिति','Date'), width: 110,
      render: v => <span style={{ fontWeight:600, fontSize:14 }}>{fd(v)}</span>,
    },

    /* Day */
    {
      field: 'day', header: L('बार','Day'), width: 90,
      render: (v, row) => (
        <div style={{ lineHeight:1.3 }}>
          <div style={{ fontSize:14, color:'#6b7280', fontWeight:700 }}>{v}</div>
          {row._dayType === 'weekend' && (
            <span style={{ fontSize:10, fontWeight:700, color:'#92400e',
              background:'#fef3c7', border:'1px solid #fde68a',
              borderRadius:4, padding:'1px 6px', marginTop:3, display:'inline-block' }}>
              Weekend
            </span>
          )}
          {row._dayType === 'holiday' && (
            <OTTooltip text={row._holidayName || 'Public Holiday'}>
              <span style={{ fontSize:10, fontWeight:700, color:'#065f46',
                background:'#d1fae5', border:'1px solid #6ee7b7',
                borderRadius:4, padding:'1px 6px', marginTop:3,
                display:'inline-block', cursor:'help' }}>
                Public Holiday
              </span>
            </OTTooltip>
          )}
        </div>
      ),
    },

    /* Time In */
    {
      field: 'timeIn', header: L('आगमन','Time In'), width: 75,
      render: v => <span style={{ fontSize:14, color:'#059669' }}>{v}</span>,
    },

    /* OT in IN: positive (early) = green, negative (late) = red */
    {
      field: 'otInINFormatted', header: L('OT IN','OT in IN'), width: 80, align:'center',
      render: (v, row) => (
        <OTTooltip text={row._tooltipOTIn || null}>
          <SignedOT value={row.otInINMins} formatted={v} />
        </OTTooltip>
      ),
    },

    /* Time Out */
    {
      field: 'timeOut', header: L('प्रस्थान','Time Out'), width: 75,
      render: v => <span style={{ fontSize:14, color:'#0369a1' }}>{v}</span>,
    },

    /* OT in OUT: positive (late out) = green, negative (early) = red */
    {
      field: 'otInOUTFormatted', header: L('OT OUT','OT in OUT'), width: 85, align:'center',
      render: (v, row) => (
        <OTTooltip text={row._tooltipOTOut || null}>
          <SignedOT value={row.otInOUTMins} formatted={v} />
        </OTTooltip>
      ),
    },

    /* Calculated OT Duration */
    {
      field: 'otFormatted', header: L('OT अवधि','OT Duration'), width: 90, align:'center',
      render: (v, row) => (
        <span style={{ fontSize:13,
          color: row._dayType ? '#7c3aed' : '#0369a1',
          fontWeight: row._dayType ? 700 : 400 }}>
          {v}
        </span>
      ),
    },

    /* Approved OT — plain editable text box */
    {
      field: 'approvedOTMins', header: L('अनु. OT','Approved OT'), width: 110, align:'center',
      filterable:false, sortable:false,
      render: (_, row) => {
        const key = `${row.employeeId}-${row.date}`;
        const currentMins = key in editedOT ? editedOT[key] : row.approvedOTMins;
        const displayVal  = toHHMM(currentMins);
        return (
          <input
            type="text"
            defaultValue={displayVal}
            key={`${key}-${row.approvedOTMins}`}
            onBlur={e => {
              const entered = e.target.value.trim();
              const mins = entered.includes(':') ? parseHHMM(entered) : (parseInt(entered) || 0);
              setEditedOT(prev => ({ ...prev, [key]: Math.max(0, mins) }));
              e.target.value = toHHMM(Math.max(0, mins));
            }}
            className="form-control"
            style={{ width:75, textAlign:'center', fontSize:13, padding:'2px 6px' }}
          />
        );
      },
    },

    /* Status */
    {
      field: 'status', header: L('स्थिति','Status'), width: 100,
      render: (v, row) => (
        <OTTooltip text={row.comment ? `💬 ${row.comment}` : null}>
          <StatusBadge status={v} />
        </OTTooltip>
      ),
    },

    /* Approved By */
    {
      field: 'approvedByName', header: L('स्वीकृतकर्ता','Approved By'), width: 130,
      render: (v, row) => row.status === 'pending'
        ? <span style={{ color:'#d1d5db' }}>—</span>
        : <span style={{ fontSize:12 }}>{v || '—'}</span>,
    },

    /* Actions */
    canAct ? {
      field: 'actions', header: L('कार्य','Actions'), width: 110, filterable:false, sortable:false,
      render: (_, row) => {
        if (row.status === 'approved') return (
          <button onClick={() => setActionModal({ rec:row, type:'reject' })}
            style={{ background:'none', border:'1px solid #fca5a5', color:'#dc2626',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
            ✗ Reject
          </button>
        );
        if (row.status === 'rejected') return (
          <button onClick={() => setActionModal({ rec:row, type:'approve' })}
            style={{ background:'none', border:'1px solid #6ee7b7', color:'#059669',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
            ✓ Approve
          </button>
        );
        return (
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => setActionModal({ rec:row, type:'approve' })}
              style={{ background:'#d1fae5', border:'none', color:'#065f46',
                borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }}>
              ✓
            </button>
            <button onClick={() => setActionModal({ rec:row, type:'reject' })}
              style={{ background:'#fee2e2', border:'none', color:'#dc2626',
                borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }}>
              ✗
            </button>
          </div>
        );
      },
    } : null,
  ].filter(Boolean);

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">⏱️ {L('ओभरटाइम स्वीकृति','Overtime (OT) Approval')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {L('OT स्वीकृति नभएसम्म कुनै पनि रिपोर्टमा देखिँदैन — Approved OT मात्र रिपोर्टमा जान्छ',
               'OT must be approved — only Approved OT appears in reports')}
          </p>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
              {L('देखि','From Date')}
            </div>
            <DateInput value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
              {L('सम्म','To Date')}
            </div>
            <DateInput value={endDate} onChange={setEndDate} />
          </div>
          <button className="btn btn-primary" onClick={load} disabled={loading} style={{ height:36 }}>
            🔃 {loading ? 'Loading…' : L('पुनः लोड','Refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8,
          padding:'10px 14px', marginBottom:14, color:'#991b1b', fontWeight:600, fontSize:13 }}>
          ❌ {error}
        </div>
      )}

      {/* ── Summary filter chips ── */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        {[
          { key:'all',      label:L('सबै','All'),            color:'#374151', bg:'#f9fafb' },
          { key:'pending',  label:L('विचाराधीन','Pending'),  color:'#92400e', bg:'#fef3c7' },
          { key:'approved', label:L('स्वीकृत','Approved'),   color:'#065f46', bg:'#d1fae5' },
          { key:'rejected', label:L('अस्वीकृत','Rejected'),  color:'#991b1b', bg:'#fee2e2' },
        ].map(({ key, label, color, bg }) => (
          <button key={key} onClick={() => setFilterStatus(key)}
            style={{ background: filterStatus===key ? color : bg,
              color: filterStatus===key ? '#fff' : color,
              border:`1px solid ${color}44`, borderRadius:8,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            {label} ({counts[key]})
          </button>
        ))}
        {/* divider */}
        <div style={{ width:1, height:22, background:'#e5e7eb', alignSelf:'center' }} />

        <button onClick={() => setDayTypeFilter(p => p === 'weekend' ? '' : 'weekend')}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px',
            background: dayTypeFilter==='weekend' ? '#fef3c7' : '#f9fafb',
            border: `1.5px solid ${dayTypeFilter==='weekend' ? '#f59e0b' : '#d1d5db'}`,
            borderRadius:8, fontSize:12, fontWeight:700,
            color: dayTypeFilter==='weekend' ? '#92400e' : '#6b7280', cursor:'pointer' }}>
          🏖 Weekend
          {weekendCount > 0 && (
            <span style={{ background: dayTypeFilter==='weekend' ? '#92400e' : '#9ca3af',
              color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>
              {weekendCount}
            </span>
          )}
        </button>

        <button onClick={() => setDayTypeFilter(p => p === 'holiday' ? '' : 'holiday')}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px',
            background: dayTypeFilter==='holiday' ? '#d1fae5' : '#f9fafb',
            border: `1.5px solid ${dayTypeFilter==='holiday' ? '#10b981' : '#d1d5db'}`,
            borderRadius:8, fontSize:12, fontWeight:700,
            color: dayTypeFilter==='holiday' ? '#065f46' : '#6b7280', cursor:'pointer' }}>
          🎉 Public Holiday
          {holidayCount > 0 && (
            <span style={{ background: dayTypeFilter==='holiday' ? '#065f46' : '#9ca3af',
              color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>
              {holidayCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button onClick={clearAdvFilters}
            style={{ padding:'5px 14px', background:'#fff5f5', border:'1px solid #fca5a5',
              borderRadius:8, fontSize:12, fontWeight:700, color:'#dc2626', cursor:'pointer' }}>
            ✕ Remove Filters
          </button>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
          {totalApprovedOT > 0 && (
            <div style={{ background:'#e0f2fe', border:'1px solid #7dd3fc',
              borderRadius:8, padding:'5px 14px', fontSize:12, fontWeight:700, color:'#0369a1' }}>
              ✅ Total Approved OT: {toHHMM(totalApprovedOT)}
            </div>
          )}
          <button onClick={() => setShowOTSettings(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 14px',
              background:'#f9fafb', border:'1.5px solid #d1d5db', borderRadius:8,
              fontSize:12, fontWeight:700, color:'#374151', cursor:'pointer' }}>
            ⚙ OT Setting
          </button>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {canAct && selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12,
          background:'#eff6ff', border:'1px solid #93c5fd', borderRadius:8, padding:'8px 14px' }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#1d4ed8' }}>
            {selected.size} selected
          </span>
          <button onClick={() => handleBulk('approve')}
            style={{ background:'#059669', color:'#fff', border:'none', borderRadius:6,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            ✓ Approve Selected
          </button>
          <button onClick={() => handleBulk('reject')}
            style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:6,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            ✗ Reject Selected
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ background:'none', border:'1px solid #93c5fd', color:'#1d4ed8',
              borderRadius:6, padding:'5px 10px', fontSize:12, cursor:'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {/* Select all pending */}
      {canAct && counts.pending > 0 && (
        <div style={{ marginBottom:8 }}>
          <button onClick={toggleSelectAll}
            style={{ background:'none', border:'none', color:'#1a56db', fontSize:12,
              fontWeight:600, cursor:'pointer', padding:0 }}>
            {counts.pending === selected.size
              ? '☑ Deselect all pending'
              : `☐ Select all ${counts.pending} pending`}
          </button>
          <span style={{ fontSize:11, color:'#9ca3af', marginLeft:10 }}>
            💡 Edit "Approved OT" field before approving to set custom OT minutes
          </span>
        </div>
      )}

      {/* ── Grid ── */}
      {loading
        ? <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>⏱️</div>
            <div style={{ fontWeight:600 }}>Loading overtime records…</div>
          </div>
        : visibleRecords.length === 0
          ? <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>
              <div style={{ fontSize:36, marginBottom:10 }}>🎉</div>
              <div style={{ fontWeight:600, fontSize:14, color:'#374151' }}>
                {records.length === 0
                  ? 'No overtime found for this period'
                  : `No ${filterStatus} OT records`}
              </div>
              <div style={{ fontSize:12, marginTop:6 }}>
                OT is detected when staff checkout after shift end or check-in before shift start.
              </div>
            </div>
          : <DataGrid
              columns={columns}
              data={visibleRecords}
              defaultPageSize={20}
              showSearch
              searchPlaceholder={L('खोज्नुहोस्…','Search staff…')}
              toolbar={
                <button onClick={() => setShowAdvSearchModal(true)}
                  style={{ display:'flex', alignItems:'center', gap:6, height:34,
                    padding:'0 14px', background: activeFilterCount>0 ? '#eff6ff' : '#f9fafb',
                    border:`1.5px solid ${activeFilterCount>0 ? '#1a56db' : '#d1d5db'}`,
                    borderRadius:7, fontSize:13, fontWeight:600,
                    color: activeFilterCount>0 ? '#1a56db' : '#374151', cursor:'pointer' }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                  </svg>
                  Advanced Search
                  {activeFilterCount > 0 && (
                    <span style={{ background:'#1a56db', color:'#fff', borderRadius:10,
                      fontSize:10, fontWeight:700, padding:'1px 7px', marginLeft:2 }}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              }
            />
      }

      {/* ── Single action modal ── */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"
              style={{ background: actionModal.type==='approve' ? '#f0fdf4' : '#fef2f2' }}>
              <h2>
                {actionModal.type==='approve' ? '✅ Approve' : '❌ Reject'} Overtime
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14 }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#111827', marginBottom:6 }}>
                  {actionModal.rec.fullName}
                  <span style={{ fontSize:11, color:'#9ca3af', marginLeft:8 }}>
                    {actionModal.rec.postShort} · {actionModal.rec.deptShort}
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:13 }}>
                  <div><span style={{ color:'#9ca3af' }}>Date:</span> <strong>{fd(actionModal.rec.date)}</strong> ({actionModal.rec.day})</div>
                  <div><span style={{ color:'#9ca3af' }}>Shift:</span> {actionModal.rec.shiftName}</div>
                  <div><span style={{ color:'#9ca3af' }}>Time In:</span> <strong style={{ color:'#059669' }}>{actionModal.rec.timeIn}</strong></div>
                  <div><span style={{ color:'#9ca3af' }}>Time Out:</span> <strong style={{ color:'#0369a1' }}>{actionModal.rec.timeOut}</strong></div>
                  <div><span style={{ color:'#9ca3af' }}>OT in IN:</span>
                    <strong style={{ color: actionModal.rec.otInINMins>=0 ? '#059669':'#dc2626', marginLeft:4 }}>
                      {actionModal.rec.otInINFormatted}
                    </strong>
                  </div>
                  <div><span style={{ color:'#9ca3af' }}>OT in OUT:</span>
                    <strong style={{ color: actionModal.rec.otInOUTMins>=0 ? '#059669':'#dc2626', marginLeft:4 }}>
                      {actionModal.rec.otInOUTFormatted}
                    </strong>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <span style={{ color:'#9ca3af' }}>Calculated OT:</span>
                    <strong style={{ color:'#0369a1', fontSize:16, marginLeft:6 }}>{actionModal.rec.otFormatted}</strong>
                  </div>
                </div>

                {/* Editable Approved OT */}
                {actionModal.type === 'approve' && (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'#eff6ff',
                    border:'1px solid #bfdbfe', borderRadius:8 }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#1d4ed8', marginBottom:4 }}>
                      Approved OT (editable — in HH:MM)
                    </div>
                    <input
                      type="text"
                      defaultValue={toHHMM(getApprovedOT(actionModal.rec))}
                      onChange={e => {
                        const key  = `${actionModal.rec.employeeId}-${actionModal.rec.date}`;
                        const mins = e.target.value.includes(':')
                          ? parseHHMM(e.target.value)
                          : (parseInt(e.target.value) || 0);
                        setEditedOT(prev => ({ ...prev, [key]: Math.max(0, mins) }));
                      }}
                      style={{ width:'100%', fontFamily:'monospace', fontSize:15, fontWeight:800,
                        textAlign:'center', border:'1px solid #93c5fd', borderRadius:6,
                        padding:'4px 10px', color:'#1d4ed8', outline:'none' }}
                    />
                    <div style={{ fontSize:10, color:'#6b7280', marginTop:3 }}>
                      Enter HH:MM or minutes. This value will be recorded in reports.
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                  Comment (optional)
                </label>
                <textarea className="form-control" rows={2} value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Enter reason or note…" style={{ fontSize:13 }} autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setActionModal(null); setComment(''); }}>
                Cancel
              </button>
              <button
                className={`btn ${actionModal.type==='approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={() => handleAction(actionModal.type)}>
                {actionModal.type==='approve'
                  ? `✅ Approve (${toHHMM(getApprovedOT(actionModal.rec))})`
                  : '❌ Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OT Settings Modal ── */}
      {showOTSettings && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ maxWidth:640, width:'96vw' }}>

            {/* Header */}
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0f9ff,#eff6ff)' }}>
              <h2 style={{ display:'flex', alignItems:'center', gap:8 }}>
                ⚙ OT Settings
              </h2>
              <button className="modal-close" onClick={() => setShowOTSettings(false)}>✕</button>
            </div>

            {/* Body */}
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:0 }}>

              {/* ── OT IN / OT OUT ── */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0,
                border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden', marginBottom:18 }}>

                {/* Header row */}
                <div style={{ gridColumn:'1/-1', display:'grid', gridTemplateColumns:'1fr 1fr',
                  background:'#f1f5f9', borderBottom:'1px solid #e5e7eb' }}>
                  <div style={{ padding:'8px 16px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:.5 }}>OT Before Time IN</div>
                  <div style={{ padding:'8px 16px', fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:.5, borderLeft:'1px solid #e5e7eb' }}>OT After Time OUT</div>
                </div>

                {/* Must work toggle + Max */}
                <div style={{ padding:'16px', borderRight:'1px solid #e5e7eb', display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:6 }}>Must Work to Get OT</div>
                    <input type="text" value={otSettings.minOTBeforeIn}
                      onChange={e => setOtSettings(p => ({ ...p, minOTBeforeIn: e.target.value }))}
                      placeholder="HH:MM"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', marginBottom:5 }}>Maximum OT before Time IN</div>
                    <input type="text" value={otSettings.maxOTBeforeIn}
                      onChange={e => setOtSettings(p => ({ ...p, maxOTBeforeIn: e.target.value }))}
                      placeholder="Type here Maximum OT allowed in Time IN"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                </div>

                <div style={{ padding:'16px', display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:6 }}>Must Work to Get OT</div>
                    <input type="text" value={otSettings.minOTAfterOut}
                      onChange={e => setOtSettings(p => ({ ...p, minOTAfterOut: e.target.value }))}
                      placeholder="HH:MM"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', marginBottom:5 }}>Maximum OT after Time OUT</div>
                    <input type="text" value={otSettings.maxOTAfterOut}
                      onChange={e => setOtSettings(p => ({ ...p, maxOTAfterOut: e.target.value }))}
                      placeholder="Type here Maximum OT allowed in Time OUT"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                </div>
              </div>

              {/* ── Weekend / Public Holiday ── */}
              <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
                <div style={{ padding:'8px 16px', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb',
                  fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:.5 }}>
                  What to do if Staff is Present
                </div>

                {[
                  { key:'weekendPresent',  label:'Weekend' },
                  { key:'holidayPresent',  label:'Public Holiday' },
                ].map(({ key, label }, i) => (
                  <div key={key} style={{ display:'grid', gridTemplateColumns:'160px 1fr',
                    borderTop: i > 0 ? '1px solid #e5e7eb' : 'none' }}>
                    <div style={{ padding:'14px 16px', background:'#fafafa',
                      borderRight:'1px solid #e5e7eb', display:'flex', alignItems:'center' }}>
                      <span style={{ fontSize:13, fontWeight:700, color:'#374151' }}>{label}</span>
                    </div>
                    <div style={{ padding:'14px 16px', display:'flex', gap:24, flexWrap:'wrap', alignItems:'center' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="radio" name={key} value="ot"
                          checked={otSettings[key] === 'ot'}
                          onChange={() => setOtSettings(p => ({ ...p, [key]: 'ot' }))}
                          style={{ accentColor:'#1a56db', width:15, height:15 }} />
                        <span style={{ fontSize:13, color:'#374151' }}>
                          Don't calculate shift — show only Working Hours as OT
                        </span>
                      </label>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="radio" name={key} value="leave"
                          checked={otSettings[key] === 'leave'}
                          onChange={() => setOtSettings(p => ({ ...p, [key]: 'leave' }))}
                          style={{ accentColor:'#1a56db', width:15, height:15 }} />
                        <span style={{ fontSize:13, color:'#374151' }}>
                          Provide Next Day Leave
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowOTSettings(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveOTSettings} disabled={otSettingsSaving}>
                {otSettingsSaving ? 'Saving…' : '💾 Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Advanced Search Modal ── */}
      {showAdvSearchModal && (() => {
        const MCS = ({ label, value, onChange, options }) => {
          const [open, setOpen] = React.useState(false);
          const [srch, setSrch] = React.useState('');
          const ref = React.useRef(null);
          React.useEffect(() => {
            const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
            document.addEventListener('mousedown', h);
            return () => document.removeEventListener('mousedown', h);
          }, []);
          const fo = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          const toggle = v => onChange(value.includes(v) ? value.filter(x=>x!==v) : [...value, v]);
          const selLabel = value.length===0 ? 'All' : value.length===1 ? value[0] : `${value.length} selected`;
          return (
            <div ref={ref} style={{ position:'relative' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>{label}</div>
              <div tabIndex={0}
                onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setOpen(p=>!p); } if (e.key==='Escape') setOpen(false); }}
                onClick={() => setOpen(p=>!p)}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'8px 10px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
                  borderRadius:7, background:'white', cursor:'pointer', fontSize:13,
                  color: value.length>0 ? '#1e40af' : '#9ca3af',
                  minHeight:42, fontWeight: value.length>0 ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline:'none', userSelect:'none' }}>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{selLabel}</span>
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:6 }}>
                  {value.length > 0 && <span style={{ background:'#1a56db', color:'white', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>{value.length}</span>}
                  {value.length > 0 && <span onMouseDown={e=>{e.preventDefault();e.stopPropagation();onChange([]);}} style={{ color:'#9ca3af', fontSize:16, lineHeight:1, cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.color='#ef4444'} onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>×</span>}
                  <span style={{ fontSize:9, color:'#9ca3af' }}>{open?'▲':'▼'}</span>
                </div>
              </div>
              {open && (
                <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, zIndex:9999,
                  background:'white', border:'1.5px solid #1a56db', borderRadius:8,
                  boxShadow:'0 8px 24px rgba(0,0,0,.18)', maxHeight:220, display:'flex', flexDirection:'column' }}>
                  <div style={{ padding:'6px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <input autoFocus type="text" value={srch} onChange={e=>setSrch(e.target.value)} placeholder="Search..."
                      onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 8px', fontSize:12, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  <div style={{ overflowY:'auto', flex:1 }}>
                    <div onMouseDown={e=>{e.preventDefault();onChange([]);}}
                      style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer', background:value.length===0?'#eff6ff':'white', borderBottom:'1px solid #f1f5f9' }}>
                      <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${value.length===0?'#1a56db':'#d1d5db'}`, background:value.length===0?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {value.length===0 && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                      </span>
                      <span style={{ fontSize:13, fontWeight:600, color:value.length===0?'#1e40af':'#374151' }}>All</span>
                    </div>
                    {fo.map(opt => {
                      const sel = value.includes(opt);
                      return (
                        <div key={opt} onMouseDown={e=>{e.preventDefault();toggle(opt);}}
                          style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer', background:sel?'#eff6ff':'white', borderBottom:'1px solid #f9fafb' }}
                          onMouseEnter={e=>{if(!sel)e.currentTarget.style.background='#f8fafc';}}
                          onMouseLeave={e=>{if(!sel)e.currentTarget.style.background='white';}}>
                          <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${sel?'#1a56db':'#d1d5db'}`, background:sel?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize:13, color:sel?'#1e40af':'#374151', fontWeight:sel?600:400 }}>{opt}</span>
                        </div>
                      );
                    })}
                    {fo.length===0 && <div style={{ padding:'10px 11px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results</div>}
                  </div>
                </div>
              )}
            </div>
          );
        };

        const setAF = (field, val) => setAdvFilters(p => ({ ...p, [field]: val }));
        const handleEnterTab = (e) => {
          if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
          e.preventDefault();
          const els = Array.from(e.currentTarget.querySelectorAll('[tabindex="0"]:not([disabled])'))
            .filter(el => el.offsetParent !== null);
          const idx = els.indexOf(document.activeElement);
          if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus();
        };

        return (
          <div className="modal-overlay">
            <div onClick={e => e.stopPropagation()} onKeyDown={handleEnterTab}
              style={{ background:'white', borderRadius:14, width:'96vw', maxWidth:900,
                maxHeight:'88vh', display:'flex', flexDirection:'column',
                boxShadow:'0 25px 60px rgba(0,0,0,.22)', overflow:'hidden' }}>

              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'16px 24px', borderBottom:'2px solid #e5e7eb',
                background:'linear-gradient(135deg,#eff6ff,#f0f9ff)', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" style={{ color:'#1a56db' }}>
                    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                  </svg>
                  <span style={{ fontSize:17, fontWeight:800, color:'#111827' }}>Advanced Search</span>
                  {activeFilterCount > 0 && (
                    <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:12, fontWeight:700, padding:'2px 10px' }}>
                      {activeFilterCount} filter{activeFilterCount>1?'s':''} active
                    </span>
                  )}
                  <span style={{ fontSize:13, color:'#6b7280' }}>— {filtered.length} of {records.length} records shown</span>
                </div>
                <button onClick={() => setShowAdvSearchModal(false)}
                  style={{ background:'#f3f4f6', border:'none', borderRadius:'50%', width:36, height:36,
                    fontSize:18, cursor:'pointer', color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
              </div>

              {/* Body */}
              <div style={{ overflowY:'auto', flex:1, padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Branch"      value={advFilters.branches}    onChange={v=>setAF('branches',v)}    options={branchOpts2} />
                  <MCS label="Department"  value={advFilters.departments}  onChange={v=>setAF('departments',v)} options={deptOpts} />
                  <MCS label="Post"        value={advFilters.positions}    onChange={v=>setAF('positions',v)}   options={posOpts} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Grade"       value={advFilters.grades}       onChange={v=>setAF('grades',v)}       options={gradeOpts} />
                  <MCS label="Gender"      value={advFilters.genders}      onChange={v=>setAF('genders',v)}      options={genderOpts} />
                  <MCS label="Mode"        value={advFilters.modes}        onChange={v=>setAF('modes',v)}        options={modeOpts} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Timing Type" value={advFilters.timingTypes}  onChange={v=>setAF('timingTypes',v)}  options={timingTypeOpts} />
                  <div /><div />
                </div>
              </div>

              {/* Footer */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'14px 24px', borderTop:'1px solid #e5e7eb', background:'#f9fafb', flexShrink:0 }}>
                <button onClick={() => { clearAdvFilters(); }}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 18px',
                    background:'#fff5f5', border:'1.5px solid #fca5a5', borderRadius:8,
                    fontSize:13, fontWeight:700, color:'#dc2626', cursor:'pointer' }}>
                  🗑 Clear All Filters
                </button>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={() => setShowAdvSearchModal(false)}
                    style={{ padding:'8px 20px', background:'white', border:'1.5px solid #d1d5db',
                      borderRadius:8, fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
                    Close
                  </button>
                  <button onClick={() => setShowAdvSearchModal(false)}
                    style={{ padding:'8px 20px', background:'#1a56db', border:'none',
                      borderRadius:8, fontSize:13, fontWeight:700, color:'white', cursor:'pointer' }}>
                    ✔ Apply Filter
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed', bottom:20, right:20, zIndex:99999,
          background: toast.type==='error' ? '#dc2626' : '#059669',
          color:'#fff', borderRadius:10, padding:'10px 18px',
          fontSize:13, fontWeight:700, boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
          {toast.type==='error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default OvertimePage;

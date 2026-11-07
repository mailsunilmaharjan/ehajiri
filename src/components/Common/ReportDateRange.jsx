import React, { useState } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import NepaliDatePicker from './NepaliDatePicker.jsx';
import EnglishDatePicker from './EnglishDatePicker.jsx';

/**
 * Optional "From Date → To Date" control for the Monthly reports.
 * Only exists when Settings → Date → "Report Custom Date Range" is enabled
 * (settings.reportDateRangeEnabled). When disabled, `active` is always false
 * and the reports behave exactly as before (Year + Month).
 *
 * Usage in a report:
 *   const dr = useReportDateRange();
 *   // in load():  if (dr.active) apiUrl = `/attendance/xxx?startDate=${dr.from}&endDate=${dr.to}`;
 *   // deps: [..., dr.active, dr.from, dr.to]
 *   // JSX: <ReportDateRange ctl={dr} />   and hide Year/Month selects when dr.active
 */
export const MAX_RANGE_DAYS = 92;

export const useReportDateRange = () => {
  const { settings } = useSettings();
  const enabled = !!settings.reportDateRangeEnabled;
  const [on,   setOn]   = useState(false);
  const [from, setFrom] = useState('');
  const [to,   setTo]   = useState('');
  const days = from && to ? Math.round((new Date(to) - new Date(from)) / 86400000) + 1 : 0;
  const valid = !!from && !!to && days >= 1 && days <= MAX_RANGE_DAYS;
  return {
    enabled, on, setOn, from, setFrom, to, setTo, days, valid,
    // Year/Month dropdowns are disabled as soon as the checkbox is ticked
    locked: enabled && on,
    // true only when the feature is enabled, switched on and the range is valid
    active: enabled && on && valid,
  };
};

const ReportDateRange = ({ ctl }) => {
  const { settings } = useSettings();
  const { language } = useLanguage();
  const L = (np, en) => (language === 'np' ? np : en);
  if (!ctl?.enabled) return null;
  const Picker = settings.defaultCalendar === 'np' ? NepaliDatePicker : EnglishDatePicker;
  const bad = ctl.on && ctl.from && ctl.to && !ctl.valid;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
      <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
        <input type="checkbox" checked={ctl.on} onChange={e => ctl.setOn(e.target.checked)} />
        {L('मिति दायरा', 'Date Range')}
      </label>
      {ctl.on && (
        <>
          <div style={{ width:140 }}><Picker value={ctl.from} onChange={ctl.setFrom} maxDate={ctl.to || undefined} /></div>
          <span style={{ color:'#6b7280' }}>→</span>
          <div style={{ width:140 }}><Picker value={ctl.to} onChange={ctl.setTo} minDate={ctl.from || undefined} /></div>
          {bad && (
            <span style={{ color:'#b91c1c', fontSize:12 }}>
              {L(`अधिकतम ${MAX_RANGE_DAYS} दिन`, `Max ${MAX_RANGE_DAYS} days`)}
            </span>
          )}
        </>
      )}
    </div>
  );
};

export default ReportDateRange;

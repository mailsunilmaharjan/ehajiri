import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import api from '../../api/client.js';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import { Donut, ChartLegend, MiniBarChart } from '../Dashboard/charts.jsx';

const STYLES = `
  .sar-p { padding:20px 22px; background:#f1f5f9; min-height:100vh; min-height:100dvh; }
  .sar-grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px; align-items:start; margin-bottom:16px; }
  .sar-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.05); overflow:hidden; }
  .sar-head { display:flex; justify-content:space-between; align-items:center; gap:10px;
    padding:14px 18px; border-left:3px solid #4f46e5; border-bottom:1px solid #eef1f5; }
  .sar-title { margin:0; font-size:14px; font-weight:800; color:#1e293b; }
  .sar-sub { margin:2px 0 0; font-size:11px; color:#94a3b8; }
  .sar-body { padding:16px 18px; }
  .sar-band { display:inline-block; padding:2px 9px; border-radius:20px; font-size:10.5px; font-weight:700; }
  @media(max-width:900px){ .sar-p { padding:14px 16px; } }
`;

const fmtPct = (v) => `${v ?? 0}%`;
const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_NP = ['जन','फेब','मार्च','अप्रि','मे','जुन','जुल','अग','सेप्ट','अक्टो','नोभ','डिसे'];

const Card = ({ title, sub, children, right }) => (
  <div className="sar-card">
    <div className="sar-head">
      <div>
        <p className="sar-title">{title}</p>
        {sub && <p className="sar-sub">{sub}</p>}
      </div>
      {right}
    </div>
    <div className="sar-body">{children}</div>
  </div>
);

const BAND_COLOR = {
  High:     { bg: '#fee2e2', color: '#991b1b' },
  Moderate: { bg: '#fef3c7', color: '#92400e' },
  Low:      { bg: '#dcfce7', color: '#166534' },
};

const StaffAnalyticsReport = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const MONTHS = language === 'np' ? MONTHS_NP : MONTHS_EN;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    api.get('/staff-analytics')
      .then(setData)
      .catch(e => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onboardYearlyBars = useMemo(() => {
    if (!data) return [];
    return data.onboarding.yearly.map(r => ({ label: String(r.year), value: r.count, color: '#4f46e5' }));
  }, [data]);

  const onboardSeasonBars = useMemo(() => {
    if (!data) return [];
    return data.onboarding.seasonality.map((m, i) => ({ label: MONTHS[i], value: m.count, color: '#6366f1' }));
  }, [data, MONTHS]);

  const offboardYearlyBars = useMemo(() => {
    if (!data) return [];
    return data.offboarding.yearly.map(r => ({ label: String(r.year), value: r.offboarded, color: '#dc2626' }));
  }, [data]);

  const offboardSeasonBars = useMemo(() => {
    if (!data) return [];
    return data.offboarding.seasonality.map((m, i) => ({ label: MONTHS[i], value: m.count, color: '#f87171' }));
  }, [data, MONTHS]);

  const peakLeanOnboard = useMemo(() => {
    if (!data) return null;
    const s = data.onboarding.seasonality;
    const sorted = [...s].sort((a, b) => b.pct - a.pct);
    return { peak: sorted.slice(0, 3), lean: sorted.slice(-3).reverse() };
  }, [data]);

  const offboardCols = [
    { field: 'year', header: L('आर्थिक वर्ष', 'Fiscal Year'), width: 130 },
    { field: 'offboarded', header: L('अवकाश', 'Left'), width: 90 },
    { field: 'headcountStart', header: L('सुरुको जनशक्ति', 'Headcount Start'), width: 150 },
    { field: 'attritionRate', header: L('अवकाश दर', 'Attrition Rate'), width: 130,
      render: (v) => v != null ? fmtPct(v) : '—' },
  ];

  const diversityCols = [
    { field: 'grade', header: L('ग्रेड', 'Grade'), width: 140,
      render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'male', header: L('पुरुष', 'Male'), width: 120,
      render: (v, row) => `${v} (${fmtPct(row.malePct)})` },
    { field: 'female', header: L('महिला', 'Female'), width: 120,
      render: (v, row) => `${v} (${fmtPct(row.femalePct)})` },
    { field: 'other', header: L('अन्य', 'Other'), width: 120,
      render: (v, row) => `${v} (${fmtPct(row.otherPct)})` },
    { field: 'total', header: L('कुल', 'Total'), width: 90,
      render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
  ];

  const mobilityCols = [
    { field: 'from', header: L('बाट', 'From'), width: 170, render: (v) => v || '—' },
    { field: 'to', header: L('मा', 'To'), width: 170, render: (v) => v || '—' },
    { field: 'count', header: L('संख्या', 'Count'), width: 100,
      render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
  ];

  const workloadCols = [
    { field: 'department', header: L('विभाग', 'Department'), width: 170,
      render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'employeeCount', header: L('कर्मचारी संख्या', 'Employees'), width: 110 },
    { field: 'avgOtHoursPerEmp', header: L('औसत OT घण्टा/व्यक्ति (३ मास)', 'Avg OT hrs/person (3mo)'), width: 190 },
    { field: 'avgLeaveDaysPerEmp', header: L('औसत बिदा दिन/व्यक्ति (यस वर्ष)', 'Avg leave days/person (this yr)'), width: 210 },
    { field: 'score', header: L('स्कोर', 'Score'), width: 90,
      render: (v) => <span style={{ fontWeight: 700 }}>{v}</span> },
    { field: 'band', header: L('स्तर', 'Band'), width: 110,
      render: (v) => (
        <span className="sar-band" style={{ background: BAND_COLOR[v].bg, color: BAND_COLOR[v].color }}>
          {L(v === 'High' ? 'उच्च' : v === 'Moderate' ? 'मध्यम' : 'न्यून', v)}
        </span>
      ) },
  ];

  if (loading) return <LoadingIndicator />;
  if (error) return (
    <div className="sar-p"><style>{STYLES}</style>
      <div className="sar-card" style={{ padding: 24, color: '#dc2626' }}>
        {L('डेटा लोड गर्न असफल भयो: ', 'Failed to load data: ')}{error}
      </div>
    </div>
  );
  if (!data) return null;

  const { onboarding, offboarding, diversity, mobility, workload } = data;

  return (
    <div className="sar-p">
      <style>{STYLES}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#1e293b' }}>
            {L('स्टाफ विश्लेषण प्रतिवेदन', 'Analysis Staff Report')}
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
            {L('भर्ती, अवकाश, विविधता र आन्तरिक स्थानान्तरणको वास्तविक डेटामा आधारित विश्लेषण',
               'Recruitment, attrition, diversity, and internal mobility — computed from real data')}
          </p>
        </div>
        <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
          color: '#475569', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>
          🔄 {L('रिफ्रेस', 'Refresh')}
        </button>
      </div>

      {/* ── 1. Joining Staff Analysis ── */}
      <div className="sar-grid2">
        <Card title={L('भर्ती प्रवृत्ति — आर्थिक वर्षअनुसार', 'Joining Trend — By Fiscal Year')}
          sub={L('Settings → Fiscal Year मा तोकिएका आर्थिक वर्षहरू अनुसार', 'Grouped by the Fiscal Years configured in Settings → Fiscal Year')}>
          {onboardYearlyBars.length
            ? <MiniBarChart data={onboardYearlyBars} height={140} />
            : <Empty L={L} />}
        </Card>
        <Card title={L('भर्ती मौसमीता — महिनावार', 'Joining Seasonality — By Calendar Month')}
          sub={L('सबै वर्षहरूको महिनागत जोड (कुन महिनामा बढी भर्ती हुन्छ)', 'All years combined — which months see the most hiring')}>
          {onboardSeasonBars.length
            ? <MiniBarChart data={onboardSeasonBars} height={140} />
            : <Empty L={L} />}
          {peakLeanOnboard && (
            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5 }}>
              <span style={{ color: '#64748b' }}>
                {L('उच्च:', 'Peak:')} <b style={{ color: '#1e293b' }}>
                  {peakLeanOnboard.peak.map(m => `${MONTHS[m.month - 1]} (${fmtPct(m.pct)})`).join(', ')}
                </b>
              </span>
              <span style={{ color: '#64748b' }}>
                {L('न्यून:', 'Lean:')} <b style={{ color: '#1e293b' }}>
                  {peakLeanOnboard.lean.map(m => `${MONTHS[m.month - 1]} (${fmtPct(m.pct)})`).join(', ')}
                </b>
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* ── 2. Offboarding/Attrition Analysis ── */}
      <div className="sar-grid2">
        <Card title={L('अवकाश प्रवृत्ति — आर्थिक वर्षअनुसार', 'Offboarding Trend — By Fiscal Year')}
          sub={L('स्थिति परिवर्तन इतिहासबाट (राजीनामा/बर्खास्ती/आदि) — Settings → Fiscal Year अनुसार', 'From status-change history (resignation/termination/etc.), grouped by Settings → Fiscal Year')}>
          {offboardYearlyBars.length
            ? <MiniBarChart data={offboardYearlyBars} height={140} />
            : <Empty L={L} />}
          <div style={{ marginTop: 12 }}>
            <DataGrid columns={offboardCols} data={offboarding.yearly} rowKey="year"
              showCheckbox={false} showFilterButton={false} compact defaultPageSize={25} />
          </div>
        </Card>
        <Card title={L('अवकाश मौसमीता — महिनावार', 'Offboarding Seasonality — By Calendar Month')}
          sub={L('सबै वर्षहरूको महिनागत जोड', 'All years combined')}>
          {offboardSeasonBars.length
            ? <MiniBarChart data={offboardSeasonBars} height={140} />
            : <Empty L={L} />}
        </Card>
      </div>

      {/* ── 3. Gender Diversity ── */}
      <div className="sar-grid2">
        <Card title={L('लैंगिक विविधता — समग्र', 'Gender Diversity — Overall')}
          sub={L('सक्रिय स्टाफ मात्र', 'Active staff only')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <Donut
              segments={[
                { label: L('पुरुष', 'Male'), value: diversity.overall.male, color: '#2563eb' },
                { label: L('महिला', 'Female'), value: diversity.overall.female, color: '#db2777' },
                { label: L('अन्य', 'Other'), value: diversity.overall.other, color: '#7c3aed' },
                { label: L('अनिर्दिष्ट', 'Unspecified'), value: diversity.overall.unspecified, color: '#cbd5e1' },
              ]}
              centerLabel={diversity.overall.total}
              centerSub={L('कुल', 'Total')}
            />
            <ChartLegend showPercent segments={[
              { label: L('पुरुष', 'Male'), value: diversity.overall.male, color: '#2563eb' },
              { label: L('महिला', 'Female'), value: diversity.overall.female, color: '#db2777' },
              { label: L('अन्य', 'Other'), value: diversity.overall.other, color: '#7c3aed' },
              { label: L('अनिर्दिष्ट', 'Unspecified'), value: diversity.overall.unspecified, color: '#cbd5e1' },
            ]} />
          </div>
        </Card>
        <Card title={L('ग्रेड अनुसार विविधता', 'Diversity by Grade')}
          sub={L('"तह" को लागि Grade प्रयोग गरिएको (यस प्रणालीमा छुट्टै तह फिल्ड छैन)',
                 'Grade is used as the org-tier grouping (this system has no separate tier field)')}>
          <DataGrid columns={diversityCols} data={diversity.byGrade} rowKey="grade"
            showCheckbox={false} showFilterButton={false} compact defaultPageSize={25} />
        </Card>
      </div>

      {/* ── 4. Internal Mobility ── */}
      <div className="sar-grid2">
        <Card title={L('शाखा स्थानान्तरण', 'Branch Transfers')}
          sub={L('गत १२ महिना', 'Last 12 months')}
          right={<span style={{ fontSize: 20, fontWeight: 800, color: '#1a56db' }}>{mobility.branchTransfers.total}</span>}>
          <DataGrid columns={mobilityCols} data={withRowId(mobility.branchTransfers.pairs)} rowKey="id"
            showCheckbox={false} showFilterButton={false} compact defaultPageSize={25} />
        </Card>
        <Card title={L('विभाग स्थानान्तरण', 'Department Transfers')}
          sub={L('गत १२ महिना', 'Last 12 months')}
          right={<span style={{ fontSize: 20, fontWeight: 800, color: '#0e9f6e' }}>{mobility.departmentTransfers.total}</span>}>
          <DataGrid columns={mobilityCols} data={withRowId(mobility.departmentTransfers.pairs)} rowKey="id"
            showCheckbox={false} showFilterButton={false} compact defaultPageSize={25} />
        </Card>
      </div>

      {/* ── 5. Workload Indicator (rule-based, not AI) ── */}
      <div className="sar-grid2" style={{ gridTemplateColumns: '1fr' }}>
        <Card title={L('कार्यभार सूचक (विभाग अनुसार)', 'Workload Indicator (by Department)')}
          sub={L('नियम-आधारित सूचक — वास्तविक OT र बिदा प्रयोगमा आधारित। यो AI भविष्यवाणी होइन।',
                 'Rule-based indicator from real overtime + leave data. This is not an AI prediction.')}>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px',
            fontSize: 11.5, color: '#92400e', marginBottom: 14 }}>
            {L(
              `⚠️ पारदर्शिता नोट: स्कोर = गत ३ महिनाको औसत OT घण्टा (सन्दर्भ बिन्दु: ${workload.referenceOtHours} घण्टा) र यस वर्ष लिइएको बिदा (कम्पनी औसत ${workload.companyAvgLeaveDaysPerEmp} दिन) बाट गणना गरिएको। यो एक साधारण सूत्र हो, AI/ML भविष्यवाणी होइन — मुनि दिइएको वास्तविक संख्या हेरेर आफैं जाँच गर्नुहोस्।`,
              `Transparency note: the score is computed from average overtime hours over the last 3 months (reference point: ${workload.referenceOtHours}h) and leave days taken this year (company average: ${workload.companyAvgLeaveDaysPerEmp} days). This is a simple formula, not an AI/ML prediction — check the raw numbers below yourself.`
            )}
          </div>
          <DataGrid columns={workloadCols} data={workload.departments} rowKey="department"
            showCheckbox={false} showFilterButton={false} compact defaultPageSize={25} />
        </Card>
      </div>
    </div>
  );
};

const Empty = ({ L }) => (
  <div style={{ padding: '20px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
    {L('कुनै डेटा उपलब्ध छैन', 'No data available')}
  </div>
);

// DataGrid needs a unique rowKey — mobility pairs have none of their own.
const withRowId = (rows) => rows.map((r, i) => ({ ...r, id: i }));

export default StaffAnalyticsReport;

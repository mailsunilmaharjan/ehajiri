import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData } from '../../context/DataContext.jsx';

const LeaveApplication = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();
  const { addLeave, leaveTypes, getLeaveBalance } = useData();
  const navigate = useNavigate();

  const balance = getLeaveBalance(currentUser.id);
  const [form, setForm] = useState({ leaveTypeCode: '', fromDate: '', toDate: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const calcDays = () => {
    if (!form.fromDate || !form.toDate) return 0;
    const diff = (new Date(form.toDate) - new Date(form.fromDate)) / (1000 * 60 * 60 * 24);
    return diff >= 0 ? diff + 1 : 0;
  };

  const validate = () => {
    const e = {};
    if (!form.leaveTypeCode) e.leaveTypeCode = t('Required field');
    if (!form.fromDate) e.fromDate = t('Required field');
    if (!form.toDate) e.toDate = t('Required field');
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) e.toDate = 'अन्त्य मिति सुरु मितिभन्दा पछाडि हुनुपर्छ';
    if (!form.reason.trim()) e.reason = t('Required field');
    if (form.reason.trim().length < 5) e.reason = 'कम्तीमा ५ अक्षर लेख्नुस';
    const days = calcDays();
    if (form.leaveTypeCode && days > 0) {
      const avail = balance[form.leaveTypeCode] || 0;
      if (days > avail) e.days = `अपर्याप्त ब्यालेन्स (उपलब्ध: ${avail} दिन)`;
    }
    return e;
  };

  const handleChange = (field, val) => {
    setForm(p => ({ ...p, [field]: val }));
    setErrors(p => ({ ...p, [field]: '', days: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 600));
    addLeave({ employeeId: currentUser.id, ...form, days: calcDays() });
    setSubmitting(false);
    setSuccess(true);
    setTimeout(() => navigate('/leave'), 2000);
  };

  const days = calcDays();
  const selectedType = leaveTypes.find(lt => lt.code === form.leaveTypeCode);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <div className="breadcrumb-item"><a href="#" onClick={e => { e.preventDefault(); navigate('/leave'); }}>{t('Leave Management')}</a></div>
            <div className="breadcrumb-item active">{t('Apply for Leave')}</div>
          </div>
          <h1 className="page-title">📝 {t('Apply for Leave')}</h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        {/* Form */}
        <div className="card">
          <div className="card-header"><h3>{t('Leave Application')}</h3></div>
          <div className="card-body">
            {success && (
              <div className="alert alert-success">
                <span>✅</span> {t('Application submitted successfully')} — {t('Please wait...')}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Employee info */}
              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>{t('Staff Information')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {[[t('Name'), currentUser.fullName], [t('Staff ID'), currentUser.employeeId], [t('Department'), currentUser.department]].map(([l, v], i) => (
                    <div key={i}><div style={{ fontSize: 11, color: '#9ca3af' }}>{l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>
                  ))}
                </div>
              </div>

              {/* Leave Type */}
              <div className="form-group">
                <label className="form-label required">{t('Type')}</label>
                <select className={`form-control ${errors.leaveTypeCode ? 'error' : ''}`}
                  value={form.leaveTypeCode} onChange={e => handleChange('leaveTypeCode', e.target.value)}>
                  <option value="">{t('Select Leave Type')}</option>
                  {leaveTypes.map(lt => (
                    <option key={lt.code} value={lt.code}>
                      {lt.name} ({t('Available')}: {balance[lt.code] || 0} {t('Days')})
                    </option>
                  ))}
                </select>
                {errors.leaveTypeCode && <div className="form-error">{errors.leaveTypeCode}</div>}
              </div>

              {/* Dates */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label required">{t('From Date')}</label>
                  <input type="date" className={`form-control ${errors.fromDate ? 'error' : ''}`}
                    value={form.fromDate} min={today}
                    onChange={e => handleChange('fromDate', e.target.value)} />
                  {errors.fromDate && <div className="form-error">{errors.fromDate}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label required">{t('To Date')}</label>
                  <input type="date" className={`form-control ${errors.toDate ? 'error' : ''}`}
                    value={form.toDate} min={form.fromDate || today}
                    onChange={e => handleChange('toDate', e.target.value)} />
                  {errors.toDate && <div className="form-error">{errors.toDate}</div>}
                </div>
              </div>

              {/* Days display */}
              {days > 0 && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#1e40af' }}>📅 कुल बिदा दिन:</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#1a56db' }}>{days} {t('Days')}</span>
                </div>
              )}
              {errors.days && <div className="alert alert-danger"><span>⚠️</span> {errors.days}</div>}

              {/* Reason */}
              <div className="form-group">
                <label className="form-label required">{t('Reason')}</label>
                <textarea className={`form-control ${errors.reason ? 'error' : ''}`}
                  rows={3} placeholder={t('Enter reason')}
                  value={form.reason} onChange={e => handleChange('reason', e.target.value)} />
                {errors.reason && <div className="form-error">{errors.reason}</div>}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn btn-outline" onClick={() => navigate('/leave')}>{t('Cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={submitting || success}>
                  {submitting ? `⏳ ${t('Please wait...')}` : `📤 ${t('Submit')}`}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Leave Balance Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header"><h3>📊 {t('Leave Balance')}</h3></div>
            <div className="card-body" style={{ padding: '14px 16px' }}>
              {leaveTypes.map(lt => {
                const avail = balance[lt.code] || 0;
                const used = lt.totalDays - avail;
                const pct = Math.round((avail / lt.totalDays) * 100);
                return (
                  <div key={lt.code} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{lt.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: lt.color }}>{avail}/{lt.totalDays}</span>
                    </div>
                    <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                      <div style={{ height: '100%', borderRadius: 3, background: lt.color, width: `${pct}%`, transition: 'width .3s' }}></div>
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t('Used')}: {used} · {t('Available')}: {avail}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedType && days > 0 && (
            <div className="card" style={{ borderLeft: `4px solid ${selectedType.color}` }}>
              <div className="card-body" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{t('Summary')}</div>
                <div style={{ fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>{t('Type')}:</span><span style={{ fontWeight: 600 }}>{selectedType.name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>{t('Days')}:</span><span style={{ fontWeight: 600, color: selectedType.color }}>{days}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>{t('Available')}:</span><span style={{ fontWeight: 600 }}>{balance[form.leaveTypeCode] || 0}</span></div>
                  <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 6, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('Remaining')}:</span>
                    <span style={{ fontWeight: 700, color: (balance[form.leaveTypeCode] || 0) - days >= 0 ? '#0e9f6e' : '#f05252' }}>
                      {(balance[form.leaveTypeCode] || 0) - days}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaveApplication;


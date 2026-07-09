import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';

/**
 * Bug Finder — Settings → Database tab's neighbor.
 * Lists every auto-logged frontend crash / backend 5xx error (see
 * server/index.js's res.json patch + src/utils/bugReporter.js) so an admin
 * can see what broke, where, and jot down the fix once resolved.
 */
const BugFinder = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const fd = useDateFormat();

  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(null);   // row id whose stack/solution editor is open
  const [solutionDraft, setSolutionDraft] = useState('');
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.get('/bug-reports')); }
    catch (e) {
      const msg = e.status === 403
        ? L('यो हेर्न एडमिन अनुमति चाहिन्छ','Admin permission required to view this')
        : (e.message || L('लोड गर्न सकिएन','Failed to load'));
      showToast(msg, 'danger');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openRow = (row) => {
    setExpanded(expanded === row.id ? null : row.id);
    setSolutionDraft(row.solution || '');
  };

  const saveSolution = async (row) => {
    setSaving(true);
    try {
      const updated = await api.put(`/bug-reports/${row.id}`, { solution: solutionDraft, resolved: true });
      setRows(p => p.map(r => r.id === row.id ? updated : r));
      showToast(L('समाधान सुरक्षित भयो','Solution saved'));
      setExpanded(null);
    } catch (e) { showToast(e.message || L('सुरक्षित गर्न सकिएन','Save failed'), 'danger'); }
    finally { setSaving(false); }
  };

  const toggleResolved = async (row) => {
    try {
      const updated = await api.put(`/bug-reports/${row.id}`, { resolved: !row.resolved });
      setRows(p => p.map(r => r.id === row.id ? updated : r));
    } catch (e) { showToast(e.message, 'danger'); }
  };

  const deleteRow = async (row) => {
    if (!window.confirm(L('यो बग रेकर्ड मेटाउने?','Delete this bug record?'))) return;
    try {
      await api.delete(`/bug-reports/${row.id}`);
      setRows(p => p.filter(r => r.id !== row.id));
      showToast(L('मेटाइयो','Deleted'));
    } catch (e) { showToast(e.message, 'danger'); }
  };

  const openCount = rows.filter(r => !r.resolved).length;

  const columns = [
    {
      field: 'createdAt', header: L('मिति','Date'), width: 140,
      render: v => (
        <div>
          <div style={{ fontWeight: 600, color: '#1f2937', fontSize: 12 }}>{fd(v?.split('T')[0])}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{v ? new Date(v).toLocaleTimeString() : ''}</div>
        </div>
      ),
    },
    {
      field: 'source', header: L('स्रोत','Source'), width: 100, align: 'center',
      render: v => (
        <span style={{
          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: v === 'backend' ? '#fef2f2' : '#eff6ff',
          color:      v === 'backend' ? '#991b1b' : '#1e40af',
          border: `1px solid ${v === 'backend' ? '#fecaca' : '#bfdbfe'}`,
        }}>
          {v === 'backend' ? '🖥️ Backend' : '💻 Frontend'}
        </span>
      ),
    },
    {
      field: 'page', header: L('पेज','Page'), width: 200,
      render: (v, row) => (
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#1a56db', fontWeight: 600 }}>{v || '—'}</div>
          {row.method && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {row.method} {row.statusCode ? `→ ${row.statusCode}` : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      field: 'message', header: L('समस्याको विवरण','Issue Details'), width: 320,
      render: (v, row) => (
        <div>
          <div style={{ fontSize: 12.5, color: '#374151' }}>{v}</div>
          {row.userName && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>👤 {row.userName}</div>
          )}
        </div>
      ),
    },
    {
      field: 'resolved', header: L('स्थिति','Status'), width: 110, align: 'center',
      render: (v, row) => (
        <button onClick={() => toggleResolved(row)}
          style={{
            border: 'none', borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: v ? '#d1fae5' : '#fef3c7', color: v ? '#065f46' : '#92400e',
          }}>
          {v ? `✅ ${L('समाधान भयो','Resolved')}` : `⚠️ ${L('खुल्ला','Open')}`}
        </button>
      ),
    },
    {
      field: 'solution', header: L('समाधान','Solution'), width: 200,
      render: (v, row) => (
        <button onClick={() => openRow(row)}
          style={{
            border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 12,
            background: 'white', color: v ? '#374151' : '#9ca3af', cursor: 'pointer',
            textAlign: 'left', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
          {v || `✏️ ${L('थप्नुस्','Add note')}`}
        </button>
      ),
    },
    {
      field: 'actions', header: L('कार्य','Actions'), width: 70, sortable: false, filterable: false,
      render: (_, row) => (
        <button className="dg-action-btn delete" title={L('मेटाउनुस','Delete')}
          onClick={e => { e.stopPropagation(); deleteRow(row); }}>🗑</button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>🐞 {L('बग फाइन्डर','Bug Finder')}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#6b7280' }}>
            {L(
              'एप्लिकेसनमा देखा परेका सबै फ्रन्टइन्ड र ब्याकइन्ड त्रुटिहरू स्वचालित रूपमा यहाँ लग हुन्छन्।',
              'Every frontend crash and backend error that occurs in the app is logged here automatically.'
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {openCount > 0 && (
            <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
              borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
              {openCount} {L('खुल्ला','open')}
            </span>
          )}
          <button className="btn btn-sm btn-outline" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'} {L('रिफ्रेस','Refresh')}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          {L('लोड हुँदैछ…','Loading…')}
        </div>
      ) : (
        <DataGrid
          columns={columns}
          data={rows}
          defaultPageSize={15}
          showSearch
          compact
          onRowClick={openRow}
        />
      )}

      {/* Detail / solution editor drawer */}
      {expanded && (() => {
        const row = rows.find(r => r.id === expanded);
        if (!row) return null;
        return (
          <div className="modal-overlay" onClick={() => setExpanded(null)}>
            <div className="modal modal-md" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>🐞 {L('बग विवरण','Bug Details')}</h2>
                <button className="modal-close" onClick={() => setExpanded(null)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14, fontSize: 12.5 }}>
                  <div><strong>{L('स्रोत','Source')}:</strong> {row.source}</div>
                  <div><strong>{L('पेज','Page')}:</strong> {row.page || '—'}</div>
                  {row.method && <div><strong>{L('मेथड','Method')}:</strong> {row.method}</div>}
                  {row.statusCode && <div><strong>{L('स्थिति कोड','Status Code')}:</strong> {row.statusCode}</div>}
                  <div><strong>{L('मिति','Date')}:</strong> {fd(row.createdAt?.split('T')[0])}</div>
                  {row.userName && <div><strong>{L('प्रयोगकर्ता','User')}:</strong> {row.userName}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{L('समस्या सन्देश','Issue Message')}</label>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
                    padding: '10px 12px', fontSize: 12.5, color: '#374151', wordBreak: 'break-word' }}>
                    {row.message}
                  </div>
                </div>
                {row.stack && (
                  <div className="form-group">
                    <label className="form-label">{L('स्ट्याक ट्रेस','Stack Trace')}</label>
                    <pre style={{ background: '#111827', color: '#d1d5db', borderRadius: 6, padding: '10px 12px',
                      fontSize: 11, maxHeight: 160, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
                      {row.stack}
                    </pre>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">{L('समाधान (व्यवस्थापकले लेख्ने)','Solution (admin notes)')}</label>
                  <textarea className="form-control" rows={4}
                    placeholder={L('यो समस्या कसरी समाधान गरियो लेख्नुहोस्...','Describe how this was fixed...')}
                    value={solutionDraft} onChange={e => setSolutionDraft(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline" onClick={() => setExpanded(null)}>{L('रद्द','Cancel')}</button>
                <button className="btn btn-primary" disabled={saving} onClick={() => saveSolution(row)}>
                  {saving ? '⏳' : '💾'} {L('समाधान सुरक्षित गर्नुस् (Resolved मार्क)','Save Solution (marks Resolved)')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type === 'success' ? '✅' : '❌'}</span> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
};

export default BugFinder;

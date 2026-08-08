import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';

/* ── Simple semver comparison ── */
const isNewer = (remote, local) => {
  const r = (remote || '0.0.0').split('.').map(Number);
  const l = (local  || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
};

const STATE_LABEL = {
  idle        : '',
  backup      : '📦 Creating database backup…',
  downloading : '⬇️ Downloading update…',
  verifying   : '🔒 Verifying package…',
  extracting  : '📂 Extracting files…',
  applying    : '🔧 Replacing application files…',
  migrating   : '🗄️ Applying database migrations…',
  restarting  : '🔄 Restarting server… (wait ~15 seconds)',
  error       : '❌ Update failed',
};

export default function UpdateChecker() {
  const [checking,   setChecking]   = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);   // { current, latest, updateAvailable, changelog, downloadUrl, checksum }
  const [applying,   setApplying]   = useState(false);
  const [pollStatus, setPollStatus] = useState(null);   // status from /api/update/status
  const [error,      setError]      = useState('');
  const [expanded,   setExpanded]   = useState(false);

  /* ── Auto-check on mount ── */
  useEffect(() => {
    handleCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Poll status while applying ── */
  useEffect(() => {
    if (!applying) return;
    const id = setInterval(async () => {
      try {
        const s = await api.get('/update/status');
        setPollStatus(s);
        if (s.state === 'restarting') {
          // Server will restart — poll health until it comes back
          setTimeout(() => pollUntilBack(), 3000);
          clearInterval(id);
        }
        if (s.state === 'error') { setApplying(false); setError(s.message); clearInterval(id); }
      } catch { /* server may be mid-restart */ }
    }, 1200);
    return () => clearInterval(id);
  }, [applying]);

  const pollUntilBack = useCallback(async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const h = await api.get('/health');
        if (h?.status === 'ok') { window.location.reload(); return; }
      } catch { /* still restarting */ }
    }
    setError('Server did not come back. Please refresh manually.');
    setApplying(false);
  }, []);

  const handleCheck = async () => {
    setChecking(true); setError('');
    try {
      const info = await api.get('/update/check');
      setUpdateInfo(info);
    } catch (e) { setError('Could not reach update server: ' + e.message); }
    finally { setChecking(false); }
  };

  const handleApply = async () => {
    if (!updateInfo?.downloadUrl) return;
    setApplying(true); setError(''); setPollStatus(null);
    try {
      await api.post('/update/apply', {
        downloadUrl : updateInfo.downloadUrl,
        checksum    : updateInfo.checksum,
        version     : updateInfo.latest,
      });
    } catch (e) { setError(e.message); setApplying(false); }
  };

  const progressPct = pollStatus?.progress ?? 0;
  const stateLabel  = STATE_LABEL[pollStatus?.state || 'idle'] || pollStatus?.message || '';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
      {/* Header */}
      <div style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb', padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔄</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>Software Update</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Current version: <strong>v{updateInfo?.current || '…'}</strong>
            </div>
          </div>
        </div>
        <button onClick={handleCheck} disabled={checking || applying}
          className="btn btn-outline" style={{ fontSize: 12, padding: '4px 12px' }}>
          {checking ? '⏳ Checking…' : '🔍 Check for Update'}
        </button>
      </div>

      <div style={{ padding: '16px 18px' }}>
        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#991b1b' }}>
            {error}
          </div>
        )}

        {/* Up to date */}
        {updateInfo && !updateInfo.updateAvailable && !applying && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#065f46',
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            padding: '10px 14px', fontSize: 13 }}>
            <span>✅</span>
            <span>You are on the latest version <strong>v{updateInfo.current}</strong>.</span>
          </div>
        )}

        {/* Update available */}
        {updateInfo?.updateAvailable && !applying && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#92400e', marginBottom: 2 }}>
                  🎉 Update Available — v{updateInfo.latest}
                </div>
                <div style={{ fontSize: 12, color: '#78350f' }}>Released {updateInfo.releaseDate || ''}</div>
              </div>
              <button onClick={handleApply} className="btn btn-primary"
                style={{ background: '#059669', border: 'none', fontSize: 13 }}>
                ⬇️ Install Update
              </button>
            </div>

            {/* Changelog */}
            {updateInfo.changelog?.length > 0 && (
              <div>
                <button onClick={() => setExpanded(p => !p)}
                  style={{ background: 'none', border: 'none', color: '#92400e', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, padding: 0, marginBottom: 6 }}>
                  {expanded ? '▲ Hide' : '▼ Show'} what's new ({updateInfo.changelog.length} items)
                </button>
                {expanded && (
                  <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 13, color: '#374151' }}>
                    {updateInfo.changelog.map((c, i) => <li key={i} style={{ marginBottom: 3 }}>{c}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div style={{ fontSize: 11, color: '#92400e', marginTop: 10, padding: '6px 10px',
              background: '#fef3c7', borderRadius: 6, border: '1px solid #fde68a' }}>
              ⚠️ A database backup will be created automatically before the update is applied.
              Do not close this window during the update.
            </div>
          </div>
        )}

        {/* Progress while applying */}
        {applying && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e40af', marginBottom: 12 }}>
              🔄 Applying Update v{updateInfo?.latest}…
            </div>
            {/* Progress bar */}
            <div style={{ background: '#dbeafe', borderRadius: 99, height: 12, marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ background: '#2563eb', height: '100%', borderRadius: 99,
                width: `${progressPct}%`, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: '#1e40af', marginBottom: 6 }}>{progressPct}%</div>
            <div style={{ fontSize: 13, color: '#374151' }}>{stateLabel || pollStatus?.message || 'Starting…'}</div>
            {pollStatus?.state === 'restarting' && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
                ✅ Update complete! Page will reload automatically when server restarts…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

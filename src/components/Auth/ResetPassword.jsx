import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';

export default function ResetPassword() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const token      = params.get('token') || '';

  const [password, setPassword]   = useState('');
  const [confirm,  setConfirm]    = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [loading,  setLoading]    = useState(false);
  const [success,  setSuccess]    = useState(null);
  const [error,    setError]      = useState(null);

  const handleSubmit = async () => {
    if (password.length < 4) { setError('Password must be at least 4 characters'); return; }
    if (password !== confirm)  { setError('Passwords do not match'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/reset-password-token', { token, newPassword: password });
      setSuccess(res.fullName);
      setTimeout(() => navigate('/login'), 3000);
    } catch (e) {
      setError(e.message || 'Invalid or expired reset link. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  const card = {
    background: '#fff', borderRadius: 14, padding: '36px 32px',
    width: '100%', maxWidth: 400, boxShadow: '0 20px 50px rgba(0,0,0,.15)',
  };

  const input = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none',
  };

  const btn = (disabled) => ({
    width: '100%', padding: '11px', border: 'none', borderRadius: 8,
    background: disabled ? '#93c5fd' : '#1a56db',
    color: '#fff', fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', marginTop: 8,
  });

  const wrap = {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#f1f5f9', padding: 20,
  };

  /* ── no token in URL ── */
  if (!token) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔗</div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#111827' }}>Invalid Reset Link</h2>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>
              This link is missing a reset token. Please request a new one.
            </p>
          </div>
          <button onClick={() => navigate('/login')} style={btn(false)}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  /* ── success state ── */
  if (success) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#065f46' }}>Password Updated!</h2>
            <p style={{ margin: '8px 0 16px', fontSize: 13, color: '#374151' }}>
              Hello <strong>{success}</strong>, your password has been set successfully.
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
              Redirecting to login in 3 seconds…
            </p>
          </div>
          <button onClick={() => navigate('/login')} style={{ ...btn(false), marginTop: 20 }}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  /* ── main form ── */
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>eHajiri TMS</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111827' }}>Set New Password</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280' }}>
            Choose a strong password for your account.
          </p>
        </div>

        {error && (
          <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 8,
            padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            New Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="At least 4 characters"
              autoFocus
              style={{ ...input, paddingRight: 38 }}
              onFocus={e => e.target.style.borderColor = '#1a56db'}
              onBlur={e => e.target.style.borderColor = '#d1d5db'}
            />
            <button
              type="button"
              onClick={() => setShowPass(p => !p)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#9ca3af' }}>
              {showPass ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Confirm Password
          </label>
          <input
            type={showPass ? 'text' : 'password'}
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(null); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Re-enter new password"
            style={{
              ...input,
              borderColor: confirm && confirm !== password ? '#ef4444' : '#d1d5db',
            }}
            onFocus={e => e.target.style.borderColor = confirm && confirm !== password ? '#ef4444' : '#1a56db'}
            onBlur={e => e.target.style.borderColor = confirm && confirm !== password ? '#ef4444' : '#d1d5db'}
          />
          {confirm && confirm !== password && (
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444' }}>Passwords do not match</p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !password || !confirm}
          style={btn(loading || !password || !confirm)}>
          {loading ? 'Updating Password…' : 'Set New Password'}
        </button>

        <button
          onClick={() => navigate('/login')}
          style={{ width: '100%', padding: '10px', marginTop: 10, border: '1.5px solid #e5e7eb',
            borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600,
            color: '#6b7280', cursor: 'pointer' }}>
          Back to Login
        </button>
      </div>
    </div>
  );
}

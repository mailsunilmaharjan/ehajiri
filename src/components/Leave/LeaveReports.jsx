import React from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

const LeaveReports = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #f3f4f6',
          background: 'linear-gradient(135deg,#f8fafc,#f0fdf4)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 28 }}>📋</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
              {L('बिदा रिपोर्टहरू', 'Leave Reports')}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {L('कर्मचारीको बिदाको विस्तृत रिपोर्ट', 'Detailed leave reports for employees')}
            </div>
          </div>
        </div>

        {/* Coming Soon body */}
        <div style={{
          padding: '60px 24px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, color: '#9ca3af', textAlign: 'center',
        }}>
          <div style={{ fontSize: 56 }}>🚧</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#374151' }}>
            {L('जल्दै आउँदैछ', 'Coming Soon')}
          </div>
          <div style={{ fontSize: 14, maxWidth: 380, lineHeight: 1.6 }}>
            {L(
              'बिदा रिपोर्ट मोड्युल निर्माणाधीन छ। छिट्टै उपलब्ध हुनेछ।',
              'The Leave Reports module is under development and will be available soon.',
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeaveReports;

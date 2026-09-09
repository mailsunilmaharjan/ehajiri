import React from 'react';
import { useNavigate } from 'react-router-dom';

/* Task > Task Setting — dedicated nav-menu landing page for the lookup lists
   that already existed (Task Category / Task Priority, see TaskLookupPage.jsx
   + their routes in App.jsx) but previously had no menu entry of their own,
   only the gear-icon shortcut inside TaskList.jsx itself. No new backend. */

const SETTING_CARDS = [
  { key: 'categories', title: 'Task Category', desc: 'Manage the category list tasks are grouped by.', icon: '🏷️', path: '/staff/task/categories' },
  { key: 'priorities',  title: 'Task Priority', desc: 'Manage priority levels and their colors.',       icon: '🚩', path: '/staff/task/priorities' },
];

export default function TaskSettings() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 className="page-title">⚙️ Task Setting</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {SETTING_CARDS.map(c => (
          <div key={c.key} onClick={() => navigate(c.path)}
            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px',
              cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.04)', transition: 'box-shadow .15s' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,.1)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,.04)'}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{c.icon}</div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

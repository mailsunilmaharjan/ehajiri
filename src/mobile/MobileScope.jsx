import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import Avatar from '../components/Common/Avatar.jsx';
import { Empty, Sheet, useMT } from './kit.jsx';

/* "Whose data am I looking at?" for managers on the phone.
   Admin sees everyone, a Branch Manager sees their branch, a Department Head their department… exactly the people the website
   already lets that role see (DataContext.filteredEmployees). A plain employee has only themself, so nothing extra shows. */

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

export function useStaffScope() {
  const { currentUser } = useAuth();
  const { filteredEmployees, employees } = useData();
  return useMemo(() => {
    const base = ((filteredEmployees && filteredEmployees.length ? filteredEmployees : employees) || []).filter(e => e.active !== false);
    const list = base.some(e => String(e.id) === String(currentUser?.id)) || !currentUser ? base : [{ ...currentUser }, ...base];
    const byId = Object.fromEntries(list.map(e => [String(e.id), e]));
    return {
      list, byId,
      canPick: list.length > 1 && currentUser?.role !== 'employee',
      branches: uniq(list.map(e => e.branch)), departments: uniq(list.map(e => e.department)), posts: uniq(list.map(e => e.position)),
    };
  }, [filteredEmployees, employees, currentUser]);
}

/** scope = { emp: 'me' | 'all' | '<id>', branch: '', department: '', post: '' } */
export const DEFAULT_SCOPE = { emp: 'me', branch: '', department: '', post: '' };
export const inScope = (e, scope) => !!e && (!scope.branch || e.branch === scope.branch) && (!scope.department || e.department === scope.department) && (!scope.post || e.position === scope.post);

function PickSheet({ scope, setScope, allowAll, onClose }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const S = useStaffScope();
  const [q, setQ] = useState('');
  const rows = S.list.filter(e => inScope(e, scope) && (!q.trim() || [e.fullName, e.employeeId, e.position, e.department].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 150);
  const Pick = ({ k, label, opts }) => (
    <div className="m-field" style={{ flex: 1, minWidth: 0, marginBottom: 8 }}><label>{label}</label>
      <select className="m-input" value={scope[k]} onChange={e => setScope({ ...scope, [k]: e.target.value })}><option value="">{mt('All')}</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
  );
  const choose = (emp) => { setScope({ ...scope, emp }); onClose(); };
  const filtered = !!(scope.branch || scope.department || scope.post);
  return (
    <Sheet title={`👥 ${mt('Select staff')}`} onClose={onClose}
      footer={<><button className="m-btn m-ghost" onClick={() => setScope({ ...scope, branch: '', department: '', post: '' })}>{mt('Clear filters')}</button>
        <button className="m-btn" onClick={onClose}>{mt('Done')}</button></>}>
      <div className="m-row" style={{ gap: 8 }}>{S.branches.length > 1 && <Pick k="branch" label={mt('Branch')} opts={S.branches} />}{S.departments.length > 1 && <Pick k="department" label={mt('Department')} opts={S.departments} />}</div>
      {S.posts.length > 1 && <Pick k="post" label={mt('Post')} opts={S.posts} />}
      <input className="m-input" style={{ marginBottom: 10 }} placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} />
      <button className={`m-task m-staffrow${scope.emp === 'me' ? ' m-picked' : ''}`} onClick={() => choose('me')}>
        <span className="m-task-bar" style={{ background: '#bcd3fb' }} /><Avatar photo={currentUser?.profilePhoto} name={currentUser?.fullName} size={38} preview={false} />
        <span className="m-grow"><b>{mt('Me')}</b><span className="m-muted" style={{ display: 'block' }}>{currentUser?.fullName}</span></span></button>
      {allowAll && (
        <button className={`m-task m-staffrow${scope.emp === 'all' ? ' m-picked' : ''}`} onClick={() => choose('all')}>
          <span className="m-task-bar" style={{ background: '#a7e3bd' }} /><span className="m-list-ico" style={{ background: '#dcfce7' }}>👥</span>
          <span className="m-grow"><b>{mt('All staff')}</b><span className="m-muted" style={{ display: 'block' }}>{filtered ? mt('With the filters above') : mt('Everyone I can see')} · {S.list.filter(e => inScope(e, scope)).length}</span></span></button>
      )}
      {rows.length === 0 && <Empty icon="👥" text={mt('Nothing here yet')} />}
      {rows.filter(e => String(e.id) !== String(currentUser?.id)).map(e => (
        <button key={e.id} className={`m-task m-staffrow${String(scope.emp) === String(e.id) ? ' m-picked' : ''}`} onClick={() => choose(String(e.id))}>
          <span className="m-task-bar" style={{ background: '#d5dce8' }} /><Avatar photo={e.profilePhoto} name={e.fullName} size={38} preview={false} />
          <span className="m-grow" style={{ minWidth: 0 }}><b className="m-ell" style={{ display: 'block' }}>{e.fullName}</b><span className="m-muted m-ell" style={{ display: 'block' }}>{[e.position, e.department, e.branch].filter(Boolean).join(' · ')}</span></span></button>
      ))}
    </Sheet>
  );
}

/** The bar shown above a report / list. Renders nothing for people who can only see themselves. */
export function StaffScopeBar({ scope, setScope, allowAll = false }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const S = useStaffScope();
  const [open, setOpen] = useState(false);
  if (!S.canPick) return null;
  const person = scope.emp === 'all' ? null : (scope.emp === 'me' ? currentUser : S.byId[String(scope.emp)] || currentUser);
  const chips = [scope.branch, scope.department, scope.post].filter(Boolean);
  const n = S.list.filter(e => inScope(e, scope)).length;
  return (<>
    <button className="m-scope" onClick={() => setOpen(true)}>
      {person ? <Avatar photo={person.profilePhoto} name={person.fullName} size={36} preview={false} /> : <span className="m-list-ico" style={{ width: 36, height: 36, background: '#dcfce7' }}>👥</span>}
      <span className="m-grow" style={{ minWidth: 0 }}>
        <b className="m-ell" style={{ display: 'block' }}>{person ? (scope.emp === 'me' ? `${mt('Me')} · ${person.fullName}` : person.fullName) : `${mt('All staff')} · ${n}`}</b>
        <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{chips.length ? chips.join(' · ') : person ? [person.position, person.department].filter(Boolean).join(' · ') : mt('Everyone I can see')}</span>
      </span>
      <span className="m-scope-go">{mt('Change')} ▾</span>
    </button>
    {open && <PickSheet scope={scope} setScope={setScope} allowAll={allowAll} onClose={() => setOpen(false)} />}
  </>);
}

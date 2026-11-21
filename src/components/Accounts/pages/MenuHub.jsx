import { Link, useNavigate } from '../lib/router';
import { MIcon } from '../../Layout/menuIcons.jsx';
import { ACCOUNTS_HUBS } from '../menu';

/** Landing page for a menu group (Master / Posting / Reports), in the same look as the Chart of Accounts
 *  statement view: one card per group with an icon, title and count, a white list of its screens, and its
 *  "+ …" items as blue buttons under the list. Quick actions sit on the right of the page header. */
export default function MenuHub({ hub }) {
  const nav = useNavigate();
  const h = ACCOUNTS_HUBS[hub];
  if (!h) return null;
  return (
    <>
      <header className="page-head">
        <h1>{h.title}</h1>
        <span className="spacer" />
        {(h.actions || []).map(([to, label]) => <button key={to} type="button" onClick={() => nav(to)}>＋ {label}</button>)}
      </header>
      <div className="coa-st-quick hub-st">
        {h.groups.map((g) => {
          const items = g.cards.filter(([, label]) => !label.startsWith('+'));
          const adds = g.cards.filter(([, label]) => label.startsWith('+'));
          return (
            <section key={g.title} className="coa-st-card">
              <h3><MIcon name={g.icon} size={18} />{g.title}<b>{items.length}</b></h3>
              <div className="coa-st-list">
                {items.map(([to, label, icon, key]) => (
                  <Link key={to} to={to} className="coa-st-led">
                    <MIcon name={icon} size={15} />
                    <span className="nm">{label}</span>
                    {key && <kbd>{key}</kbd>}
                  </Link>
                ))}
              </div>
              {adds.length > 0 && (
                <div className="hub-st-btns">
                  {adds.map(([to, label]) => <button key={to} type="button" onClick={() => nav(to)}>＋ {label.replace(/^\+\s*/, '')}</button>)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

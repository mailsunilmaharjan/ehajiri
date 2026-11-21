import { Link } from '../lib/router';
import { MIcon } from '../../Layout/menuIcons.jsx';
import { ACCOUNTS_HUBS } from '../menu';

/** Landing page for a menu group (Master / Posting / Reports): quick buttons, then every sub-menu as columns of cards. */
export default function MenuHub({ hub }) {
  const h = ACCOUNTS_HUBS[hub];
  if (!h) return null;
  return (
    <>
      <header className="page-head"><h1>{h.title}</h1></header>
      {h.actions?.length > 0 && (
        <div className="hub-actions">
          {h.actions.map(([to, label]) => <Link key={to} to={to} className="hub-btn">{label}</Link>)}
        </div>
      )}
      <div className="hub-cols">
        {h.groups.map((g) => (
          <section key={g.title} className="hub-col">
            <h2><MIcon name={g.icon} size={20} />{g.title}</h2>
            <div className="hub-list">
              {g.cards.map(([to, label, icon, key]) => (
                <Link key={to} to={to} className="hub-item">
                  <MIcon name={icon} size={18} />{label}{key && <kbd>{key}</kbd>}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

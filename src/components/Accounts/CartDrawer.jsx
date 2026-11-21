import { clearCart, removeFromCart, setCartQty, useCart } from './lib/cart';
import { useShortcuts } from './lib/keys';
import './accounts.css';
import './accounts.embed.css';

/** Product cart (quick ordering from the catalogue). Opened from the cart icon in eHajiri's header, so it can render
 *  outside the Accounts screens: the wrapper gives it the module's scoped styles without adding any box of its own.
 *  `go('/docs/SI/new?cart=1')` receives paths relative to /accounts. */
export default function CartDrawer({ onClose, go }) {
  const cart = useCart();
  useShortcuts({ close: onClose });
  const make = (t) => { onClose(); go(`/docs/${t}/new?cart=1`); };
  return (
    <div className="acc-app" style={{ display: 'contents' }}>
      <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="card form narrow">
          <h2>🛒 Cart <span className="muted small">{cart.length} products</span></h2>
          {cart.length === 0 ? <p className="muted full">Cart is empty. Open Products and use “Add to Cart”.</p> : (
            <table className="grid full"><thead><tr><th className="sn">SN</th><th>Product</th><th className="num" style={{ width: 90 }}>Qty</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>{cart.map((c, i) => (
                <tr key={c.item_id}><td className="sn">{i + 1}</td><td>{c.name}</td>
                  <td><input className="num" type="number" min="1" value={c.qty} onChange={(e) => setCartQty(c.item_id, Number(e.target.value))} /></td>
                  <td><button className="link del-x" onClick={() => removeFromCart(c.item_id)}>✕</button></td></tr>
              ))}</tbody></table>
          )}
          <div className="actions">
            {cart.length > 0 && <button className="ghost" onClick={() => { if (confirm('Empty the cart?')) clearCart(); }}>Empty</button>}
            <span className="spacer" />
            <button className="ghost" onClick={onClose}>Close</button>
            <button className="ghost" disabled={!cart.length} onClick={() => make('SO')}>Create Sales Order</button>
            <button disabled={!cart.length} onClick={() => make('SI')}>Create Sales Invoice</button>
          </div>
        </div>
      </div>
    </div>
  );
}

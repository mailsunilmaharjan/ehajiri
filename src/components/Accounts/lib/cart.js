// Cart for quick ordering from the product catalogue. Kept in memory only — eHajiri serves every tenant from
// one browser origin, so localStorage would leak one company's cart into another.
import { useEffect, useState } from 'react';

let cart = [];
const subs = new Set();

export function getCart() { return cart; }
function save(c) { cart = c; subs.forEach((f) => f(c)); }
export function addToCart(item, qty = 1) {
  const c = cart.map((x) => ({ ...x }));
  const row = c.find((x) => x.item_id === item.id);
  if (row) row.qty += qty; else c.push({ item_id: item.id, name: item.name, qty });
  save(c);
}
export const setCartQty = (id, qty) => save(cart.map((x) => (x.item_id === id ? { ...x, qty } : x)).filter((x) => x.qty > 0));
export const removeFromCart = (id) => save(cart.filter((x) => x.item_id !== id));
export const clearCart = () => save([]);

export function useCart() {
  const [c, setC] = useState(getCart);
  useEffect(() => { subs.add(setC); setC(getCart()); return () => subs.delete(setC); }, []);
  return c;
}

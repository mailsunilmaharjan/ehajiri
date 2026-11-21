// Keyboard rules for every form:
//   Enter        → next field (like Tab). On the last field it presses the Save button.
//   Ctrl+S       → Save          Esc → Close / back          Ctrl+Delete → Delete / Cancel
// Pages and dialogs register their actions with useShortcuts(); the newest (top-most dialog) wins.
import { useEffect, useRef } from 'react';

const stack = [];

export function useShortcuts(handlers, active = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!active) return undefined;
    const entry = { get: () => ref.current };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

const top = () => stack[stack.length - 1]?.get() || {};

const FIELDS = 'input:not([type=hidden]):not([type=file]), select, textarea, button[data-save]';

function scopeOf(el) {
  return el.closest('.modal > .card') || el.closest('.acc-app') || document.body;
}

/** Move focus to the next field after `from`; on reaching the Save button, press it. */
export function focusNext(from) {
  const els = [...scopeOf(from).querySelectorAll(FIELDS)]
    .filter((e) => !e.disabled && !e.readOnly && e.tabIndex !== -1 && e.offsetParent !== null);
  const next = els[els.indexOf(from) + 1];
  if (!next) return;
  if (next.matches('button[data-save]')) { next.click(); return; }
  next.focus();
  if (next.tagName === 'INPUT' && /^(text|number|search|email|tel|)$/.test(next.type)) next.select?.();
}

// First letter in capital in every text box — except email addresses, links, passwords, numbers and
// fields marked data-nocap (codes, account numbers, serials, usernames, server settings).
const SETTER = {
  INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set,
  TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set,
};
function capitalizeFirst(e) {
  const el = e.target;
  if (!(el instanceof Element) || !el.closest('.acc-app')) return;   // never touch the rest of eHajiri
  const isInput = el instanceof HTMLInputElement;
  if (!isInput && !(el instanceof HTMLTextAreaElement)) return;
  if (isInput && !['text', ''].includes(el.type)) return;              // email, password, number, url, date …
  if (el.closest('[data-nocap]') || el.autocomplete === 'username') return;
  const v = el.value;
  const at = v.search(/\S/);
  if (at < 0) return;
  const up = v[at].toLocaleUpperCase();
  if (up === v[at] || /@|^\s*(https?:|www\.)/i.test(v)) return;
  const s = el.selectionStart; const en = el.selectionEnd;
  // native setter keeps React's change tracking intact, so onChange receives the capitalised text
  SETTER[el.tagName].call(el, v.slice(0, at) + up + v.slice(at + 1));
  try { el.setSelectionRange(s, en); } catch { /* ignore */ }
}

// ✕ close button on every pop-up form and entry form — does the same as Esc (the form's own close action).
const CLOSABLE = '.acc-app .modal > .card, .acc-app .entry-card';
function addCloseButtons(root = document) {
  root.querySelectorAll?.(CLOSABLE).forEach((card) => {
    if (card.querySelector(':scope > .x-close')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'x-close no-print';
    b.tabIndex = -1;
    b.title = 'Close (Esc)';
    b.setAttribute('aria-label', 'Close');
    b.textContent = '✕';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); top().close?.(); });
    card.appendChild(b);
  });
}

// The module's own shortcuts apply only while the Accounts screens are open and focus is inside them
// (or on the empty page body) — Enter / Esc / Ctrl+S elsewhere in eHajiri behave exactly as before.
const ownsEvent = (e) => !!document.querySelector('.acc-app')
  && (e.target === document.body || (e.target instanceof Element && !!e.target.closest('.acc-app')));

let installs = 0, cleanup = null;
export function installKeys() {
  installs++;
  if (installs === 1) {
    const mo = new MutationObserver(() => addCloseButtons());
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', capitalizeFirst, true);
    document.addEventListener('keydown', onKeyDown);
    cleanup = () => { mo.disconnect(); document.removeEventListener('input', capitalizeFirst, true); document.removeEventListener('keydown', onKeyDown); };
  }
  return () => { installs = Math.max(0, installs - 1); if (!installs && cleanup) { cleanup(); cleanup = null; } };
}

function onKeyDown(e) {
  if (!ownsEvent(e)) return;
  {
    const h = top();
    const k = e.key;
    const visible = (el) => el && el.offsetParent !== null;
    const modal = [...document.querySelectorAll('.acc-app .modal')].filter(visible).pop();
    // F1 or Alt+N (and Ctrl+N where the browser allows it): the page's "+ New / + Add" button
    // (Products → new product, Customers / Suppliers → new form pop-up). F1 never opens the browser's help.
    if (k === 'F1' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (modal) return;
      const btn = [...document.querySelectorAll('.acc-app [data-new]')].find(visible);
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if ((e.altKey || e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'n' && !modal) {
      const btn = [...document.querySelectorAll('.acc-app [data-new]')].find(visible);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); return; }
    }
    // Ctrl+F: jump to the page's search box (customer, ledger, product…) instead of the browser's find bar
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && k.toLowerCase() === 'f') {
      const scope = modal || document.querySelector('.acc-app');
      const box = [...scope.querySelectorAll('[data-find]')].find(visible);
      const input = box && (box.matches('input, textarea') ? box : box.querySelector('input'));
      if (input) { e.preventDefault(); input.focus(); input.select?.(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') {
      e.preventDefault();
      if (h.save) setTimeout(() => h.save(), 0);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'Delete') {
      if (h.del) { e.preventDefault(); h.del(); }
      return;
    }
    if (k === 'Escape') {
      if (!e.defaultPrevented && h.close) { e.preventDefault(); h.close(); }
      return;
    }
    // Drop boxes: ↑ / ↓ open the list, then ↑ ↓ move and Enter picks (the browser's own list handles that).
    // Skipped where a page uses the arrows itself (e.g. moving between rows of the product grid).
    if ((k === 'ArrowDown' || k === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.defaultPrevented
        && e.target instanceof HTMLSelectElement && !e.target.disabled && typeof e.target.showPicker === 'function') {
      try { e.target.showPicker(); e.preventDefault(); } catch { /* older browser: keep the normal arrow behaviour */ }
      return;
    }
    if (k === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t.closest('[data-enter="off"]')) return;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') {
        e.preventDefault();
        focusNext(t);
      }
    }
  }
}

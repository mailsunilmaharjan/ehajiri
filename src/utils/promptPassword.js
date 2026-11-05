// Small imperative password dialog (masked input) — resolves with the typed
// password, or null if cancelled. Used for sensitive-action re-authentication.
export function promptPassword(message = 'Enter your password to continue') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('form');
    box.style.cssText = 'background:#fff;border-radius:10px;padding:20px;width:min(360px,90vw);box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:inherit;';
    const label = document.createElement('div');
    label.textContent = message;
    label.style.cssText = 'font-size:14px;font-weight:600;color:#374151;margin-bottom:10px;';
    const input = document.createElement('input');
    input.type = 'password'; input.autocomplete = 'current-password';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:7px 14px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;';
    const ok = document.createElement('button');
    ok.type = 'submit'; ok.textContent = 'Confirm';
    ok.style.cssText = 'padding:7px 14px;border:0;background:#1a56db;color:#fff;border-radius:6px;cursor:pointer;';
    const done = (v) => { overlay.remove(); resolve(v); };
    cancel.onclick = () => done(null);
    box.onsubmit = (e) => { e.preventDefault(); done(input.value || null); };
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    row.append(cancel, ok); box.append(label, input, row); overlay.append(box);
    document.body.append(overlay); input.focus();
  });
}

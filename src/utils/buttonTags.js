/* Colour the Print / Export buttons the same way everywhere.
 *
 * Every page builds its own Print / Export buttons (mostly inline-styled), so CSS alone can't find them. This tags
 * any <button> whose text is a Print or Export label with a class — .btn-print / .btn-export — and ui-kit.css
 * gives those classes one look app-wide (Print = blue, Export = green). Runs on load and whenever the page changes.
 */
const PRINT_RE  = /^[^\p{L}\p{N}]*(print|प्रिन्ट)(?![\p{L}\p{M}\p{N}])/iu;   // "Print", not "Printer"
const EXPORT_RE = /^[^\p{L}\p{N}]*(export|excel|निर्यात|एक्सेल)/iu;

// "Advanced Search" pop-ups: each page builds its own (inline-styled), so they're tagged .adv-search-modal and
// ui-kit.css gives them the Staff Detail form look (grey header / white card of fields / grey footer).
const ADV_RE = /advanced? search|विस्तृत खोज/i;

function tag(root) {
  const buttons = root.querySelectorAll ? root.querySelectorAll('button:not(.btn-print):not(.btn-export)') : [];
  for (const b of buttons) {
    const text = (b.textContent || '').trim();
    if (!text || text.length > 40) continue;
    if (PRINT_RE.test(text)) b.classList.add('btn-print');
    else if (EXPORT_RE.test(text)) b.classList.add('btn-export');
  }
  const dialogs = root.querySelectorAll ? root.querySelectorAll('.modal-overlay > div:not(.adv-search-modal):not(.adv-checked)') : [];
  for (const d of dialogs) {
    const head = d.firstElementChild;
    if (d.children.length >= 3 && head && ADV_RE.test((head.textContent || '').slice(0, 200))) d.classList.add('adv-search-modal');
    else if (head) d.classList.add('adv-checked');     // not an Advanced Search pop-up — don't re-check it
  }
}

export function installButtonTags() {
  if (typeof document === 'undefined') return;
  let queued = false;
  const run = () => { queued = false; tag(document.body); };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  const start = () => {
    run();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}

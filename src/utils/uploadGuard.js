/* Upload safety — browser side.
   1) showUploadWarning(): a clear "this file was blocked" popup (used when the server refuses an upload).
   2) installUploadGuard(): checks every <input type="file"> the moment a file is picked and blocks
      programs / scripts / disguised files straight away, before they are even read by the app.
   The server (middleware/uploadGuard.js) is the real gatekeeper; this only gives instant feedback. */

const DANGEROUS_EXT = new Set([
  'exe','dll','com','bat','cmd','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','msi','msp','scr','pif','hta','cpl','jar',
  'jnlp','lnk','reg','inf','sys','drv','ocx','application','gadget','msc','py','pyw','rb','pl','sh','bash','php','phtml',
  'phar','asp','aspx','ashx','jsp','cgi','html','htm','xhtml','shtml','mht','mhtml','apk','ipa','dmg','iso','vhd','swf',
  'chm','appx','msix','scf','url','xll','wll','docm','xlsm','pptm','dotm','xltm','xlam','ppam','sldm','vb','elf','run',
  'deb','rpm','cab','rar','7z','tar','gz','tgz','bz2','xz','crx','xpi','sct','wsc',
]);

export function showUploadWarning(items, title = 'File blocked for your safety') {
  try {
    const old = document.getElementById('eh-upload-warning');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'eh-upload-warning';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'background:#b91c1c;color:#fff;padding:14px 18px;font-size:16px;font-weight:700;display:flex;gap:8px;align-items:center';
    head.textContent = '⛔ ' + title;
    const body = document.createElement('div');
    body.style.cssText = 'padding:16px 18px;font-size:13.5px;color:#374151;line-height:1.5';
    const intro = document.createElement('div');
    intro.textContent = 'This file looks unsafe (virus, spyware, hacking tool, program or script) or is not what it claims to be. It was NOT uploaded.';
    intro.style.cssText = 'margin-bottom:10px;font-weight:600;color:#991b1b';
    body.appendChild(intro);
    (items || []).slice(0, 8).forEach(it => {
      const row = document.createElement('div');
      row.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:7px 10px;margin-bottom:6px;word-break:break-word';
      const nm = document.createElement('b'); nm.textContent = (it.name || 'File') + ': ';
      row.appendChild(nm);
      row.appendChild(document.createTextNode(Array.isArray(it.reasons) ? it.reasons.join('; ') : String(it.reason || it.reasons || 'not allowed')));
      body.appendChild(row);
    });
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:10px;font-size:12px;color:#6b7280';
    hint.textContent = 'Only normal images (PNG, JPG, GIF, WEBP) and documents (PDF, Word, Excel) are allowed. If you think this is a mistake, contact your administrator.';
    body.appendChild(hint);
    const foot = document.createElement('div');
    foot.style.cssText = 'padding:10px 18px 16px;text-align:right';
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.style.cssText = 'background:#b91c1c;color:#fff;border:none;border-radius:6px;padding:8px 22px;font-weight:700;cursor:pointer';
    ok.onclick = () => wrap.remove();
    foot.appendChild(ok);
    box.append(head, body, foot);
    wrap.appendChild(box);
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  } catch { /* never let the warning itself break the app */ }
}

const asciiAt = (b, s, off = 0) => s.split('').every((ch, i) => b[off + i] === ch.charCodeAt(0));
function magicProblem(b, imageOnly) {
  if (!b || b.length < 2) return null;
  if (asciiAt(b, 'MZ')) return 'is a Windows program (.exe / .dll)';
  if (b[0] === 0x7f && asciiAt(b, 'ELF', 1)) return 'is a Linux program (ELF)';
  if (asciiAt(b, '#!')) return 'is a script file';
  if (asciiAt(b, 'Rar!') || (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc) || (b[0] === 0x1f && b[1] === 0x8b)) return 'is a compressed archive';
  if (b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe) return 'is a Java / macOS program';
  if (asciiAt(b, 'MSCF')) return 'is an installer archive';
  if (b[0] === 0x4c && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[4] === 1 && b[5] === 0x14) return 'is a Windows shortcut (.lnk)';
  if (imageOnly) {
    const isImg = (b[0] === 0x89 && asciiAt(b, 'PNG', 1)) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
      || asciiAt(b, 'GIF8') || (asciiAt(b, 'RIFF') && asciiAt(b, 'WEBP', 8)) || asciiAt(b, 'BM')
      || asciiAt(b, '<svg') || asciiAt(b, '<?xml') || (b[0] === 0 && b[1] === 0 && b[2] === 0)   // HEIC/AVIF ("ftyp" boxes)
      || (b.length > 8 && asciiAt(b, 'ftyp', 4));
    if (!isImg) return 'is not a real image file';
  }
  return null;
}

async function checkFile(file, imageOnly) {
  const name = String(file.name || '');
  const parts = name.toLowerCase().split('.').slice(1);
  const bad = parts.find(p => DANGEROUS_EXT.has(p.trim()));
  if (bad) return `file type ".${bad}" is not allowed`;
  let head;
  try { head = new Uint8Array(await file.slice(0, 16).arrayBuffer()); } catch { return null; }
  const p = magicProblem(head, imageOnly && !/\.svg$/i.test(name));
  return p ? p : null;
}

export function installUploadGuard() {
  if (typeof document === 'undefined' || window.__ehUploadGuard) return;
  window.__ehUploadGuard = true;
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
    if (input.__ehUploadOk) { input.__ehUploadOk = false; return; }   // our own re-dispatch
    const files = Array.from(input.files || []);
    if (!files.length) return;
    // Hold the event while the picked files are checked, then pass it on (or drop it).
    e.stopImmediatePropagation();
    const accept = String(input.accept || '').toLowerCase();
    const imageOnly = !!accept && accept.split(',').every(a => a.trim().startsWith('image/'));
    Promise.all(files.map(async f => ({ name: f.name, problem: await checkFile(f, imageOnly) })))
      .then(results => {
        const bad = results.filter(r => r.problem);
        if (!bad.length) { input.__ehUploadOk = true; input.dispatchEvent(new Event('change', { bubbles: true })); return; }
        try { input.value = ''; } catch { /* ignore */ }
        showUploadWarning(bad.map(b => ({ name: b.name, reasons: [b.problem] })));
      })
      .catch(() => { input.__ehUploadOk = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  }, true);
}

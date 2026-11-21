/*
 * In-app viewer for PDFs and pictures from the server (quotations, previews, payment vouchers, transport bills).
 *
 * Why: Chrome hands PDF tabs to the Adobe Acrobat extension, which re-downloads the link without our session
 * (blank page) and can't read blob: / file: URLs unless allowed. Here the file is fetched with the session and
 * PDF pages are drawn with PDF.js (bundled, works offline), so nothing depends on the browser's PDF handler.
 * Print and Download work from the viewer.
 *
 *   openPdf(url, title)  — from anywhere (lib/api.js); <FileViewerHost /> is mounted once in the app shell.
 */
import { useEffect, useRef, useState } from 'react';
import { useShortcuts } from '../lib/keys';
import { authFetch } from '../lib/api';
import { Kbd } from './inputs';

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.js?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

export function FileViewerHost() {
  const [file, setFile] = useState(null);
  useEffect(() => {
    const on = (e) => setFile({ ...e.detail, key: Date.now() });
    window.addEventListener('ehl:open-file', on);
    return () => window.removeEventListener('ehl:open-file', on);
  }, []);
  return file ? <FileViewer key={file.key} url={file.url} title={file.title} onClose={() => setFile(null)} /> : null;
}

function FileViewer({ url, title, onClose }) {
  const [state, setState] = useState({ busy: true, err: '', kind: '', name: '', pages: 0, done: 0 });
  const [zoom, setZoom] = useState(1);
  const pagesRef = useRef(null);
  const blobRef = useRef(null);
  const docRef = useRef(null);
  const imgUrl = useRef('');

  // fetch once (with the session cookie)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await authFetch(url);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Could not open the file (${res.status}).`);
        }
        const blob = await res.blob();
        const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1]
          || decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');
        if (dead) return;
        blobRef.current = blob;
        if ((blob.type || '').startsWith('image/')) {
          imgUrl.current = URL.createObjectURL(blob);
          setState({ busy: false, err: '', kind: 'img', name, pages: 1, done: 1 });
          return;
        }
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        if (dead) { doc.destroy(); return; }
        docRef.current = doc;
        setState({ busy: false, err: '', kind: 'pdf', name, pages: doc.numPages, done: 0 });
      } catch (e) {
        if (!dead) setState((s) => ({ ...s, busy: false, err: e.message || 'Could not open the file.' }));
      }
    })();
    return () => {
      dead = true;
      docRef.current?.destroy();
      if (imgUrl.current) URL.revokeObjectURL(imgUrl.current);
    };
  }, [url]);

  // draw the PDF pages (again when zoom changes), one after another so the first page shows quickly
  useEffect(() => {
    const doc = docRef.current;
    const box = pagesRef.current;
    if (state.kind !== 'pdf' || !doc || !box) return undefined;
    let dead = false;
    box.innerHTML = '';
    (async () => {
      const width = Math.min(box.clientWidth - 32, 1000) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages && !dead; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width / base.width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = `${vp.width / dpr}px`;
        canvas.className = 'fv-page';
        box.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (!dead) setState((s) => ({ ...s, done: i }));
      }
    })().catch((e) => !dead && setState((s) => ({ ...s, err: e.message })));
    return () => { dead = true; };
  }, [state.kind, zoom]);

  const download = () => {
    if (!blobRef.current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blobRef.current); a.download = state.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  /** Print the drawn pages (pictures) from a hidden frame — no PDF plug-in needed. */
  const print = () => {
    const srcs = state.kind === 'img' ? [imgUrl.current] : [...pagesRef.current.querySelectorAll('canvas')].map((c) => c.toDataURL('image/png'));
    if (!srcs.length) return;
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    w.document.write(`<!doctype html><html><head><title>${state.name}</title><style>
      @page { margin: 0; } html, body { margin: 0; } img { display: block; width: 100%; page-break-after: always; break-after: page; }
      img:last-child { page-break-after: auto; break-after: auto; }</style></head><body>${srcs.map((s) => `<img src="${s}">`).join('')}</body></html>`);
    w.document.close();
    const go = () => { w.focus(); w.print(); setTimeout(() => fr.remove(), 1000); };
    const imgs = [...w.document.images];
    Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(go);
  };

  useShortcuts({ close: onClose });
  const ready = !state.busy && !state.err && (state.kind === 'img' || state.done === state.pages);

  return (
    <div className="modal fv-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card fv-card">
        <div className="fv-bar">
          <b className="fv-title" title={state.name}>📄 {title || state.name || 'File'}</b>
          {state.kind === 'pdf' && <span className="muted small">{state.done < state.pages ? `Page ${state.done}/${state.pages}…` : `${state.pages} page${state.pages > 1 ? 's' : ''}`}</span>}
          <span className="spacer" />
          {state.kind === 'pdf' && <>
            <button type="button" className="ghost btn-sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Smaller">−</button>
            <span className="small fv-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" className="ghost btn-sm" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} title="Bigger">＋</button>
          </>}
          <button type="button" className="ghost btn-sm" disabled={!ready} onClick={print}>🖨 Print</button>
          <button type="button" className="ghost btn-sm" disabled={!blobRef.current} onClick={download}>⬇ Download</button>
          <button type="button" className="btn-sm" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
        </div>
        <div className="fv-body">
          {state.busy && <div className="fv-msg">Opening…</div>}
          {state.err && <div className="fv-msg neg">{state.err}</div>}
          {state.kind === 'img' && <img className="fv-img" src={imgUrl.current} alt={state.name} />}
          <div ref={pagesRef} className="fv-pages" />
        </div>
      </div>
    </div>
  );
}

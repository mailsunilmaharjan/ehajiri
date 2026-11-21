import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A scroll box that is exactly as tall as the screen allows (same idea as the DataGrid's fit-to-screen): it measures where it starts,
 * leaves room for anything that sits under it (a legend, a footer note) and scrolls inside itself — so a long report table keeps its
 * header frozen and ends ~4px above the bottom of the window at any monitor resolution, instead of scrolling the whole page.
 * Use it as the wrapper around a report <table>:  <FitScroll style={{ border: '1px solid #dedede', borderRadius: 8 }}><table>…</table></FitScroll>
 * A table shorter than the room simply keeps its natural height (maxHeight, not height).
 */
export default function FitScroll({ style, className = '', gap = 4, children }) {
  const ref = useRef(null);
  const [h, setH] = useState(null);
  useLayoutEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      let below = 0;
      for (let n = el; n && n !== document.body && !n.classList?.contains('page-container'); n = n.parentElement) {
        for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
          const cs = getComputedStyle(s);
          if (cs.position === 'fixed' || cs.position === 'absolute' || cs.display === 'none') continue;
          below += s.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
        }
        below += (parseFloat(getComputedStyle(n).marginBottom) || 0);
        if (n !== el) below += parseFloat(getComputedStyle(n).paddingBottom) || 0;
      }
      setH(Math.round(Math.max(240, window.innerHeight - gap - top - below)));
    };
    calc();
    window.addEventListener('resize', calc);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calc) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener('resize', calc); ro?.disconnect(); };
  }, [gap]);
  return (
    <div ref={ref} className={`fit-scroll ${className}`.trim()} style={{ ...style, maxHeight: h || undefined, overflow: 'auto' }}>
      {children}
    </div>
  );
}

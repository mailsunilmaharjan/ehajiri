import { useLayoutEffect, useState } from 'react';

const GAP = 4;   // px left between the card and the bottom of the screen

/**
 * Blank striped rows + a remarks box so a grid reaches exactly the bottom of the screen (any resolution).
 * It measures where the card really ends and grows / shrinks the filler to match, so no gap is left
 * above the Windows taskbar. Returns { fill: number of blank rows, remH: remarks box height in px }.
 */
export function useFillRows(gridRef, deps, minRem = 62) {
  const [fill, setFill] = useState(0);
  const [remH, setRemH] = useState(minRem);
  useLayoutEffect(() => {
    const calc = () => {
      const t = gridRef.current;
      const card = t?.closest('.card');
      if (!t || !card) return;
      const body = t.tBodies[0];
      const blanks = [...body.querySelectorAll(':scope > tr.blank')];
      const rem = body.querySelector(':scope > tr.remarks-row');
      const real = [...body.rows].filter((r) => !r.classList.contains('blank') && !r.classList.contains('remarks-row'));
      // height of one blank row: a real blank row if there is one, else the shortest data row
      const rowH = blanks[0]?.offsetHeight || Math.min(36, ...real.map((r) => r.offsetHeight).filter(Boolean)) || 31;
      const filler = blanks.reduce((s, r) => s + r.offsetHeight, 0) + (rem?.offsetHeight || 0);
      const cardBottom = card.getBoundingClientRect().bottom + window.scrollY + (parseFloat(getComputedStyle(card).marginBottom) || 0);
      const space = filler + (window.innerHeight - GAP - cardBottom);   // what the filler should measure
      // the remarks box can't be smaller than the text inside it
      const td = rem?.cells[0];
      const pad = td ? parseFloat(getComputedStyle(td).paddingTop) + parseFloat(getComputedStyle(td).paddingBottom) + 1 : 0;
      const need = Math.max(minRem, Math.ceil((td?.firstElementChild?.offsetHeight || 0) + pad));
      const n = Math.max(0, Math.floor((space - need) / rowH));
      setFill(n);
      setRemH(Math.max(need, Math.floor(space - n * rowH)));
    };
    calc();
    // measure again whenever the grid changes size (remarks text grows, rows load, fonts arrive…);
    // calc is exact from real heights, so the second pass settles and stops
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(calc); };
    const ro = typeof ResizeObserver !== 'undefined' && gridRef.current ? new ResizeObserver(again) : null;
    ro?.observe(gridRef.current);
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('resize', calc); ro?.disconnect(); cancelAnimationFrame(raf); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { fill, remH };
}
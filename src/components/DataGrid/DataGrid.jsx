import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import './DataGrid.css';
import { useLanguage } from '../../context/LanguageContext.jsx';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';

/* A click / key inside an editable cell (input, select, textarea…) must not move focus to the grid
   or trigger row navigation — otherwise the cell loses focus and can't be typed in. */
const isEditable = (el) => !!el?.closest?.('input, select, textarea, [contenteditable="true"]');

const DataGrid = ({
  columns = [],
  data = [],
  loading = false,            // true = show the branded loading state instead of rows (grid chrome/header stays put)
  defaultPageSize = 10,
  pageSizeOptions = [5, 10, 25, 50, 100],
  showSearch = true,
  searchPlaceholder = null,   // null = use language-aware default
  title = '',
  toolbar = null,
  toolbarLeft = null,
  onRowClick = null,
  onRowDoubleClick = null,
  onFocusChange = null,       // (row) => void — fires as ArrowUp/ArrowDown moves the keyboard-focus highlight, live (no Enter needed)
  onDeleteKey = null,
  striped = true,
  compact = false,
  ultraCompact = false,       // set true for ~half-height rows (e.g. dense command/log tables)
  rowKey = 'id',
  onDeleteSelected = null,
  onSelectionChange = null,   // (selectedKeys: any[]) => void  — called whenever selection changes
  showCheckbox     = true,    // set false to hide selection checkboxes
  autoWidth        = false,   // set true to auto-fit column widths to content
  showFilterButton = true,    // set false to hide the column-filter toggle button
  filterButtonLabel = null,   // override label; null = default "Filter" / "फिल्टर"
  selectionActions = null,    // extra buttons rendered in the selection bar
  contextMenu = null,         // [{ label: string|(row)=>string, icon, onClick(row), className?, visible?(row), disabled?(row), title? }] — shown on right-click
  searchOnlyExtraFields = false, // true = global search looks ONLY at extraSearchFields, not the columns
  extraSearchFields = [],     // extra row fields to include in global search (not shown as columns)
  className = '',             // extra class on the outer container, for scoping one-off style overrides
  showFooter = true,          // set false to hide the pagination/info footer (e.g. small fixed-size reports)
  initialSelected = [],       // seeds the checkbox selection once on mount (e.g. a caller pre-checking rows before this grid ever renders) — uncontrolled after that, same as selectedRows always has been
  groupBy = null,             // (row) => groupKey — when set, rows render under merged full-width section headers instead of flat/paginated (e.g. Task's date-bucket sections)
  groupOrder = null,          // [groupKey, ...] display order for sections; a key with no matching rows still renders its header. Defaults to first-seen order when omitted
  groupLabel = null,          // (groupKey, rowCount) => ReactNode — section header content; defaults to the raw key
  totalsRow = null,           // { [field]: node } — a totals row pinned at the bottom of the table (sticky), each value under its own column; fields not listed stay blank
  footerLeft = null,          // extra content on the footer's left side (e.g. a selected-row preview strip) — pushes the Total/pagination info to the right instead of leaving it alone on the left
  fillToBottom,               // undefined (default) = automatic: a full-page grid sizes itself to the screen — it gets exactly the height left under it, scrolls its body inside (sticky header), shows blank ruled rows when there are few records, and keeps the paging bar visible. true = always, false = never (the grid ends after its last row)
  remarks = null,             // (row) => node — with fillToBottom: a details/remarks strip pinned at the bottom of the grid showing the focused (or first) row; its height takes whatever space is left under the blank rows, so it adapts to any screen
  remarksMin = 62,            // px — the strip never gets smaller than this (or than its own text)
  fillGap = 4,                // px kept free under a fillToBottom grid — just a hair, so the grid's bottom border sits right at the edge of the screen
  toolbarRightInset = 0,      // px — shifts the search/filter/toolbar block left so a fixed-position side panel (e.g. a detail drawer) doesn't cover it
}) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRows, setSelectedRows] = useState(initialSelected);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [focusedRowIdx, setFocusedRowIdx] = useState(-1);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, row }
  const scrollRef = useRef(null);
  const rootRef = useRef(null);
  const [autoFill, setAutoFill] = useState(false);   // automatic fit-to-screen decided on mount (see below)
  const restRef = useRef(0);
  const [boxH, setBoxH] = useState(null);             // px height given to the whole grid in fit-to-screen mode
  const [blankRows, setBlankRows] = useState(0);
  const [restH, setRestH] = useState(0);              // px left over under the last whole blank row (< 1 row): given to the remarks strip / footer so blank rows keep the SAME height as data rows
  const searchRef = useRef(null);
  const ctxRef = useRef(null);

  /* Close context menu on outside click or Escape */
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null);
    };
    const closeKey = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', closeKey); };
  }, [ctxMenu]);

  const placeholder = searchPlaceholder ?? L('खोज्नुस...', 'Search...');
  const hasFillColumn = columns.some(c => c.fill);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleFilter = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setCurrentPage(1);
  };

  const handleSelectAll = (checked) => {
    // pageData already IS "everything currently on screen" — the current page's
    // slice normally, or every grouped row when groupBy is set (see below).
    const next = checked ? pageData.map(r => r[rowKey]) : [];
    setSelectedRows(next);
    if (onSelectionChange) onSelectionChange(next);
  };

  const handleSelectRow = (key, checked) => {
    setSelectedRows(prev => {
      const next = checked ? [...prev, key] : prev.filter(k => k !== key);
      if (onSelectionChange) onSelectionChange(next);
      return next;
    });
  };

  const processed = useMemo(() => {
    let result = [...data];
    if (globalSearch) {
      // Split on whitespace so each word can match anywhere across the row
      // (any column, any order) instead of requiring the whole typed string —
      // spaces included — to appear together inside one single field. Lets
      // "John Doe" find a row whose name is "John Karki" and whose
      // organization is "Doe Traders", not just a field literally containing
      // "John Doe" as one contiguous substring.
      const terms = globalSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
      result = result.filter(row => {
        const rowText = (searchOnlyExtraFields ? [] : columns
          .filter(col => col.filterable !== false && col.field !== 'actions'))
          .map(col => row[col.field])
          .concat(extraSearchFields.map(field => row[field]))
          .filter(v => v != null)
          .map(v => String(v).toLowerCase())
          .join('  ');
        return terms.every(term => rowText.includes(term));
      });
    }
    Object.entries(filters).forEach(([field, val]) => {
      if (val) result = result.filter(row => {
        const v = row[field];
        return v != null && String(v).toLowerCase().includes(val.toLowerCase());
      });
    });
    if (sortField) {
      result = [...result].sort((a, b) => {
        const av = a[sortField], bv = b[sortField];
        if (av == null) return 1; if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [data, globalSearch, filters, sortField, sortDir, extraSearchFields, searchOnlyExtraFields]);

  const processedData = processed;
  const isGrouped = typeof groupBy === 'function';

  // Bucket processedData into ordered sections (Today / Tomorrow / ... for the
  // Task grid). Sections appear in groupOrder even with zero matching rows, so
  // e.g. "nothing due tomorrow" is still visible rather than silently absent.
  let groupSections = null;
  if (isGrouped) {
    const byGroup = new Map();
    processedData.forEach(row => {
      const key = groupBy(row);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(row);
    });
    const orderedKeys = (groupOrder && groupOrder.length) ? groupOrder : Array.from(byGroup.keys());
    groupSections = orderedKeys.map(key => ({ key, rows: byGroup.get(key) || [] }));
  }

  // Grouped view shows every matching row across all sections at once — paging
  // a date-bucketed planner sheet mid-section would split a section across pages.
  const totalPages = isGrouped ? 1 : Math.max(1, Math.ceil(processedData.length / pageSize));
  const startIdx = isGrouped ? 0 : (currentPage - 1) * pageSize;
  const pageData = isGrouped ? groupSections.flatMap(s => s.rows) : processedData.slice(startIdx, startIdx + pageSize);

  useEffect(() => { setFocusedRowIdx(-1); }, [currentPage, pageSize, globalSearch, sortField, sortDir]);
  useEffect(() => { if (showSearch) searchRef.current?.focus(); }, []);

  const handleKeyDown = (e) => {
    if (isEditable(e.target)) return;          // typing in a cell input — leave the keys to the input
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedRowIdx(prev => {
        const next = Math.min(prev + 1, pageData.length - 1);
        const idx = next < 0 ? 0 : next;
        if (onFocusChange && pageData[idx]) onFocusChange(pageData[idx]);
        return idx;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedRowIdx(prev => {
        const idx = Math.max(prev - 1, 0);
        if (onFocusChange && pageData[idx]) onFocusChange(pageData[idx]);
        return idx;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = focusedRowIdx >= 0 ? focusedRowIdx : 0;
      if (pageData[idx]) {
        if (onRowDoubleClick) onRowDoubleClick(pageData[idx]);
        else if (onRowClick)  onRowClick(pageData[idx]);
      }
    } else if (e.key === 'Delete' && onDeleteKey) {
      e.preventDefault();
      if (selectedRows.length > 0) setBulkDeleteConfirm(true);
      else { const idx = focusedRowIdx >= 0 ? focusedRowIdx : 0; if (pageData[idx]) onDeleteKey(pageData[idx]); }
    }
  };

  const pageNumbers = useMemo(() => {
    const arr = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) arr.push(i); }
    else {
      arr.push(1);
      if (currentPage > 3) arr.push('...');
      for (let i = Math.max(2, currentPage-1); i <= Math.min(totalPages-1, currentPage+1); i++) arr.push(i);
      if (currentPage < totalPages - 2) arr.push('...');
      arr.push(totalPages);
    }
    return arr;
  }, [totalPages, currentPage]);

  const allSelected = pageData.length > 0 && pageData.every(r => selectedRows.includes(r[rowKey]));
  const someSelected = pageData.some(r => selectedRows.includes(r[rowKey]));

  const maxSN = processedData.length;
  const snDigits = String(maxSN).length;
  const snWidth = Math.max(32, snDigits * 10 + 22);

  const hasToolbar = title || toolbarLeft || showSearch || showFilterButton || toolbar;
  const totalCols = (showCheckbox ? 1 : 0) + 1 /* SN */ + columns.length;

  const renderRow = (row, ri, sn) => (
    <tr
      key={row[rowKey] ?? ri}
      className={`dg-row ${(onRowClick || onRowDoubleClick) ? 'clickable' : ''} ${selectedRows.includes(row[rowKey]) ? 'selected' : ''} ${focusedRowIdx === ri ? 'kb-focus' : ''}`}
      ref={el => { if (focusedRowIdx === ri && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }}
      onClick={(e) => { setFocusedRowIdx(ri); if (!isEditable(e.target)) scrollRef.current?.focus(); if (onRowClick) onRowClick(row); }}
      onDoubleClick={() => {
        if (onRowDoubleClick) onRowDoubleClick(row);
        else if (onRowClick)  onRowClick(row);
      }}
      onContextMenu={contextMenu ? (e) => {
        e.preventDefault();
        setFocusedRowIdx(ri);
        setCtxMenu({ x: e.clientX, y: e.clientY, row });
      } : undefined}
    >
      {showCheckbox && (
        <td className="dg-td dg-checkbox-col" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedRows.includes(row[rowKey])}
            onChange={e => handleSelectRow(row[rowKey], e.target.checked)}
            className="dg-checkbox"
          />
        </td>
      )}
      <td className="dg-td dg-sn-col" style={{ width: snWidth, minWidth: snWidth }}>{sn}</td>
      {columns.map((col, ci) => (
        <td
          key={ci}
          className={`dg-td${ci === 0 && col.field !== 'actions' ? ' dg-first-col' : ''}`}
          style={{ textAlign: col.align || 'left', whiteSpace: (autoWidth && !col.wrap) ? 'nowrap' : undefined }}
        >
          {col.render
            ? col.render(row[col.field], row)
            : (row[col.field] != null && row[col.field] !== '' ? row[col.field] : <span className="dg-null">—</span>)}
        </td>
      ))}
    </tr>
  );

  /* ── Fit to the screen ─────────────────────────────────────────────────────────────────────────────
     The grid is given exactly the height that is left between its top edge and the bottom of the window
     (minus anything that sits under it on the page, e.g. a legend), so it adapts to any monitor resolution:
       • few records  → blank ruled rows fill the space (same look as Staff Detail / the Accounts lists)
       • many records → the body scrolls inside the grid (sticky header) and the paging bar stays on screen.
     Automatic for full-page grids; grids in dialogs / side panels, several grids on one page, grouped grids
     and phones keep the old natural-height behaviour. Pass fillToBottom={true|false} to force either way. */
  useLayoutEffect(() => {
    if (fillToBottom !== undefined) return;
    const root = rootRef.current;
    if (!root) return;
    const inPopup = root.closest('.modal, .modal-overlay, .modal-drawer, [role="dialog"], .dg-fixed-height, .acc-app, .zk-biometric-grid');
    const page = root.closest('.page-container') || root.closest('main');
    const grids = page ? page.querySelectorAll('.dg-container').length : 0;
    const top = root.getBoundingClientRect().top;
    setAutoFill(!inPopup && !!page && grids === 1 && !isGrouped && window.innerWidth >= 768 && top < window.innerHeight * 0.7);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const fill = fillToBottom === undefined ? autoFill : !!fillToBottom;

  // (a) the height of the whole grid
  useLayoutEffect(() => {
    if (!fill) { setBoxH(null); setBlankRows(0); setRestH(0); return undefined; }
    const calcBox = () => {
      const root = rootRef.current;
      if (!root) return;
      const top = root.getBoundingClientRect().top + window.scrollY;
      let below = 0;                                   // everything that sits under the grid on the page must stay visible
      for (let el = root; el && el !== document.body && el.tagName !== 'MAIN' && !el.classList?.contains('page-container'); el = el.parentElement) {
        for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
          const cs = getComputedStyle(sib);
          if (cs.position === 'fixed' || cs.position === 'absolute' || cs.display === 'none') continue;
          below += sib.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
        }
        const ecs = getComputedStyle(el);
        below += parseFloat(ecs.marginBottom) || 0;
        if (el !== root) below += (parseFloat(ecs.paddingBottom) || 0) + (parseFloat(ecs.borderBottomWidth) || 0);   // a card around the grid has its own bottom padding / border
      }
      setBoxH(Math.round(Math.max(300, window.innerHeight - fillGap - top - below)));
    };
    calcBox();
    window.addEventListener('resize', calcBox);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calcBox) : null;
    ro?.observe(document.body);                         // a toolbar that wraps / a banner that appears above moves the grid's top
    return () => { window.removeEventListener('resize', calcBox); ro?.disconnect(); };
  }, [fill, fillGap, pageData.length === 0]);          // eslint-disable-line react-hooks/exhaustive-deps

  // (b) how many blank rows fit inside it (measured from real heights — exact at any resolution)
  useLayoutEffect(() => {
    if (!fill || boxH === null) return undefined;
    const wrap = scrollRef.current;
    if (!wrap) return undefined;
    const calcBlanks = () => {
      const body = wrap.querySelector('tbody');
      const head = wrap.querySelector('thead');
      if (!body) return;
      const others = [...body.rows].filter((r) => !r.classList.contains('dg-blank-row'));
      const foot = wrap.querySelector('tfoot');
      const used = (head?.offsetHeight || 0) + (foot?.offsetHeight || 0) + others.reduce((a2, r) => a2 + r.offsetHeight, 0);
      // real (sub-pixel) height of one blank filler row — they are no longer stretched, so measuring them is stable; before the first blank row exists use a data row
      const rowH = body.querySelector('tr.dg-blank-row')?.getBoundingClientRect().height || body.querySelector('tr.dg-row')?.getBoundingClientRect().height || 30;
      // clientHeight already shrank by the extra (restH) the strip/footer took last time — add it back so the result is stable, not oscillating
      const free = wrap.clientHeight + restRef.current - used;
      if (loading || pageData.length === 0 || free <= 0) { restRef.current = 0; setBlankRows(0); setRestH(0); return; }
      const n = Math.min(300, Math.floor(free / rowH));
      const rest = Math.max(0, Math.floor(free - n * rowH));
      restRef.current = rest;
      setBlankRows(n);
      setRestH(rest);
    };
    calcBlanks();
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(calcBlanks); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null;
    ro?.observe(wrap);                                  // the remarks strip / toolbar / footer growing shrinks the body area
    return () => { ro?.disconnect(); cancelAnimationFrame(raf); };
  }, [fill, boxH, pageData.length, loading, !!remarks, pageSize, currentPage]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={rootRef} className={`dg-container${fill ? ' dg-fill' : ''}${fill && restH > 0 ? ' dg-has-rest' : ''}${className ? ' ' + className : ''}`}
      style={fill && boxH ? { height: boxH } : undefined}>
      {/* Toolbar */}
      {hasToolbar && (
      <div className="dg-toolbar">
        {(title || toolbarLeft) && <div className="dg-toolbar-left">{title && <div className="dg-title">{title}</div>}{toolbarLeft}</div>}
        <div className="dg-toolbar-right" style={toolbarRightInset ? { marginRight: toolbarRightInset } : undefined}>
          {showSearch && (
            <div className="dg-searchbox">
              <svg className="dg-search-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input
                ref={searchRef}
                type="text"
                className="dg-search-input"
                placeholder={placeholder}
                value={globalSearch}
                onChange={e => { setGlobalSearch(e.target.value); setCurrentPage(1); }}
              />
              {globalSearch && (
                <button className="dg-search-clear" onClick={() => { setGlobalSearch(''); setCurrentPage(1); }}>✕</button>
              )}
            </div>
          )}
          {showFilterButton && (
            <button
              className={`dg-filter-btn ${showFilters ? 'active' : ''}`}
              onClick={() => setShowFilters(p => !p)}
              title={filterButtonLabel || L('स्तम्भ फिल्टर', 'Column Filter')}
            >
              {filterButtonLabel ? (
                <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                  <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                </svg>
              )}
              {filterButtonLabel || L('फिल्टर', 'Filter')}
            </button>
          )}
          {toolbar}
        </div>
      </div>
      )}

      {/* Selection info bar */}
      {selectedRows.length > 0 && (
        <div className="dg-selection-bar">
          <span>✔ {selectedRows.length} {L('पङ्क्ति छानिएको', 'row(s) selected')}</span>
          <button onClick={() => setSelectedRows([])}>✕ {L('खाली गर्नुस', 'Clear')}</button>
          {selectionActions}
          {onDeleteSelected && (
            <button className="dg-delete-all-btn" onClick={() => setBulkDeleteConfirm(true)}>
              🗑 {L('छानिएको मेटाउनुस', 'Delete Selected')}
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div
        className="dg-scroll-wrapper"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={(e) => { if (!isEditable(e.target)) scrollRef.current?.focus(); }}
        style={{ outline: 'none', cursor: 'default' }}
      >
        <table className={`dg-table ${striped ? 'striped' : ''} ${compact ? 'compact' : ''} ${ultraCompact ? 'ultra-compact' : ''} ${autoWidth ? 'auto-width' : ''}`}
          style={ autoWidth
            // A fill column's width:'100%' hint (below) is only meaningful
            // relative to a table with a DEFINITE width — against the
            // .auto-width class's own width:auto (size-to-content), it reads
            // instead as "claim 100% of the container on top of whatever the
            // other columns already need", which is what was overflowing the
            // table past its container and forcing a horizontal scrollbar.
            // minWidth (same 600px floor the non-auto-width table always
            // has, see .dg-table in DataGrid.css) keeps the OTHER, fixed/
            // nowrap columns from being squeezed illegibly on a narrow
            // screen once the fill column is pushing the table to fill
            // 100% width — below that floor .dg-scroll-wrapper's own
            // overflow-x:auto takes over and shows a horizontal scrollbar
            // instead of squashing every column.
            ? (hasFillColumn ? { tableLayout:'auto', width:'100%', minWidth:600 } : { tableLayout:'auto' })
            : {}
          }>
          <thead>
            <tr className="dg-header-row">
              {showCheckbox && (
                <th className="dg-th dg-checkbox-col">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={e => handleSelectAll(e.target.checked)}
                    className="dg-checkbox"
                  />
                </th>
              )}
              <th className="dg-th dg-sn-col" style={ autoWidth ? {} : { width: snWidth, minWidth: snWidth }}>SN</th>
              {columns.map((col, i) => (
                <th
                  key={col.field || i}
                  className={`dg-th ${col.sortable !== false && col.field !== 'actions' ? 'sortable' : ''} ${sortField === col.field ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}`}
                  style={ autoWidth
                    ? { textAlign: col.align || 'left', whiteSpace:'nowrap',
                        width: col.fill ? '100%' : (col.wrap ? (col.width || undefined) : '1px') }
                    : { width: col.width, minWidth: col.minWidth || 80, textAlign: col.align || 'left' }
                  }
                  onClick={() => col.sortable !== false && col.field !== 'actions' && handleSort(col.field)}
                >
                  <div className="dg-th-inner">
                    <span>{col.header}</span>
                  </div>
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr className="dg-filter-row">
                <th className="dg-filter-cell"></th>
                <th className="dg-filter-cell"></th>
                {columns.map((col, i) => (
                  <th key={`f-${i}`} className="dg-filter-cell">
                    {col.filterable !== false && col.field !== 'actions' && (
                      <input
                        type="text"
                        className="dg-filter-input"
                        placeholder="…"
                        value={filters[col.field] || ''}
                        onChange={e => handleFilter(col.field, e.target.value)}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={totalCols} style={{ border: 'none', padding: 0 }}>
                  <LoadingIndicator />
                </td>
              </tr>
            ) : isGrouped ? (() => {
              let flatIdx = -1; // keeps incrementing across sections — matches pageData's flattened order (keyboard nav)
              return groupSections.map(({ key, rows }) => (
                <React.Fragment key={`dg-grp-${key}`}>
                  <tr className={`dg-group-row dg-group-row-${String(key).replace(/[^a-zA-Z0-9_-]/g, '')}`}>
                    <td colSpan={totalCols} className="dg-group-cell">
                      {groupLabel ? groupLabel(key, rows.length) : key}
                    </td>
                  </tr>
                  {rows.length === 0 ? (
                    <tr className="dg-group-row-empty">
                      <td colSpan={totalCols} className="dg-group-empty-cell">{L('कुनै कार्य छैन', 'No tasks')}</td>
                    </tr>
                  ) : rows.map((row, gi) => { flatIdx++; return renderRow(row, flatIdx, gi + 1); })}
                </React.Fragment>
              ));
            })() : pageData.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="dg-empty">
                  <div className="dg-empty-content">
                    <div className="dg-empty-icon">📋</div>
                    <div className="dg-empty-text">{L('कुनै डाटा फेला परेन', 'No data found')}</div>
                  </div>
                </td>
              </tr>
            ) : (
              pageData.map((row, ri) => renderRow(row, ri, startIdx + ri + 1))
            )}
            {fill && !loading && !isGrouped && pageData.length > 0 && Array.from({ length: blankRows }, (_, i) => (
              <tr key={`dg-blank-${i}`} className="dg-blank-row" aria-hidden="true">
                {Array.from({ length: totalCols }, (__, c) => <td key={c} className={`dg-td dg-blank-td${c < (showCheckbox ? 1 : 0) + 1 ? ' dg-blank-lead' : ''}`}>&nbsp;</td>)}
              </tr>
            ))}
          </tbody>
          {totalsRow && !loading && pageData.length > 0 && (
            <tfoot className="dg-total-foot">
              <tr className="dg-total-row">
                {showCheckbox && <td className="dg-td dg-total-td" />}
                <td className="dg-td dg-total-td dg-sn-col" style={{ width: snWidth, minWidth: snWidth }} />
                {columns.map((col, ci) => (
                  <td key={ci} className="dg-td dg-total-td"
                    style={{ textAlign: col.align || 'left', whiteSpace: 'nowrap' }}>
                    {totalsRow[col.field] ?? ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {fill && restH > 0 && <div className="dg-fill-rest" style={{ height: restH }} aria-hidden="true" />}

      {fill && remarks && (() => {
        const cur = pageData[Math.max(0, focusedRowIdx)] || pageData[0];
        return (
          <div className="dg-remarks-strip" style={{ minHeight: remarksMin }}>
            <div className="dg-remarks-inner">{cur ? remarks(cur) : null}</div>
          </div>
        );
      })()}

      {/* Bulk Delete Confirmation */}
      {bulkDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: 'linear-gradient(135deg,#fff5f5,#fef2f2)' }}>
              <h2>⚠️ {L('मेटाउने पुष्टि', 'Delete Confirmation')}</h2>
              <button className="modal-close" onClick={() => setBulkDeleteConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>
                {L('के तपाईं', 'Are you sure you want to delete')}{' '}
                <strong style={{ color: '#dc2626' }}>{selectedRows.length} {L('छानिएका रेकर्ड', 'selected record(s)')}</strong>
                {L(' मेटाउन चाहनुहुन्छ?', '?')}
              </p>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                ⚠️ {L('डिफल्ट / सिस्टम रेकर्डहरू स्वतः छोडिनेछन्।', 'Default / system records will be skipped automatically.')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setBulkDeleteConfirm(false)}>{L('रद्द', 'Cancel')}</button>
              <button className="btn btn-danger" onClick={() => {
                onDeleteSelected(selectedRows);
                setSelectedRows([]);
                setBulkDeleteConfirm(false);
              }}>🗑 {L('सबै मेटाउनुस', 'Delete All')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && contextMenu && (
        <div
          ref={ctxRef}
          className="dg-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          {contextMenu
            // an item may carry visible(row) / disabled(row); dividers left stranded at the ends or doubled up are dropped
            .filter((item) => item === 'divider' || !item.visible || item.visible(ctxMenu.row))
            .filter((item, i, arr) => item !== 'divider' || (i > 0 && i < arr.length - 1 && arr[i - 1] !== 'divider'))
            .map((item, i) => (
            item === 'divider'
              ? <div key={i} className="dg-ctx-divider" />
              : (
                <button
                  key={i}
                  className={`dg-ctx-item ${item.className || ''}`}
                  disabled={!!(item.disabled && item.disabled(ctxMenu.row))}
                  title={item.title ? (typeof item.title === 'function' ? item.title(ctxMenu.row) : item.title) : undefined}
                  onClick={() => { setCtxMenu(null); item.onClick(ctxMenu.row); }}
                >
                  {item.icon && <span className="dg-ctx-icon">{item.icon}</span>}
                  {typeof item.label === 'function' ? item.label(ctxMenu.row) : item.label}
                </button>
              )
          ))}
        </div>
      )}

      {/* Footer / Pagination — footerLeft (e.g. a selected-row preview strip)
          pushes Total/pagination together to the right instead of leaving
          them alone on the left; without it, the layout is unchanged from
          before (info left, pagination right, as direct flex siblings) for
          every other DataGrid caller. */}
      {showFooter && (() => {
        const infoBlock = (
          <div className="dg-info">
            {processedData.length > 0 ? (
              <span style={{ color:'#000', fontWeight:700, fontSize:11, display:'inline-flex', alignItems:'center', gap:10 }}>
                <span style={{ background:'#fef08a', border:'1px solid #facc15', borderRadius:5, padding:'1px 8px' }}>
                  {L('कुल डाटा', 'Total Data')} : {processedData.length}
                </span>
                {!isGrouped && <span>{L('कुल पृष्ठ', 'Total Page')} {startIdx + 1}–{Math.min(startIdx + pageSize, processedData.length)}</span>}
                {data.length !== processedData.length && ` (${L('फिल्टर', 'Filter')}: ${data.length} ${L('मध्ये', 'of')})`}
              </span>
            ) : <span>{L('कुनै रेकर्ड छैन', 'No records found')}</span>}
          </div>
        );
        const pagingBlock = !isGrouped && (
          <div className="dg-paging">
            <div className="dg-pagesize">
              <label>{L('प्रति पृष्ठ:', 'Per page:')}</label>
              <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setCurrentPage(1); }}>
                {pageSizeOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="dg-page-btns">
              <button className="pg-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} title={L('पहिलो', 'First')}>«</button>
              <button className="pg-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} title={L('अगाडि', 'Previous')}>‹</button>
              {pageNumbers.map((pg, i) =>
                pg === '...'
                  ? <span key={i} className="pg-ellipsis">…</span>
                  : <button key={i} className={`pg-btn ${pg === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(pg)}>{pg}</button>
              )}
              <button className="pg-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} title={L('पछाडि', 'Next')}>›</button>
              <button className="pg-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} title={L('अन्तिम', 'Last')}>»</button>
            </div>
          </div>
        );
        return (
          <div className="dg-footer">
            {footerLeft ? (
              <>
                <div className="dg-footer-left">{footerLeft}</div>
                <div className="dg-footer-right">{infoBlock}{pagingBlock}</div>
              </>
            ) : (
              <>{infoBlock}{pagingBlock}</>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default DataGrid;

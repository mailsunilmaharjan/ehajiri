import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import './DataGrid.css';
import { useLanguage } from '../../context/LanguageContext.jsx';

const DataGrid = ({
  columns = [],
  data = [],
  defaultPageSize = 10,
  showSearch = true,
  searchPlaceholder = null,   // null = use language-aware default
  title = '',
  toolbar = null,
  toolbarLeft = null,
  onRowClick = null,
  onRowDoubleClick = null,
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
  contextMenu = null,         // [{ label, icon, onClick(row), className? }] — shown on right-click
  extraSearchFields = [],     // extra row fields to include in global search (not shown as columns)
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
  const [selectedRows, setSelectedRows] = useState([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [focusedRowIdx, setFocusedRowIdx] = useState(0);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, row }
  const scrollRef = useRef(null);
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

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleFilter = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    setCurrentPage(1);
  };

  const handleSelectAll = (checked) => {
    const next = checked
      ? processedData.slice((currentPage-1)*pageSize, (currentPage-1)*pageSize+pageSize).map(r => r[rowKey])
      : [];
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
      const q = globalSearch.toLowerCase();
      result = result.filter(row => {
        const inColumns = columns.some(col => {
          if (col.filterable === false || col.field === 'actions') return false;
          const v = row[col.field];
          return v != null && String(v).toLowerCase().includes(q);
        });
        if (inColumns) return true;
        return extraSearchFields.some(field => {
          const v = row[field];
          return v != null && String(v).toLowerCase().includes(q);
        });
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
  }, [data, globalSearch, filters, sortField, sortDir, extraSearchFields]);

  const processedData = processed;
  const totalPages = Math.max(1, Math.ceil(processedData.length / pageSize));
  const startIdx = (currentPage - 1) * pageSize;
  const pageData = processedData.slice(startIdx, startIdx + pageSize);

  useEffect(() => { setFocusedRowIdx(0); }, [currentPage, pageSize, globalSearch, sortField, sortDir]);
  useEffect(() => { if (showSearch) searchRef.current?.focus(); }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedRowIdx(prev => { const next = Math.min(prev + 1, pageData.length - 1); return next < 0 ? 0 : next; });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedRowIdx(prev => Math.max(prev - 1, 0));
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

  return (
    <div className="dg-container">
      {/* Toolbar */}
      <div className="dg-toolbar">
        {(title || toolbarLeft) && <div className="dg-toolbar-left">{title && <div className="dg-title">{title}</div>}{toolbarLeft}</div>}
        <div className="dg-toolbar-right">
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
        onClick={() => scrollRef.current?.focus()}
        style={{ outline: 'none', cursor: 'default' }}
      >
        <table className={`dg-table ${striped ? 'striped' : ''} ${compact ? 'compact' : ''} ${ultraCompact ? 'ultra-compact' : ''} ${autoWidth ? 'auto-width' : ''}`}
          style={ autoWidth ? { tableLayout:'auto' } : {} }>
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
                    ? { textAlign: col.align || 'left', whiteSpace:'nowrap', width: col.wrap ? undefined : '1px' }
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
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="dg-empty">
                  <div className="dg-empty-content">
                    <div className="dg-empty-icon">📋</div>
                    <div className="dg-empty-text">{L('कुनै डाटा फेला परेन', 'No data found')}</div>
                  </div>
                </td>
              </tr>
            ) : (
              pageData.map((row, ri) => (
                <tr
                  key={row[rowKey] ?? ri}
                  className={`dg-row ${(onRowClick || onRowDoubleClick) ? 'clickable' : ''} ${selectedRows.includes(row[rowKey]) ? 'selected' : ''} ${focusedRowIdx === ri ? 'kb-focus' : ''}`}
                  ref={el => { if (focusedRowIdx === ri && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }}
                  onClick={() => { setFocusedRowIdx(ri); scrollRef.current?.focus(); if (onRowClick) onRowClick(row); }}
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
                  <td className="dg-td dg-sn-col" style={{ width: snWidth, minWidth: snWidth }}>{startIdx + ri + 1}</td>
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
              ))
            )}
          </tbody>
        </table>
      </div>

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
          {contextMenu.map((item, i) => (
            item === 'divider'
              ? <div key={i} className="dg-ctx-divider" />
              : (
                <button
                  key={i}
                  className={`dg-ctx-item ${item.className || ''}`}
                  onClick={() => { setCtxMenu(null); item.onClick(ctxMenu.row); }}
                >
                  {item.icon && <span className="dg-ctx-icon">{item.icon}</span>}
                  {item.label}
                </button>
              )
          ))}
        </div>
      )}

      {/* Footer / Pagination */}
      <div className="dg-footer">
        <div className="dg-info">
          {processedData.length > 0 ? (
            <span>
              {startIdx + 1}–{Math.min(startIdx + pageSize, processedData.length)} / {L('कुल', 'Total')} {processedData.length}
              {data.length !== processedData.length && ` (${L('फिल्टर', 'Filter')}: ${data.length} ${L('मध्ये', 'of')})`}
            </span>
          ) : <span>{L('कुनै रेकर्ड छैन', 'No records found')}</span>}
        </div>
        <div className="dg-paging">
          <div className="dg-pagesize">
            <label>{L('प्रति पृष्ठ:', 'Per page:')}</label>
            <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setCurrentPage(1); }}>
              {[5, 10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
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
      </div>
    </div>
  );
};

export default DataGrid;

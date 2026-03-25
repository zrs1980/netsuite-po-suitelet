/**
 * @NApiVersion 2.1
 * @NScriptType suitelet
 * @NModuleScope SameAccount
 *
 * HTML template builder for the Open PO dashboard.
 * No external CSS or JS dependencies — all inline.
 */
define(['N/runtime'], (runtime) => {

  const PAGE_SIZE = 50;

  // ─── Public entry point ───────────────────────────────────────────────────

  /**
   * Build the complete HTML page string.
   * @param {{ filters, rows, totalCount, kpis, params }} opts
   * @returns {string} Full HTML document
   */
  function buildPage({ filters, rows, totalCount, kpis, params }) {
    const subsidiariesEnabled = runtime.isFeatureInEffect({ feature: 'SUBSIDIARIES' });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const currentPage = filters.page || 1;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Open Purchase Orders</title>
${buildStyles()}
</head>
<body>
${buildHeaderBar(params)}
${buildFilterPanel(filters, subsidiariesEnabled)}
${buildKpiBar(kpis)}
${buildResultsTable(rows, totalCount, subsidiariesEnabled, params)}
${buildPagination(currentPage, totalPages, params)}
${buildInlineScript()}
</body>
</html>`;
  }

  // ─── Header bar ───────────────────────────────────────────────────────────

  function buildHeaderBar(params) {
    const exportUrl = buildUrl(params, { action: 'export', page: null });
    return `<div class="header-bar">
  <h1 class="page-title">Open Purchase Orders</h1>
  <a class="btn btn-export" href="${escHtml(exportUrl)}">&#8595; Export CSV</a>
</div>`;
  }

  // ─── Filter panel ─────────────────────────────────────────────────────────

  function buildFilterPanel(filters, subsidiariesEnabled) {
    const statusOptions = {
      'PurchOrd:B': 'Pending Receipt',
      'PurchOrd:D': 'Partially Received',
      'PurchOrd:E': 'Pending Bill/Partially Billed',
    };
    const activeStatuses = filters.status && filters.status.length > 0
      ? filters.status
      : Object.keys(statusOptions);

    const statusCheckboxes = Object.entries(statusOptions).map(([code, label]) => {
      const checked = activeStatuses.includes(code) ? 'checked' : '';
      return `<label class="checkbox-label"><input type="checkbox" name="status_cb" value="${code}" ${checked}> ${escHtml(label)}</label>`;
    }).join('');

    const subsidiaryInput = subsidiariesEnabled ? `
      <div class="filter-group">
        <label>Subsidiary</label>
        <input type="number" name="subsidiary_id" value="${escHtml(filters.subsidiary_id || '')}" placeholder="Internal ID">
      </div>` : '';

    return `<div class="filter-panel" id="filterPanel">
  <div class="filter-panel-header" onclick="toggleFilters()">
    <span>&#9660; Filters</span>
    <span class="filter-toggle-hint">Click to collapse</span>
  </div>
  <form id="filterForm" method="GET" onsubmit="submitFilters(event)">
    <input type="hidden" name="page" value="1">
    <input type="hidden" name="sort_col" id="sortCol" value="${escHtml(filters.sort_col || 'expected_date')}">
    <input type="hidden" name="sort_dir" id="sortDir" value="${escHtml(filters.sort_dir || 'asc')}">
    <input type="hidden" name="status" id="statusHidden" value="${escHtml((filters.status || []).join(','))}">

    <div class="filter-row">
      <div class="filter-group">
        <label>Status</label>
        <div class="checkbox-group">${statusCheckboxes}</div>
      </div>
      <div class="filter-group">
        <label>Vendor ID</label>
        <input type="number" name="vendor_id" value="${escHtml(filters.vendor_id || '')}" placeholder="Internal ID">
      </div>
      <div class="filter-group">
        <label>PO Date From</label>
        <input type="date" name="date_from" value="${escHtml(filters.date_from || '')}">
      </div>
      <div class="filter-group">
        <label>PO Date To</label>
        <input type="date" name="date_to" value="${escHtml(filters.date_to || '')}">
      </div>
      <div class="filter-group">
        <label>Expected Date From</label>
        <input type="date" name="exp_from" value="${escHtml(filters.exp_from || '')}">
      </div>
      <div class="filter-group">
        <label>Expected Date To</label>
        <input type="date" name="exp_to" value="${escHtml(filters.exp_to || '')}">
      </div>
      <div class="filter-group">
        <label>Location ID(s)</label>
        <input type="text" name="location_id" value="${escHtml((filters.location_ids || []).join(','))}" placeholder="e.g. 1,2,3">
      </div>
      ${subsidiaryInput}
      <div class="filter-group">
        <label>Item ID</label>
        <input type="number" name="item_id" value="${escHtml(filters.item_id || '')}" placeholder="Internal ID">
      </div>
      <div class="filter-group">
        <label>Min PO Value</label>
        <input type="number" name="min_value" value="${escHtml(filters.min_value || '')}" placeholder="0.00" step="0.01">
      </div>
      <div class="filter-group filter-group--checkbox">
        <label><input type="checkbox" name="overdue_only" value="true" ${filters.overdue_only ? 'checked' : ''}> Overdue Only</label>
      </div>
    </div>
    <div class="filter-actions">
      <button type="submit" class="btn btn-primary">Apply Filters</button>
      <a href="?" class="btn btn-secondary">Clear Filters</a>
    </div>
  </form>
</div>`;
  }

  // ─── KPI bar ──────────────────────────────────────────────────────────────

  function buildKpiBar(kpis) {
    const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtCurrency = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `<div class="kpi-bar">
  <div class="kpi-tile">
    <div class="kpi-value">${fmt(kpis.totalPos)}</div>
    <div class="kpi-label">Total Open POs</div>
  </div>
  <div class="kpi-tile">
    <div class="kpi-value">$${fmtCurrency(kpis.outstandingValue)}</div>
    <div class="kpi-label">Outstanding Value</div>
  </div>
  <div class="kpi-tile kpi-tile--warning">
    <div class="kpi-value">${fmt(kpis.overduePos)}</div>
    <div class="kpi-label">Overdue POs</div>
  </div>
  <div class="kpi-tile">
    <div class="kpi-value">${fmt(kpis.partiallyReceived)}</div>
    <div class="kpi-label">Partially Received</div>
  </div>
</div>`;
  }

  // ─── Results table ────────────────────────────────────────────────────────

  function buildResultsTable(rows, totalCount, subsidiariesEnabled, params) {
    if (!rows || rows.length === 0) {
      return `<div class="empty-state">
  <div class="empty-state-icon">&#128196;</div>
  <p>No open purchase orders match your current filters.</p>
  <a href="?" class="btn btn-secondary">Clear Filters</a>
</div>`;
    }

    const sortCol = params.sort_col || 'expected_date';
    const sortDir = params.sort_dir || 'asc';

    function sortLink(col, label) {
      const newDir = (sortCol === col && sortDir === 'asc') ? 'desc' : 'asc';
      const arrow  = sortCol === col ? (sortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
      const url    = buildUrl(params, { sort_col: col, sort_dir: newDir, page: 1 });
      return `<a class="sort-link" href="${escHtml(url)}">${label}${arrow}</a>`;
    }

    const subsidiaryHeader = subsidiariesEnabled
      ? `<th>${sortLink('subsidiary_name', 'Subsidiary')}</th>` : '';

    const rows_html = rows.map(row => buildPoRow(row, subsidiariesEnabled, params)).join('');

    return `<div class="results-meta">Showing ${rows.length} of ${totalCount.toLocaleString()} POs</div>
<div class="table-wrapper">
  <table class="results-table" id="poTable">
    <thead>
      <tr>
        <th class="expand-col"></th>
        <th>${sortLink('po_number', 'PO Number')}</th>
        <th>${sortLink('vendor_name', 'Vendor')}</th>
        <th>${sortLink('po_date', 'PO Date')}</th>
        <th>${sortLink('expected_date', 'Expected Date')}</th>
        <th>Location</th>
        ${subsidiaryHeader}
        <th>Status</th>
        <th>Currency</th>
        <th class="num-col">${sortLink('base_total', 'PO Total (Base)')}</th>
        <th class="num-col">${sortLink('amount_remaining', 'Remaining')}</th>
        <th class="num-col">Qty Ord.</th>
        <th class="num-col">Qty Rec.</th>
        <th>Memo</th>
      </tr>
    </thead>
    <tbody>${rows_html}</tbody>
  </table>
</div>`;
  }

  function buildPoRow(row, subsidiariesEnabled, params) {
    const poUrl = '/app/accounting/transactions/purchord.nl?id=' + escHtml(row.po_id);
    const colCount = subsidiariesEnabled ? 14 : 13;
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = row.expected_date && row.expected_date < today;
    const rowClass = 'po-row' + (isOverdue ? ' row--overdue' : '') + (row.fully_received_flag ? ' row--fully-received' : '');

    const subsidiaryCell = subsidiariesEnabled
      ? `<td>${escHtml(row.subsidiary_name)}</td>` : '';

    const statusBadge = `<span class="badge badge--${getStatusClass(row.status)}">${escHtml(row.status_label)}</span>`;

    const warnings = [];
    if (row.fully_received_flag) warnings.push('<span class="badge badge--warn" title="All lines received but PO is still open">&#9888; Fully Received</span>');
    if (isOverdue) warnings.push('<span class="badge badge--danger">Overdue</span>');

    const memo = row.memo ? escHtml(row.memo.substring(0, 80)) + (row.memo.length > 80 ? '&hellip;' : '') : '';

    return `<tr class="${rowClass}" onclick="toggleLines(${row.po_id}, this)" title="Click to expand lines">
  <td class="expand-col"><span class="expand-icon" id="icon-${row.po_id}">&#9654;</span></td>
  <td><a href="${poUrl}" target="_blank" onclick="event.stopPropagation()">${escHtml(row.po_number)}</a> ${warnings.join(' ')}</td>
  <td>${escHtml(row.vendor_name)}</td>
  <td>${escHtml(row.po_date || '—')}</td>
  <td class="${isOverdue ? 'overdue-date' : ''}">${escHtml(row.expected_date || '—')}</td>
  <td>${escHtml(row.location_name)}</td>
  ${subsidiaryCell}
  <td>${statusBadge}</td>
  <td>${escHtml(row.currency)}</td>
  <td class="num-col">${fmtNum(row.base_total)}</td>
  <td class="num-col">${fmtNum(row.amount_remaining)}</td>
  <td class="num-col">${fmtNum(row.qty_ordered)}</td>
  <td class="num-col">${fmtNum(row.qty_received)}</td>
  <td class="memo-col">${memo}</td>
</tr>
<tr class="lines-row" id="lines-${row.po_id}" style="display:none">
  <td colspan="${colCount}"><div class="spinner" id="spinner-${row.po_id}">Loading line details&hellip;</div></td>
</tr>`;
  }

  // ─── Pagination ───────────────────────────────────────────────────────────

  function buildPagination(currentPage, totalPages, params) {
    if (totalPages <= 1) return '';
    const prevUrl = currentPage > 1 ? buildUrl(params, { page: currentPage - 1 }) : null;
    const nextUrl = currentPage < totalPages ? buildUrl(params, { page: currentPage + 1 }) : null;

    return `<div class="pagination">
  ${prevUrl ? `<a class="btn btn-page" href="${escHtml(prevUrl)}">&laquo; Prev</a>` : '<span class="btn btn-page btn-page--disabled">&laquo; Prev</span>'}
  <span class="page-info">Page ${currentPage} of ${totalPages}</span>
  ${nextUrl ? `<a class="btn btn-page" href="${escHtml(nextUrl)}">Next &raquo;</a>` : '<span class="btn btn-page btn-page--disabled">Next &raquo;</span>'}
</div>`;
  }

  // ─── Inline CSS ───────────────────────────────────────────────────────────

  function buildStyles() {
    return `<style>
/* Reset & base */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, Arial, sans-serif; font-size: 13px; color: #333; background: #f0f2f5; }
a { color: #2E75B6; text-decoration: none; }
a:hover { text-decoration: underline; }

/* Header bar */
.header-bar { display: flex; align-items: center; justify-content: space-between; background: #1A3C6E; color: #fff; padding: 12px 20px; }
.page-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.3px; }

/* Buttons */
.btn { display: inline-block; padding: 7px 14px; border-radius: 4px; font-size: 13px; cursor: pointer; border: none; text-decoration: none; }
.btn-primary   { background: #2E75B6; color: #fff; }
.btn-primary:hover { background: #1A5A9A; color:#fff; }
.btn-secondary { background: #fff; color: #333; border: 1px solid #ccc; }
.btn-secondary:hover { background: #f5f5f5; color: #333; }
.btn-export    { background: #27AE60; color: #fff; }
.btn-export:hover { background: #1E8449; color:#fff; }
.btn-page      { background: #fff; color: #2E75B6; border: 1px solid #ccc; margin: 0 3px; }
.btn-page:hover { background: #D9E8F5; }
.btn-page--disabled { color: #aaa; border-color: #e0e0e0; cursor: default; pointer-events: none; }

/* Filter panel */
.filter-panel { background: #fff; border-bottom: 1px solid #ddd; }
.filter-panel-header { background: #1A3C6E; color: #fff; padding: 8px 20px; cursor: pointer; display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
.filter-toggle-hint { font-weight: normal; font-size: 11px; opacity: 0.8; }
#filterForm { padding: 14px 20px; }
.filter-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.filter-group { display: flex; flex-direction: column; gap: 4px; min-width: 160px; }
.filter-group label { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
.filter-group input[type=text], .filter-group input[type=number], .filter-group input[type=date] {
  padding: 6px 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px; }
.filter-group--checkbox { justify-content: flex-end; }
.checkbox-group { display: flex; flex-direction: column; gap: 4px; }
.checkbox-label { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: normal; text-transform: none; letter-spacing: 0; }
.filter-actions { display: flex; gap: 10px; padding-top: 4px; }

/* KPI bar */
.kpi-bar { display: flex; gap: 16px; padding: 14px 20px; background: #fff; border-bottom: 1px solid #ddd; }
.kpi-tile { flex: 1; background: #D9E8F5; border-radius: 6px; padding: 14px 18px; text-align: center; }
.kpi-tile--warning { background: #FFF3CD; }
.kpi-value { font-size: 24px; font-weight: 700; color: #2E75B6; }
.kpi-tile--warning .kpi-value { color: #C0392B; }
.kpi-label { font-size: 11px; color: #555; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.4px; }

/* Results meta */
.results-meta { padding: 8px 20px; font-size: 12px; color: #666; background: #fff; }

/* Table */
.table-wrapper { overflow-x: auto; padding: 0 20px 20px; background: #fff; }
.results-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.results-table thead th { background: #1A3C6E; color: #fff; padding: 9px 10px; text-align: left; white-space: nowrap; position: sticky; top: 0; z-index: 1; border-right: 1px solid #2a4e80; }
.results-table tbody tr:nth-child(4n+1), .results-table tbody tr:nth-child(4n+2) { background: #fff; }
.results-table tbody tr:nth-child(4n+3), .results-table tbody tr:nth-child(4n+4) { background: #F5F5F5; }
.results-table tbody tr.po-row:hover { background: #EBF3FB; cursor: pointer; }
.results-table td { padding: 7px 10px; border-bottom: 1px solid #e8e8e8; vertical-align: middle; }
.num-col { text-align: right; font-variant-numeric: tabular-nums; }
.memo-col { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #666; }
.expand-col { width: 24px; text-align: center; }
.expand-icon { font-size: 10px; color: #2E75B6; }
.sort-link { color: #fff; }
.sort-link:hover { color: #D9E8F5; }

/* Row states */
.row--overdue td { color: #7B241C; }
.row--fully-received { border-left: 3px solid #E67E22; }
.overdue-date { color: #C0392B; font-weight: 600; }

/* Lines row */
.lines-row td { padding: 0 10px 0 30px; background: #f9fbfd; border-bottom: 2px solid #2E75B6; }
.lines-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
.lines-table th { background: #2E75B6; color: #fff; padding: 6px 8px; text-align: left; }
.lines-table td { padding: 5px 8px; border-bottom: 1px solid #dce8f4; }
.lines-table tr:last-child td { border-bottom: none; }

/* Badges */
.badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.badge--B, .badge--pending   { background: #D9E8F5; color: #1A3C6E; }
.badge--D, .badge--partial   { background: #FFF3CD; color: #856404; }
.badge--E, .badge--billed    { background: #D4EDDA; color: #155724; }
.badge--open                 { background: #D9E8F5; color: #1A3C6E; }
.badge--received             { background: #D4EDDA; color: #155724; }
.badge--warn                 { background: #FFF3CD; color: #856404; }
.badge--danger               { background: #F8D7DA; color: #721C24; }

/* Spinner */
.spinner { padding: 12px 0; color: #2E75B6; font-style: italic; }

/* Empty state */
.empty-state { text-align: center; padding: 60px 20px; color: #666; background: #fff; }
.empty-state-icon { font-size: 48px; margin-bottom: 12px; }

/* Pagination */
.pagination { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px 20px; background: #fff; border-top: 1px solid #e8e8e8; }
.page-info { font-size: 13px; color: #555; }

/* Print */
@media print {
  .filter-panel, .header-bar .btn-export, .pagination { display: none; }
  .lines-row { display: table-row !important; }
}
</style>`;
  }

  // ─── Inline JS ────────────────────────────────────────────────────────────

  function buildInlineScript() {
    return `<script>
// Toggle filter panel
function toggleFilters() {
  var form = document.getElementById('filterForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

// Collect status checkboxes into hidden field before form submit
function submitFilters(e) {
  var checked = Array.from(document.querySelectorAll('input[name=status_cb]:checked')).map(function(cb){ return cb.value; });
  document.getElementById('statusHidden').value = checked.join(',');
}

// Expand / collapse PO lines with lazy fetch
function toggleLines(poId, row) {
  var linesRow = document.getElementById('lines-' + poId);
  var icon     = document.getElementById('icon-' + poId);
  if (!linesRow) return;

  if (linesRow.dataset.loaded === 'true') {
    var visible = linesRow.style.display !== 'none';
    linesRow.style.display = visible ? 'none' : '';
    icon.innerHTML = visible ? '&#9654;' : '&#9660;';
    return;
  }

  linesRow.style.display = '';
  icon.innerHTML = '&#9660;';

  fetch(window.location.pathname + '?action=lines&po_id=' + poId)
    .then(function(r) { return r.json(); })
    .then(function(lines) {
      linesRow.innerHTML = '<td colspan="20">' + buildLinesTable(lines) + '</td>';
      linesRow.dataset.loaded = 'true';
    })
    .catch(function(err) {
      linesRow.innerHTML = '<td colspan="20"><span style="color:#C0392B">Error loading lines: ' + err.message + '</span></td>';
    });
}

function buildLinesTable(lines) {
  if (!lines || lines.length === 0) {
    return '<div class="spinner" style="font-style:normal">&#9432; No active lines found for this PO.</div>';
  }
  var html = '<table class="lines-table"><thead><tr>'
    + '<th>#</th><th>Item / Description</th><th>Category</th>'
    + '<th>Qty Ordered</th><th>Qty Received</th><th>Qty Remaining</th>'
    + '<th>Units</th><th>Unit Cost</th><th>Line Amount</th>'
    + '<th>Expected Date</th><th>Status</th>'
    + '</tr></thead><tbody>';

  lines.forEach(function(ln) {
    var statusClass = ln.line_status === 'Received' ? 'received' : ln.line_status === 'Partial' ? 'partial' : 'open';
    html += '<tr>'
      + '<td>' + esc(ln.line_num) + '</td>'
      + '<td>' + esc(ln.item_name) + '</td>'
      + '<td>' + esc(ln.item_category || '') + '</td>'
      + '<td style="text-align:right">' + fmt(ln.qty_ordered) + '</td>'
      + '<td style="text-align:right">' + fmt(ln.qty_received) + '</td>'
      + '<td style="text-align:right">' + fmt(ln.qty_remaining) + '</td>'
      + '<td>' + esc(ln.units || '') + '</td>'
      + '<td style="text-align:right">' + fmtCurrency(ln.unit_cost) + '</td>'
      + '<td style="text-align:right">' + fmtCurrency(ln.line_amount) + '</td>'
      + '<td>' + esc(ln.expected_date || '—') + '</td>'
      + '<td><span class="badge badge--' + statusClass + '">' + esc(ln.line_status) + '</span></td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function fmt(n) {
  if (n === null || n === undefined) return '—';
  return parseFloat(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
}
function fmtCurrency(n) {
  if (n === null || n === undefined) return '—';
  return parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
</script>`;
  }

  // ─── Utility helpers ──────────────────────────────────────────────────────

  function escHtml(s) {
    if (!s && s !== 0) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return '—';
    return parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getStatusClass(status) {
    const map = { 'PurchOrd:B': 'B', 'PurchOrd:D': 'D', 'PurchOrd:E': 'E' };
    return map[status] || 'B';
  }

  /**
   * Build a URL with the current params overridden by overrides.
   * Null values in overrides remove the param.
   */
  function buildUrl(params, overrides) {
    const merged = Object.assign({}, params, overrides);
    const parts = [];
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') continue;
      if (k === 'action') continue; // never carry action into nav links
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(merged[k]));
    }
    return '?' + parts.join('&');
  }

  return { buildPage };
});

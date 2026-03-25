/**
 * @NApiVersion 2.1
 * @NScriptType suitelet
 * @NModuleScope SameAccount
 *
 * CSV export handler for the Open PO dashboard.
 * Runs the same filtered query with no pagination cap (up to 2,000 rows).
 */
define(['N/query', 'N/runtime', 'N/log', './loop_open_po_query'], (query, runtime, log, poQuery) => {

  const MAX_EXPORT_ROWS = 2000;

  /**
   * Write a CSV response for the current filtered result set.
   * @param {Object} context  Suitelet context
   * @param {Object} params   Raw URL parameters
   */
  function writeCsv(context, params) {
    const res = context.response;

    res.setHeader({ name: 'Content-Type',        value: 'text/csv; charset=utf-8' });
    res.setHeader({ name: 'Content-Disposition', value: 'attachment; filename="open_po_export.csv"' });
    res.setHeader({ name: 'Cache-Control',        value: 'no-cache' });

    const filters = poQuery.parseFilters(params);
    // Remove pagination for export
    filters.page = 1;

    const { rows, totalCount } = getExportRows(filters);

    if (totalCount > MAX_EXPORT_ROWS) {
      log.audit('CSV export warning', `Result set ${totalCount} exceeds max ${MAX_EXPORT_ROWS}. Truncating.`);
    }

    const csvLines = [];

    // Header row
    csvLines.push(csvRow([
      'PO Number',
      'Vendor',
      'PO Date',
      'Expected Receipt Date',
      'Location',
      'Subsidiary',
      'Status',
      'Currency',
      'PO Total (Foreign)',
      'PO Total (Base)',
      'Qty Ordered',
      'Qty Received',
      'Amount Received',
      'Amount Remaining',
      'Memo',
    ]));

    for (const row of rows) {
      csvLines.push(csvRow([
        row.po_number,
        row.vendor_name,
        row.po_date,
        row.expected_date || '',
        row.location_name,
        row.subsidiary_name,
        row.status_label,
        row.currency,
        row.foreign_total,
        row.base_total,
        row.qty_ordered,
        row.qty_received,
        row.amount_received,
        row.amount_remaining,
        row.memo || '',
      ]));
    }

    if (totalCount > MAX_EXPORT_ROWS) {
      csvLines.push(csvRow([`WARNING: Export truncated to ${MAX_EXPORT_ROWS} rows. Total matching: ${totalCount}. Apply additional filters to export the full set.`]));
    }

    res.write(csvLines.join('\r\n'));
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Run the query without pagination, up to MAX_EXPORT_ROWS.
   */
  function getExportRows(filters) {
    // Reuse the standard query but override page size via direct SuiteQL
    // We patch the filters to fetch up to MAX_EXPORT_ROWS at once.
    const exportFilters = Object.assign({}, filters, { page: 1, _exportMode: true });
    return poQuery.getOpenPos(exportFilters, MAX_EXPORT_ROWS);
  }

  /**
   * Format a single CSV row, escaping values per RFC 4180.
   */
  function csvRow(values) {
    return values.map(v => {
      const s = v === null || v === undefined ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }

  return { writeCsv };
});

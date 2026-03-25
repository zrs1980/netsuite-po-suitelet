/**
 * @NApiVersion 2.1
 * @NScriptType suitelet
 * @NModuleScope SameAccount
 *
 * Data layer — SuiteQL queries for the Open PO dashboard.
 * All user-supplied filter values use bind parameters; never string-concatenated.
 */
define(['N/query', 'N/runtime', 'N/log'], (query, runtime, log) => {

  // ─── Constants ──────────────────────────────────────────────────────────────

  const PAGE_SIZE = 50;

  const VALID_STATUSES = {
    'PurchOrd:B': 'Pending Receipt',
    'PurchOrd:D': 'Partially Received',
    'PurchOrd:E': 'Pending Bill/Partially Billed',
  };

  const VALID_SORT_COLS = {
    po_number:      't.tranid',
    vendor_name:    'builtin.df(t.entity)',
    po_date:        't.trandate',
    expected_date:  't.custbody_expected_receipt_date',
    base_total:     't.total',
    amount_remaining: 'amount_remaining',
  };

  // ─── parseFilters ────────────────────────────────────────────────────────────

  /**
   * Parse raw URL parameters into a typed filters object.
   * @param {Object} params  context.request.parameters
   * @returns {Object} filters
   */
  function parseFilters(params) {
    return {
      status:       sanitizeStatusList(params.status),
      vendor_id:    parseIntParam(params.vendor_id),
      date_from:    parseDateParam(params.date_from),
      date_to:      parseDateParam(params.date_to),
      location_ids: parseIntListParam(params.location_id),
      subsidiary_id: parseIntParam(params.subsidiary_id),
      item_id:      parseIntParam(params.item_id),
      overdue_only: params.overdue_only === 'true',
      exp_from:     parseDateParam(params.exp_from),
      exp_to:       parseDateParam(params.exp_to),
      currency:     params.currency ? String(params.currency).replace(/[^A-Z]/g, '').substring(0, 3) : null,
      min_value:    parseFloatParam(params.min_value),
      page:         Math.max(1, parseIntParam(params.page) || 1),
      sort_col:     VALID_SORT_COLS[params.sort_col] ? params.sort_col : 'expected_date',
      sort_dir:     params.sort_dir === 'desc' ? 'DESC' : 'ASC',
    };
  }

  // ─── getOpenPos ──────────────────────────────────────────────────────────────

  /**
   * Main dashboard query — one row per PO with aggregated line data.
   * @param {Object} filters  from parseFilters()
   * @returns {{ rows: Array, totalCount: number }}
   */
  function getOpenPos(filters) {
    log.debug('governance', runtime.getCurrentScript().getRemainingUsage());

    const { whereSql, params } = buildWhereClause(filters);
    const offset = (filters.page - 1) * PAGE_SIZE;
    const orderCol = VALID_SORT_COLS[filters.sort_col] || 't.custbody_expected_receipt_date';
    const orderDir = filters.sort_dir;

    const sql = `
      SELECT
        t.id                                                AS po_id,
        t.tranid                                            AS po_number,
        t.entity                                            AS vendor_id,
        builtin.df(t.entity)                                AS vendor_name,
        TO_CHAR(t.trandate, 'YYYY-MM-DD')                   AS po_date,
        TO_CHAR(t.custbody_expected_receipt_date,'YYYY-MM-DD') AS expected_date,
        t.location                                          AS location_id,
        builtin.df(t.location)                              AS location_name,
        t.subsidiary                                        AS subsidiary_id,
        builtin.df(t.subsidiary)                            AS subsidiary_name,
        t.status                                            AS status,
        builtin.df(t.currency)                              AS currency,
        t.foreigntotal                                      AS foreign_total,
        t.total                                             AS base_total,
        t.memo                                              AS memo,
        SUM(tl.quantity)                                    AS qty_ordered,
        SUM(tl.quantityreceived)                            AS qty_received,
        SUM(tl.quantityreceived * tl.rate)                  AS amount_received,
        t.total - SUM(tl.quantityreceived * tl.rate)        AS amount_remaining
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE ${whereSql}
      GROUP BY t.id, t.tranid, t.entity, t.trandate,
               t.custbody_expected_receipt_date, t.location, t.subsidiary,
               t.status, t.currency, t.foreigntotal, t.total, t.memo
      ORDER BY ${orderCol} ${orderDir} NULLS LAST,
               t.trandate ASC
      OFFSET ${offset} ROWS FETCH NEXT ${PAGE_SIZE} ROWS ONLY
    `;

    const countSql = `
      SELECT COUNT(DISTINCT t.id) AS total
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE ${whereSql}
    `;

    const rows = runSuiteQL(sql, params).map(mapPoRow);
    const countResult = runSuiteQL(countSql, params);
    const totalCount = countResult.length > 0 ? (parseInt(countResult[0].total, 10) || 0) : 0;

    return { rows, totalCount };
  }

  // ─── getPoLines ──────────────────────────────────────────────────────────────

  /**
   * Line-level detail for a single PO (lazy-loaded on row expand).
   * @param {number} poId  Internal ID of the PO
   * @returns {Array} lines
   */
  function getPoLines(poId) {
    log.debug('governance', runtime.getCurrentScript().getRemainingUsage());

    const sql = `
      SELECT
        tl.line                                   AS line_num,
        tl.item                                   AS item_id,
        builtin.df(tl.item)                       AS item_name,
        tl.description                            AS description,
        tl.quantity                               AS qty_ordered,
        tl.quantityreceived                       AS qty_received,
        tl.quantity - tl.quantityreceived         AS qty_remaining,
        builtin.df(tl.units)                      AS units,
        tl.rate                                   AS unit_cost,
        tl.amount                                 AS line_amount,
        TO_CHAR(tl.expectedreceiptdate,'YYYY-MM-DD') AS expected_date,
        tl.custcol_item_category                  AS item_category,
        tl.isclosed                               AS is_closed
      FROM transactionline tl
      WHERE tl.transaction = :po_id
        AND tl.isclosed = 'F'
        AND tl.itemtype != 'Subtotal'
      ORDER BY tl.line ASC
    `;

    return runSuiteQL(sql, { po_id: poId }).map(row => ({
      line_num:      row.line_num,
      item_id:       row.item_id,
      item_name:     row.item_name || row.description || '—',
      description:   row.description,
      qty_ordered:   parseFloat(row.qty_ordered) || 0,
      qty_received:  parseFloat(row.qty_received) || 0,
      qty_remaining: parseFloat(row.qty_remaining) || 0,
      units:         row.units,
      unit_cost:     parseFloat(row.unit_cost) || 0,
      line_amount:   parseFloat(row.line_amount) || 0,
      expected_date: row.expected_date,
      item_category: row.item_category,
      line_status:   deriveLineStatus(row),
    }));
  }

  // ─── getKpiSummary ───────────────────────────────────────────────────────────

  /**
   * Aggregate KPIs for the banner tiles.
   * @param {Object} filters  from parseFilters()
   * @returns {{ totalPos, outstandingValue, overduePos, partiallyReceived }}
   */
  function getKpiSummary(filters) {
    log.debug('governance', runtime.getCurrentScript().getRemainingUsage());

    const { whereSql, params } = buildWhereClause(filters);
    const today = getTodayString();

    const sql = `
      SELECT
        COUNT(DISTINCT t.id)                                    AS total_pos,
        SUM(t.total - SUM_REC.amount_received)                  AS outstanding_value,
        SUM(CASE WHEN t.custbody_expected_receipt_date IS NOT NULL
                  AND t.custbody_expected_receipt_date < TO_DATE('${today}','YYYY-MM-DD')
                  AND t.status != 'PurchOrd:C'
             THEN 1 ELSE 0 END)                                 AS overdue_pos,
        SUM(CASE WHEN t.status = 'PurchOrd:D' THEN 1 ELSE 0 END) AS partially_received
      FROM transaction t
      JOIN (
        SELECT tl.transaction,
               SUM(tl.quantityreceived * tl.rate) AS amount_received
        FROM transactionline tl
        WHERE tl.isclosed = 'F' AND tl.itemtype != 'Subtotal'
        GROUP BY tl.transaction
      ) SUM_REC ON SUM_REC.transaction = t.id
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE ${whereSql}
    `;

    const result = runSuiteQL(sql, params);
    const row = result[0] || {};

    return {
      totalPos:          parseInt(row.total_pos, 10) || 0,
      outstandingValue:  parseFloat(row.outstanding_value) || 0,
      overduePos:        parseInt(row.overdue_pos, 10) || 0,
      partiallyReceived: parseInt(row.partially_received, 10) || 0,
    };
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  function buildWhereClause(filters) {
    const statusList = filters.status && filters.status.length > 0
      ? filters.status
      : Object.keys(VALID_STATUSES);

    let sql = `t.type = 'PurchOrd'
      AND t.status IN (${statusList.map(s => `'${s}'`).join(',')})
      AND tl.isclosed = 'F'
      AND tl.itemtype != 'Subtotal'`;

    const params = {};

    if (filters.vendor_id) {
      sql += ` AND t.entity = :vendor_id`;
      params.vendor_id = filters.vendor_id;
    }
    if (filters.date_from) {
      sql += ` AND t.trandate >= TO_DATE(:date_from,'YYYY-MM-DD')`;
      params.date_from = filters.date_from;
    }
    if (filters.date_to) {
      sql += ` AND t.trandate <= TO_DATE(:date_to,'YYYY-MM-DD')`;
      params.date_to = filters.date_to;
    }
    if (filters.location_ids && filters.location_ids.length > 0) {
      sql += ` AND t.location IN (${filters.location_ids.join(',')})`;
    }
    if (filters.subsidiary_id) {
      sql += ` AND t.subsidiary = :subsidiary_id`;
      params.subsidiary_id = filters.subsidiary_id;
    }
    if (filters.item_id) {
      sql += ` AND EXISTS (SELECT 1 FROM transactionline tl2 WHERE tl2.transaction = t.id AND tl2.item = :item_id AND tl2.isclosed = 'F')`;
      params.item_id = filters.item_id;
    }
    if (filters.overdue_only) {
      const today = getTodayString();
      sql += ` AND t.custbody_expected_receipt_date IS NOT NULL AND t.custbody_expected_receipt_date < TO_DATE('${today}','YYYY-MM-DD')`;
    }
    if (filters.exp_from) {
      sql += ` AND t.custbody_expected_receipt_date >= TO_DATE(:exp_from,'YYYY-MM-DD')`;
      params.exp_from = filters.exp_from;
    }
    if (filters.exp_to) {
      sql += ` AND t.custbody_expected_receipt_date <= TO_DATE(:exp_to,'YYYY-MM-DD')`;
      params.exp_to = filters.exp_to;
    }
    if (filters.min_value) {
      sql += ` AND t.total >= :min_value`;
      params.min_value = filters.min_value;
    }

    return { whereSql: sql, params };
  }

  function runSuiteQL(sql, params) {
    const remaining = runtime.getCurrentScript().getRemainingUsage();
    if (remaining < 100) {
      log.error('governance', 'Governance limit approaching — aborting query. Remaining: ' + remaining);
      throw new Error('Governance limit too low to execute query. Please narrow your filters.');
    }
    try {
      const result = query.runSuiteQL({ query: sql, params: params || {} });
      return result.asMappedResults();
    } catch (e) {
      log.error({ title: 'SuiteQL error', details: { sql, params, error: e.message } });
      throw e;
    }
  }

  function mapPoRow(row) {
    const qtyOrdered  = parseFloat(row.qty_ordered)  || 0;
    const qtyReceived = parseFloat(row.qty_received)  || 0;
    const baseTotal   = parseFloat(row.base_total)    || 0;
    const amtReceived = parseFloat(row.amount_received) || 0;
    const amtRemaining = parseFloat(row.amount_remaining) != null
      ? parseFloat(row.amount_remaining)
      : baseTotal - amtReceived;

    return {
      po_id:          row.po_id,
      po_number:      row.po_number,
      vendor_id:      row.vendor_id,
      vendor_name:    row.vendor_name || '—',
      po_date:        row.po_date,
      expected_date:  row.expected_date || null,
      location_id:    row.location_id,
      location_name:  row.location_name || '—',
      subsidiary_id:  row.subsidiary_id,
      subsidiary_name: row.subsidiary_name || '—',
      status:         row.status,
      status_label:   VALID_STATUSES[row.status] || row.status,
      currency:       row.currency || '—',
      foreign_total:  parseFloat(row.foreign_total) || 0,
      base_total:     baseTotal,
      memo:           row.memo,
      qty_ordered:    qtyOrdered,
      qty_received:   qtyReceived,
      amount_received: amtReceived,
      amount_remaining: amtRemaining,
      fully_received_flag: qtyReceived >= qtyOrdered && qtyOrdered > 0,
    };
  }

  function deriveLineStatus(row) {
    if (row.is_closed === 'T') return 'Closed';
    const qtyOrdered  = parseFloat(row.qty_ordered)  || 0;
    const qtyReceived = parseFloat(row.qty_received)  || 0;
    if (qtyReceived === 0)             return 'Open';
    if (qtyReceived >= qtyOrdered)     return 'Received';
    return 'Partial';
  }

  function sanitizeStatusList(param) {
    if (!param) return null;
    return String(param).split(',')
      .map(s => s.trim())
      .filter(s => VALID_STATUSES[s]);
  }

  function parseIntParam(val) {
    if (!val) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }

  function parseIntListParam(val) {
    if (!val) return [];
    return String(val).split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
  }

  function parseDateParam(val) {
    if (!val) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    return null;
  }

  function parseFloatParam(val) {
    if (!val) return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }

  function getTodayString() {
    const d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  // ─── Exports ─────────────────────────────────────────────────────────────────

  return { parseFilters, getOpenPos, getPoLines, getKpiSummary };
});

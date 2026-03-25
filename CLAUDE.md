# CLAUDE.md — Open Purchase Order Suitelet
## Loop ERP / CEBA Solutions | NetSuite Account: 3550424

---

## Project Overview

Build a NetSuite **Suitelet** that renders a filterable, paginated dashboard of all open Purchase Orders. Users can view PO header summaries, expand rows to see line-level detail, filter by multiple criteria, and export results to CSV.

This is a **SuiteScript 2.1** project targeting NetSuite account `3550424`. The Suitelet renders a full custom HTML page (not a serverWidget form). Data is fetched via **SuiteQL** (N/query module).

---

## File Structure

```
/
├── CLAUDE.md                          ← this file
├── src/
│   └── FileCabinet/
│       └── SuiteScripts/
│           └── loop_erp/
│               └── open_po_suitelet/
│                   ├── loop_open_po_suitelet.js       ← main Suitelet entry point
│                   ├── loop_open_po_query.js          ← SuiteQL data layer (SS2.1 module)
│                   ├── loop_open_po_html.js           ← HTML template builder (SS2.1 module)
│                   └── loop_open_po_export.js         ← CSV export handler (SS2.1 module)
├── manifest.xml                       ← SuiteApp manifest (com.looperp.openposuitelet)
├── deploy/
│   └── deployment.xml                 ← Suitelet deployment record definition
└── tests/
    └── loop_open_po_query.test.js     ← Unit tests for query/data layer (Jest, mocked N/query)
```

---

## NetSuite Script Metadata

| Property         | Value                                              |
|------------------|----------------------------------------------------|
| Script Type      | Suitelet                                           |
| Script ID        | `customscript_loop_open_po_suitelet`               |
| Deployment ID    | `customdeploy_loop_open_po_suitelet`               |
| API Version      | 2.1                                                |
| Entry Point      | `loop_open_po_suitelet.js` → `onRequest`           |
| Menu Path        | Transactions > Purchasing > Open Purchase Orders   |

---

## Architecture Decisions

### Rendering: Custom HTML via `response.write()`
Do **not** use `serverWidget`. The dashboard requires full layout control (KPI tiles, expandable rows, pagination). All HTML is built in `loop_open_po_html.js` and written to the response.

### Data: SuiteQL (N/query)
Use `N/query` with SuiteQL rather than `N/search`. Reasons:
- Better join performance for header + line aggregation in a single query
- Cleaner pagination with `OFFSET` / `FETCH NEXT`
- Easier to unit-test the query string in isolation

### State: URL Query Parameters
Filter state is persisted in the URL query string. On GET requests, the Suitelet reads `context.request.parameters` to hydrate filter values. No server-side session state.

### Routing
- `GET` with no `action` param → render full page
- `GET` with `action=export` → return CSV file response
- `POST` is not used; all filter changes reload the page via GET

---

## Data Layer (`loop_open_po_query.js`)

### Primary SuiteQL Query

Join `transaction` (PO header) to `transactionline` (PO lines). Aggregate line quantities at the header level for the summary row. Return one row per PO for the main table.

**Key fields to select:**

| Output Column         | SuiteQL Expression                                      | Notes                                    |
|-----------------------|---------------------------------------------------------|------------------------------------------|
| `po_id`               | `t.id`                                                  | Internal ID — use for hyperlink          |
| `po_number`           | `t.tranid`                                              | Display number                           |
| `vendor_id`           | `t.entity`                                              |                                          |
| `vendor_name`         | `builtin.df(t.entity)`                                  | Display name via built-in formula        |
| `po_date`             | `t.trandate`                                            |                                          |
| `expected_date`       | `t.custbody_expected_receipt_date`                      | **Confirm field ID before use**          |
| `location_id`         | `t.location`                                            |                                          |
| `location_name`       | `builtin.df(t.location)`                                |                                          |
| `subsidiary_id`       | `t.subsidiary`                                          | Omit in single-subsidiary accounts       |
| `subsidiary_name`     | `builtin.df(t.subsidiary)`                              |                                          |
| `status`              | `t.status`                                              | Filter values below                      |
| `currency`            | `builtin.df(t.currency)`                                |                                          |
| `foreign_total`       | `t.foreigntotal`                                        |                                          |
| `base_total`          | `t.total`                                               |                                          |
| `memo`                | `t.memo`                                                | Truncate to 80 chars in HTML layer       |
| `qty_ordered`         | `SUM(tl.quantity)`                                      | Aggregate across lines                   |
| `qty_received`        | `SUM(tl.quantityreceived)`                              | Aggregate across lines                   |
| `amount_received`     | `SUM(tl.quantityreceived * tl.rate)`                    | Approximation; use for display only      |
| `amount_remaining`    | `t.total - SUM(tl.quantityreceived * tl.rate)`          | Derived                                  |

**WHERE clause filters:**

```sql
t.type = 'PurchOrd'
AND t.status IN ('PurchOrd:B', 'PurchOrd:D', 'PurchOrd:E')
-- B = Pending Receipt, D = Partially Received, E = Pending Bill/Partially Billed
AND tl.isclosed = 'F'
AND tl.itemtype != 'Subtotal'
```

**Status code reference:**

| Display Status              | NS Status Code  |
|-----------------------------|-----------------|
| Pending Receipt             | `PurchOrd:B`    |
| Partially Received          | `PurchOrd:D`    |
| Pending Bill/Part. Billed   | `PurchOrd:E`    |

**GROUP BY:** `t.id, t.tranid, t.entity, t.trandate, t.custbody_expected_receipt_date, t.location, t.subsidiary, t.status, t.currency, t.foreigntotal, t.total, t.memo`

### Line-Level Detail Query

Separate SuiteQL query triggered when a user expands a PO row. Called via a GET request with `action=lines&po_id=<id>` and returns JSON.

**Fields:** `tl.line`, `tl.item`, `builtin.df(tl.item)`, `tl.description`, `tl.quantity`, `tl.quantityreceived`, `tl.units`, `tl.rate`, `tl.amount`, `tl.expectedreceiptdate`, `tl.custcol_item_category`, `tl.isclosed`

Filter: `tl.transaction = :po_id AND tl.isclosed = 'F' AND tl.itemtype != 'Subtotal'`

### Derived Line Status

Calculate in the data layer before returning to HTML:
```
if qty_received == 0             → "Open"
if qty_received < qty_ordered    → "Partial"
if qty_received >= qty_ordered   → "Received"
if line.isclosed == true         → "Closed"  (excluded from main query but shown if queried directly)
```

### Pagination

Use SuiteQL `FETCH NEXT n ROWS ONLY OFFSET m` pattern. Page size = 50. Pass `page` param in URL (1-indexed). Convert to offset: `offset = (page - 1) * 50`.

Run a separate `COUNT(*)` query with the same WHERE clause (no GROUP BY, no OFFSET) to get total record count for page controls.

### Dynamic Filter Application

Build the WHERE clause dynamically based on URL params. Use bind parameters (`:param_name`) — never string-concatenate user input into SQL.

```javascript
// Example pattern
let whereClause = `t.type = 'PurchOrd' AND t.status IN ('PurchOrd:B','PurchOrd:D','PurchOrd:E') AND tl.isclosed = 'F'`;
const params = {};

if (filters.vendor_id) {
  whereClause += ` AND t.entity = :vendor_id`;
  params.vendor_id = parseInt(filters.vendor_id);
}
if (filters.date_from) {
  whereClause += ` AND t.trandate >= :date_from`;
  params.date_from = filters.date_from; // 'YYYY-MM-DD'
}
// etc.
```

---

## HTML Layer (`loop_open_po_html.js`)

Returns a complete HTML string. The Suitelet writes this string directly to `context.response`.

### Page Structure

```
<html>
  <head> ... styles, inline CSS ... </head>
  <body>
    <div class="header-bar">        ← Page title + Export button
    <div class="filter-panel">      ← Collapsible filter controls
    <div class="kpi-bar">           ← 4 KPI tiles
    <div class="results-table">     ← Paginated PO table
      <thead> ... </thead>
      <tbody>
        <tr class="po-row">         ← One per PO (clickable to expand)
        <tr class="lines-row">      ← Hidden by default; shown on expand
      </tbody>
    </div>
    <div class="pagination">        ← Prev / Next / page info
    <script> ... inline JS ... </script>
  </body>
</html>
```

### Styling Rules

- **No external CSS or JS dependencies.** Inline `<style>` block only. No CDN links. NetSuite blocks most external resources in Suitelets.
- Color palette:
  - Navy `#1A3C6E` — headings, table headers
  - Blue `#2E75B6` — links, accents, KPI values
  - Light blue `#D9E8F5` — KPI tile backgrounds
  - Light grey `#F5F5F5` — alternating row shading
  - White `#FFFFFF` — primary row background
  - Red `#C0392B` — overdue indicator, High priority
  - Orange `#E67E22` — warning states, Medium priority
  - Green `#27AE60` — received status badge
- Font: system-ui, Arial, sans-serif stack
- Table: full-width, sticky `<thead>`, 1px `#CCCCCC` borders, 8px/12px cell padding
- KPI tiles: 4-up horizontal flexbox, rounded corners, bold large number, small label below

### KPI Tiles

| Tile Label             | Calculation Source                            |
|------------------------|-----------------------------------------------|
| Total Open POs         | COUNT of rows in current filtered result set  |
| Outstanding Value      | SUM of `amount_remaining` (base currency)     |
| Overdue POs            | COUNT where `expected_date < TODAY` and status != Received |
| Partially Received     | COUNT where status = `PurchOrd:D`             |

KPI values come from a separate aggregation query in `loop_open_po_query.js` → `getKpiSummary(filters)`.

### Expandable Lines

Lines are loaded lazily via a `fetch()` call to the same Suitelet URL with `action=lines&po_id=<id>`. On success, the hidden `<tr class="lines-row">` is populated and shown. Show a spinner in the lines row while loading.

```javascript
// Inline JS pattern
function toggleLines(poId, row) {
  const linesRow = document.getElementById('lines-' + poId);
  if (linesRow.dataset.loaded === 'true') {
    linesRow.style.display = linesRow.style.display === 'none' ? '' : 'none';
    return;
  }
  linesRow.style.display = '';
  linesRow.innerHTML = '<td colspan="12"><div class="spinner">Loading...</div></td>';
  fetch(window.location.pathname + '?action=lines&po_id=' + poId)
    .then(r => r.json())
    .then(data => {
      linesRow.innerHTML = buildLinesTable(data);
      linesRow.dataset.loaded = 'true';
    });
}
```

### Sorting

Column sort links append `sort_col=<col>&sort_dir=asc|desc` to the current URL. The query layer applies `ORDER BY` accordingly. Default: `expected_date ASC NULLS LAST, po_date ASC`.

### CSV Export

`action=export` route: runs the same filter query with no pagination limit (up to 2,000 rows). Sets response headers:
```javascript
context.response.setHeader({ name: 'Content-Type', value: 'text/csv' });
context.response.setHeader({ name: 'Content-Disposition', value: 'attachment; filename="open_po_export.csv"' });
```

### XSS Prevention

All user-visible string values (vendor names, memos, item names) must be HTML-escaped before injection into the template. Implement a simple `escHtml(str)` helper:
```javascript
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

---

## Main Suitelet (`loop_open_po_suitelet.js`)

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/url', 'N/runtime', './loop_open_po_query', './loop_open_po_html', './loop_open_po_export'],
(query, url, runtime, poQuery, poHtml, poExport) => {

  const onRequest = (context) => {
    const req = context.request;
    const res = context.response;
    const action = req.parameters.action || '';

    if (action === 'lines') {
      // Return JSON line detail for a single PO
      const poId = parseInt(req.parameters.po_id);
      const lines = poQuery.getPoLines(poId);
      res.setHeader({ name: 'Content-Type', value: 'application/json' });
      res.write(JSON.stringify(lines));
      return;
    }

    if (action === 'export') {
      poExport.writeCsv(context, req.parameters);
      return;
    }

    // Default: render full dashboard page
    const filters = poQuery.parseFilters(req.parameters);
    const { rows, totalCount } = poQuery.getOpenPos(filters);
    const kpis = poQuery.getKpiSummary(filters);
    const html = poHtml.buildPage({ filters, rows, totalCount, kpis, params: req.parameters });
    res.write(html);
  };

  return { onRequest };
});
```

---

## Filter Parameter Map

These are the URL parameter names Claude Code should use consistently across all modules:

| URL Param      | Type      | SuiteQL Field               | Notes                              |
|----------------|-----------|-----------------------------|------------------------------------|
| `status`       | multi     | `t.status`                  | Comma-separated NS status codes    |
| `vendor_id`    | int       | `t.entity`                  |                                    |
| `date_from`    | string    | `t.trandate >= :date_from`  | Format: `YYYY-MM-DD`               |
| `date_to`      | string    | `t.trandate <= :date_to`    | Format: `YYYY-MM-DD`               |
| `location_id`  | multi     | `t.location`                | Comma-separated internal IDs       |
| `subsidiary_id`| int       | `t.subsidiary`              | Omit query param in non-OneWorld   |
| `item_id`      | int       | `tl.item`                   |                                    |
| `overdue_only` | bool      | `t.custbody_expected_receipt_date < TODAY` | `'true'` or absent  |
| `exp_from`     | string    | Expected date range from    | Format: `YYYY-MM-DD`               |
| `exp_to`       | string    | Expected date range to      | Format: `YYYY-MM-DD`               |
| `currency`     | string    | `builtin.df(t.currency)`    | 3-letter ISO code                  |
| `min_value`    | float     | `t.total >= :min_value`     |                                    |
| `page`         | int       | OFFSET calc                 | Default: 1                         |
| `sort_col`     | string    | ORDER BY col name           | Whitelist allowed values           |
| `sort_dir`     | string    | `ASC` or `DESC`             | Default: `ASC`                     |

---

## Edge Cases to Handle in Code

Refer to the full requirements doc for detail. Priority items to implement defensively:

1. **No results** — render empty-state div, not an empty table
2. **Large result sets** — enforce 50-row page limit; warn if count > 2,000 on export
3. **Fully received but open PO** — detect `qty_received >= qty_ordered` and show a yellow warning badge on the row
4. **Multi-currency** — always show both `foreigntotal` (with ISO code) and `total` (base) as separate columns
5. **Blank expected date** — never include in overdue count; display as `—` in table
6. **Location/subsidiary access** — do NOT add `administrator` override context; let NS enforce access naturally via the query
7. **XSS** — escape all string values before HTML injection (see `escHtml` above)
8. **SQL injection** — use bind params always, never string-concatenate filter values
9. **Single-subsidiary account** — check `runtime.isFeatureInEffect({ feature: 'SUBSIDIARIES' })`; if false, hide subsidiary column and filter
10. **Sort column whitelist** — only allow known column names in `ORDER BY` to prevent SQL injection via `sort_col` param

---

## Acceptance Criteria (Test Checklist)

Before marking the Suitelet complete, verify:

- [ ] AC-01: Default view returns all POs in Pending Receipt, Partially Received, Pending Bill statuses
- [ ] AC-02: Status filter limits results to selected statuses only
- [ ] AC-03: Vendor filter limits results to that vendor
- [ ] AC-04: PO Number links open correct NS record (uses internal ID, not tranid)
- [ ] AC-05: Expanding a row shows correct line quantities and amounts
- [ ] AC-06: `amount_remaining` = `base_total` − `amount_received` for all rows
- [ ] AC-07: Overdue Only toggle returns POs where `expected_date < TODAY` only
- [ ] AC-08: KPI tiles update correctly when filters change
- [ ] AC-09: CSV export downloads all filtered rows (no pagination cap)
- [ ] AC-10: Users cannot see POs for locations outside their NS access
- [ ] AC-11: Page load ≤ 3s for default filter on accounts with ≤ 500 open POs
- [ ] AC-12: Empty state message shown when no results match
- [ ] AC-13: Pagination controls show correct page count and navigate correctly
- [ ] AC-14: Vendor names with `&`, `<`, `>` render correctly (no broken HTML)

---

## Open Questions (Resolve Before Starting)

These need answers from the NetSuite admin / account before certain code paths can be finalised:

| ID     | Question                                                                                      | Impacts                          |
|--------|-----------------------------------------------------------------------------------------------|----------------------------------|
| OQ-05  | Confirm field ID for expected receipt date — is it `custbody_expected_receipt_date`? Header or line level? | All date filter + overdue logic  |
| OQ-06  | Is `custcol_item_category` active and populated in this account?                              | Line detail query                |
| OQ-01  | Should POs pending multi-level approval be shown?                                             | WHERE clause status filter       |
| OQ-02  | Include drop-ship POs? If yes, add a visual indicator.                                        | Query + HTML badge               |
| OQ-03  | Are blanket/standing POs in use? If yes, line qty aggregation may need adjustment.            | Data layer aggregation           |
| OQ-07  | Should CSV export be restricted to Procurement Manager + Admin roles only?                    | Export route access check        |

---

## SuiteScript Conventions

- Always include JSDoc `@NApiVersion 2.1`, `@NScriptType`, `@NModuleScope` headers
- Use `define([...], (...) => { ... })` AMD module format
- No `async/await` — SuiteScript 2.1 does not support it in all contexts; use synchronous `N/query` calls
- Log governance usage: `log.debug('governance', runtime.getCurrentScript().getRemainingUsage())` at query entry points
- Hard governance limit: if `getRemainingUsage() < 100`, return a partial result with a UI warning rather than failing
- Use `log.error` with structured objects for error handling; never `console.log`
- All modules use relative `./` paths in `define()` — do not use absolute SuiteScript paths

---

## What NOT to Build in v1.0

- PO creation or editing
- Approval workflow actions
- Vendor portal / external access
- Mobile responsive layout
- Real-time WebSocket updates
- NetSuite email alerts from the Suitelet
- Any write operations to NetSuite records

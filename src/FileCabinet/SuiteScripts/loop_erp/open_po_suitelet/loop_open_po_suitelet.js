/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Open Purchase Order Dashboard — Main Entry Point
 * Script ID:     customscript_loop_open_po_suitelet
 * Deployment ID: customdeploy_loop_open_po_suitelet
 */
define(
  ['N/query', 'N/url', 'N/runtime', './loop_open_po_query', './loop_open_po_html', './loop_open_po_export'],
  (query, url, runtime, poQuery, poHtml, poExport) => {

    const onRequest = (context) => {
      const req = context.request;
      const res = context.response;
      const action = req.parameters.action || '';

      try {
        if (action === 'lines') {
          // Return JSON line detail for a single PO
          const poId = parseInt(req.parameters.po_id, 10);
          if (!poId || isNaN(poId)) {
            res.setHeader({ name: 'Content-Type', value: 'application/json' });
            res.write(JSON.stringify({ error: 'Invalid po_id' }));
            return;
          }
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
        const html = poHtml.buildPage({
          filters,
          rows,
          totalCount,
          kpis,
          params: req.parameters,
        });
        res.write(html);

      } catch (e) {
        log.error({ title: 'onRequest error', details: e.message + '\n' + e.stack });
        res.write('<h2 style="color:red;font-family:Arial">An error occurred loading the dashboard. Please try again or contact your administrator.</h2><pre>' + e.message + '</pre>');
      }
    };

    return { onRequest };
  }
);

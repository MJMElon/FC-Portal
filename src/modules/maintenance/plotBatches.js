/**
 * Which batches are standing in a plot right now.
 *
 * THE MAIN NURSERY MOVEMENT REPORT, AND NOTHING ELSE. One rule and no
 * exceptions: the batches a Field Conductor is offered for a plot, and the
 * quantity beside each, are that report's own. MOVE_COLS.main in the
 * office's operation_reports.html, column for column:
 *
 *   Balance = transplanted from PN + transfer in
 *           - sold - 3rd culled - transfer out + stock adjustment
 *
 * Two of those carry the report's own condition: a 3rd culling counts only
 * once the drone map has been keyed (MapQty:) — until the plot has been
 * flown the figure is a claim, and the report leaves the batch standing —
 * and a stock calibration only once [APPROVED …], keeping its own sign.
 *
 * Everything else takes no part, because that report has no column for it:
 * the 1st and 2nd cullings, Planted, Seeds_Received and Seed Damage.
 *
 * U1 is the worked example: the report prints batch 250 at 447 and batch
 * 252 at 4,201, 4,648 for the plot. So does this.
 *
 * A batch that works out to zero has been culled, sold or moved on and is
 * not offered. A PN plot has no main-nursery movement and offers nothing.
 *
 * SHARED RULE — shared/create_plot_batch_balance.sql is the same arithmetic
 * in the database, and is what the app actually reads; this is the fallback
 * for a database without that view. Change one, change the other.
 *
 * No imports, so it stays unit-testable in plain node.
 */

/* A 3rd culling counts only once the drone-map figure has been keyed. */
const CULL3_EVIDENCED = /MapQty:\s*\d+/;
/* An approved stock calibration, and only an approved one. Its
   quantity_change is ALREADY SIGNED: a Found is positive, a Stolen negative. */
const APPROVED = /\[APPROVED by [^\]]+ on [^\]]+\]/;
/* "3rd Culling transfer. From: [B7|main] To: ..." → B7. */
const SRC_PLOT = /From:\s*\[([^\]|]+)\|/;

/** A delivery order's plot, read forgivingly: "U15 (UPB PREMIER HYBRID)" → U15. */
export function plotKey(v) {
  return String(v == null ? '' : v).trim().toUpperCase()
    .replace(/^PLOT\s*:?\s*/, '')
    .split(/[\s(,[]/)[0]
    .replace(/[^0-9A-Z-]/g, '');
}

/**
 * A batch by its trailing digits: "MJM-225", "225." and " 225 " are all 225.
 *
 * A PARENTHETICAL NOTE GOES FIRST. "232 (B13)" is batch 232, not batch 13 —
 * left in, the trailing-digits rule reads the "13" inside the note and files
 * the row under a batch nobody meant. Not hypothetical: it is the bug
 * _mvBatchKey() in the office's operation_reports.html records having hit, on
 * a delivery order whose batch field read "232 (B13)". Same split plotKey
 * already does for its own notes.
 *
 * SHARED RULE - _mvBatchKey() in operation_reports.html and mjm_batch_key()
 * in shared/create_plot_batch_balance.sql. Change one, change the others.
 */
export function batchKey(v) {
  const noNote = String(v == null ? '' : v).trim().split(/[\s(,[]/)[0];
  const cleaned = noNote.replace(/[^0-9A-Za-z]+$/, '');
  const m = /(\d+)$/.exec(cleaned);
  return m ? String(parseInt(m[1], 10)) : '';
}

/**
 * → Map(plotKey → [{ batch, qty }]), biggest first.
 * `logs` are shared_inventory_logs rows; `dos` are shared_do_records rows.
 */
export function batchesByPlot(logs, dos) {
  const bal = new Map();   // plotKey → Map(batchKey → { batch, qty })
  const add = (plot, batch, n) => {
    const pk = plotKey(plot), bk = batchKey(batch);
    if (!pk || !bk || !n) return;
    if (!bal.has(pk)) bal.set(pk, new Map());
    const m = bal.get(pk);
    if (!m.has(bk)) m.set(bk, { batch, qty: 0 });
    m.get(bk).qty += n;
  };

  for (const l of logs || []) {
    const q = Math.abs(Number(l.quantity_change || 0));
    switch (l.transaction_type) {
      case 'Transplanted':                       // transplanted from PN
        add(l.plot_name, l.batch_name, q); break;
      case '3rd_Culling':                        // once flown, and only then
        if (CULL3_EVIDENCED.test(l.remark || '')) add(l.plot_name, l.batch_name, -q);
        break;
      case 'Cull3_Transfer': {                   // one log, two sides
        add(l.plot_name, l.batch_name, q);
        const from = (l.remark || '').match(SRC_PLOT);
        if (from) add(from[1], l.batch_name, -q);
        break;
      }
      case 'Stock_Calibration':                  // approved only, sign as stored
        if (APPROVED.test(l.remark || '')) add(l.plot_name, l.batch_name, Number(l.quantity_change) || 0);
        break;
      default: break;   // no column on the main report, so no part here
    }
  }

  // A delivery order can only take seedlings OFF a plot that already has them.
  // Its batch column is free text, so a mistyped batch must not conjure one up.
  for (const d of dos || []) {
    if (d.status === 'Cancelled' || String(d.remark || '').includes('[CANCELLED]')) continue;
    for (let i = 1; i <= 5; i++) {
      const qty = Number(d[`qty_${i}`] || 0);
      if (!qty) continue;
      const pk = plotKey(d[`plot_${i}`]), bk = batchKey(d[`batch_${i}`]);
      if (!pk || !bk) continue;
      const m = bal.get(pk);
      if (!m || !m.has(bk)) continue;
      m.get(bk).qty -= qty;
    }
  }

  // Same rule as the movement report: a batch whose balance works out to zero
  // has been culled, sold or moved on and is not offered. A NEGATIVE balance
  // is kept — the report shows those too, and hiding them here would mean the
  // field could not record work on a plot the office can see stock in.
  // Ordered by batch number, so the list reads against the report row for row.
  // { batch, qty } and nothing else, which is exactly what the view path's
  // mapFromBalances() hands back — the two must be indistinguishable to the
  // form, or a phone with the view and one without would behave differently.
  const out = new Map();
  bal.forEach((m, pk) => {
    const list = [...m.values()]
      .filter((b) => b.qty !== 0)
      .sort((a, b) => (parseInt(batchKey(a.batch), 10) || 0) - (parseInt(batchKey(b.batch), 10) || 0))
      .map((b) => ({ batch: b.batch, qty: b.qty }));
    if (list.length) out.set(pk, list);
  });
  return out;
}

/** The batches standing in one plot, however its name happens to be spelt. */
export function batchesIn(map, plot) {
  return (map && map.get(plotKey(plot))) || [];
}

/**
 * Which batches are standing in a plot right now.
 *
 * The same arithmetic the Operation Reports movement report does, so the
 * batches a Field Conductor ticks in the field are the ones that report says
 * are there: transplanted in, plus anything transferred in and any approved
 * stock calibration, less the culls, the sales and anything transferred out.
 * A batch whose balance works out to zero has been culled, sold or moved on,
 * and is not offered.
 *
 * "The same arithmetic" is load-bearing and was once only a claim: this file
 * deducted the 2nd culling, counted an unevidenced 3rd and ignored stock
 * calibrations altogether, so the phone showed -2 where the office showed
 * 447 and 4,191 where it showed 4,201. See the notes on OUT_TYPES below.
 *
 * No imports, so it stays unit-testable in plain node.
 */

const IN_TYPES  = ['Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone', 'Planted', 'Seeds_Received'];
/* 2nd_Culling is NOT here and never is: it is Batch Detail Tab 6's running
   snapshot of a batch working through the 3rd culling, not a loss on top of
   it, and the Movement Report gives it no column at all. Deducting it is
   what made U1's batch 252 read 4,191 where the report read 4,201.
   3rd_Culling is not here either — it deducts only once evidenced, below. */
const OUT_TYPES = ['Damaged_Seeds', '1st_Culling'];

/* A 3rd culling counts only once the drone-map figure has been keyed. Until
   the plot has been flown the culled figure is a claim, and one still waiting
   on its map leaves the batch standing on the report — so it leaves it
   standing here.
   SHARED RULE — the same test in operation_reports.html (runLifeOfPlot and
   runMovementReportCombined) and in shared/create_plot_batch_balance.sql. */
const CULL3_EVIDENCED = /MapQty:\s*\d+/;

/* An approved stock calibration, and only an approved one. The same marker
   operation_batch_detail.html writes and the Movement Report reads; a pending
   adjustment has not been ruled on and moves no figure anywhere else, so it
   must not move one here. Its quantity_change is ALREADY SIGNED — a Found is
   positive, a Stolen or over-allocation negative — so it is added as stored,
   not as a fixed direction like every other type above.
   SHARED RULE — the same test is in shared/create_plot_batch_balance.sql and
   in operation_reports.html. Change one, change the others. */
const APPROVED = /\[APPROVED by [^\]]+ on [^\]]+\]/;

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
  const cell = (plot, batch) => {
    const pk = plotKey(plot), bk = batchKey(batch);
    if (!pk || !bk) return null;
    if (!bal.has(pk)) bal.set(pk, new Map());
    const m = bal.get(pk);
    if (!m.has(bk)) m.set(bk, { batch, qty: 0 });
    return m.get(bk);
  };
  const add = (plot, batch, n) => { const c = cell(plot, batch); if (c) c.qty += n; };

  for (const l of logs || []) {
    const q = Math.abs(Number(l.quantity_change || 0));
    if (IN_TYPES.includes(l.transaction_type))  add(l.plot_name, l.batch_name, q);
    else if (OUT_TYPES.includes(l.transaction_type)) add(l.plot_name, l.batch_name, -q);
    else if (l.transaction_type === '3rd_Culling') {
      if (CULL3_EVIDENCED.test(l.remark || '')) add(l.plot_name, l.batch_name, -q);
    } else if (l.transaction_type === 'Cull3_Transfer') {
      // One log, two sides: plot_name is where they landed, the remark says
      // where they left.
      add(l.plot_name, l.batch_name, q);
      const from = (l.remark || '').match(/From:\s*\[([^\]|]+)\|/);
      if (from) add(from[1], l.batch_name, -q);
    } else if (l.transaction_type === 'Stock_Calibration') {
      if (!APPROVED.test(l.remark || '')) continue;
      add(l.plot_name, l.batch_name, Number(l.quantity_change) || 0);
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

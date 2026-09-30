/**
 * Which batches are standing in a plot right now.
 *
 * THIS IS THE MOVEMENT REPORT, both of its sections, and nothing else. The
 * batches a Field Conductor is offered and the quantity beside each are the
 * ones Operation Reports shows for that plot; if the two ever disagree, one
 * of them has a bug. The rules are written out at the top of runLifeOfPlot()
 * in operation_reports.html and are mirrored here line for line:
 *
 *   MAIN NURSERY (MOVE_COLS.main)
 *     + Transplanted from PN, arriving at the plot named on the row
 *     + Transfer in  (Cull3_Transfer, the side that arrived)
 *     - Transfer out (the same log, leaving the plot its remark names)
 *     - 3rd culled, ONLY ONCE EVIDENCED (MapQty: keyed — until the plot has
 *       been flown the culled figure is a claim, and the report leaves the
 *       batch standing)
 *     - Sold (delivery orders, against a plot·batch the ledger already has)
 *     + Stock adjustment, approved only, with its own sign
 *
 *   PRE-NURSERY (MOVE_COLS.pre) — what gives a PN plot (P01–P52) and the
 *   PREMIUM CARE / DOUBLE-TONE holding trays their batches
 *     + Planted into the tray
 *     + Transfer in (a Premium Care / Double Tone tray filling up)
 *     - 1st culled, in the tray
 *     - Transplanted out: the SOURCE tray's own loss, read from the remark
 *
 *   THE 2ND CULLING NEVER DEDUCTS, in either section. It is Batch Detail
 *   Tab 6's running snapshot of a batch working through the 3rd culling,
 *   not a loss on top of it, and the report gives it no column at all.
 *
 *   SEED DAMAGE never entered a tray, so it counts at zero — the report
 *   shows it and does not subtract it. Seeds_Received is not a movement
 *   column in either section.
 *
 * A batch whose balance works out to zero has been culled, sold or moved on
 * and is not offered.
 *
 * "The same arithmetic" is load-bearing and was once only a claim. This file
 * deducted the 2nd culling, counted an unevidenced 3rd, ignored stock
 * calibrations and never deducted a transplant from its source tray — so the
 * phone showed -2 where the office showed 447, 4,191 where it showed 4,201,
 * and trays carrying seedlings they had sent to the field months earlier.
 *
 * No imports, so it stays unit-testable in plain node.
 */

/* A 3rd culling counts only once the drone-map figure has been keyed.
   SHARED RULE — the same test in operation_reports.html (runLifeOfPlot and
   runMovementReportCombined) and in shared/create_plot_batch_balance.sql. */
const CULL3_EVIDENCED = /MapQty:\s*\d+/;

/* An approved stock calibration, and only an approved one — a pending
   adjustment has not been ruled on and moves no figure anywhere else. Its
   quantity_change is ALREADY SIGNED: a Found is positive, a Stolen negative.
   SHARED RULE — same marker in operation_reports.html and the view. */
const APPROVED = /\[APPROVED by [^\]]+ on [^\]]+\]/;

/* "Transplanted from tray [T4] to Main Plot [U1]" → T4. The source tray's
   own loss: without it a tray goes on showing seedlings it sent to the field
   months ago, and the holding trays never net out. */
const SRC_TRAY = /from tray \[([^\]]+)\]/i;
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
    const t = l.transaction_type;

    // Every transplant out of a tray is that tray's own loss, whichever
    // section the seedlings arrived in.
    if (t === 'Transplanted' || t === 'Transplanted_Premium' || t === 'Transplanted_DoubleTone') {
      const src = (l.remark || '').match(SRC_TRAY);
      if (src) add(src[1], l.batch_name, -q);
      // …and the plot or tray named on the row gains them.
      add(l.plot_name, l.batch_name, q);
      continue;
    }
    if (t === 'Planted') { add(l.plot_name, l.batch_name, q); continue; }
    if (t === '1st_Culling') { add(l.plot_name, l.batch_name, -q); continue; }
    if (t === '3rd_Culling') {
      if (CULL3_EVIDENCED.test(l.remark || '')) add(l.plot_name, l.batch_name, -q);
      continue;
    }
    if (t === 'Cull3_Transfer') {
      add(l.plot_name, l.batch_name, q);
      const from = (l.remark || '').match(SRC_PLOT);
      if (from) add(from[1], l.batch_name, -q);
      continue;
    }
    if (t === 'Stock_Calibration') {
      if (APPROVED.test(l.remark || '')) add(l.plot_name, l.batch_name, Number(l.quantity_change) || 0);
      continue;
    }
    // 2nd_Culling, Damaged_Seeds, Seeds_Received and everything else: no
    // column in either section of the report, so no part here.
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

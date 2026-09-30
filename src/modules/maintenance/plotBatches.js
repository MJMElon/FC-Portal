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
 * took the 2nd culling off on top of the 3rd and ignored stock calibrations
 * altogether, so the phone showed -2 where the office showed 447. See the
 * 2nd-culling note in batchesByPlot below.
 *
 * No imports, so it stays unit-testable in plain node.
 */

const IN_TYPES  = ['Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone', 'Planted', 'Seeds_Received'];
const OUT_TYPES = ['Damaged_Seeds', '1st_Culling', '2nd_Culling', '3rd_Culling'];

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

/** A batch by its trailing digits: "MJM-225", "225." and " 225 " are all 225. */
export function batchKey(v) {
  const cleaned = String(v == null ? '' : v).trim().replace(/[^0-9A-Za-z]+$/, '');
  const m = /(\d+)$/.exec(cleaned);
  return m ? String(parseInt(m[1], 10)) : '';
}

/**
 * → Map(plotKey → [{ batch, qty }]), biggest first.
 * `logs` are shared_inventory_logs rows; `dos` are shared_do_records rows.
 */
export function batchesByPlot(logs, dos) {
  const bal = new Map();   // plotKey → Map(batchKey → { batch, qty, cull2, cull3 })
  const cell = (plot, batch) => {
    const pk = plotKey(plot), bk = batchKey(batch);
    if (!pk || !bk) return null;
    if (!bal.has(pk)) bal.set(pk, new Map());
    const m = bal.get(pk);
    if (!m.has(bk)) m.set(bk, { batch, qty: 0, cull2: 0, cull3: 0 });
    return m.get(bk);
  };
  const add = (plot, batch, n) => { const c = cell(plot, batch); if (c) c.qty += n; };

  for (const l of logs || []) {
    const q = Math.abs(Number(l.quantity_change || 0));
    if (IN_TYPES.includes(l.transaction_type))  add(l.plot_name, l.batch_name, q);
    else if (OUT_TYPES.includes(l.transaction_type)) {
      add(l.plot_name, l.batch_name, -q);
      // Kept aside so the 2nd culling can be given back below where a 3rd
      // has since replaced it.
      if (l.transaction_type === '2nd_Culling' || l.transaction_type === '3rd_Culling') {
        const c = cell(l.plot_name, l.batch_name);
        if (c) c[l.transaction_type === '2nd_Culling' ? 'cull2' : 'cull3'] += q;
      }
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

  /* THE 2ND CULLING COUNTS ONLY UNTIL A 3RD REPLACES IT.

     The 3rd culling is keyed against the ORIGINAL transplanted figure, not
     against what was left of it, so it already contains the 2nd. Taking both
     off subtracts the same seedlings twice, and the tell is a batch that
     should have netted to nought reading as a small negative instead — B1's
     batch 237 read -2 that way.

     SHARED RULE — the same one liveCount() applies in
     shared/shared_plot_movement.js (which decides what a maintenance plot's
     capacity is worth in the payroll), the same one the Movement Report
     applies by giving 2nd Culled no column at all, and the same one
     create_plot_batch_balance.sql now applies in the database. Change one,
     change the others, or the phone and the office go back to disagreeing. */
  bal.forEach((m) => m.forEach((b) => { if (b.cull3 > 0) b.qty += b.cull2; }));

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

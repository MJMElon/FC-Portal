// 2nd cull (Pusing Polibeg) — the list, the month it belongs to, and the
// request's wording. Pure, so the rule can be checked without a database.
//
// THE RULE: a batch is due its 2nd cull in the fourth month after it was first
// transplanted into a plot. "First" means the earliest transplant of that
// plot-and-batch, and the month is the same month label the Batch Report
// fills in from the transplant date.
//
// The list is worked out from the ledger on every screen rather than stored,
// so it cannot drift from the ledger. Only the nursery's completion and the
// month's Nelos case are stored (nops_2nd_cull_nursery, nops_2nd_cull_case).
//
// Shared with mjm-ai-system: the Batch Record page reads the same status, and
// the month key 'YYYY-MM' is what both sides agree on.

import { batchKey, plotKey } from './plotBatches.js';
import { isReplantPlot, nurseryOfPlot } from '../palms/data.js';

export const SECOND_CULL_AFTER_MONTHS = 4;
export const SECOND_CULL_CATEGORY = 'Request Drone Terbang (2nd cull)';
export const SECOND_CULL_PRIORITY = 'normal';
export const SECOND_CULL_NURSERIES = ['BNN', 'UNN1', 'UNN2'];

// Places that appear in the transplant ledger but are not a nursery plot, and
// are not part of the 2nd cull. Premium Care is one of them. Skipped outright,
// so they are not listed even as "not placed".
// plotKey cuts a name at its first space, so "Premium Care" arrives as PREMIUM.
export const NOT_A_PLOT = ['PREMIUM', 'PREMIUMCARE'];

// The transplant types the Batch Report counts as moved into a plot.
export const TRANSPLANT_TYPES = ['Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone'];

function monthIndex(ym) {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

function ymOf(index) {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** The month label for today: 'YYYY-MM'. Local time, so the 1st is the 1st. */
export function monthKeyOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The transplant month whose 2nd cull falls due in `dueYm`. */
export function transplantMonthOf(dueYm) {
  return ymOf(monthIndex(dueYm) - SECOND_CULL_AFTER_MONTHS);
}

/** The month the 2nd cull for a transplant month falls due. */
export function dueMonthOf(transplantYm) {
  return ymOf(monthIndex(transplantYm) + SECOND_CULL_AFTER_MONTHS);
}

function batchNumber(b) {
  const n = parseInt(b, 10);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * The 2nd cull due in `month`, grouped by nursery.
 *
 * @param rows   shared_inventory_logs rows of TRANSPLANT_TYPES, with
 *               plot_name, batch_name, transaction_date, created_at
 * @param month  'YYYY-MM'
 * @returns { items: { [nursery]: [{ plot, batch }] }, unplaced: [{ plot, batch }] }
 *   `unplaced` is a plot the ledger has but no nursery claims. It is named,
 *   never dropped: a due batch that appears on no list is the worst outcome.
 */
export function dueItems(rows, month) {
  const first = new Map(); // "PLOT#BATCH" -> { plot, batch, ym }
  for (const r of rows || []) {
    if (r.transaction_type && !TRANSPLANT_TYPES.includes(r.transaction_type)) continue;
    const plot = plotKey(r.plot_name);
    const batch = batchKey(r.batch_name);
    if (!plot || !batch || isReplantPlot(plot) || NOT_A_PLOT.includes(plot)) continue;
    const ym = String(r.transaction_date || r.created_at || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const key = `${plot}#${batch}`;
    const prev = first.get(key);
    if (!prev || ym < prev.ym) first.set(key, { plot, batch, ym });
  }

  const items = {};
  const unplaced = [];
  for (const e of first.values()) {
    if (dueMonthOf(e.ym) !== month) continue;
    const nursery = nurseryOfPlot(e.plot);
    if (!nursery) { unplaced.push({ plot: e.plot, batch: e.batch }); continue; }
    (items[nursery] = items[nursery] || []).push({ plot: e.plot, batch: e.batch });
  }
  const byPlotThenBatch = (a, b) =>
    a.plot.localeCompare(b.plot, undefined, { numeric: true })
    || batchNumber(a.batch) - batchNumber(b.batch);
  for (const n of Object.keys(items)) items[n].sort(byPlotThenBatch);
  unplaced.sort(byPlotThenBatch);
  return { items, unplaced };
}

/** The plots of one nursery, each with its batches, in plot order. */
export function plotsOf(list) {
  const byPlot = new Map();
  for (const { plot, batch } of list || []) {
    if (!byPlot.has(plot)) byPlot.set(plot, []);
    byPlot.get(plot).push(batch);
  }
  return [...byPlot.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([plot, batches]) => ({ plot, batches }));
}

/**
 * The Nelos case body. The wording is the office's own, one line per nursery,
 * and it names only plots: the drone flies the plot, and the batches are on
 * the list the nursery already has.
 */
export function requestText(items) {
  const lines = ['Request Drone Terbang', ''];
  for (const n of SECOND_CULL_NURSERIES) {
    const plots = plotsOf(items[n]).map((p) => p.plot);
    if (plots.length) lines.push(`${n}: ${plots.join(', ')}`);
  }
  lines.push('', 'Tujuan: Pusing Polibeg');
  return lines.join('\n');
}

/** Each nursery's 'done' rows, keyed by nursery code. */
export function doneByNursery(rows) {
  const out = {};
  for (const r of rows || []) out[r.nursery] = r;
  return out;
}

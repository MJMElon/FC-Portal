import { fetchAllRows, supabase } from '../../lib/supabase.js';
import { cacheBlocks, cachedBlocks } from './cullingOffline.js';
import { isOnline } from '../../lib/outbox.js';
import { batchKey, plotKey } from '../maintenance/plotBatches.js';
import { nurseryOfPlot, todayStr } from './data.js';

/**
 * Where the Culling Calculator's numbers come from.
 *
 * The whole calculation was taken out to be rebuilt, and this is the one place
 * it goes back in. The screen reads only from here, so wiring the calculator
 * up means filling in these functions and touching nothing else.
 *
 * The list is now gated on ONE thing: PALMS's plot status. A plot is on this
 * screen when it is at Pengambilan, full stop — a Field Conductor moving it
 * there is what puts it here, and moving it on is what takes it off. This was
 * tried once before and reverted (see pengambilanPlots below for the two
 * ways it failed), so this is a considered second attempt, not an oversight
 * of the first one. What changed is the batch step: rather than the screen
 * guessing which batch in the plot is meant, the Field Conductor is handed
 * every batch standing there and picks the one they are standing in front
 * of. A young batch with nothing to judge yet is still offered — it is on
 * the person, not the screen, to know they have not started collecting from
 * it.
 *
 * Three reads, all matched on the plot AND the batch together where a batch
 * applies:
 *
 *   pengambilan   The PLOT STATUS. Decides which plots are offered at all.
 *   transplanting The Batch Report's Transplanting tab — decides which
 *                 batches within an offered plot are offered, and supplies
 *                 the transplanted-in figure.
 *   delivery      Still read, but only for the COLLECTED figure once a plot
 *   orders        and batch are chosen. It is a figure now, not a gate.
 *   3rd culling   The Batch Report. A block leaves this screen when its 3rd
 *                 culling row carries a drone MAP QUANTITY — not when it
 *                 carries a culled figure, which goes in while the counting
 *                 is still under way.
 *
 * and the balance is the difference:
 *
 *     balance = transplanted in  −  collected
 *
 * which is what the ten percent line is drawn against.
 *
 * EVERY one of those reads is matched on the plot AND the batch together.
 * Neither is enough on its own: one plot holds several batches, and one batch
 * can be spread over several plots, so matching on either alone would pour
 * one block's figures into another's.
 *
 * What was removed, in case any of it is worth having back (git has it all,
 * up to commit f79a4c5):
 *
 *   cullingScope.js    which plots to list, taken from the delivery orders
 *   cullingFigures.js  the ledger reads behind Transplant and Baki
 *   cullingCycles.js   splitting a plot into intakes by transplanting month,
 *                      the batches inside one, and the selling window
 *   cullingData.js     cullingRate, hasFigures, figuresBroken
 */

/**
 * Which plots are at Pengambilan, right now. THE gate for the plot list.
 *
 * This was the gate once before, was reverted, and is the gate again — on
 * the person who asked for it back knowing why it left. It failed in both
 * directions the first time:
 *
 *   Status is easy to lose by accident. Every activity left out of a day's
 *   PALMS selection is recorded as finished, so one Field Conductor saving a
 *   day's log without Pengambilan in it silently closed that status across a
 *   whole nursery — emptying the calculator while customers were still
 *   actively collecting.
 *
 *   Status doesn't distinguish batches. One plot at Pengambilan can hold a
 *   batch a month from empty right beside one transplanted last week —
 *   gating on plot status alone offered the Field Conductor young stock with
 *   nothing yet to judge.
 *
 * Neither failure is fixed here — they can't be, from a plot status alone.
 * What changed is what the SECOND one costs: the plot no longer carries a
 * figure by itself. Choosing a plot at Pengambilan is only the first step;
 * the Field Conductor still has to choose which batch standing in it they
 * mean, by name, off a list built from the Batch Report (loadTransplanting),
 * not guessed at from this status. A young batch offered by mistake is a
 * batch somebody has to actively pick before it can do anything, not one
 * silently averaged into a figure. The first failure — losing the status by
 * accident — is unchanged and is the field's problem to keep an eye on, the
 * same as any other PALMS status.
 *
 * A -R plot never appears — see loadPlots, which applies isReplantPlot to
 * every batch this returns before it reaches the screen.
 *
 * Matched by NAME rather than by "the last stage in the list", because the
 * list is the office's to extend: a nursery that adds a stage after
 * Pengambilan (Up-keep, say) would otherwise silently move the gate onto it.
 * Falls back to the last stage only when nothing is named Pengambilan at all.
 *
 * A split plot logs against "B2#A". The plot is what the delivery orders and
 * the batch report name, so an area at Pengambilan puts its PLOT on the
 * screen — the batches inside it come from the Batch Report either way.
 *
 * @returns {Promise<Set<string>|null>} plot keys, or null when the read
 *   failed — never an empty set standing in for "could not tell".
 */
/** Every delivery order, or null if they could not be read. Its own function
    so the diagnosis below reads exactly what the list reads. */
async function loadDeliveryOrders() {
  const res = await fetchAllRows(() =>
    supabase
      .from('shared_do_records')
      .select(
        'do_number, delivery_date, status, remark, ' +
          'plot_1, batch_1, qty_1, plot_2, batch_2, qty_2, plot_3, batch_3, qty_3, ' +
          'plot_4, batch_4, qty_4, plot_5, batch_5, qty_5'
      )
      .order('id', { ascending: true })
  );
  if (res.error) {
    console.warn('[culling] could not read the delivery orders:', res.error.message);
    return null;
  }
  return res.data || [];
}

/* ── THE STATUSES THAT PUT A PLOT ON THIS SCREEN ──────────────────────
   Collecting does not happen at one status. Saringan Anak Bibit is the
   screening pass, and seedlings go out of a plot during it just as they do
   at Pengambilan, so a plot at either is a plot a Field Conductor may be
   standing in with stock leaving it. Gating on Pengambilan alone hid the
   screening plots from the calculator entirely.

   Named here, once, rather than written into the query: adding the next
   one is a line in this list, and the fallback below only fires when NONE
   of them is in the office stage list at all.

   Compared on letters and digits, upper-cased -- the same rule
   nurseryKey/plotKey use everywhere else in this system. The office types
   these names by hand, so "Saringan Anak Bibit", "saringan anak bibit" and
   a stray double space are the same stage. It cannot merge two different
   stages: two names differing by a letter or digit give different keys. */
const stageKey = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const CULLING_STAGES = new Set([
  stageKey('Pengambilan'),
  stageKey('Saringan Anak Bibit'),
]);

/**
 * Which plots PALMS says are at Pengambilan or Saringan Anak Bibit, right
 * now.
 *
 * Read for the DIAGNOSIS, not for the list. The status answers a question
 * about a plot — is the field collecting from it — and the calculator's
 * question is about a batch: is this block nearly empty. One does not answer
 * the other. A plot at Pengambilan holds batches months apart in age, and
 * the young ones have nothing to judge.
 *
 * It is not a gate for a second reason: it can be lost. Every activity left
 * out of a day's PALMS selection is recorded as finished, so one save from a
 * screen that had not finished syncing closed Pengambilan across a whole
 * nursery. Gating on it emptied the calculator while customers were still
 * collecting.
 *
 * So what it does now is report. cullDebug names a plot being collected from
 * that nobody has moved to Pengambilan, which is a missing status worth
 * fixing — but it is the field's problem to fix, not a reason to hide the
 * work from the Field Conductor standing in front of it.
 *
 * Matched by NAME rather than by "the last stage in the list", because the
 * list is the office's to extend: a nursery that adds a stage after the last
 * collecting one (Up-keep, say) would otherwise silently move the gate onto
 * it. Falls back to the last stage only when NONE of the names below is in
 * the list at all.
 *
 * A split plot logs against "B2#A". The plot is what the delivery orders and
 * the batch report name, so an area at one of these statuses puts its PLOT
 * on the screen — the figures are per batch either way.
 */
export async function pengambilanPlots() {
  const [logs, stages] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from('fcportal_palms_plot_logs')
        .select('plot_name, act_n, end_date')
        .is('end_date', null)
        .order('id', { ascending: true })
    ),
    supabase.from('nops_plot_status_stages').select('name, sort_order').order('sort_order'),
  ]);
  if (logs.error) {
    console.warn('[culling] could not read the plot status:', logs.error.message);
    return null;                 // null = could not tell, which is not "none"
  }
  if (stages.error || !(stages.data || []).length) {
    console.warn('[culling] could not read the stage list:', stages.error && stages.error.message);
    return null;
  }
  const list = stages.data;
  /* Every stage whose name is one of CULLING_STAGES, not just the first
     one found. A plot is offered when it sits at ANY of them. */
  const want = new Set(
    list.filter((x) => CULLING_STAGES.has(stageKey(x.name))).map((x) => x.sort_order)
  );
  /* Nothing recognised at all — the office has renamed the lot. Fall back
     to the last stage, which is what this did when it knew one name. */
  if (!want.size) want.add(list[list.length - 1].sort_order);
  const out = new Set();
  (logs.data || []).forEach((r) => {
    if (!want.has(r.act_n)) return;
    out.add(plotKey(String(r.plot_name || '').split('#')[0]));
  });
  return out;
}

/**
 * What is RUNNING on a plot right now, split into the statuses that put it
 * on this screen and the ones that do not.
 *
 * Read before the confirm, so the question can name them: Pengambilan
 * closes, Membesar keeps running, the board will show Membesar only. A
 * dialog that says "the collecting status" in the abstract leaves the admin
 * to work out which of the plot two running activities that means, and the
 * answer decides whether they press OK.
 *
 * Both lists come back EMPTY rather than null on a failure the caller can
 * see, so a caller can tell "nothing is running" from "could not ask".
 */
export async function openStatuses(plot) {
  const want = plotKey(String(plot || '').split('#')[0]);
  const out = { collecting: [], other: [] };
  if (!want) return out;

  const stages = await supabase
    .from('nops_plot_status_stages').select('name, sort_order').order('sort_order');
  if (stages.error || !(stages.data || []).length) throw new Error('no stage list');
  const nameOf = new Map((stages.data || []).map((x) => [x.sort_order, x.name]));

  const open = await supabase
    .from('fcportal_palms_plot_logs')
    .select('plot_name, act_n')
    .is('end_date', null);
  if (open.error) throw new Error(open.error.message);

  (open.data || []).forEach((r) => {
    if (plotKey(String(r.plot_name || '').split('#')[0]) !== want) return;
    const name = nameOf.get(r.act_n);
    if (!name) return;
    const side = CULLING_STAGES.has(stageKey(name)) ? out.collecting : out.other;
    if (!side.includes(name)) side.push(name);
  });
  return out;
}

/**
 * Close the collecting status on a plot, so it leaves this screen.
 *
 * What the X in the plot picker does. It is NOT a delete: the log row is
 * kept and given an end_date, exactly as PALMS does when a Field Conductor
 * saves a day without that activity ticked. The period the plot really was
 * at Pengambilan stays in the history where the board, the reports and
 * anybody looking back can still see it. Deleting the row would take a real
 * collecting period out of the record to tidy up a list.
 *
 * Why it is needed at all: an activity is closed as a side effect of saving
 * THAT plot, and nothing else ever closes one. A plot nobody saves again
 * keeps every open row open for ever — B4 sat on this screen reading
 * Membesar on the board with a Pengambilan row open since June. Until now
 * the only way out was to open PALMS and save a day for that plot.
 *
 * Online only, deliberately. This is office tidying on a record other
 * people are reading, not field work with a bar of signal — and queueing it
 * would mean an admin taps X, sees the plot go, and finds it back tomorrow
 * because the send failed. Better to say so now.
 *
 * Returns how many rows were closed. 0 means the plot was already clear,
 * which is worth telling apart from a failure.
 */
export async function closeCollectingStatus(plot) {
  const want = plotKey(String(plot || '').split('#')[0]);
  if (!want) throw new Error('no plot named');
  if (!isOnline()) throw new Error('offline');

  const stages = await supabase
    .from('nops_plot_status_stages').select('name, sort_order').order('sort_order');
  if (stages.error || !(stages.data || []).length) {
    throw new Error((stages.error && stages.error.message) || 'no stage list');
  }
  const list = stages.data;
  let acts = list.filter((x) => CULLING_STAGES.has(stageKey(x.name))).map((x) => x.sort_order);
  if (!acts.length) acts = [list[list.length - 1].sort_order];

  /* Read the ids first and match the plot HERE rather than with a pattern in
     the query. A split plot logs against "B2#A", and a LIKE that caught it
     would also catch B20 — closing a status on a plot nobody asked about. */
  const open = await supabase
    .from('fcportal_palms_plot_logs')
    .select('id, plot_name, act_n')
    .is('end_date', null)
    .in('act_n', acts);
  if (open.error) throw new Error(open.error.message);

  const ids = (open.data || [])
    .filter((r) => plotKey(String(r.plot_name || '').split('#')[0]) === want)
    .map((r) => r.id);
  if (!ids.length) return 0;

  const res = await supabase
    .from('fcportal_palms_plot_logs')
    .update({ end_date: todayStr() })
    .in('id', ids);
  if (res.error) throw new Error(res.error.message);
  return ids.length;
}

/* Whether the last loadPlots() answered from the device rather than the
 * office, and how old that copy is.
 *
 * The screen needs this and could not work it out for itself. An empty list
 * was drawn as "No plot is at Pengambilan yet" whatever the reason for it —
 * so a phone that had simply never loaded anything told a Field Conductor
 * there was no culling to do, which is a statement about the nursery made
 * from a fact about the network. Same bug the Maintenance board had.
 */
let _lastFromCache = false;

export function lastLoadWasCached() {
  return _lastFromCache;
}

/** When the device's copy of the blocks was taken, or 0 for never. */
export function blocksCachedAt() {
  return (cachedBlocks() || { at: 0 }).at || 0;
}

export async function loadPlots() {
  /* Standing in a plot is where there is no signal, so the last good read is
     kept on the device and served when a read cannot be made. Every read here
     answers null on failure rather than "nothing", so a partial failure falls
     back whole instead of quietly listing an empty nursery — and, worse,
     saving that emptiness over the cache. */
  if (!isOnline()) {
    _lastFromCache = true;
    return (cachedBlocks() || { rows: [] }).rows;
  }

  const [atPengambilan, planted, finished, dos] = await Promise.all([
    pengambilanPlots(), loadTransplanting(), loadFinished(), loadDeliveryOrders(),
  ]);
  if (!atPengambilan || !planted || !finished || !dos) {
    _lastFromCache = true;
    return (cachedBlocks() || { rows: [] }).rows;
  }
  _lastFromCache = false;

  const today = new Date().toISOString().slice(0, 10);

  /* The collected figure, per plot and batch, from the delivery orders — a
     FIGURE now, not a gate. A block with nothing collected against it yet
     simply carries zero here; it is still listed, because the plot and
     batch it belongs to were already offered by the walk below. */
  const collected = new Map();
  for (const d of dos) {
    if (isCancelled(d)) continue;
    for (const line of collectionLines(d)) {
      const key = `${line.plot}#${line.batch}`;
      if (!collected.has(key)) {
        collected.set(key, { collected: 0, firstDate: '', lastDate: '', orders: [] });
      }
      const e = collected.get(key);
      e.collected += line.qty;
      /* The orders the collected figure is made of. A block collected on
         four delivery orders shows one number, and "which D/O is that?" has
         no answer from the number alone — least of all when no single order
         carries it, because it is their sum. */
      e.orders.push({ do: d.do_number || '', on: String(d.delivery_date || ''), qty: line.qty });
      const on = String(d.delivery_date || '');
      if (on) {
        if (!e.firstDate || on < e.firstDate) e.firstDate = on;
        if (on > e.lastDate) e.lastDate = on;
      }
    }
  }

  /* A BLOCK is here because PALMS has its plot at Pengambilan and the Batch
     Report has stock standing in it — that is the whole test now. Whether
     anything has been collected off it yet is not part of the test; it is
     part of the figure, read above. */
  const rows = [];
  planted.forEach((t, key) => {
    const plot = key.split('#')[0];
    const batch = key.slice(plot.length + 1);
    if (!atPengambilan.has(plot)) return;
    if (isReplantPlot(plot)) return;
    if (isOldBatch(batch)) return;
    /* A map quantity against a block means the drone has flown it and the
       count is settled. The block is finished: offering it again would
       invite a second count of stock that is no longer standing. */
    if (finished.has(key)) return;
    const c = collected.get(key);
    rows.push({
      key,
      plot,
      batch,
      nursery: nurseryOfPlot(plot) || '',
      collected: c ? c.collected : 0,
      firstDate: c ? c.firstDate : '',
      lastDate: c ? c.lastDate : '',
      transplant: t.qty,
      transplantedOn: t.last,
      balance: t.qty - (c ? c.collected : 0),
      orders: c
        ? c.orders.slice().sort((a, b) => a.on.localeCompare(b.on) || String(a.do).localeCompare(String(b.do)))
        : [],
    });
  });
  rows.forEach((e) => {
    // How long collection has been running on each — null when nothing has
    // been collected yet, which sends it to the back of byPlotThenBatch.
    e.daysCollecting = daysSince(e.firstDate, today);
  });
  const out = byPlotThenBatch(rows);
  cacheBlocks(out);
  return out;
}

/**
 * Why a block is on this screen, or why it is not.
 *
 * The list is now built by walking the Batch Report's transplanting entries
 * for plots PALMS has at Pengambilan, so that is the walk this mirrors: one
 * row per plot-and-batch the Batch Report knows about, saying which rule
 * kept it off the screen or that it is on it. A second, shorter list follows
 * for delivery-order lines collected against a plot-and-batch the Batch
 * Report has never heard of — those can never be listed, whatever PALMS
 * says, because there is nothing to hold a transplanted-in figure.
 *
 * Run it from the browser's console with the calculator open:
 *
 *     cullDebug('B4')            every batch the report holds for a plot
 *     cullDebug('U17', '237')    one block
 *     cullDebug()                all of them
 *
 * @param   {string} plot   optional, to narrow it
 * @param   {string} batch  optional, likewise
 * @returns {Promise<Array<{ plot, batch, transplanted, collected, orders, why }>>}
 *   `why` is 'LISTED' or the rule that stopped it.
 */
export async function diagnose(plot = '', batch = '') {
  const wantPlot = plotKey(plot);
  const wantBatch = batchKey(batch);
  const [dos, planted0, finished0, atPengambilan] = await Promise.all([
    loadDeliveryOrders(), loadTransplanting(), loadFinished(), pengambilanPlots(),
  ]);
  if (!atPengambilan) return [{ why: 'the plot status could not be read at all' }];
  /* Either read answers null when it could not be made, so that loadPlots can
     fall back to the device's copy rather than list an empty nursery. The
     diagnosis has no cache to fall back to and says what it can with what it
     got. */
  const planted = planted0 || new Map();
  const finished = finished0 || new Set();
  const dosList = dos || [];

  // Collection lines, gathered per block, for the FIGURE only — matches the
  // read loadPlots makes for `collected`, not the gate.
  const orders = new Map();
  for (const d of dosList) {
    if (isCancelled(d)) continue;
    for (const line of collectionLines(d)) {
      const key = `${line.plot}#${line.batch}`;
      if (!orders.has(key)) orders.set(key, []);
      orders.get(key).push({ do: d.do_number || '', on: String(d.delivery_date || ''), qty: line.qty });
    }
  }

  const out = [];

  // Every batch the Batch Report has standing in a plot — the actual walk
  // the list makes.
  planted.forEach((t, key) => {
    const p = key.split('#')[0];
    const b = key.slice(p.length + 1);
    if (wantPlot && p !== wantPlot) return;
    if (wantBatch && b !== wantBatch) return;
    const ord = orders.get(key) || [];
    out.push({
      plot: p,
      batch: b,
      transplanted: t.qty,
      collected: ord.reduce((n, o) => n + o.qty, 0),
      orders: ord,
      why: whyNot(p, b, finished, atPengambilan),
    });
  });

  // Collected against a plot-and-batch the Batch Report never heard of —
  // covered above if it was, so only the orphans are left to explain.
  orders.forEach((ord, key) => {
    if (planted.has(key)) return;
    const p = key.split('#')[0];
    const b = key.slice(p.length + 1);
    if (wantPlot && p !== wantPlot) return;
    if (wantBatch && b !== wantBatch) return;
    out.push({
      plot: p,
      batch: b,
      transplanted: 0,
      collected: ord.reduce((n, o) => n + o.qty, 0),
      orders: ord,
      why: `the batch report has no batch ${b} transplanted into ${p}`,
    });
  });
  return out;
}

/**
 * What the batch report actually holds near a block — every batch that went
 * into this plot, and every plot this batch went into.
 *
 * The commonest answer diagnose() gives is that the batch report has no such
 * batch in that plot, and the next question is always the same: then what IS
 * in there? Two plot-and-batch keys that should have met and did not are
 * usually a plot named one way on the delivery order and another in the batch
 * report — B4 against B4-1 — and seeing both lists side by side is what makes
 * that visible.
 */
export async function plantedNear(plot = '', batch = '') {
  const wantPlot = plotKey(plot);
  const wantBatch = batchKey(batch);
  const planted = (await loadTransplanting()) || new Map();
  const out = [];
  planted.forEach((v, key) => {
    const [p, b] = key.split('#');
    const samePlot = wantPlot && p === wantPlot;
    const sameBatch = wantBatch && b === wantBatch;
    if (!samePlot && !sameBatch) return;
    out.push({
      plot: p,
      batch: b,
      transplanted: v.qty,
      on: v.last,
      match: samePlot && sameBatch ? 'both' : samePlot ? 'this plot' : 'this batch',
    });
  });
  return out.sort((a, b) => a.plot.localeCompare(b.plot, undefined, { numeric: true }) ||
                            a.batch.localeCompare(b.batch, undefined, { numeric: true }));
}

/* The gates, in the same order loadPlots applies them. Kept beside the
   diagnosis rather than inside it so the wording of each answer sits next to
   the rule it reports on. */
function whyNot(p, b, finished, atPengambilan) {
  if (isReplantPlot(p)) return 'a -R plot, which does not belong on this screen';
  if (isOldBatch(b)) return `batch ${b} is before ${MIN_BATCH}`;
  if (finished.has(`${p}#${b}`)) return 'the 3rd culling map qty is in — this block is done';
  if (!atPengambilan.has(p)) return 'PALMS does not have this plot at Pengambilan';
  return 'LISTED';
}

/** Collection runs about a month, so a block a month into it is the one worth
    walking. */
export const COLLECTION_DAYS = 30;

/**
 * How ready a block is to be counted — smaller is sooner.
 *
 * A block a month into its collection is nearly empty and is what the Field
 * Conductor came here for; one that opened last week has nothing to judge yet.
 * So the list is ordered by how close each is to that month.
 *
 * Anything PAST the month is treated as having arrived rather than as having
 * overshot. Ranking by distance alone would send a block sixty days in to the
 * back of the list beside one that opened yesterday, and the sixty-day one is
 * the more overdue of the two, not the less interesting.
 *
 * A block with no collection date cannot be placed and goes last.
 */
export function readiness(row) {
  const d = row && row.daysCollecting;
  if (d == null) return Infinity;
  return d >= COLLECTION_DAYS ? 0 : COLLECTION_DAYS - d;
}

/**
 * The order the list is in: plots by readiness, and a plot's batches together.
 *
 * Ranking every row on its own put a plot's second batch somewhere further
 * down the list with other people's plots in between, so the same ground came
 * up twice in one scroll with no way to see that it had. A plot is one place
 * you walk, so its batches sit together.
 *
 * The plot takes its place from its READIEST batch. Ranking a plot by its
 * least ready would bury ground that is nearly finished behind ground that
 * has barely started, and it is the nearly-finished one the Field Conductor
 * came here for.
 *
 * Inside a plot the batches read in number order, which is the order they are
 * spoken of and written down.
 *
 * Exported so it can be driven on its own — a comparator buried inside the
 * read is a comparator nothing can check.
 */
export function byPlotThenBatch(rows) {
  const best = new Map();
  for (const r of rows || []) {
    const mine = { ready: readiness(r), days: r.daysCollecting || 0 };
    const cur = best.get(r.plot);
    if (!cur || mine.ready < cur.ready || (mine.ready === cur.ready && mine.days > cur.days)) {
      best.set(r.plot, mine);
    }
  }
  return [...(rows || [])].sort((a, b) => {
    const ra = best.get(a.plot);
    const rb = best.get(b.plot);
    return (
      ra.ready - rb.ready ||
      // Among plots already past the month, the longest-running first.
      rb.days - ra.days ||
      a.plot.localeCompare(b.plot, undefined, { numeric: true }) ||
      // Same plot: its batches, in number order.
      a.batch.localeCompare(b.batch, undefined, { numeric: true })
    );
  });
}

/** Whole days from a date to another, or null when either is missing. */
export function daysSince(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* Transplanting puts seedlings INTO a plot. Three types, because the Batch
   Report offers three destinations; only the first reaches a numbered plot,
   but reading all three costs nothing and matches the office movement report
   rather than being a second opinion on it. */
const TRANSPLANT_TYPES = ['Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone'];

/**
 * What the Batch Report says was transplanted in, per plot and batch.
 *
 * @returns {Promise<Map<string, { qty: number, first: string, last: string }>>}
 *   keyed the same way as the delivery orders, "PLOT#BATCH", so the two sides
 *   of the balance meet on the same key however loosely either was typed.
 */
export async function loadTransplanting() {
  const res = await fetchAllRows(() =>
    supabase
      .from('shared_inventory_logs')
      .select('plot_name, batch_name, quantity_change, transaction_date, created_at')
      .in('transaction_type', TRANSPLANT_TYPES)
      .order('id', { ascending: true })
  );
  if (res.error) {
    /* null, not an empty map. An empty map means "nothing was transplanted
       anywhere", which would drop every block on the screen and then be
       cached as the truth. A read that failed has to say it failed. */
    console.warn('[culling] could not read the transplanting:', res.error.message);
    return null;
  }
  return transplantedByBlock(res.data || []);
}

/** → Set of "PLOT#BATCH" the 3rd culling has finished. */
export async function loadFinished() {
  const res = await fetchAllRows(() =>
    supabase
      .from('shared_inventory_logs')
      .select('plot_name, batch_name, remark')
      .eq('transaction_type', '3rd_Culling')
      .order('id', { ascending: true })
  );
  if (res.error) {
    // Likewise: an empty set would mean "nothing is finished".
    console.warn('[culling] could not read the 3rd culling:', res.error.message);
    return null;
  }
  return finishedBlocks(res.data || []);
}

/**
 * The drone MAP QUANTITY is what ends a block.
 *
 * Not the culled figure, and not the row existing. The 3rd Culling Records
 * report opens a row for every plot a batch went into, and a Field Conductor
 * fills the culled quantity in while the work is still going on — so both of
 * those say "being counted", not "counted". The Map qty is the drone's own
 * number, keyed once the map is back and the count is settled, and until it
 * is there the block still has work in it.
 *
 * That is why B4 batch 242 and U17 batches 237 and 242 went missing: they had
 * a culled figure against them and no map quantity yet, and the old rule read
 * the figure as the end of the job.
 *
 * The Batch Report leaves it in the remark — " MapQty: 151", written only
 * when the field was filled — and this reads it back with that page's own
 * expression so the two cannot drift apart.
 */
export function mapQty(remark) {
  const m = /MapQty:\s*(\d+)/.exec(String(remark || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * The same, from rows already in hand.
 *
 * Only 3rd_Culling rows are read. A Cull3_Transfer used to end a block too,
 * on the reasoning that seedlings moved off a plot have left it — but a
 * transfer carries no map quantity, so treating it as the end would take a
 * block off this screen by a route the Map qty rule does not govern. The
 * transfer is the movement; the map quantity on the plot's own culling row is
 * the finish.
 */
export function finishedBlocks(rows) {
  const out = new Set();
  for (const l of rows || []) {
    if (l.transaction_type && l.transaction_type !== '3rd_Culling') continue;
    const batch = batchKey(l.batch_name);
    const plot = plotKey(l.plot_name);
    if (!batch || !plot) continue;
    if (!(mapQty(l.remark) > 0)) continue;
    out.add(`${plot}#${batch}`);
  }
  return out;
}


/** The same, from rows already in hand — so the rule is testable without a
    database behind it. */
export function transplantedByBlock(rows) {
  const out = new Map();
  for (const l of rows || []) {
    const plot = plotKey(l.plot_name);
    const batch = batchKey(l.batch_name);
    const qty = Math.abs(Number(l.quantity_change || 0));
    if (!plot || !batch || !qty) continue;
    const key = `${plot}#${batch}`;
    if (!out.has(key)) out.set(key, { qty: 0, first: '', last: '' });
    const e = out.get(key);
    e.qty += qty;
    /* The date the office recorded the transplanting on, falling back to when
       the row was written. A batch can go in over several days, so both ends
       are kept rather than one being made to stand for the whole. */
    const on = String(l.transaction_date || l.created_at || '').slice(0, 10);
    if (on) {
      if (!e.first || on < e.first) e.first = on;
      if (on > e.last) e.last = on;
    }
  }
  return out;
}

/** The five collection lines a delivery order carries, as rows. A line needs
    both a plot and a quantity to be a collection; a batch is how the block is
    named, and a line without one cannot be separated from its neighbours. */
export function collectionLines(d) {
  const out = [];
  if (!d) return out;
  for (let i = 1; i <= 5; i++) {
    const qty = Math.abs(Number(d[`qty_${i}`] || 0));
    const plot = plotKey(d[`plot_${i}`]);
    const batch = batchKey(d[`batch_${i}`]);
    if (!plot || !qty || !batch) continue;
    out.push({ plot, batch, qty });
  }
  return out;
}

/**
 * The -R plots, which do not belong on this screen.
 *
 * B4 and B4-R are different ground, and only the first is counted here. The
 * suffix is kept by plotKey rather than trimmed, which is what makes them
 * possible to tell apart at all — so the two never share a row, and the -R one
 * simply never opens one.
 *
 * A trailing number is allowed for, so B4-R and B4-R2 are both left out.
 */
export function isReplantPlot(plot) {
  return /-R\d*$/.test(String(plot || ''));
}

/**
 * The oldest batch this screen carries.
 *
 * Everything before 224 is old ground that has been through its culling
 * already, and a stray delivery order against one of them is history rather
 * than work. So the list starts here.
 *
 * 224 itself is kept — "before 224" is what is left out.
 */
export const MIN_BATCH = 224;

/** Whether a batch is older than the screen goes back. */
export function isOldBatch(batch) {
  const n = parseInt(batchKey(batch), 10);
  // A batch with no number in it cannot be placed either side of the line,
  // and collectionLines has already refused it, so it never reaches here.
  return Number.isFinite(n) && n < MIN_BATCH;
}

/** A cancelled order collected nothing. The office has recorded cancellation
    two ways — a status, and a marker left in the remark — so both are read;
    missing either would put a plot here that nobody is collecting from. */
export function isCancelled(d) {
  return d.status === 'Cancelled' || String(d.remark || '').includes('[CANCELLED]');
}

/**
 * The figures behind one plot.
 *
 * @param   {{ plot: string, batch: string }} block  a plot AND a batch — the
 *          list is split by batch, so figures are per block, not per plot.
 * @returns {{ transplant: number, balance: number } | null}
 *   null means "cannot say". A block loadPlots hands over never answers null,
 *   because a block with nothing transplanted into it is not listed at all —
 *   the guard is kept so that stays true rather than being assumed.
 */
export function figuresFor(block) {
  if (!block || !(block.transplant > 0)) return null;
  return { transplant: block.transplant, balance: block.balance };
}

/**
 * Whether a plot's figures can carry a rate at all.
 *
 * Kept separate from figuresFor so a plot can be listed with its figures
 * shown and still be refused a percentage — a balance the ledger cannot
 * explain should be visible, not silently rated.
 */
export function hasFigures(row) {
  return !!row && row.transplant > 0 && row.balance >= 0;
}

/**
 * Whether a block's figures cannot be trusted at all.
 *
 * A balance the ledger could not explain — more recorded leaving than ever
 * arrived — used to answer this. The screen still has the panel for it: the
 * block is named and its balance shown, but no rate is offered, because a
 * rate worked out from a figure that does not add up reads as a healthy plot.
 */
export function figuresBroken(block) {
  return !!block && block.transplant > 0 && block.balance < 0;
}

/**
 * The culling rate.
 *
 * @param   {{ balance: number, transplant: number, inang: number }} figures
 *   `inang` is what the Field Conductor has counted on the keypad so far.
 * @returns {number} a fraction — 0.1 is ten percent. NaN when there is no
 *   rate to be had, which the screen shows as a dash rather than as 0%.
 */
export function rateFor({ balance, transplant, inang }) {
  if (!(transplant > 0)) return NaN;
  /* Pokok inang screened out are kept back, so they come off what would
     otherwise be culled. Before any are counted `inang` is nothing and the
     rate is simply what is left as a share of what went in. */
  return (balance - (inang || 0)) / transplant;
}

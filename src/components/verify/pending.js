/* WHAT IS STILL WAITING TO BE VERIFIED — the two rules, on their own.
 *
 * Pure, and out here rather than inside the card, so a test drives the real
 * ones instead of a restatement of them. Both answer the same shape of
 * question: the work happened, and nobody said who did it — which is the
 * one gap the payroll cannot close by itself.
 */

import { isCancelledDO, plotsOfDO } from '../../modules/do/data.js';
import { nurseryKey } from '../../lib/access.js';
import { TRANSPLANT_JOBS } from '../../modules/maintenance/transplantData.js';

/* ── 1. A DELIVERY ORDER WHOSE LOADERS WERE NEVER NAMED ───────────────
   Skipping the Who Loaded This DO step writes NOTHING -- saveDOWorkers is
   never called, so the column stays null and the DO "reads identically to
   one nobody has looked at yet" (do/data.js says so in as many words).
   That is deliberate and it is also why the skip is invisible: the only
   difference between a DO somebody answered and one somebody walked past
   is an empty column nothing was looking at.

   An EMPTY OBJECT counts as unanswered too. cleanPicks drops a nursery
   nobody ticked, so a popup opened, fiddled with and saved can leave `{}`
   -- which names no one, and a DO naming no one is a DO nobody is paid
   for. A CANCELLED DO is out: nothing was loaded, so nobody loaded it. */
export function doNeedsWorkers(d) {
  if (!d || !d.id) return false;
  if (isCancelledDO(d)) return false;
  const w = d.worked_by_by_nursery;
  if (!w || typeof w !== 'object') return true;
  /* Named, but with an empty list against every nursery, is still nobody.
     The column is jsonb, so this is {nursery: [names]}. */
  return !Object.keys(w).some((k) => Array.isArray(w[k]) && w[k].length > 0);
}

/* WHERE THE LIST STARTS, and it is a date rather than a rolling window.
   A rolling 92 days opened on **332 delivery orders**, which is not a list
   anybody works down -- it is a wall, and a wall gets scrolled past. Nearly
   all of it was from before anybody was ticking loaders at all, so it was
   332 questions that were never going to be answered sitting on top of the
   handful that would.

   The office asked for October 2026 on, which is the month the step
   started being done. Before it there is nothing to recover.

   A FIXED DATE, the same shape as TRANSPLANT_FLOW_FROM and
   TRANSPLANT_DATE_FROM in transplantData.js and for the same reason given
   there: records made before a rule existed and records made after it have
   to meet somewhere, and the 1st of a month is that somewhere. Move this
   date to move the floor; there is no second rule to keep in step. */
export const LOADING_WORKERS_FROM = '2026-10-01';

/* ── 1b. AND IT HAS TO BE ONE OF MY NURSERIES ─────────────────────────
   The office asked for it in one line: *"BNN acc 只看到 BNN 的 plot, UNN1
   只看到 UNN1 的 plot"*. The transplanting half has been scoped since it
   was written; this half never was, so a BNN conductor opened the board
   and found a DO for N12 sitting beside his own B2.

   THE TEST IS "ANY OF ITS PLOTS IS MINE", and it has to be, because a DO
   can span nurseries -- it carries plot_1..plot_5 and one load can be
   drawn from more than one. Asking that EVERY plot is mine would drop a
   DO half of which is my work, and nobody would ever name the gang for it.

   A DO WHOSE PLOTS CANNOT BE PLACED GOES ON SHOWING. A plot missing from
   Seedling Stock has no nursery to compare, and a card that vanishes off
   every board with nothing saying where it went is the exact fault this
   board exists to stop -- it would be the Who Loaded step being skipped
   again, only now invisible to the system as well as to the person. Same
   direction as access failing open: show too much rather than too little.

   Matched through nurseryKey, like every nursery comparison in either
   repository: the tick list is typed by hand and says "UNN1" where
   shared_plots says "UNN 1".

   WHAT IT COSTS, and it is the thing another_nursery_can_load_the_do.cjs
   is entirely about: WHERE THE SEEDLINGS WERE IS NOT WHO CARRIED THEM. A
   BNN DO is regularly loaded by a UNN 1 gang, and after this the UNN 1
   conductor no longer sees it. There is no better rule available -- this
   board lists exactly the DOs whose `worked_by_by_nursery` is still
   empty, so the one thing that would say who loaded it is the answer
   nobody has given yet, and the plots are all there is. The work is not
   lost: it sits on the BNN board, and that popup opens every other
   nursery by hand underneath its own, which is what it was built for.

   `allowed` empty or absent is NOBODY HAS BEEN ASKED, so every DO shows --
   which is what the whole portal did before this existed. */
export function doIsMine(d, plotMap, allowed) {
  const list = (allowed || []).filter(Boolean);
  if (!list.length) return true;
  const mine = new Set(list.map(nurseryKey));
  /* plotsOfDO is the DO module's own reader of plot_1..plot_5 -- the same
     one the card prints -- so the scope cannot come to disagree with what
     is on screen. */
  const placed = plotsOfDO(d || {})
    .map((p) => (plotMap || {})[p])
    .filter(Boolean);
  /* No plots on the DO at all, or not one of them is in Seedling Stock:
     there is nothing to place it by, so it stays. */
  if (!placed.length) return true;
  return placed.some((n) => mine.has(nurseryKey(n)));
}

/* ── 2. A TRANSPLANTED PLOT WHOSE JOBS ARE NOT ALL RECORDED ───────────
   The ledger says seedlings went into the plot; the four jobs that go with
   that -- blanket spray, lining, polybag filling, transplanting -- are each
   a crew and a quantity, and each is somebody's pay. A plot is outstanding
   while ANY of the four has no record.

   This is the same arithmetic the sheet's own list sorts by (`doneOf` in
   TransplantSheet.jsx), asked one level up so the front page and the sheet
   cannot disagree about what is left. The sheet keys its records on
   plot + work_type + schedule_month and that is the key matched here.

   `rows` is what loadTransplantingSince gives: [{ plot, qty, batches, ... }].
   `records` is what loadTransplantRecords gives: rows of the saved table. */
/* A BATCH IS THE UNIT OF THE WORK, NOT THE PLOT.
   `missingJobs` used to ask only whether the plot had a record of each
   job, in any month, ever since TRANSPLANT_FLOW_FROM. So a plot that took
   another delivery AFTER its four jobs were recorded counted as finished
   and dropped off the board -- and that delivery is a new filling, a new
   lining, a new planting and a new spray, four more crews owed their pay,
   on no screen anywhere. The office settled it in one line: the new
   seedlings 要再做一次.

   IT CANNOT BE DONE BY DATE. Filling and lining are sometimes done before
   the seedlings arrive and sometimes after -- 两种都有 -- so a record
   older than an arrival proves nothing, and a date test would leave those
   plots on the board for ever.

   So it is the BATCH, which both sides carry: the ledger row names the
   batches that have arrived, and the record names the batches it was
   recorded for. A job is owed again when the ledger names a batch that no
   record of that job mentions. B11 is the case it was found on: the
   ledger says 269, 271 and the record says 269. */
const batchKey = (v) => String(v == null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();
const batchList = (v) => String(v == null ? '' : v).split(',').map(batchKey).filter(Boolean);

export function missingJobs(plot, records, batches) {
  const mine = (records || []).filter((r) => r && r.plot_name === plot);
  /* The batches the ledger says have arrived. Not given any -- every
     caller before this rule existed -- the question is the old one. */
  const want = (batches || []).map(batchKey).filter(Boolean);

  return TRANSPLANT_JOBS.filter((j) => {
    const recs = mine.filter((r) => r.work_type === j.key);
    if (!recs.length) return true;      // never recorded at all
    if (!want.length) return false;     // nothing to match it against

    /* A RECORD WITH NO BATCH ON IT COVERS EVERYTHING, which keeps the old
       behaviour wherever the data cannot answer. saveTransplantRecord
       writes `batch_name: rec.batch || null`, so a blank is possible --
       and raising a plot for ever over a record nobody can tie to a
       delivery would be the wall this board is careful not to become. */
    const covered = new Set();
    let blank = false;
    recs.forEach((r) => {
      const list = batchList(r.batch_name);
      if (!list.length) blank = true;
      list.forEach((b) => covered.add(b));
    });
    if (blank) return false;

    return want.some((b) => !covered.has(b));
  });
}

/* WHICH DELIVERY IS OWED, for the card to name. A plot coming back with
   its four jobs already recorded for an earlier batch reads as a mistake
   unless the screen says which batch it is about. */
export function owedBatches(plot, records, batches) {
  const want = (batches || []).filter((b) => b != null && String(b).trim() !== '');
  if (!want.length) return [];
  const mine = (records || []).filter((r) => r && r.plot_name === plot);
  if (!mine.length) return [];
  const covered = new Set();
  let blank = false;
  mine.forEach((r) => {
    const list = batchList(r.batch_name);
    if (!list.length) blank = true;
    list.forEach((b) => covered.add(b));
  });
  if (blank) return [];
  return want.filter((b) => !covered.has(batchKey(b)));
}

/* WHAT THOSE BATCHES CAME TO, which is not what the plot came to.
   `row.qty` is every arrival since the floor. On a plot coming back for a
   SECOND delivery that figure is the two deliveries added together, and it
   is the number the next crew would be paid on: B11 read 3,303 where 135
   had arrived. The office: *"之前3168记录了就记录了 这次的135 不要combine
   起来"*.

   It falls back to the whole figure wherever the batches cannot answer —
   nothing owed yet (so everything is), a reader that carries no `byBatch`,
   or a batch the ledger quantity cannot be placed under. A plot nobody has
   recorded anything for is the ordinary case and is untouched. */
export function owedQty(row, owed) {
  if (!row) return 0;
  const want = (owed || []).filter(Boolean);
  const by = row.byBatch;
  if (!want.length || !by) return row.qty;
  let n = 0, seen = false;
  want.forEach((b) => { if (by[b] != null) { n += by[b]; seen = true; } });
  return seen ? n : row.qty;
}

/* ONE JOB'S OWN ANSWER. The four jobs are not recorded together — the
   lining can be done for the new delivery while the spray still owes both
   — so which batches are outstanding, and what they came to, is asked per
   job and not per plot. `records` is every saved record; the job is
   filtered here so no caller has to remember to. */
export function owedForJob(row, records, jobKey) {
  const mine = (records || []).filter((r) => r && r.work_type === jobKey
    && r.plot_name === row.plot);
  const owed = owedBatches(row.plot, mine, row.batches);
  /* owedBatches answers [] for TWO different things, and they are opposite
     ends of this screen: nothing recorded at all (so every batch is owed),
     and every batch already covered (so none is). The record list is what
     tells them apart — a job with no record is the ordinary first entry,
     and the figure for it is the plot's own total. */
  const fresh = !mine.length;
  const batches = owed.length ? owed : (fresh ? (row.batches || []) : []);
  return { batches, qty: owedQty(row, batches), fresh };
}

export function plotsOwingJobs(rows, records) {
  return (rows || [])
    .map((r) => {
      const owed = owedBatches(r.plot, records, r.batches);
      return { ...r, missing: missingJobs(r.plot, records, r.batches), owed, owedQty: owedQty(r, owed) };
    })
    .filter((r) => r.missing.length > 0);
}

/* ── THE STEPPER ──────────────────────────────────────────────────────
   One card at a time with an arrow either side. It CLAMPS rather than
   wraps, the same choice the maintenance week stepper made and for the
   same reason: the last card rolling round to the first reads as a list
   that has started again, and somebody working down a deck of nine loses
   their place. The index is also clamped against a list that SHRANK --
   answering a DO takes it off the list underneath the card you are on. */
export function clampIndex(i, n) {
  if (!n) return 0;
  return Math.max(0, Math.min(n - 1, i || 0));
}

/* WHAT IS STILL WAITING TO BE VERIFIED — the two rules, on their own.
 *
 * Pure, and out here rather than inside the card, so a test drives the real
 * ones instead of a restatement of them. Both answer the same shape of
 * question: the work happened, and nobody said who did it — which is the
 * one gap the payroll cannot close by itself.
 */

import { isCancelledDO } from '../../modules/do/data.js';
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
export function missingJobs(plot, records) {
  const have = new Set(
    (records || [])
      .filter((r) => r && r.plot_name === plot)
      .map((r) => r.work_type)
  );
  return TRANSPLANT_JOBS.filter((j) => !have.has(j.key));
}

export function plotsOwingJobs(rows, records) {
  return (rows || [])
    .map((r) => ({ ...r, missing: missingJobs(r.plot, records) }))
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

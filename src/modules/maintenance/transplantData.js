/**
 * The four jobs a plot needs when seedlings go into it.
 *
 * Everything on the left of this screen is the office's: which plots were
 * transplanted this month, with which batch and how many, read the same way
 * the Transplanting Report reads it — shared_inventory_logs, transaction
 * type Transplanted, quantity_change summed. Nobody re-keys a figure, so the
 * field and the office cannot disagree about what was planted.
 *
 * The report's approved Stock_Calibration adjustments only annotate its Qty
 * cell, they do not change the number, so the figure here is the report's
 * figure and not a near-miss of it.
 *
 * What the Field Conductor adds is the right of it: who did the work. Three
 * of the jobs are "these people did this plot". Polybag filling is paid by
 * the bag, so it is "these people did this many each", and the total has to
 * come to what the report says or somebody is being paid for bags that do
 * not exist.
 *
 * Storage is nops_transplant_field_records — see
 * shared/RUN_ME_transplant_records.sql in the office repository.
 */

import { nurseryKey } from '../../lib/access.js';
import { fetchAllRows, supabase } from '../../lib/supabase.js';

/** Raised when the table has not been created yet. */
export const TRANSPLANT_SETUP_NEEDED = 'TRANSPLANT_SETUP_NEEDED';

const TABLE = 'nops_transplant_field_records';

/* ONE type, because this screen answers to the Transplanting Report and that
   report reads one — see runTransplantingReport() in
   operation/operation_reports.html, which says why in its own comment:
   Transplanted_Premium and Transplanted_DoubleTone are pre-nursery moves
   into the Premium Care and Double Tone holding TRAYS, not into a plot, and
   do not belong in a report titled Transplanting.

   They do not belong here either, and for a sharper reason: there is no plot
   to blanket-spray, line, fill or plant. A tray on this list is four jobs
   nobody can do.

   Deliberately NOT the three-type list in modules/palms/cullingSource.js.
   That one is measuring how much stock went into a block and wants every
   destination; this one is asking which plots need work. Two questions, two
   answers — do not "align" them. */
const TRANSPLANT_TYPES = ['Transplanted'];

/**
 * WHEN a ledger row happened, asked the way the Transplanting Report asks it.
 *
 * SHARED RULE — this is _logDate() and _RE_LOG_DATE in the office repository,
 * operation/operation_reports.html. Change one, change the other.
 *
 * Not every row carries a transaction_date. Some were keyed with the date in
 * the remark ("Date: 2026-09-23"), some have only the created_at they were
 * written with. The report has always fallen through those three in order, so
 * a row with no transaction_date still lands on its proper day.
 *
 * This screen used to ask PostgREST for transaction_date >= x, and PostgREST
 * answers a comparison against NULL by dropping the row. So a plot with two
 * deliveries — one dated, one not — arrived here carrying only one of them:
 * B4 read 2,309 where the report said 2,309 + 96, and the 96 was neither
 * shown nor recordable nor payable. Nothing said anything was missing, which
 * is the worst part of it; the plot simply looked smaller than it was.
 */
const _RE_LOG_DATE = /(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i;
export function logDate(l) {
  if (l && l.transaction_date) return String(l.transaction_date).slice(0, 10);
  const m = l && l.remark ? String(l.remark).match(_RE_LOG_DATE) : null;
  if (m) return m[1];
  return l && l.created_at ? String(l.created_at).slice(0, 10) : null;
}

/**
 * The four jobs, in the order they happen in the nursery.
 *
 * `jenis` is the office's own wording — the nursery's names for these jobs,
 * not a translation of the English. It is stored on each record and is what
 * a Piece Rate is matched on in the payroll, so a job recorded in the field
 * lines up with the office record instead of being a near-miss spelling.
 *
 * `aka` is the wording a job carried BEFORE. Records saved under it are still
 * in the table with that jenis on them, and the payroll matches on the whole
 * list — so renaming a job here does not stop last month's work pricing.
 * Nothing is rewritten in the database; the old string simply stays known.
 *
 * `split` marks the one paid by the bag.
 */
export const TRANSPLANT_JOBS = [
  { key: 'blanket_spray', icon: '💨', jenis: 'Menyembur rumput secara rata',
    en: 'Blanket Spray',
    ms: 'Menyembur rumput secara rata',
    aka: ['Blanket Spray'] },
  { key: 'lining',        icon: '📐', jenis: 'Menyusun dan mengatur polibeg 15" X 18"',
    en: 'Lining & Arranging Polybag 15" × 18"',
    ms: 'Menyusun dan mengatur polibeg 15" X 18"',
    aka: ['Menyusun polibeg'] },
  { key: 'polybag_fill',  icon: '🪣', jenis: 'Mengisi polibeg 15" X 18"', split: true,
    en: 'Polybag Filling 15" × 18"',
    ms: 'Mengisi polibeg 15" X 18"',
    aka: ['Mengisi polibeg'] },
  { key: 'transplanting', icon: '🌱', jenis: 'Memindah anak sawit ke polibeg besar',
    en: 'Transplanting (Hy Plug → big polybag)',
    ms: 'Memindah anak sawit ke polibeg besar',
    aka: ['Menanam anak benih'] },
];

export const jobByKey   = (key) => TRANSPLANT_JOBS.find((j) => j.key === key) || null;
export const jobLabel   = (job, lang) => (job ? (lang === 'ms' ? job.ms : job.en) : '');

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "Sep 2026" → { from: '2026-09-01', to: '2026-09-30' }, or null. */
export function monthRange(label) {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(String(label || '').trim());
  if (!m) return null;
  const i = MONTH_ABBR.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (i < 0) return null;
  const y = parseInt(m[2], 10);
  const last = new Date(y, i + 1, 0).getDate();
  const p = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${p(i + 1)}-01`, to: `${y}-${p(i + 1)}-${p(last)}` };
}

const plotKey = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * The day this screen starts counting from.
 *
 * A plot is transplanted once, and the four jobs it then needs are spread
 * over the weeks after — the lining on the day, the filling over a week, the
 * blanket spray whenever the grass comes. Drawing the list from the month on
 * the board meant a plot transplanted on 28 August had until the 31st to
 * have all four recorded, and on 1 September it was simply gone: not done,
 * not late, not anywhere. The work still happened and the people still had to
 * be paid, so it was keyed into the payroll by hand or lost.
 *
 * So the list is everything transplanted SINCE this date, and it carries
 * forward until its four jobs are recorded. Fixed rather than rolling,
 * because a rolling window has the same hole in it further back, and fixed
 * rather than open-ended so the ledger read stays small and the list does not
 * fill with plots finished long before this screen existed.
 */
export const TRANSPLANT_FLOW_FROM = '2026-08-25';

/**
 * What the operation report says has gone into this nursery's plots since
 * TRANSPLANT_FLOW_FROM.
 *
 * Asked of the ledger by DATE, then narrowed to the plots this nursery
 * holds — the ledger has no nursery column, the plot list is what knows.
 * A plot transplanted twice is one row with the total: it is one plot to
 * line, to fill and to plant, however many deliveries it took.
 *
 * `from` is here so a caller can ask for a narrower window; nothing does
 * today, and the default is the one date this screen counts from.
 *
 * @returns {Promise<Array<{plot, batches:string[], batch:string, qty:number, last:string}>>}
 */
export async function loadTransplantingSince(plotNames, from = TRANSPLANT_FLOW_FROM) {
  const allowed = new Set((plotNames || []).map(plotKey));
  if (!allowed.size) return [];

  /* A row with no transaction_date is kept and dated below, by the report's
     own rule. Narrowing in the query alone would drop exactly those rows —
     see logDate. The date is then applied in JS, so the window is the same
     one either way. */
  const res = await fetchAllRows(() => supabase
    .from('shared_inventory_logs')
    .select('plot_name, batch_name, quantity_change, transaction_date, created_at, remark')
    .in('transaction_type', TRANSPLANT_TYPES)
    .or(`transaction_date.gte.${from},transaction_date.is.null`)
    .order('id', { ascending: true }));
  if (res.error) throw res.error;

  const byPlot = new Map();
  (res.data || []).forEach((r) => {
    const k = plotKey(r.plot_name);
    if (!allowed.has(k)) return;
    const when = logDate(r);
    // Undated by every rule: it cannot be placed, so it is not placed.
    if (!when || when < from) return;
    const qty = Math.abs(Number(r.quantity_change || 0));
    if (!qty) return;
    const cur = byPlot.get(k) || { plot: String(r.plot_name || '').trim(), batches: [], qty: 0, last: '' };
    cur.qty += qty;
    const b = String(r.batch_name || '').trim();
    if (b && !cur.batches.includes(b)) cur.batches.push(b);
    if (!cur.last || when > cur.last) cur.last = when;
    byPlot.set(k, cur);
  });

  /* Newest first. The plot somebody is standing in front of is the one
     transplanted most recently, and the older ones below it are the ones
     still waiting for a job — which is the order this list is read in. */
  return [...byPlot.values()]
    .map((p) => ({ ...p, batch: p.batches.join(', ') }))
    .sort((a, b) => String(b.last).localeCompare(String(a.last))
                 || a.plot.localeCompare(b.plot, undefined, { numeric: true }));
}

function missingTable(error) {
  const m = String((error && error.message) || '');
  return /relation .* does not exist|Could not find the table|schema cache/i.test(m);
}

/** Every transplanting job already recorded for this nursery and month. */
/**
 * Every transplanting record for this nursery's plots, WHATEVER MONTH it was
 * saved under.
 *
 * It used to ask for one month's, which was right while the plot list was one
 * month's too. Now that a plot carries forward from TRANSPLANT_FLOW_FROM
 * until its jobs are done, asking by month would show an August plot's
 * blanket spray as "not recorded yet" on a September board — and the unique
 * key is (plot, work_type, schedule_month), so it would have accepted a
 * second record and the payroll would have paid the same plot's spray twice,
 * in two different months, with both sheets looking perfectly normal.
 *
 * So a job is done or it is not, and the month it was saved under is what it
 * gets PAID in, not what makes it count.
 */
export async function loadTransplantRecords(nursery) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .gte('work_date', TRANSPLANT_FLOW_FROM)
    .order('plot_name');
  if (error) {
    if (missingTable(error)) throw new Error(TRANSPLANT_SETUP_NEEDED);
    throw error;
  }
  /* Filtered here rather than in the query: a record made before the nursery
     was written would vanish from its own plot's list.

     Matched through the same key the plot list uses — "UNN 1" and "UNN1" are
     one nursery, and a record saved under one spelling must not hide from
     the other. */
  const want = nursery ? nurseryKey(nursery) : null;
  return (data || []).filter(
    (r) => !want || !r.nursery_name || nurseryKey(r.nursery_name) === want
  );
}

/**
 * Save one job on one plot.
 *
 * Upserted on (plot, job, month), because recording the same job twice on
 * the same plot is a correction rather than a second crew — the unique index
 * says so and this matches it. Anything already there is replaced whole.
 */
export async function saveTransplantRecord(rec) {
  const workers = (rec.workers || [])
    .filter((w) => w && w.name)
    .map((w) => ({ name: w.name, qty: w.qty == null || w.qty === '' ? null : Number(w.qty) }));
  const total = workers.reduce((n, w) => n + (Number(w.qty) || 0), 0);
  const job = jobByKey(rec.workTypeKey);

  const row = {
    work_date:      rec.date,
    nursery_name:   rec.nursery || null,
    plot_name:      rec.plot,
    batch_name:     rec.batch || null,
    work_type:      rec.workTypeKey,
    jenis:          job ? job.jenis : null,
    schedule_month: rec.month,
    source_qty:     rec.sourceQty == null ? null : Number(rec.sourceQty),
    workers,
    total_qty:      job && job.split ? total : null,
    remark:         rec.remark || null,
    reported_by:    rec.reportedBy || null,
    updated_at:     new Date().toISOString(),
  };

  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'plot_name,work_type,schedule_month' });
  if (error) {
    if (missingTable(error)) throw new Error(TRANSPLANT_SETUP_NEEDED);
    throw error;
  }
}

/** Undo a record — the job was not done after all. */
export async function deleteTransplantRecord(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

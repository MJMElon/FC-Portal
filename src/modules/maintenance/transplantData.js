/**
 * The four jobs a plot needs when seedlings go into it.
 *
 * Everything on the left of this screen is the office's: which plots were
 * transplanted this month, with which batch and how many, read straight out
 * of shared_inventory_logs — the same ledger the operation report adds up.
 * Nobody re-keys a quantity, so the field and the office cannot disagree
 * about what was planted.
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

import { fetchAllRows, supabase } from '../../lib/supabase.js';

/** Raised when the table has not been created yet. */
export const TRANSPLANT_SETUP_NEEDED = 'TRANSPLANT_SETUP_NEEDED';

const TABLE = 'nops_transplant_field_records';

/* Transplanting puts seedlings INTO a plot. Three types, because the Batch
   Report offers three destinations; reading all three matches the office
   movement report rather than being a second opinion on it. Same list as
   modules/palms/cullingSource.js — change one, change the other. */
const TRANSPLANT_TYPES = ['Transplanted', 'Transplanted_Premium', 'Transplanted_DoubleTone'];

/**
 * The four jobs, in the order they happen in the nursery.
 *
 * `jenis` is the office's own wording, stored alongside so a job recorded in
 * the field lines up with the office record instead of being a near-miss
 * spelling of it. `split` marks the one paid by the bag.
 */
export const TRANSPLANT_JOBS = [
  { key: 'blanket_spray', icon: '💨', jenis: 'Blanket Spray',
    en: 'Blanket Spray',                ms: 'Semburan Blanket' },
  { key: 'lining',        icon: '📐', jenis: 'Menyusun polibeg',
    en: 'Lining & Arranging Polybag',   ms: 'Menyusun & Mengatur Polibeg' },
  { key: 'polybag_fill',  icon: '🪣', jenis: 'Mengisi polibeg', split: true,
    en: 'Polybag Filling 15" × 18"',    ms: 'Mengisi Polibeg 15" × 18"' },
  { key: 'transplanting', icon: '🌱', jenis: 'Menanam anak benih',
    en: 'Transplanting (Hy Plug → polybag)', ms: 'Menanam (Hy Plug → polibeg)' },
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
 * What the operation report says went into this nursery's plots this month.
 *
 * Asked of the ledger by DATE, then narrowed to the plots this nursery
 * holds — the ledger has no nursery column, the plot list is what knows.
 * A plot transplanted twice in the month is one row with the total: it is
 * one plot to line, to fill and to plant, however many deliveries it took.
 *
 * @returns {Promise<Array<{plot, batches:string[], batch:string, qty:number, last:string}>>}
 */
export async function loadMonthTransplanting(plotNames, monthLabel) {
  const range = monthRange(monthLabel);
  if (!range) return [];
  const allowed = new Set((plotNames || []).map(plotKey));
  if (!allowed.size) return [];

  const res = await fetchAllRows(() => supabase
    .from('shared_inventory_logs')
    .select('plot_name, batch_name, quantity_change, transaction_date')
    .in('transaction_type', TRANSPLANT_TYPES)
    .gte('transaction_date', range.from)
    .lte('transaction_date', range.to)
    .order('id', { ascending: true }));
  if (res.error) throw res.error;

  const byPlot = new Map();
  (res.data || []).forEach((r) => {
    const k = plotKey(r.plot_name);
    if (!allowed.has(k)) return;
    const qty = Math.abs(Number(r.quantity_change || 0));
    if (!qty) return;
    const cur = byPlot.get(k) || { plot: String(r.plot_name || '').trim(), batches: [], qty: 0, last: '' };
    cur.qty += qty;
    const b = String(r.batch_name || '').trim();
    if (b && !cur.batches.includes(b)) cur.batches.push(b);
    if (!cur.last || String(r.transaction_date) > cur.last) cur.last = String(r.transaction_date || '');
    byPlot.set(k, cur);
  });

  return [...byPlot.values()]
    .map((p) => ({ ...p, batch: p.batches.join(', ') }))
    .sort((a, b) => a.plot.localeCompare(b.plot, undefined, { numeric: true }));
}

function missingTable(error) {
  const m = String((error && error.message) || '');
  return /relation .* does not exist|Could not find the table|schema cache/i.test(m);
}

/** Every transplanting job already recorded for this nursery and month. */
export async function loadTransplantRecords(nursery, monthLabel) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('schedule_month', monthLabel)
    .order('plot_name');
  if (error) {
    if (missingTable(error)) throw new Error(TRANSPLANT_SETUP_NEEDED);
    throw error;
  }
  // Filtered here rather than in the query: a record made before the nursery
  // was written would vanish from its own plot's list.
  return (data || []).filter((r) => !nursery || !r.nursery_name || r.nursery_name === nursery);
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

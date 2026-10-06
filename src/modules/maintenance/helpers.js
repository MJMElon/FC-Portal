// Pure helpers for the Maintenance module — no imports, so they can be
// unit-tested in plain node and reused anywhere.

/**
 * The four maintenance jobs. `jenis` is the exact wording Nursery Operation
 * Management stores in its own Work Maintenance list, so a job recorded in the
 * field lines up with the office record instead of being a near-miss spelling
 * of it. Do not "tidy" these strings.
 */
export const WORK_TYPES = [
  { key: 'pd',       icon: '🧪', jenis: 'Penyemburan racun kulat dan serangga', en: 'P & D Spraying',     ms: 'Penyemburan Racun Kulat & Serangga' },
  { key: 'manuring', icon: '🌾', jenis: 'Membaja',                              en: 'Manuring',           ms: 'Membaja' },
  { key: 'weeding',  icon: '🌿', jenis: 'Merumput',                             en: 'Weeding',            ms: 'Merumput' },
  { key: 'interrow', icon: '💨', jenis: 'Meracun rumput secara selingan',       en: 'Interrow Spraying',  ms: 'Meracun Rumput Selingan' },
];

export const workTypeLabel = (wt, lang) => (wt ? (lang === 'ms' ? wt.ms : wt.en) : '');
export const workTypeByKey = (key) => WORK_TYPES.find((w) => w.key === key) || null;

export const todayStr = () => new Date().toISOString().slice(0, 10);

// Access rules live in one place — see lib/access.js. Re-exported here so the
// module's existing imports keep working, and so this file and the Plot Status
// one cannot drift into two different answers to the same question.
export { allowedNurseries, canMaintain } from '../../lib/access.js';

/** Newest first, then by plot so a day's work reads in a stable order. */
export function sortRecords(rows) {
  return [...(rows || [])].sort(
    (a, b) =>
      String(b.work_date || '').localeCompare(String(a.work_date || '')) ||
      String(a.plot_name || '').localeCompare(String(b.plot_name || '')) ||
      (b.id || 0) - (a.id || 0)
  );
}

/** Records as CSV. Quotes every field, so a remark with a comma survives. */
export function toCsv(rows, lang) {
  const head = ['Date', 'Nursery', 'Plot', 'Work', 'Chemical', 'Quantity', 'Remark', 'Recorded by'];
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')];
  for (const r of rows || []) {
    lines.push(
      [
        r.work_date,
        r.nursery_name,
        r.plot_name,
        workTypeLabel(workTypeByKey(r.work_type), lang) || r.jenis,
        r.chemical,
        r.qty,
        r.remark,
        r.reported_by,
      ]
        .map(cell)
        .join(',')
    );
  }
  return lines.join('\n');
}

/* ── Who counts as a worker on a maintenance sheet ──────────────────────
 *
 * A nursery's payroll register holds everybody on it: general workers, but
 * also the conductor, his assistant, drivers, the pump operator, clerks. Only
 * the first of those does maintenance work, and offering the rest on the
 * "who did this work" list is offering the wrong answer nineteen ways.
 *
 * This is the office's rule, from nursery_ops/plot_maintenance_script.js in
 * the mjm-ai-system repository, and it is a DELIBERATE COPY rather than an
 * import: the two live in different repositories and there is no shared
 * bundle between them. Keep the two in step — if the roles list or the
 * wording changes there, change it here. A worker who appears on one sheet
 * and not the other is a worker whose pay does not add up.
 *
 * The order matters:
 *   1. maint_general on the row is an explicit answer, either way, and wins
 *   2. "General Worker" (or Pekerja Am / Buruh Am) is a worker
 *   3. another role off the register's own list is not
 *   4. once ANY worker in this nursery has been labelled, an unlabelled one
 *      is taken as not-a-worker — a half-filled register should not quietly
 *      include everybody
 *   5. otherwise, anything that does not read as a non-worker role
 */

/** The roles the payroll register offers. Kept in step with ROLES there. */
export const ROLES = ['Field Conductor', 'Assistant Field Conductor',
                      'Water Pump Operator', 'General Worker', 'Driver', 'Gardener'];

const MAINT_ROLE       = /^general\s*worker$|pekerja am|buruh am/i;
const NON_GENERAL_ROLE = /driver|pemandu|conductor|kondektor|konduktor|supervisor|penyelia|mandor|mandur|kepala|kerani|clerk|admin|manager|pengurus|executive|eksekutif|mekanik|mechanic|technician|juruteknik|security|pengawal|jaga|foreman|operator|storekeeper|storeman/i;

const roleOf      = (r) => String((r && (r.role || r.job_title)) || '').trim();
const isKnownRole = (r) => ROLES.some((x) => x.toLowerCase() === String(r).trim().toLowerCase());

export function isGeneralWorker(r, nurseryNamesTheRole) {
  if (!r || r.active === false) return false;
  if (r.maint_general === true)  return true;
  if (r.maint_general === false) return false;
  const role = roleOf(r);
  if (MAINT_ROLE.test(role)) return true;
  if (isKnownRole(role))     return false;
  if (nurseryNamesTheRole)   return false;
  return !NON_GENERAL_ROLE.test(role);
}

/* ── WHO DID THE WORK, for the screen ──────────────────────────────────
 *
 * `worked_by` is the tick list: the conductor opened Who did this job and
 * named the crew. When it is there it IS the answer, and reported_by is
 * merely who held the phone.
 *
 * When it is empty there are two quite different situations wearing the same
 * shape, and the card used to show reported_by for both:
 *
 *   a WORKER saved the job from their own phone, so the reporter did it
 *   a CONDUCTOR saved it and ticked nobody, so the reporter did NOT do it
 *
 * Showing the conductor's name as the worker in the second case is the
 * screen naming the wrong person for a morning's work — and it is his name
 * that then reads back as the one who did it. The register tells them apart:
 * a reporter who is a general worker of this nursery did the job, and one
 * who is not was keying it for somebody he forgot to tick.
 *
 * Returns the names to show and, separately, who keyed it.
 */
const sameName = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export function didTheWork(record, workerNames) {
  const ticked = String((record && record.worked_by) || '')
    .split(',').map((n) => n.trim()).filter(Boolean);
  const reporter = String((record && record.reported_by) || '').trim();
  if (ticked.length) return { names: ticked, keyedBy: reporter, nobodyTicked: false };
  if (!reporter) return { names: [], keyedBy: '', nobodyTicked: true };
  const isWorker = (workerNames || []).some((n) => sameName(n, reporter));
  return isWorker
    ? { names: [reporter], keyedBy: '', nobodyTicked: false }
    : { names: [], keyedBy: reporter, nobodyTicked: true };
}

/** The general workers among one nursery's register rows. */
export function generalWorkers(rows) {
  const list = rows || [];
  // Rule 4: has anybody here actually been labelled a general worker?
  const named = list.some((r) => r.active !== false && MAINT_ROLE.test(roleOf(r)));
  return list.filter((r) => isGeneralWorker(r, named));
}

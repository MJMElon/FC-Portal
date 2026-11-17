/* ══════════════════════════════════════════════════════════════════════════
   WHICH PLOTS EXIST — AND THE OFFICE IS THE ONE WHO SAYS

   A plot is added in ONE place: Seedling Stock Management → System Settings
   → Add Plot, which inserts a row into `shared_plots`. Most of this portal
   already reads it — PALMS (`modules/palms/data.js`), the maintenance board
   (`modules/maintenance/data.js`) and the DO module (`modules/do/data.js`)
   all do — so a plot the office adds turns up on those screens by itself.

   THE NELOS RAISE FORM DID NOT. It carried the four ranges written out,
   P01-P52 / B01-B14 / U01-U18 / N01-N20, with a comment saying the list was
   copied from the hub's dock, which copied it from the audit module. So a
   plot the office added — and above all a "-R" plot, which a 3rd-culling
   transfer makes and which is in no hardcoded range anywhere — could not be
   named on a case at all. The Field Conductor standing in it had no way to
   say where the problem was.

   ── THE RULES ─────────────────────────────────────────────────────────────

   THE RANGES ARE THE FLOOR, not the list. Whatever `shared_plots` holds is
   added on top, deduped on letters and digits. So a read that fails changes
   nothing — the form offers exactly what it offered before — and no plot
   that is on screen today can disappear. That is the fail-open rule every
   other gate in these two repositories follows, and an empty plot picker is
   a form nobody can fill in.

   WHAT IT DOES NOT DO, said plainly: a plot DELETED on the settings page
   does not leave the four ranges. That is the price of fail-open and it is
   the safe direction here.

   THE NURSERY IS MATCHED ON LETTERS AND DIGITS, upper-cased, because
   `shared_plots` spells it the way Seedling Stock does — "UNN 1" with the
   space — where this form keys it 'UNN1'. Same rule as `nurseryKey`
   everywhere else in this repository. A plot filed under a FIFTH nursery is
   left out: there is no option on this form to put it under.

   SHARED RULE — this is `shared/shared_maint_plots.js` and
   `audit/audit_plots.js` in the office repository, and `loadPlots()` in
   `shared/shared_nelos_dock.js`. Four copies of one read, one per place
   that cannot import from the others; change one, change the rest.
   ══════════════════════════════════════════════════════════════════════════ */
import { supabase } from './supabase.js';

const pad = (letter, n) =>
  Array.from({ length: n }, (_, i) => `${letter}${String(i + 1).padStart(2, '0')}`);

/* The four ranges, as every raise form in the company has always offered
   them. The floor, never the whole answer. */
export const NURSERY_RANGES = {
  PN: pad('P', 52),
  BNN: pad('B', 14),
  UNN1: pad('U', 18),
  UNN2: pad('N', 20),
};

export const NURSERY_CODES = Object.keys(NURSERY_RANGES);

/* LETTERS AND DIGITS, AND THEN THE LEADING ZEROS OFF THE NUMBER.

   The usual letters-and-digits rule is not enough here and it took a test
   to see it: these four ranges are PADDED ('B01') and `shared_plots` holds
   what the office typed, which is 'B1'. On letters and digits alone those
   are two different keys, so the office's B1 was added BESIDE the range's
   B01 and the picker offered one plot twice under two spellings. 'B04-R'
   and 'B4-R' are the same plot for the same reason. */
const key = (v) => String(v ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  .replace(/([A-Z])0+(\d)/g, '$1$2');

/* 'UNN 1' and 'UNN1' are one nursery; anything whose letters and digits are
   not one of the four is not one of the four. */
function codeOf(name) {
  const k = key(name);
  return NURSERY_RANGES[k] ? k : null;
}

/* B10 after B2, not before it — the comparison every other plot picker in
   the system uses. */
const order = (a, b) =>
  String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/* The ranges plus whatever the office keyed, deduped on letters and digits.
   Seedling Stock spells a plot 'B1' where the ranges spell it 'B01', and one
   plot offered twice is a picker somebody has to read twice; the RANGE
   spelling wins where both have it, so nothing moves for a plot that was
   already there. */
export function mergePlots(extra) {
  const out = {};
  NURSERY_CODES.forEach((n) => {
    const list = NURSERY_RANGES[n].slice();
    const seen = new Set(list.map(key));
    ((extra || {})[n] || []).forEach((p) => {
      const k = key(p);
      if (!k || seen.has(k)) return;
      list.push(String(p).trim());
      seen.add(k);
    });
    out[n] = list.sort(order);
  });
  return out;
}

let _cache = null;

/**
 * nursery code → [plot], the office's list over the four ranges.
 *
 * Never throws and never rejects: a table that cannot be read, a refused
 * policy or no signal all give back the ranges, which is where the caller
 * was. Cached for the life of the tab, because the answer changes when
 * somebody keys a plot in the office and not between two renders.
 *
 * `nops_maint_custom_plots` is read as well as `shared_plots`: Add Row on
 * the Work Maintenance schedule writes there, and the schedule and the
 * salary claim have counted both for months.
 */
export async function loadNurseryPlots() {
  if (_cache) return _cache;
  const extra = {};
  const add = (nursery, plot) => {
    const n = codeOf(nursery);
    const p = String(plot ?? '').trim();
    if (!n || !p) return;
    (extra[n] || (extra[n] = [])).push(p);
  };
  try {
    const [stock, custom] = await Promise.all([
      supabase.from('shared_plots').select('nursery_name, plot_name')
        .then((r) => r, (e) => ({ error: e })),
      supabase.from('nops_maint_custom_plots').select('nursery, plot')
        .then((r) => r, (e) => ({ error: e })),
    ]);
    if (!stock?.error) (stock?.data || []).forEach((r) => add(r?.nursery_name, r?.plot_name));
    if (!custom?.error) (custom?.data || []).forEach((r) => add(r?.nursery, r?.plot));
  } catch (e) {
    /* Nothing: the ranges are the answer. */
  }
  _cache = mergePlots(extra);
  return _cache;
}

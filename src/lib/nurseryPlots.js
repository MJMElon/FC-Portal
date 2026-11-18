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

   THE RANGES ARE THE FALLBACK, and they were the FLOOR for a day. The office
   asked for the other half the same afternoon — *"i deleted a plot, make it
   remove from all modules too. i added a plot, make it add for all modules
   too."* — and the floor was exactly what stopped the cross on the settings
   page doing anything: B14 was offered whether or not `shared_plots` had a
   row for it.

   So the LIST is what Seedling Stock holds where the office has keyed
   something, and the range answers for a nursery they have not. Two things
   hold that up and the first is why `mergePlots` takes an `ok` at all:

     - A READ THAT FAILS CHANGES NOTHING. The form offers exactly what it
       offered before — the fail-open rule every other gate in these two
       repositories follows, and an empty plot picker is a form nobody can
       fill in. So only a reply that really ARRIVED narrows anything: an
       empty object cannot be told from a refusal, which is the shape that
       would have emptied every picker in the company at once.
     - IT IS ASKED PER NURSERY, and the Pre Nursery is why. A nursery
       `shared_plots` holds no plot for keeps its whole range, because an
       absent answer is nobody having been asked — and PN is counted in
       TRAYS, so a global test would wipe P01 to P52 off every form.

   WHAT IT COSTS, said plainly: if `shared_plots` is short of a row, a plot
   nobody deleted stops being offered. The office repository carries the
   check that names every one of them —
   shared/CHECK_which_plots_each_module_offers.sql, section 4 — and the
   answer to a plot in that list is to add it back on the settings page, one
   press, and it returns everywhere.

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
   them. What answers for a nursery the office has keyed nothing for, and
   what a failed read falls back on — never the whole answer. */
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

/* THE OFFICE'S LIST WINS, PER NURSERY.

   A plot is added AND DELETED in Seedling Stock Management → System
   Settings, and the office asked for both halves: *"i deleted a plot, make
   it remove from all modules too. i added a plot, make it add for all
   modules too."* So for a nursery the office has keyed, that list IS the
   list — delete B14 there and it is off this form.

   The ranges being the FLOOR is exactly what used to stop a deletion
   biting, so they are now only the FALLBACK, and three things keep that
   from being a cliff:

   1. A READ THAT FAILED CHANGES NOTHING (`ok` false) — the ranges stand,
      which is the fail-open rule everything here follows. An empty plot
      picker is a form nobody can fill in.
   2. ASKED PER NURSERY, never once for all four. The Pre Nursery is counted
      in TRAYS, so `shared_plots` may hold no PN row at all; a single global
      test would wipe P01 to P52 off this form. A nursery the office has said
      NOTHING about keeps its range — an absent answer is nobody having been
      asked.
   3. A HAND-ADDED plot (`nops_maint_custom_plots`) is still appended: that
      is the office saying it exists by another route.

   `loaded` is { stock, custom, ok }. Deduped on letters and digits with the
   leading zeros off, so the office's 'B1' is not offered beside a range's
   'B01'. */
export function mergePlots(loaded) {
  const stock  = (loaded && loaded.stock)  || {};
  const custom = (loaded && loaded.custom) || {};
  const ok     = !!(loaded && loaded.ok);
  const out = {};
  NURSERY_CODES.forEach((n) => {
    const keyed = ok && Array.isArray(stock[n]) && stock[n].length;
    const list = (keyed ? stock[n] : NURSERY_RANGES[n]).slice();
    const seen = new Set(list.map(key));
    (custom[n] || []).forEach((p) => {
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
 * nursery code → [plot]: the office's list where they have keyed one,
 * and the four ranges where they have not.
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
  const loaded = { stock: {}, custom: {}, ok: false };
  const add = (into, nursery, plot) => {
    const n = codeOf(nursery);
    const p = String(plot ?? '').trim();
    if (!n || !p) return;
    (into[n] || (into[n] = [])).push(p);
  };
  try {
    const [stock, custom] = await Promise.all([
      supabase.from('shared_plots').select('nursery_name, plot_name')
        .then((r) => r, (e) => ({ error: e })),
      supabase.from('nops_maint_custom_plots').select('nursery, plot')
        .then((r) => r, (e) => ({ error: e })),
    ]);
    if (!stock?.error) {
      /* THE READ ANSWERED. Only this flag decides whether a plot the office
         deleted disappears or the range stands, so it is set on a reply that
         really came back and on nothing else. */
      loaded.ok = true;
      (stock?.data || []).forEach((r) => add(loaded.stock, r?.nursery_name, r?.plot_name));
    }
    if (!custom?.error) {
      (custom?.data || []).forEach((r) => add(loaded.custom, r?.nursery, r?.plot));
    }
  } catch (e) {
    /* Nothing: the ranges are the answer. */
  }
  _cache = mergePlots(loaded);
  return _cache;
}

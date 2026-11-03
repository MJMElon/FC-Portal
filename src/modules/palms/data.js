import { newUid } from '../../lib/outbox.js';
import { loadSettings } from './settings.js';

// PALMS — Plot Activity Log Monitoring System, data layer.
// Ported from the standalone NurseryPALMS app. localStorage under the SAME
// key the standalone app used stays what the screens read and write — they do
// it synchronously, and there is no safe way to make a working field app
// async all at once — so anything already on a device carries over.
//
// sync.js is the layer either side of it: what is here goes up to
// fcportal_palms_plot_logs, and what other people recorded comes back down.

/* The nurseries and, once the office has been read, the exact plots in each.
   `count` is only the fallback shape used before shared_plots has answered —
   see applyOfficeConfig() and officeConfig.js. */
export const NURSERIES = {
  BNN: { label: 'BNN', prefix: 'B', count: 14, plots: null },
  UNN1: { label: 'UNN1', prefix: 'U', count: 18, plots: null },
  UNN2: { label: 'UNN2', prefix: 'N', count: 20, plots: null },
};

// Activity names are nursery domain vocabulary and stay as-is in both
// languages; `days` is the ideal duration of the stage.
// `mShort` is the phone-sized label — the picker has to show all eleven
// activities without the Field Conductor scrolling.
export const ACTIVITIES = [
  { n: 1, name: 'Saringan Anak Bibit', mShort: 'Saringan bibit', short: 'Saringan Anak Bibit', days: 2 },
  { n: 2, name: 'Tunggu buat culling', mShort: 'Tunggu culling', short: 'Tunggu cull', days: 3 },
  { n: 3, name: 'Culling', mShort: 'Culling', short: 'Culling', days: 2 },
  { n: 4, name: 'Membersih', mShort: 'Membersih', short: 'Membersih', days: 1 },
  { n: 5, name: 'Meracun secara selingan', mShort: 'Meracun selingan', short: 'Meracun', days: 1 },
  { n: 6, name: 'Angkat tanah', mShort: 'Angkat tanah', short: 'Angkat tanah', days: 5 },
  { n: 7, name: 'Isi polibeg', mShort: 'Isi polibeg', short: 'Isi polibeg', days: 5 },
  { n: 8, name: 'Lining', mShort: 'Lining', short: 'Lining', days: 2 },
  { n: 9, name: 'Transplanting', mShort: 'Transplanting', short: 'Transplant', days: 2 },
  { n: 10, name: 'Membesar', mShort: 'Membesar', short: 'Membesar', days: 270 },
  { n: 11, name: 'Pengambilan', mShort: 'Pengambilan', short: 'Pengambilan', days: 30 },
];

const STORE_KEY = 'palms_status_v8';

/* ---------- plot layout & thresholds, from settings ----------
   MULTI and ATTENTION are filled from the saved settings at load and
   rewritten in place when they change, so every screen reading them picks
   the change up on its next render. */
export const MULTI = {};
export const ATTENTION = {};
// Incentive rules, hydrated from settings alongside the rest.
export const INCENTIVE = { minAreaPct: 25 };
let PHOTOS = {};

export function applySettings(s) {
  Object.keys(MULTI).forEach((k) => delete MULTI[k]);
  Object.entries(s.multi || {}).forEach(([k, v]) => {
    MULTI[k] = v;
  });
  Object.keys(ATTENTION).forEach((k) => delete ATTENTION[k]);
  Object.entries(s.attention || {}).forEach(([k, v]) => {
    ATTENTION[k] = Number(v);
  });
  PHOTOS = s.photos || {};
  INCENTIVE.minAreaPct = s.minArea == null ? 25 : Number(s.minArea);
}
applySettings(loadSettings());

// Photos that ship with the app, keyed by plot. Filled in at startup by
// src/plotPhotos.js, which reads the src/plot-maps folder — a list kept here
// by hand would be a second thing to remember every time a photo is added.
// Empty when nothing has registered, which is how a plain Node script can
// import this module without Vite.
let SHIPPED_PHOTOS = {};
export function registerShippedPhotos(map) {
  SHIPPED_PHOTOS = map || {};
}

// A photo of this plot on its own, if there is one. A sharp close-up beats a
// crop out of the whole-nursery map every time, so it wins when present.
// Returns null when the plot has neither an upload nor a shipped picture, so
// callers can fall back to the nursery map.
export function plotPhoto(pid) {
  if (PHOTOS[pid]) return PHOTOS[pid];
  return SHIPPED_PHOTOS[pid] || null;
}

export function isMulti(pid) {
  return !!MULTI[pid];
}
export function aKey(pid, area) {
  return pid + '#' + area;
}

/* Every storage key belonging to a plot — one per area once it is split.
   Lives here rather than in the screen that first needed it, because the
   floating dock counts the same keys to decide whether the day is done, and
   two answers to "what is a plot made of" is how they would disagree. */
export function keysOfPlot(pid) {
  return isMulti(pid) ? MULTI[pid].areas.map((a) => aKey(pid, a)) : [pid];
}

/**
 * Carry a plot's history onto its areas when it is split.
 *
 * Work is logged against a unit key: the plot on its own ("B2") while it is
 * whole, "B2#A" once it is split. Splitting therefore used to blank the plot
 * on every screen — the new area keys had never been written to, so a plot
 * halfway through a cycle came back reading as untouched, and the cycle it
 * was in the middle of vanished from the board, the train and the study.
 *
 * Nothing about the plot changed on the ground, so nothing about it should
 * change on screen. Everything logged before the split was done to the whole
 * plot and so belongs to every area cut out of it: each new area starts
 * holding the plot's history, and they only diverge from the split onwards —
 * which is the point of splitting, that the areas can now be worked
 * separately.
 *
 * An area that already has its own log is left alone, so redrawing the
 * dividers on a plot that has been split for months moves the boundaries and
 * touches nothing else. Nothing is ever deleted: the whole-plot log stays
 * underneath, which is what lets un-splitting put the plot back as it was.
 *
 * Returns the number of areas seeded.
 */
export function carryLogsToAreas(db, pid, areas) {
  const src = db.logs[pid];
  if (!src || !src.length) return 0;
  let seeded = 0;
  areas.forEach((a) => {
    const k = aKey(pid, a);
    if ((db.logs[k] || []).length) return; // this area has its own history
    db.logs[k] = JSON.parse(JSON.stringify(src));
    // The per-key side tables travel with the log, or an area inherits the
    // plot's entries while claiming nobody has touched it today.
    if (db.updated[pid] && !db.updated[k]) db.updated[k] = { ...db.updated[pid] };
    if (db.unlocked[pid] && !db.unlocked[k]) db.unlocked[k] = db.unlocked[pid];
    seeded++;
  });
  return seeded;
}

/* ---------- storage ---------- */
export function freshDB() {
  return { logs: {}, updated: {}, editReq: {}, unlocked: {}, history: [], seq: 0 };
}

export function loadDB() {
  let db = freshDB();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) db = Object.assign(freshDB(), JSON.parse(raw));
  } catch (e) {
    /* storage unavailable -> run in-memory only */
  }
  // old requests were recorded as Admin's; they were the FC's
  Object.values(db.editReq || {}).forEach((r) => {
    if (r && r.by === 'Admin') r.by = 'FC';
  });
  return db;
}

export function saveDB(db) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- helpers ---------- */
/**
 * A -R plot is a REPLANT plot — ground a 3rd-culling transfer moved seedlings
 * onto. PALMS has nothing to say about one, so it is on no PALMS screen: not
 * the plot list, not the Culling Calculator. The office: "plot-R 不需要出现在
 * palms 完全不需要".
 *
 * SHARED RULE — isReplantPlot in the office repository,
 * shared/shared_palms.js. Change one, change the other. A trailing number is
 * allowed for, so B4-R and B4-R2 both go; a split area ("B4-R#A") is judged
 * by its plot.
 */
export function isReplantPlot(plot) {
  return /-R\d*$/i.test(String(plot == null ? '' : plot).split('#')[0].trim());
}

export function plotsOf(nk) {
  const n = NURSERIES[nk];
  if (!n) return [];
  // The office's list once it has been read; the generated one until then, so
  // a portal that cannot reach the server still has plots to show.
  // Filtered here as well as where the list is built, because a phone can
  // be holding a list cached before -R plots were left out of it.
  if (n.plots && n.plots.length) return n.plots.filter((p) => !isReplantPlot(p));
  return Array.from({ length: n.count }, (_, i) => n.prefix + (i + 1));
}

/** The last stage of the cycle, whatever the office has called it. */
export const lastAct = () => ACTIVITIES[ACTIVITIES.length - 1] || null;
/** The first. Both are read rather than assumed, because the office decides
    how many stages there are now. */
export const firstAct = () => ACTIVITIES[0] || null;

/**
 * Take the plot list and the stage list from Nursery Operation Management.
 *
 * Which plots exist (shared_plots, kept in Seedling Stock Management) and
 * which statuses can be chosen (nops_plot_status_stages, kept on Life of
 * Plot) are the office's to decide — they were hardcoded here, so adding a
 * plot or renaming a stage meant a code change and a deploy.
 *
 * Mutated in place, exactly as applySettings() does, so every screen already
 * holding a reference to NURSERIES or ACTIVITIES picks the change up on its
 * next render instead of needing to be re-imported.
 *
 * Anything the office has not filled in is left alone. An empty stage table
 * must not empty the picker a Field Conductor is standing in a plot using.
 */
export function applyOfficeConfig(cfg) {
  const c = cfg || {};
  if (c.plots) {
    Object.keys(NURSERIES).forEach((nk) => {
      const list = c.plots[nk];
      NURSERIES[nk].plots = list && list.length ? list : null;
    });
  }
  if (c.activities && c.activities.length) {
    ACTIVITIES.length = 0;
    c.activities.forEach((a) => ACTIVITIES.push(a));
  }
}
export function nurseryOfPlot(p) {
  for (const k in NURSERIES) if (p.startsWith(NURSERIES[k].prefix)) return k;
  return null;
}
export function activityByN(n) {
  return ACTIVITIES.find((a) => a.n === n);
}
/* Every ideal-days read goes through here, so this is where a stage the
   office has since removed or renumbered stops being a crash. An entry keeps
   the ideal it was started with (log entries carry their own `ideal`); this
   is only for starting a new one, and one day is a safe floor. */
export function durFor(pid, act) {
  return act && act.days != null ? act.days : 1;
}

function fmt(d) {
  return (
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  );
}
export function todayStr() {
  return fmt(new Date());
}
export function parseD(s) {
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(y, m - 1, dd);
}
export function addDays(s, n) {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}
export function diffDays(a, b) {
  return Math.round((parseD(b) - parseD(a)) / 86400000);
}
export function prettyD(s) {
  if (!s) return '—';
  return parseD(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
// Wall-clock of a save, stored as plain "HH:MM" — enough to tell a Field
// Conductor when today's report went in, and readable straight from storage.
export function nowClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- state derivation ----------
   A plot can have more than one activity running at once — culling may still
   be going while the soil crew starts angkat tanah — so "what is open" is a
   list, not a single entry. */
export const MAX_CONCURRENT = 2;

export function currentEntries(db, pid) {
  return (db.logs[pid] || []).filter((e) => e.end === null);
}

// The first open activity. Kept for the places that only need one.
export function currentEntry(db, pid) {
  const open = currentEntries(db, pid);
  return open.length ? open[0] : null;
}
export function tickedToday(db, pid) {
  return db.updated[pid] && db.updated[pid].at === todayStr();
}
export function isLocked(db, pid) {
  return !!currentEntry(db, pid) && tickedToday(db, pid) && !db.unlocked[pid];
}

function statusOfEntry(pid, e) {
  const act = activityByN(e.actN);
  const due = addDays(e.start, e.ideal);
  const left = diffDays(todayStr(), due);
  if (left < 0) return { state: 'overdue', act, due, left, start: e.start, key: pid };
  // "Needs attention" is configured in Settings: an activity listed there
  // warns once fewer than that many days remain. Anything unlisted is only
  // ever on schedule or overdue.
  const warnAt = ATTENTION[e.actN];
  const soon = warnAt != null && left < warnAt;
  return { state: soon ? 'soon' : 'ontrack', act, due, left, start: e.start, key: pid };
}

const STATE_RANK = { overdue: 0, soon: 1, ontrack: 2, none: 3 };

// With two activities running, the plot is only as healthy as its worse one.
export function computeStatus(db, pid) {
  const open = currentEntries(db, pid);
  if (!open.length) return { state: 'none' };
  return open
    .map((e) => statusOfEntry(pid, e))
    .sort((a, b) => {
      const r = STATE_RANK[a.state] - STATE_RANK[b.state];
      return r !== 0 ? r : (a.left ?? Infinity) - (b.left ?? Infinity);
    })[0];
}

/* ---------- multi-area derivation ---------- */
function bucket(p) {
  if (p < 40) return 30;
  if (p < 60) return 50;
  return 70;
}
export function worstArea(db, pid) {
  const rank = { overdue: 0, soon: 1, ontrack: 2, none: 3 };
  const arr = MULTI[pid].areas.map((a) => ({ area: a, key: aKey(pid, a), st: computeStatus(db, aKey(pid, a)) }));
  arr.sort((x, y) => {
    const rx = rank[x.st.state],
      ry = rank[y.st.state];
    if (rx !== ry) return rx - ry; // worse state first
    const lx = x.st.left == null ? Infinity : x.st.left;
    const ly = y.st.left == null ? Infinity : y.st.left;
    return lx - ly; // then earliest due date / most overdue
  });
  return arr[0];
}
export function multiStatus(db, pid) {
  return worstArea(db, pid).st;
}
export function effStatus(db, p) {
  return isMulti(p) ? multiStatus(db, p) : computeStatus(db, p);
}

// Record one unit's activities for a day.
//
// Whatever the Field Conductor leaves out is treated as finished: an activity
// that was running yesterday and is not chosen today gets closed with today's
// date. That is how "angkat tanah is done" gets recorded without anyone having
// to say so.
// `ts` is the clock time of the save, kept so a second save on the same day
// can say when the first one was.
export function applyDailySelection(db, key, selected, by, date, ts) {
  const sel = [...new Set(selected)].slice(0, MAX_CONCURRENT).sort((a, b) => a - b);
  const open = currentEntries(db, key);
  let changed = false;

  open.forEach((e) => {
    if (!sel.includes(e.actN)) {
      e.end = date;
      /* dirty = changed here and not yet delivered. sync's pull skips dirty
         entries — otherwise pulling BEFORE push (the order that protects
         office corrections) hands this close straight back to the server's
         still-open copy, and the status the Field Conductor just saved
         reverts in front of them. push clears it once the server has it. */
      e.dirty = 1;
      changed = true;
    }
  });
  sel.forEach((n) => {
    if (!open.some((e) => e.actN === n && e.end === null)) {
      startEntry(db, key, n, date, by);
      changed = true;
    }
  });

  db.updated[key] = { by, at: date, ts: ts || nowClock() };
  recordHistory(db, { key, acts: sel, by, at: date });
  return changed;
}

export function startEntry(db, pid, actN, dateStr, by) {
  db.logs[pid] = db.logs[pid] || [];
  /* uid is minted here, on the device, before the entry has been anywhere.
     It is what the server matches a row on, so an entry keyed with no signal
     and sent three days later cannot be saved twice. */
  db.logs[pid].push({
    uid: newUid(), no: ++db.seq, actN, start: dateStr, end: null,
    ideal: durFor(pid, activityByN(actN)), by, dirty: 1,
  });
}

// Every save is appended here, so "show me what was keyed in on 3 Aug" is an
// exact answer rather than a guess reconstructed from the logs.
export function recordHistory(db, { key, actN, acts, by, at, demo }) {
  db.history = db.history || [];
  const row = { at, key, acts: acts || (actN != null ? [actN] : []), by };
  // Same flag as the log entries: generated for a fresh install to have
  // something to show, and never sent to the server. A demo plot that later
  // gets a real entry would otherwise carry its invented days up with it.
  if (demo) row.demo = true;
  // A day holds one report per unit. Saving the nursery twice — a correction
  // an hour later — rewrites that day's row instead of stacking a second one.
  const i = db.history.findIndex((h) => h.key === key && h.at === at);
  if (i >= 0) db.history[i] = row;
  else db.history.push(row);
  // A daily report across three nurseries is ~56 rows; keep about a year of
  // them so the device's storage does not creep upwards forever.
  const CAP = 20000;
  if (db.history.length > CAP) db.history = db.history.slice(-CAP);
}

/* ---------- sample data ----------
   Built to be checked rather than to look plausible: every stage the office
   has configured is represented, and the three statuses (on schedule, needs
   attention, overdue) all appear, so the pipeline, the stat cards and the
   filters each have something to show. Prior stages are back-filled with
   sensible dates and written into the history, giving the date filter about a
   month to look through. */
function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/* The last two stage numbers — growing on, and collection. "Needs attention"
   only means anything on those two: an earlier stage is measured in days and
   is simply on schedule or late. Read rather than written as 10 and 11,
   because how many stages there are is the office's to decide. */
function lastTwo() {
  const n = ACTIVITIES.length;
  return [(ACTIVITIES[n - 2] || ACTIVITIES[n - 1] || { n: -1 }).n,
          (ACTIVITIES[n - 1] || { n: -1 }).n];
}

// mood: 'ontrack' | 'overdue' | 'soon'
// "soon" only exists for Membesar (<30 days left) and Pengambilan (<7), so it
// falls back to on-schedule for any earlier stage.
function seedUnit(db, key, actN, mood, by) {
  const today = todayStr();
  const idealC = durFor(key, activityByN(actN));
  let curStart;
  if (mood === 'overdue') {
    curStart = addDays(today, -(idealC + randInt(1, 6)));
  } else if (mood === 'soon' && (actN === lastTwo()[0] || actN === lastTwo()[1])) {
    const window = actN === lastTwo()[1] ? 7 : 30;
    curStart = addDays(today, -(idealC - randInt(1, window - 1)));
  } else {
    curStart = addDays(today, -randInt(0, Math.max(0, Math.min(20, idealC - 1))));
  }

  const entries = [{ actN, start: curStart, end: null, ideal: idealC }];
  let endCursor = curStart;
  for (let n = actN - 1; n >= 1; n--) {
    const ideal = durFor(key, activityByN(n));
    const spent = Math.max(1, ideal + randInt(-1, 2));
    const start = addDays(endCursor, -spent);
    entries.unshift({ actN: n, start, end: endCursor, ideal });
    endCursor = start;
  }
  // Two finished cycles behind the current one. The Motion Study measures
  // completed work, so without a past there would be nothing to look at until
  // the nursery had run a full intake through — about a year. These are not
  // written into the daily history: they are older than any date the filter
  // reaches back to, and 52 plots' worth would be a lot of rows to carry for
  // nothing.
  const past = [];
  let cursor = endCursor;
  for (let c = 0; c < 2; c++) {
    // Roughly a third of the past cycles were worked hard through the early
    // stages, so the Culling Duration report has runs on both sides of the
    // 15-day incentive to look at. The ideal for Saringan Anak Bibit through
    // to Transplanting is 23 days, so a qualifying run is a genuinely fast
    // one and the sample would otherwise never produce a single green row.
    const fast = randInt(0, 2) === 0;
    // Halving the ideals for stages 1-9 lands the run at 14 days; one stage
    // gets a spare day so the fast cycles are not all identical, which still
    // leaves them inside 15.
    const bonusOn = randInt(1, 9);
    for (let n = (lastAct() || { n: 11 }).n; n >= 1; n--) {
      const ideal = durFor(key, activityByN(n));
      // Spread the durations either side of the ideal so shortest and longest
      // are actually different figures.
      const spent =
        fast && n <= 9
          ? Math.max(1, Math.round(ideal * 0.5)) + (n === bonusOn ? 1 : 0)
          : Math.max(1, ideal + randInt(-Math.ceil(ideal * 0.3), Math.ceil(ideal * 0.4)));
      const start = addDays(cursor, -spent);
      past.unshift({ actN: n, start, end: cursor, ideal });
      cursor = start;
    }
  }
  // Numbered in the order they happened, oldest first: the Motion Study reads
  // a log back in that order to tell one cycle from the next.
  const all = [...past, ...entries];
  all.forEach((e) => {
    e.no = ++db.seq;
    e.by = by;
    /* Made up on this device to give a fresh install something to look at.
       Flagged so sync.js can refuse to send it: demo plots reaching the
       server would show the office activity that never happened. */
    e.demo = true;
  });
  entries.forEach((e) => recordHistory(db, { key, actN: e.actN, by, at: e.start, demo: true }));
  db.logs[key] = all;
}

// Fixed stages for the multi-area plots so the weighted label has something
// to show: B1 and U8 land on a Kosong/Pengambilan mix, B4 on Membesar with
// Pengambilan.
/* Fixed stages for the multi-area demo plots, as positions in whatever list
   the office has configured: `last` is collection, `mid` something growing,
   `early` something at the start. Written as names rather than the numbers
   5/10/11, which only meant anything while the list was fixed at eleven. */
const demoN = (which) => {
  const n = ACTIVITIES.length;
  const pick = { last: n - 1, mid: Math.max(0, n - 2), early: Math.min(3, n - 1) }[which];
  return (ACTIVITIES[pick] || ACTIVITIES[n - 1] || { n: 1 }).n;
};
const MULTI_PLAN = () => ({
  B1: { A: demoN('early'), B: demoN('last') },
  B4: { A: demoN('mid'),   B: demoN('last') },
  U8: { A: demoN('last'),  B: demoN('last'), C: demoN('early') },
});

export function seedSample() {
  const db = freshDB();
  const today = todayStr();
  const yest = addDays(today, -1);
  const moods = ['ontrack', 'overdue', 'soon'];
  let n = 0;

  Object.keys(NURSERIES).forEach((nk) =>
    plotsOf(nk).forEach((pid) => {
      const areas = isMulti(pid) ? MULTI[pid].areas : [null];
      areas.forEach((a, ai) => {
        const key = a ? aKey(pid, a) : pid;
        // Cycle the activities so all eleven are covered, and bias the
        // "needs attention" mood onto the two stages that can show it.
        const plan = MULTI_PLAN();
        const planned = a && plan[pid] ? plan[pid][a] : null;
        const actN = planned || ACTIVITIES[n % ACTIVITIES.length].n;
        let mood = moods[n % 3];
        if (mood === 'soon' && actN < 10) mood = 'ontrack';
        if (actN >= 10 && n % 4 === 0) mood = 'soon';

        seedUnit(db, key, actN, mood, 'Contoh');

        // Roughly every third unit is already keyed in today, so the train
        // shows a mix of done and outstanding. For a plot split into areas
        // only the FIRST area is done, which is what makes the area map
        // worth opening: one green, the rest still to do.
        const doneToday = a ? ai === 0 : n % 3 === 0;
        db.updated[key] = { by: 'Contoh', at: doneToday ? today : yest, ts: '07:30' };
        if (doneToday) recordHistory(db, { key, actN, by: 'Contoh', at: today, demo: true });
        n++;
      });
    })
  );
  return db;
}


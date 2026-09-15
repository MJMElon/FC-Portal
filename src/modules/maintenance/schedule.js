/**
 * Reading the office's maintenance schedule.
 *
 * Nursery Operation Management keeps one row per (nursery, month) in
 * nops_maint_state, with the whole month's plan in a JSON payload. This file
 * turns that payload into "for week N, this job is due on these plots, with
 * this chemical" — which is all a Field Conductor needs on a phone.
 *
 * The payload, as the office page writes it:
 *   pdConfig       { W1..W4: { P, P_dose, P_unit, P_sticker…, D, D_dose, … } }
 *   pd             { W1..W4: { <plot>: { P: bool, D: bool } } }
 *   manuringConfig [ round ][ col ] = { name, dose, unit }
 *   manuring       { <plot>: [ round ][ col ] = bool }
 *   interrowConfig [ round ][ col ] = { chem, chem_dose, chem_unit, activator_dose, activator_unit }
 *   interrow       { <plot>: [ round ][ col ] = bool }
 *   weeding        { <plot>: { R1: bool, R2: bool } }
 *
 * No imports, so it stays unit-testable in plain node.
 */

/** The four weeks the office plans in, and the days each one covers. */
export const WEEKS = [1, 2, 3, 4];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-04" → "Apr 2026", the key the office stores its schedule under. */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m ? `${MONTH_ABBR[parseInt(m[2], 10) - 1]} ${m[1]}` : '';
}

/** "Apr 2026" → a number that sorts, so months can be compared. */
export function monthRank(lbl) {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(String(lbl || '').trim());
  if (!m) return -1;
  const idx = MONTH_ABBR.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return idx < 0 ? -1 : parseInt(m[2], 10) * 12 + idx;
}

/**
 * Two shapes the office still reads, and so must this.
 *
 * Manuring and inter-row were once planned as a single round, and payloads
 * saved then are still in the database. The office page migrates them the
 * moment it loads one (migrateManuringShape / migrateInterrowShape in
 * plot_maintenance_script.js); without the same step here a schedule saved
 * the old way links to nothing at all, and the field is told a plot has no
 * work when the office can see that it does.
 *
 * Returns a new payload; the caller's is untouched.
 */
export function normalisePayload(payload) {
  if (!payload) return payload;
  const s = JSON.parse(JSON.stringify(payload));

  // Manuring: one flat row of columns becomes round 1 of many.
  if (Array.isArray(s.manuringConfig) && s.manuringConfig.length && !Array.isArray(s.manuringConfig[0])) {
    s.manuringConfig = [s.manuringConfig];
    Object.keys(s.manuring || {}).forEach((p) => {
      const v = s.manuring[p];
      if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'boolean')) s.manuring[p] = [v];
    });
  }

  // Inter-row: an object keyed by round becomes an array of rounds, each with
  // a single column.
  if (s.interrowConfig && !Array.isArray(s.interrowConfig)) {
    const keys = Object.keys(s.interrowConfig).sort();
    s.interrowConfig = keys.map((k) => [s.interrowConfig[k]]);
    Object.keys(s.interrow || {}).forEach((p) => {
      const v = s.interrow[p];
      if (v && !Array.isArray(v)) s.interrow[p] = keys.map((k) => [!!v[k]]);
    });
  }

  alignRoundsToWeeks(s);
  return s;
}

/* ── A round's POSITION and the WEEK its dates name ─────────────────────
   Two different things, and old payloads have them apart.
   ── This lives in BOTH repositories. Change one, change the other:
      alignRoundsToWeeks in nursery_ops/plot_maintenance_script.js. ──

   The office's full-width sheets pushed a new round onto the END of the
   array, so round 2 sat at index 1 whatever its dates said. Everything that
   READS a schedule goes by the week BLOCK the from-date falls in — round 2
   dated the 15th is week 3.

   So a month built the old way showed its week columns as 1 and 3 in the
   office and its work as weeks 1 and 2 on every phone. Both sides were
   reading the same payload and both were certain.

   Moved only where the evidence is unambiguous: the round is at its
   position, the block its dates name is empty, and the two differ. A month
   already filed by block is untouched. */
function alignRoundsToWeeks(s) {
  const filled = (x) => (Array.isArray(x) ? x.length > 0 : !!x);
  const slotOf = (from) => Math.min(WEEKS.length, Math.max(1, Math.ceil((+from || 1) / 7))) - 1;
  const weeksFor = (kind) => {
    const own = s.weeksByWork && Array.isArray(s.weeksByWork[kind]) ? s.weeksByWork[kind] : null;
    return (own || (Array.isArray(s.weeks) ? s.weeks : []))
      .slice().sort((a, b) => (+a.from || 0) - (+b.from || 0));
  };
  const setOf = (xs) => new Set(xs);
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  /* Is this work filed by POSITION or by BLOCK? Asked once, of the whole
     work, rather than round by round — a per-round guess moves data that was
     already in the right place.

     Positional means: every block holding data is one of the POSITIONS
     0..n-1, and that is not the same set as the blocks the dates name. If
     the data already sits on the dates' blocks, or on anything else, it is
     left alone. Nothing is moved on a maybe. */
  const movesFor = (weeks, hasData) => {
    if (!weeks.length) return [];
    const slots = weeks.map((w) => slotOf(w.from));
    const positions = weeks.map((_, i) => i);
    if (same(setOf(slots), setOf(positions))) return [];
    const data = setOf([...Array(WEEKS.length).keys()].filter(hasData));
    if (!data.size || !same(data, setOf(positions))) return [];
    return weeks.map((w, pos) => [pos, slotOf(w.from)]).filter(([p, q]) => p !== q);
  };

  [['manuring', 'manuringConfig'], ['interrow', 'interrowConfig']].forEach(([kind, key]) => {
    const cfg = s[key];
    if (!Array.isArray(cfg)) return;
    const moves = movesFor(weeksFor(kind), (b) => filled(cfg[b]));
    if (!moves.length) return;
    const isDest = (i) => moves.some(([, to]) => to === i);
    const shift = (arr) => {
      const next = arr.slice();
      moves.forEach(([from, to]) => { next[to] = arr[from]; });
      moves.forEach(([from]) => { if (!isDest(from)) next[from] = []; });
      for (let b = 0; b < WEEKS.length; b++) if (!Array.isArray(next[b])) next[b] = [];
      return next;
    };
    s[key] = shift(cfg);
    Object.keys(s[kind] || {}).forEach((p) => {
      if (Array.isArray(s[kind][p])) s[kind][p] = shift(s[kind][p]);
    });
  });

  // Weeding keeps a key per block — R1 to R4 — rather than an array.
  const wKey = (b) => `R${b + 1}`;
  const wMoves = movesFor(weeksFor('weeding'),
    (b) => Object.keys(s.weeding || {}).some((p) => s.weeding[p] && s.weeding[p][wKey(b)]));
  if (wMoves.length) {
    const isDest = (i) => wMoves.some(([, to]) => to === i);
    Object.keys(s.weeding || {}).forEach((p) => {
      const row = s.weeding[p];
      if (!row) return;
      const next = { ...row };
      wMoves.forEach(([from, to]) => { next[wKey(to)] = row[wKey(from)]; });
      wMoves.forEach(([from]) => { if (!isDest(from)) next[wKey(from)] = false; });
      s.weeding[p] = next;
    });
  }
}

/**
 * The schedule that applies to a month, per nursery.
 *
 * The office page carries the previous month's plan forward on screen and
 * only writes a row once someone ticks or saves — so a month can look fully
 * planned in the office and have no row of its own. The field has to see the
 * same plan the office is looking at, so where this month has no row the most
 * recent earlier one is used, and said to be carried forward.
 */
export function applicableSchedules(rows, monthLbl) {
  const want = monthRank(monthLbl);
  const best = new Map();     // nursery → { nursery, payload, month, carried }
  (rows || []).forEach((r) => {
    if (!r || !r.payload) return;
    const rank = monthRank(r.month);
    if (rank < 0 || rank > want) return;         // never a future month's plan
    const cur = best.get(r.nursery);
    if (!cur || monthRank(cur.month) < rank) {
      best.set(r.nursery, { nursery: r.nursery, payload: normalisePayload(r.payload),
                            month: r.month, carried: rank !== want });
    }
  });
  return [...best.values()];
}

/**
 * The month either side of this one, in the office's own wording.
 *
 * The week navigator walks off the end of a month — back from week 1 lands in
 * the previous month's week 4 — and the schedule for that month has to be
 * asked for by the same label the office files it under.
 */
export function shiftMonthLabel(lbl, delta) {
  const rank = monthRank(lbl);
  if (rank < 0) return lbl;
  const n = rank + (delta || 0);
  const year = Math.floor(n / 12);
  const idx = n - year * 12;
  return `${MONTH_ABBR[idx]} ${year}`;
}

/** The month a date falls in, in the office's own wording. */
export function monthLabelOf(dateStr) {
  return monthLabel(String(dateStr || '').slice(0, 7));
}

export function daysInMonthLabel(lbl) {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(String(lbl || '').trim());
  if (!m) return 31;
  const idx = MONTH_ABBR.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return 31;
  return new Date(parseInt(m[2], 10), idx + 1, 0).getDate();
}

function ordinalDay(d) {
  const v = d % 100;
  const sfx = ['th', 'st', 'nd', 'rd'];
  return d + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]);
}

/** "1st - 7th". The last week runs to the end of the month. */
export function weekDates(week, mLabel) {
  const days = daysInMonthLabel(mLabel);
  const from = (week - 1) * 7 + 1;
  if (from > days) return '';
  const to = week === WEEKS.length ? days : Math.min(from + 6, days);
  return from === to ? ordinalDay(from) : `${ordinalDay(from)} - ${ordinalDay(to)}`;
}

/** Which week a day of the month belongs to — the 29th onwards is week 4. */
/* SHARED WITH THE OFFICE. weekNoOfDay() in mjm-ai-system
   nursery_ops/plot_maintenance_script.js is the same arithmetic, and the
   office files a round's ticks under the block this returns — so the two
   drifting apart means a worker sent out in the wrong week for a job that
   was planned correctly. Change one, change the other. */
export function weekOfDate(dateStr) {
  const day = parseInt(String(dateStr || '').slice(8, 10), 10);
  if (!day) return 0;
  return Math.min(WEEKS.length, Math.ceil(day / 7));
}

/* A round's ticks. Tolerates a payload shape nobody has migrated: a bare
   boolean counts as one ticked column rather than throwing .some is not a
   function and taking the whole week's list down with it. */
const ticked = (v) => (Array.isArray(v) ? v.some(Boolean) : !!v);

const dose = (name, amount, unit) =>
  name && name !== '—' ? `${name}${amount ? ` ${amount}${unit || ''}` : ''}` : '';

/** "Daconil 50gm + Bond 15mL" — the chemical and its sticker, if any. */
function pdChemical(cfg, side) {
  if (!cfg) return '';
  const main = dose(cfg[side], cfg[`${side}_dose`], cfg[`${side}_unit`]);
  const stick = dose(cfg[`${side}_sticker`], cfg[`${side}_sticker_dose`], cfg[`${side}_sticker_unit`]);
  return [main, stick].filter(Boolean).join(' + ');
}

/**
 * Every job due in one week, as { key, plots: [{ plot, chemical }] }.
 *
 * P & D is planned per week, and the office ticks the insecticide (P) and the
 * fungicide (D) separately — a plot needing both is one visit with both named.
 * Manuring, weeding and inter-row are planned per ROUND, and a round is the
 * same seven-day block: round 1 is week 1. Weeding has no chemical.
 */
export function weekTasks(payload, week) {
  const s = payload || {};
  const wk = `W${week}`;
  const ri = week - 1;
  const out = {};

  // ── P & D ──
  // The pest spray and the disease spray are two jobs, not one: the office
  // ticks them separately and writes a work-record row for each, so the field
  // gets one entry per side rather than a single line naming both chemicals.
  // Doing them on the same walk is a coincidence of the day, not a reason to
  // record them as one piece of work.
  const pdCfg = (s.pdConfig || {})[wk];
  const pdTicks = (s.pd || {})[wk] || {};
  out.pd = [];
  Object.keys(pdTicks).sort(plotCmp).forEach((plot) => {
    const tick = pdTicks[plot];
    if (!tick) return;
    ['P', 'D'].forEach((side) => {
      if (!tick[side]) return;
      const chemical = pdChemical(pdCfg, side);
      if (!chemical) return;
      out.pd.push({ plot, chemical, side });
    });
  });

  // ── Manuring ──
  const mCfg = (s.manuringConfig || [])[ri] || [];
  out.manuring = Object.keys(s.manuring || {})
    .filter((plot) => ticked((s.manuring[plot] || [])[ri]))
    .sort(plotCmp)
    .map((plot) => ({
      plot,
      chemical: ((s.manuring[plot] || [])[ri] || [])
        .map((on, ci) => (on ? dose(mCfg[ci] && mCfg[ci].name, mCfg[ci] && mCfg[ci].dose, mCfg[ci] && mCfg[ci].unit) : ''))
        .filter(Boolean)
        .join(' + '),
    }));

  /* ── Weeding — a round per week block, and nothing is sprayed ──
     This read ['R1','R2'][ri] and nothing else, from back when weeding was
     planned as two rounds a month. The office has let it run in any of the
     four week blocks for a while and writes R1 to R4, so weeding set for
     week 3 or week 4 reached neither portal: the office showed it, the
     field was never told, and the plots went unweeded with nobody able to
     see why. Same key the office writes — see weToggle and plotsAtSlot. */
  const wKey = `R${week}`;
  out.weeding = !wKey ? [] : Object.keys(s.weeding || {})
    .filter((plot) => s.weeding[plot] && s.weeding[plot][wKey])
    .sort(plotCmp)
    .map((plot) => ({ plot, chemical: '' }));

  // ── Inter-row spraying ──
  const iCfg = (s.interrowConfig || [])[ri] || [];
  out.interrow = Object.keys(s.interrow || {})
    .filter((plot) => ticked((s.interrow[plot] || [])[ri]))
    .sort(plotCmp)
    .map((plot) => ({
      plot,
      chemical: ((s.interrow[plot] || [])[ri] || [])
        .map((on, ci) => {
          if (!on || !iCfg[ci]) return '';
          const c = iCfg[ci];
          /* The activator is chosen on the office's schedule now. A round
             saved before it could be has no name for it and printed the
             word "Activator", so that is what a missing one still reads as.
             Change one, change the other: interrowAct in the office's
             plot_maintenance_script.js. */
          return [dose(c.chem, c.chem_dose, c.chem_unit),
                  dose(c.activator || 'Activator', c.activator_dose, c.activator_unit)]
            .filter(Boolean).join(' + ');
        })
        .filter(Boolean)
        .join(' + '),
    }));

  return out;
}

/** B2 before B10, the way the nursery says them. */
function plotCmp(a, b) {
  const na = parseInt(String(a).replace(/\D/g, ''), 10);
  const nb = parseInt(String(b).replace(/\D/g, ''), 10);
  const pa = String(a).replace(/[0-9]/g, '');
  const pb = String(b).replace(/[0-9]/g, '');
  return pa.localeCompare(pb) || (na - nb) || String(a).localeCompare(String(b));
}

/**
 * The same week across several nurseries, as one list per job.
 * A Field Conductor looking at "All nurseries" wants the week's work, not a
 * nursery to choose first — and plot names carry their nursery in the prefix
 * (B, U, N), so the merged list still reads unambiguously.
 */
export function mergeWeekTasks(entries, week) {
  const out = { pd: [], manuring: [], weeding: [], interrow: [] };
  (entries || []).forEach((e) => {
    const t = weekTasks(e && e.payload, week);
    Object.keys(out).forEach((k) => {
      t[k].forEach((task) => out[k].push({ ...task, nursery: e && e.nursery }));
    });
  });
  Object.keys(out).forEach((k) => out[k].sort((a, b) => plotCmp(a.plot, b.plot)));
  return out;
}

/**
 * Has this plot's job already been recorded for this week?
 * Matched on the month's week rather than the exact day, because the schedule
 * asks for the job once in the block, not on a particular date.
 *
 * `chemical` separates the two P & D sprays on the same plot, which are two
 * jobs. A record made before they were split names both chemicals at once, so
 * a record whose chemical CONTAINS this one still counts — otherwise every
 * spray already recorded would reappear as outstanding.
 */
export function isDone(records, { workTypeKey, plot, week, month, chemical }) {
  return (records || []).some(
    (r) =>
      r.work_type === workTypeKey &&
      r.plot_name === plot &&
      (!chemical || !r.chemical || r.chemical === chemical ||
        String(r.chemical).indexOf(chemical) !== -1) &&
      (r.week_no ? r.week_no === week : weekOfDate(r.work_date) === week) &&
      monthLabelOf(r.work_date) === month
  );
}

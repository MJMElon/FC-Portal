/**
 * How much to draw from the store for one job in one week.
 *
 * ── This arithmetic lives in BOTH repositories. Change one, change the
 *    other. ──
 *
 * The office's copy is calcMaxChem / calcFertUsage / coverageFor in
 * nursery_ops/plot_maintenance_script.js, and the figures it prints under
 * each work on the Schedule tab are the same ones this produces. A Field
 * Conductor whose phone disagrees with the office sheet has no way to tell
 * which is wrong, so the two rules are stated the same way in both places:
 *
 *   A SPRAY is measured in pumps. One pump covers a number of seedlings —
 *   the chemical's own coverage when it has one, the preset from
 *   nops_maint_config when it does not, 800 when neither has been read.
 *       amount = (seedlings / coverage) x dose per pump
 *
 *   A FERTILISER is measured per seedling, with no pump in it.
 *       amount = seedlings x dose
 *
 * Both come out in grams or millilitres and are shown in kilograms or
 * litres to one decimal, the way the office sheet shows them.
 *
 * Everything here tolerates the tables it needs being absent. A phone that
 * could not read plot capacity shows no figure rather than a wrong one.
 */

export const COVERAGE_PER_PUMP = 800;

/** Letters and digits only, so "UNN 1" and UNN1 are one nursery. The same
    match the office uses — qtyNurseryKey over there. Change one, change
    the other. */
const nurseryKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const byNursery = (map, n) => {
  if (!map) return null;
  if (map[n]) return map[n];
  const want = nurseryKey(n);
  const k = Object.keys(map).find((x) => nurseryKey(x) === want);
  return k ? map[k] : null;
};

/**
 * What one plot holds, from the office's capacity table. Null when this
 * phone has no figure for it, which is not the same as zero.
 *
 * A pre-nursery plot is counted in TRAYS and becomes seedlings once; a main
 * nursery plot is counted in polybags and is the figure itself.
 */
export function makeCapacity({ qty, trays, traySize } = {}) {
  return (nursery, plot) => {
    const per = byNursery(traySize, nursery);
    if (per) {
      const t = byNursery(trays, nursery);
      const n = t && t[plot];
      if (n != null) return (Number(n) || 0) * (Number(per) || 0);
    }
    const q = byNursery(qty, nursery);
    const v = q && q[plot];
    return v == null ? null : Number(v) || 0;
  };
}

/** One pump's reach for a named chemical. */
export function makeCoverage(chemicals, preset) {
  const byName = {};
  (chemicals || []).forEach((c) => { if (c && c.name) byName[c.name] = c; });
  return (name) => {
    const c = byName[name];
    const own = c && c.coverage != null && c.coverage !== '' ? Number(c.coverage) : 0;
    return Math.max(1, own || Number(preset) || COVERAGE_PER_PUMP);
  };
}

/** grams → kg, millilitres → L, one decimal — the office's fmtUsage. */
function show(total, unit) {
  const big = Math.round((total / 1000) * 10) / 10;
  return `${big.toLocaleString()} ${unit === 'gm' ? 'kg' : 'L'}`;
}

/* A dose is a number or it is nothing. One keyed with a comma or a unit in
   it multiplies out to NaN, and "NaN kg" reads as an amount. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Every product each job needs this week, as { pd: [{ name, text }], … }.
 *
 * `entries` is [{ nursery, payload }] — one for a chosen nursery, several
 * for "All nurseries". They go into ONE bag, so two nurseries spraying the
 * same chemical at the same rate come out as one line with the seedlings
 * added before the rounding, not as two rounded halves.
 *
 * A plot whose capacity this phone does not know is left out of the sum and
 * named in `missing`, so a partial figure can say that it is partial.
 */
export function weekUsage(entries, week, { capacityOf, coverageOf } = {}) {
  const out = { pd: [], manuring: [], weeding: [], interrow: [], missing: [] };
  if (!capacityOf) return out;

  const missing = new Set();
  /* Keyed on everything that must not be averaged together: the job, the
     product, its unit AND its rate. Two columns of the same fertiliser at
     different rates are two lines, because one number would be neither. */
  const bag = new Map();
  const add = (job, nursery, plot, name, dose, unit, kind) => {
    if (!name || name === '—') return;
    const d = num(dose);
    if (d == null) return;
    const cap = capacityOf(nursery, plot);
    if (cap == null) { missing.add(plot); return; }
    const k = `${job}|${name}|${unit || ''}|${kind}|${d}`;
    if (!bag.has(k)) bag.set(k, { job, name, dose: d, unit, kind, seed: 0 });
    bag.get(k).seed += cap;
  };

  (entries || []).forEach((e) => {
    const s = (e && e.payload) || {};
    const n = e && e.nursery;
    const wk = `W${week}`;
    const ri = week - 1;

    // ── P & D: the spray, and the sticker that goes in the tank with it ──
    const pdCfg = (s.pdConfig || {})[wk];
    const pdTicks = (s.pd || {})[wk] || {};
    if (pdCfg) {
      Object.keys(pdTicks).forEach((plot) => {
        const tick = pdTicks[plot];
        if (!tick) return;
        ['P', 'D'].forEach((side) => {
          if (!tick[side]) return;
          add('pd', n, plot, pdCfg[side], pdCfg[`${side}_dose`], pdCfg[`${side}_unit`], 'spray');
          add('pd', n, plot, pdCfg[`${side}_sticker`], pdCfg[`${side}_sticker_dose`],
              pdCfg[`${side}_sticker_unit`], 'spray');
        });
      });
    }

    // ── Manuring: spread dry, per seedling ──
    const mCfg = (s.manuringConfig || [])[ri] || [];
    Object.keys(s.manuring || {}).forEach((plot) => {
      const row = (s.manuring[plot] || [])[ri];
      const cols = Array.isArray(row) ? row : [row];
      cols.forEach((on, ci) => {
        if (!on || !mCfg[ci]) return;
        add('manuring', n, plot, mCfg[ci].name, mCfg[ci].dose, mCfg[ci].unit || 'gm', 'fert');
      });
    });

    // ── Inter-row: the chemical and its activator ──
    const iCfg = (s.interrowConfig || [])[ri] || [];
    Object.keys(s.interrow || {}).forEach((plot) => {
      const row = (s.interrow[plot] || [])[ri];
      const cols = Array.isArray(row) ? row : [row];
      cols.forEach((on, ci) => {
        const c = iCfg[ci];
        if (!on || !c) return;
        add('interrow', n, plot, c.chem, c.chem_dose, c.chem_unit || 'mL', 'spray');
        /* A round saved before the activator could be chosen has no name for
           it and printed the word "Activator". Same fallback as the office. */
        add('interrow', n, plot, c.activator || 'Activator', c.activator_dose,
            c.activator_unit || 'mL', 'spray');
      });
    });

    // Weeding mixes nothing, so it never gets a line.
  });

  bag.forEach((b) => {
    if (!b.seed) return;
    const total = b.kind === 'fert'
      ? b.seed * b.dose
      : (b.seed / (coverageOf ? coverageOf(b.name) : COVERAGE_PER_PUMP)) * b.dose;
    out[b.job].push({ name: b.name, text: show(total, b.unit) });
  });
  ['pd', 'manuring', 'weeding', 'interrow'].forEach((k) =>
    out[k].sort((a, b) => a.name.localeCompare(b.name)));
  out.missing = [...missing];
  return out;
}

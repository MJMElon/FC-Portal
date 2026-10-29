/**
 * A FIGURE IS TURNED INTO TEXT IN ONE PLACE, AND THE LOCALE IS PINNED.
 *
 * A bare `toLocaleString()` reads the DEVICE's locale, which on a phone is
 * whatever the person set their handset to and has nothing to do with this
 * system. The office saw it first on a dose: their screen read **4.4 kg**
 * and the Field Conductor's phone read **4,4 kg** on the same figure, in
 * the same week, because his phone is set to a language that writes
 * decimals with a comma.
 *
 * A dose is the harmless end of it. The separator swaps BOTH ways, so on
 * that same phone a plot of 6,515 seedlings prints **6.515**, which a
 * person running down a column reads as six and a half. Every figure in
 * this app went through that call.
 *
 * So: ONE pin — grouping on the comma and the decimal on the point, which
 * is how every office screen, every printed claim and every figure the
 * nursery has ever written down reads. It is pinned rather than left to the
 * device precisely BECAUSE the two have to agree: a phone that disagrees
 * with the sheet leaves a Field Conductor no way to tell which is wrong,
 * which is the same reason the usage arithmetic is stated the same way in
 * both repositories.
 *
 * 'en-MY' is the SAME SPELLING the office pins, in `moneyFig` on the salary
 * claim, which is the one figure in this system that was already being
 * written deliberately. One rule in two repositories under two different
 * names is the drift this codebase keeps finding, so it is this name in
 * both. A browser that has never heard of the Malaysian subtag resolves it
 * to plain `en`, which formats a number identically — the fallback costs
 * nothing, which is why the region can safely be named.
 *
 * ── A DATE IS NOT A FIGURE and does not come through here. ──
 * A date SHOULD read in the reader's own language, so the two in the
 * culling console output are deliberately left on the device locale.
 *
 * ── This rule lives in BOTH repositories. Change one, change the other. ──
 * The office copy is the dose line in `plot_maintenance_script.js`, which
 * is where this was found; the rest of that side is a sweep still owed.
 */

export const NUM_LOCALE = 'en-MY';

/**
 * @param {*} n     anything; a value that is not a finite number comes back
 *                  as an empty string rather than as "NaN", which reads as
 *                  an amount.
 * @param {object} [opts]  Intl options, the same ones toLocaleString takes.
 */
export function numText(n, opts) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  // The one call in the app that may name a locale.
  return v.toLocaleString(NUM_LOCALE, opts);
}

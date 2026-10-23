import { fmtNum, fmtPct } from './cullingData.js';

/**
 * What to do about a culling rate.
 *
 * The Field Conductor counts pokok inang, the calculator works out where that
 * leaves the rate, and this decides what happens next. Today there are two
 * answers, and more are expected — so they are a LIST OF RULES rather than an
 * if/else: adding a third band is adding an entry here, and nothing in the
 * calculator screen changes.
 *
 * Rules are tried in order and the first match wins, so they may overlap and
 * the specific ones go first. Each one carries everything the case needs, so
 * the screen never has to know what "drone flight" means.
 *
 * category is the name this case is FILED under, and it is the string Nelos
 * routes on — nelos_routes matches a case by the words in its category, not
 * by an id. So it is not a label: renaming it here without renaming it in
 * nelos_categories and nelos_routes leaves a rule for a name nothing raises,
 * and every culling case falls back to the Field Conductors who raised it.
 * shared/migration_nelos_culling_rename.sql in mjm-ai-system moves both, and
 * carries the cases already filed under the old names across with them.
 *
 * titleKey is the wording on the button, and changes with the language.
 * caseTitle is the wording the CASE carries, and does not: a case is read by
 * whoever picks it up, days later, in whatever language they use, so its
 * title is one fixed sentence rather than whatever the raiser's phone was
 * set to.
 */

/** The line the whole thing turns on. One place, so the calculator, the case
    and any future rule cannot disagree about where 10% is. */
export const CULL_LIMIT = 0.1;

export const CULLING_ACTIONS = [
  {
    key: 'drone',
    // At or under the limit the plot is ready — the drone flight is what
    // records it having got there.
    when: (rate) => rate <= CULL_LIMIT,
    titleKey: 'cull.actDrone',
    caseTitle: (plot) => `Request drone flight for culling at plot "${plot}"`,
    category: 'From Culling Calculator - Request Drone Flight',
    priority: 'normal',
    tone: 'ok',
  },
  {
    key: 'recheck',
    // Still above the limit after the count, so somebody has to go and look
    // at the plot before it can be signed off.
    when: (rate) => rate > CULL_LIMIT,
    titleKey: 'cull.actRecheck',
    caseTitle: (plot) => `Request auditor to plot "${plot}" for high culling rate audit`,
    category: 'From Culling Calculator - Request Final Check For Pokok Inang',
    // Normal, like everything else. Nelos does not show a priority any
    // more, so raising at 'high' only wrote a word nobody reads — and when
    // every case a rule raises is high, high is not a priority.
    priority: 'normal',
    tone: 'warn',
  },
];

/**
 * THE THIRD WAY OUT, and it is not decided by a rate.
 *
 * The other two are bands: where the figure lands says what happens. This
 * one is decided by how many times the plot has been round the loop. A
 * selection made, an auditor sent, a second selection made, and the block is
 * STILL over ten percent — that is not a figure to be re-counted, it is a
 * plot somebody at HQ has to come and look at. So it is kept out of
 * CULLING_ACTIONS: a rule in that list answers "what does this rate mean",
 * and this one answers a different question.
 *
 * It routes to HQ Operation (`nursery_ops` in nelos_modules), which is the
 * one thing about it that must match the database: nelos_routes matches a
 * case by the WORDS in its category. The category here, the nelos_categories
 * row and the nelos_routes rule are three spellings of one string, and a
 * change to any of them without the other two sends every HQ verification
 * back to the Field Conductor who raised it. shared/RUN_ME_culling_inang.sql
 * in mjm-ai-system is the other two.
 */
export const HQ_ACTION = {
  key: 'hq',
  titleKey: 'cull.actHq',
  caseTitle: (plot) => `Request HQ verification for culling at plot "${plot}"`,
  category: 'From Culling Calculator - Request HQ Verification',
  priority: 'normal',
  tone: 'warn',
};

/** The rule that applies to a rate, or null when there is nothing to say. */
export function actionFor(rate) {
  if (!Number.isFinite(rate)) return null;
  return CULLING_ACTIONS.find((a) => a.when(rate)) || null;
}

/**
 * The rule that applies to a WHOLE PLOT, which is a list of rates — one per
 * batch standing in it.
 *
 * The calculator shows every batch at once now, so the decision is about all
 * of them together and the question is not "what does this rate mean" but
 * "is every one of them clear". THE WORST BATCH DECIDES. Averaging them
 * would hide the one in trouble behind the ones that are fine, which is the
 * same reason the screen never offered an all-batches figure to act on.
 *
 * A rate that is not a number — a batch whose ledger does not add up — is
 * not clear and is not ignorable: it answers null, so no button is offered
 * at all. "Cannot say" must never read as "yes".
 *
 * It is the same CULL_LIMIT and the same two rules as actionFor, asked of a
 * set instead of one, so a third band added above still arrives here with
 * nothing changed.
 */
export function actionForPlot(rates) {
  const list = rates || [];
  if (!list.length) return null;
  if (list.some((r) => !Number.isFinite(r))) return null;
  return actionFor(Math.max(...list));
}

/**
 * What the case says.
 *
 * The figures go in the body because the case IS the record — nothing the
 * calculator does touches stock. Whoever picks the case up has to be able to
 * see what was counted and what it left the rate at, without opening the
 * calculator or taking the Field Conductor's word for it.
 *
 * ONE LINE PER BATCH, because the calculator now shows the whole plot at
 * once and the decision was made over all of them. A case that named only
 * the batch somebody happened to have selected would be a record of a
 * different decision from the one that was taken, and it would send the
 * auditor to part of a plot.
 *
 * The separate counts are kept beside the total — "300 + 250 + 180" is a
 * walk round the plot in three goes, and a single 730 hides that.
 */
export function caseBody({ t, plot, nursery, rows, by, date }) {
  const lines = [
    `${t('cull.plot')}: ${plot}${nursery ? ` (${nursery})` : ''}`,
    '',
  ];
  (rows || []).forEach((r) => {
    const terms = (r.terms && r.terms.length > 1) ? `  (${r.terms.map(fmtNum).join(' + ')})` : '';
    lines.push(
      `${t('cull.batchField')} ${r.batch || '—'}: ` +
      `${t('cull.balance')} ${fmtNum(r.balance)} (${fmtPct(r.rate)})` +
      ` · ${t('cull.selected')} ${fmtNum(r.inang)}${terms}` +
      ` · ${t('cull.finalBalance')} ${fmtNum(r.finalBalance)} (${fmtPct(r.finalRate)})`
    );
  });
  lines.push('');
  lines.push(`${t('cull.raisedBy')}: ${by || '—'} · ${date}`);
  return lines.join('\n');
}

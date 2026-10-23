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

/** The rule that applies to a rate, or null when there is nothing to say. */
export function actionFor(rate) {
  if (!Number.isFinite(rate)) return null;
  return CULLING_ACTIONS.find((a) => a.when(rate)) || null;
}

/**
 * What the case says.
 *
 * The figures go in the body because the case IS the record — nothing the
 * calculator does touches stock. Whoever picks the case up has to be able to
 * see what was counted and what it left the rate at, without opening the
 * calculator or taking the Field Conductor's word for it.
 */
export function caseBody({ t, plot, nursery, balance, inang, rate, terms, by, date, batch }) {
  const lines = [
    `${t('cull.plot')}: ${plot}${nursery ? ` (${nursery})` : ''}`,
    /* Which block of the plot. A plot holds several batches and they are
       collected on their own timetables, so "U4" on its own sends the auditor
       to the right field and leaves them to guess which part of it. */
    ...(batch ? [`${t('cull.batchField')}: ${batch}`] : []),
    `${t('cull.balance')}: ${fmtNum(balance)}`,
    // The separate counts are kept, not just their total: "300 + 250 + 180"
    // is a walk round the plot in three goes, and a single 730 hides that.
    `${t('cull.inangCounted')}: ${fmtNum(inang)}${terms && terms.length > 1 ? `  (${terms.map(fmtNum).join(' + ')})` : ''}`,
    `${t('cull.estRate')}: ${fmtPct(rate)}`,
    `${t('cull.raisedBy')}: ${by || '—'} · ${date}`,
  ];
  return lines.join('\n');
}

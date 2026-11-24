/**
 * A WORKER BOUNDED TO A PLOT IS BOUNDED TO ITS REPLANT.
 *
 * The office, in the one sentence that says why this cannot be keyed by
 * hand: "月头 没有B3-R 结果15号那天B3-R出现 所以worker那边要live update
 * B3-R 出现 如果有做B3-R就按B3-R 如果两边都有做 B3 和 B3-R都要按". And the
 * reason, which is the whole of why it matters: "可能B3已经没有苗了 要cull了
 * 但是B3-R没出现 他们就会按B3 结果B3的balance其实是要被cull的".
 *
 * It drives the SHIPPED rules out of the shipped files — plotKey,
 * replantParent, isReplantPlot and workerPlotFilter — because the whole
 * fault was two keys disagreeing, and a restated key cannot disagree with
 * itself.
 *
 * EVERY READER IS GUARDED. On the previous code replantParent does not
 * exist, so an unguarded call takes the harness down on the first line and
 * the checks underneath are never asked — which proves nothing about the
 * code being replaced. A missing export is ONE named failure here.
 */
'use strict';

const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('pass  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  -> got ' + JSON.stringify(got))); }
};
/* A reader that throws is a named failure, never a dead harness. */
const safe = (name, fn) => {
  try { return fn(); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  -> threw: ' + e.message); return undefined; }
};

const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PB = path.join(ROOT, 'src/modules/maintenance/plotBatches.js');
const WS = path.join(ROOT, 'src/worker/workerMaintSource.js');
const PD = path.join(ROOT, 'src/modules/palms/data.js');

/* workerMaintSource.js imports supabase and the outbox, so it cannot be
   imported in plain node — and stubbing a dozen modules to reach one pure
   function would be a thicker fixture than the function. It is LIFTED out of
   the shipped file instead and run with the real plotKey and the real
   replantParent in scope, which is the stronger check anyway: a rule
   restated in a test cannot disagree with itself.

   The body opens after the PARAMETER LIST and not at the first brace on the
   line, which is the trap the office harness already had to learn. */
const liftFn = (src, name) => {
  const i = src.indexOf('export function ' + name + '(');
  if (i < 0) return null;
  const open = src.indexOf('{', src.indexOf(')', i));
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) {
      return src.slice(i + 'export '.length, k + 1);
    }
  }
  return null;
};

(async () => {
  const pb = await safe('plotBatches.js loads', () => import(PB));
  if (!pb) {
    console.log('\n' + pass + ' passed, ' + fail + ' failed  (plotBatches.js would not load)');
    process.exit(1);
  }

  const { plotKey, replantParent, isReplantPlot } = pb;

  const wsSrc = fs.readFileSync(WS, 'utf8');
  const wpfSrc = liftFn(wsSrc, 'workerPlotFilter');
  const workerPlotFilter = wpfSrc === null ? undefined : safe(
    'workerPlotFilter lifts out of the shipped file',
    () => new Function('plotKey', 'replantParent',
                       wpfSrc + '\nreturn workerPlotFilter;')(plotKey, replantParent));

  // ── 1. The parent of a replant ─────────────────────────────────────────
  console.log('\n-- 1. which plot a -R plot is the replant OF');

  ok('replantParent is exported', typeof replantParent === 'function',
     typeof replantParent);

  if (typeof replantParent === 'function') {
    const P = (v) => safe('replantParent(' + JSON.stringify(v) + ')',
                          () => replantParent(v));
    ok('B3-R is the replant of B3', P('B3-R') === 'B3', P('B3-R'));
    ok('a second replant counts too: B4-R2 is B4', P('B4-R2') === 'B4', P('B4-R2'));
    ok('a split area is judged by its plot: B4-R#A is B4', P('B4-R#A') === 'B4', P('B4-R#A'));
    ok('lower case and spacing do not matter', P(' b3-r ') === 'B3', P(' b3-r '));
    ok('a delivery-order spelling still reads: PLOT: B3-R is B3',
       P('PLOT: B3-R') === 'B3', P('PLOT: B3-R'));

    // The ones that must answer NO, because each would widen a boundary
    // over a plot that is nobody's replant.
    ok('an ordinary plot is nobody replant', P('B3') === null, P('B3'));
    ok('B3-RX is not a replant', P('B3-RX') === null, P('B3-RX'));
    ok('a bare -R has no parent to name', P('-R') === null, P('-R'));
    ok('nothing is not a replant', P('') === null && P(null) === null,
       [P(''), P(null)]);

    /* IT ANSWERS IN plotKey SPELLING, which is the one thing a caller
       cannot check for itself: every caller compares against keys, and a
       parent worked out in one spelling and compared in another matches
       nothing while looking exactly as though it should. Asked of every
       replant name rather than one, and against plotKey of the head, which
       is the whole claim. */
    const spelling = ['B3-R', 'B14-R', 'b4-r2', 'B4-R#A', ' b3-r ', 'U12-R']
      .filter((n) => {
        const head = String(n).split('#')[0].trim().replace(/-R\d*$/i, '');
        return P(n) !== safe('plotKey', () => plotKey(head));
      });
    ok('the parent is always already a plotKey', spelling.length === 0, spelling);

    /* WHAT IS NOT CLAIMED, and it is named rather than buried: the SQL copy
       keys on letters and digits alone, so it reads "U 7-R" as U7 where this
       reads it as U -- plotKey SPLITS ON A SPACE, because it is also the
       reader for a delivery order plot ("U15 (UPB PREMIER HYBRID)"). The
       difference is unreachable unless the office keys a plot name with a
       space inside it, and for such a name the boundary ALREADY mismatched
       before any of this -- plotKey("U 7") is "U" and plotKey("U7") is "U7".
       Moving plotKey to close it would move the movement-report agreement
       this whole file rests on, so it is left, and it is left SAID. */
    ok('a plot name with a space is plotKey own long-standing shape',
       safe('plotKey(U 7)', () => plotKey('U 7')) === P('U 7-R'),
       [safe('plotKey(U 7)', () => plotKey('U 7')), P('U 7-R')]);
  }

  // ── 1b. The two questions share one rule ───────────────────────────────
  console.log('\n-- 1b. isReplantPlot and replantParent cannot disagree');

  ok('isReplantPlot is exported', typeof isReplantPlot === 'function',
     typeof isReplantPlot);

  if (typeof isReplantPlot === 'function' && typeof replantParent === 'function') {
    /* THE IMPLICATION THAT HAS TO HOLD IS ONE-WAY: a plot this widens a
       boundary over must be a plot PALMS also calls a replant. The reverse
       is not needed and does not hold for one name -- "-R" with nothing in
       front of it, which isReplantPlot answers yes to (its head matches
       empty) and which has no parent to name. That is the SAFE direction:
       no parent means no widening, so such a name opens nothing. Asserting
       the equivalence instead would force a change to isReplantPlot, which
       is the shipped PALMS rule and decides which plots that module hides. */
    const names = ['B3', 'B3-R', 'b3-r', 'B4-R2', 'B4-R#A', 'B3-RX', '-R',
                   'B14-R', 'U 7-R', 'P12', '', null];
    const widensNonReplant = names.filter((n) => {
      const hasParent = safe('replantParent', () => replantParent(n) !== null);
      return hasParent && !safe('isReplantPlot', () => !!isReplantPlot(n));
    });
    ok('nothing with a parent is a plot PALMS would not call a replant',
       widensNonReplant.length === 0, widensNonReplant);
    ok('and a bare -R, which PALMS does call one, widens nothing',
       safe('replantParent(-R)', () => replantParent('-R')) === null);
  }

  // ── 2. The boundary, which is what the worker actually sees ────────────
  console.log('\n-- 2. the office own sentence, through workerPlotFilter');

  ok('workerPlotFilter is in workerMaintSource.js and drives',
     typeof workerPlotFilter === 'function', typeof workerPlotFilter);
  ok('and it asks replantParent rather than keeping a copy of the rule',
     wpfSrc !== null && /replantParent\s*\(/.test(wpfSrc));

  const mk = (plots) => safe('workerPlotFilter(' + JSON.stringify(plots) + ')',
                             () => workerPlotFilter(plots === undefined ? {} : { plots }));

  if (typeof workerPlotFilter === 'function') {
    const bounded = mk(['B3', 'B6']);
    const call = (f, p) => safe('filter(' + JSON.stringify(p) + ')',
                                () => (typeof f === 'function' ? !!f(p) : undefined));

    // THE HEADLINE, in the office own words: 如果两边都有做 B3 和 B3-R都要按.
    ok('a worker bounded to B3 can tick B3', call(bounded, 'B3') === true);
    ok('and B3-R, which appeared on the 15th', call(bounded, 'B3-R') === true,
       call(bounded, 'B3-R'));
    ok('B6-R comes with B6 as well', call(bounded, 'B6-R') === true,
       call(bounded, 'B6-R'));

    // What must NOT widen.
    ok('a plot nobody gave them is still out', call(bounded, 'B4') === false,
       call(bounded, 'B4'));
    ok('and so is its replant', call(bounded, 'B4-R') === false,
       call(bounded, 'B4-R'));
    ok('B3-RX is not B3 replant and stays out', call(bounded, 'B3-RX') === false,
       call(bounded, 'B3-RX'));

    /* ONE WAY ONLY. The office put this worker on the replant; the parent is
       other seedlings and somebody else morning. */
    const onReplant = mk(['B3-R']);
    ok('bounded to B3-R, B3-R is in', call(onReplant, 'B3-R') === true);
    ok('bounded to B3-R, B3 is NOT in', call(onReplant, 'B3') === false,
       call(onReplant, 'B3'));

    /* The two shapes that mean something and must not move. */
    ok('an EMPTY plot list still means nobody',
       call(mk([]), 'B3') === false && call(mk([]), 'B3-R') === false,
       [call(mk([]), 'B3'), call(mk([]), 'B3-R')]);
    ok('NO plot list is no filter at all, as it always was',
       mk(undefined) === null && workerPlotFilter(null) === null,
       [mk(undefined), workerPlotFilter(null)]);

    /* A phone sends " b3-r ", and the office keys whatever they key. */
    ok('both sides are compared on their keys',
       call(mk([' b3 ']), 'B3-R') === true, call(mk([' b3 ']), 'B3-R'));
  }

  // ── 3. The PALMS copy is the same rule, not a second one ───────────────
  console.log('\n-- 3. one isReplantPlot, re-exported and never rewritten');

  const pd = await safe('palms/data.js loads', () => import(PD));
  /* NOT GATED on plotBatches exporting it: on the previous code palms/data.js
     keeps its own copy, so this has to FAIL rather than go quiet -- a section
     that skips itself reads exactly like a section that passed. */
  ok('palms/data.js still exports isReplantPlot',
     !!pd && typeof pd.isReplantPlot === 'function', pd && typeof pd.isReplantPlot);
  /* The SAME FUNCTION OBJECT. A copy that happens to agree today is a copy
     that drifts, and the PALMS screens read this one. */
  ok('and it is the very same function, not a copy',
     !!pd && typeof isReplantPlot === 'function' && pd.isReplantPlot === isReplantPlot);

  // ── 4. The database holds the same rule, and it is the one that decides ─
  console.log('\n-- 4. the SQL copy is in step');

  const sqlPath = path.join(ROOT, '..', 'mjm-ai-system', 'shared',
                            'create_worker_portal.sql');
  if (!fs.existsSync(sqlPath)) {
    console.log('skip  the office repository is not beside this one');
  } else {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    /* worker_plots() is the single gate -- the phone lists what it returns
       and worker_submit_maint refuses a save against anything it does not.
       So the screen half above is worth nothing on its own, and a release
       that ships one and not the other shows the plot and then refuses the
       save, after the walk. */
    ok('the database has a worker_replant_parent',
       sql.includes('FUNCTION public.worker_replant_parent('));
    ok('and worker_plots asks it',
       /worker_plots[\s\S]*worker_replant_parent\(p\.plot_name\)/.test(sql));
    ok('and it is granted to anon, the phone own role',
       /GRANT EXECUTE ON FUNCTION public\.worker_replant_parent\(TEXT\)[^\n]*anon/.test(sql));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

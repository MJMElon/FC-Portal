/* A TRANSPLANTED PLOT THAT SEEDLING STOCK CANNOT PLACE IS STILL OWED FOUR
 * JOBS, AND IT WAS ON NOBODY BOARD.
 *
 * The office counted their own Pending Verification and said it: *"我的
 * pending verification 还是只有 B2 B3 没有 B11"*. The ledger had put
 * seedlings into that plot and none of its four jobs was recorded, so the
 * board should have been raising it.
 *
 * It never could. `loadTransplantingSince` is handed the plot names of the
 * conductor own nurseries and drops every ledger row outside that list --
 * which is right for another nursery plot and catastrophic for a plot on
 * NO nursery list, because there is then no conductor anywhere whose list
 * it is in. It is raised on no board, nobody is ever asked to record its
 * lining, its polybag filling, its blanket spray or its transplanting, and
 * that is four crews worth of pay that no screen in the system mentions.
 *
 * This codebase already decided this exact question for the other half of
 * the same board, and wrote the answer down: a card that vanishes off
 * every board with nothing saying where it went is the fault this board
 * exists to stop.
 *
 * The REAL reader is lifted out of the shipped file -- the whole fault was
 * one line of filtering inside it, so a restatement here would prove
 * nothing.
 *
 * Run: node tests/a_plot_on_no_list_is_not_invisible.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const is = (got, want, m) => {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok    ' + m);
  else fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));
};
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* The shipped reader, with its module imports cut away and the two helpers
   it leans on lifted beside it. Everything that decides which rows survive
   is the file own. */
const SRC = R('src/modules/maintenance/transplantData.js');
const grab = (src, decl, name) => {
  const at = src.indexOf(decl + name);
  if (at < 0) throw new Error(name + ' not found');
  let depth = 0;
  for (let j = src.indexOf('{', src.indexOf(')', at)); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1).replace(/^export /, '');
  }
  throw new Error(name + ' not closed');
};
const line = (src, re) => { const m = src.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };

const code = [
  line(SRC, /^const plotKey = .*$/m),
  line(SRC, /^export const TRANSPLANT_FLOW_FROM = .*$/m).replace(/^export /, ''),
  grab(SRC, 'function ', 'logDate'),
  grab(SRC, 'export async function ', 'loadTransplantingSince'),
].join('\n');

/* The ledger read is the only thing stubbed: this test is about which rows
   the function KEEPS, not about the network. */
let LEDGER = [];
const ctx = {
  console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean,
  supabase: null,
  fetchAllRows: async () => ({ data: LEDGER, error: null }),
};
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__f = loadTransplantingSince;', ctx);
const loadTransplantingSince = vm.runInContext('__f', ctx);

const row = (plot, qty, when) => ({
  plot_name: plot, batch_name: '271', quantity_change: qty,
  transaction_date: when, created_at: when + 'T00:00:00Z', remark: '',
});

/* B2 and B3 are on the BNN list. B11 took seedlings and is on NO list --
   which is the office own case. N12 is another nursery plot and must go
   on being another nursery business. */
const MINE = ['B2', 'B3'];
const EVERY = ['B2', 'B3', 'N12', 'N15'];
LEDGER = [row('B2', 3164, '2026-10-02'), row('B3', 900, '2026-10-04'),
          row('B11', 700, '2026-10-20'), row('N12', 500, '2026-10-06')];

(async () => {
  console.log('\n-- 1 - WITHOUT THE FULL LIST IT BEHAVES EXACTLY AS IT DID --');
  /* Nothing else calls this with three arguments, and nothing else should
     change because of this fix. */
  const before = await loadTransplantingSince(MINE);
  is(before.map((p) => p.plot).sort(), ['B2', 'B3'],
     'the conductor own plots, and neither of the other two');

  console.log('\n-- 2 - GIVEN IT, THE UNPLACEABLE PLOT IS RAISED --');
  const after = await loadTransplantingSince(MINE, undefined, EVERY);
  is(after.map((p) => p.plot).sort(), ['B11', 'B2', 'B3'],
     'B11 is on the board -- it is on no nursery list, so it is on nobody else board either');
  is(after.filter((p) => p.unplaced).map((p) => p.plot), ['B11'],
     'and it is MARKED, so the card can say so rather than print a blank nursery');
  is(after.find((p) => p.plot === 'B11').qty, 700,
     'with its real quantity, off the same ledger rows as any other plot');

  console.log('\n-- 3 - ANOTHER NURSERY PLOT IS STILL NOT MINE --');
  /* This is the half that must NOT change. N12 is on the list, just not on
     this conductor own -- raising it here would undo the scoping the
     office asked for in the same week. */
  is(after.some((p) => p.plot === 'N12'), false,
     'N12 is on the Seedling Stock list, so it belongs to its own nursery board');

  console.log('\n-- 4 - AND A PLOT WITH NOTHING IN THE LEDGER IS NOT INVENTED --');
  LEDGER = [row('B2', 3164, '2026-10-02')];
  const one = await loadTransplantingSince(MINE, undefined, EVERY);
  is(one.map((p) => p.plot), ['B2'],
     'only plots the ledger actually moved seedlings into');

  /* The floor is the floor for an unplaceable plot too: it is a plot the
     board forgot, not a plot the board exempts. */
  console.log('\n-- 5 - THE DATE FLOOR STILL APPLIES TO IT --');
  LEDGER = [row('B11', 700, '2026-01-01')];
  const old = await loadTransplantingSince(MINE, undefined, EVERY);
  is(old.map((p) => p.plot), [],
     'an arrival from before TRANSPLANT_FLOW_FROM is out, placed or not');

  console.log(failed ? '\nFAILED (' + failed + ')' : '\nall green');
  process.exit(failed ? 1 : 0);
})();

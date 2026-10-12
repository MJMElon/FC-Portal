/* THE CONFIRM NAMES THE STATUSES, FOR THAT PLOT.

   Pressing X closes a PALMS status, and an admin deciding whether to press
   OK needs to know WHICH of the plot running activities goes and which
   stays. "The collecting status is closed" leaves them to work that out,
   and on B4 -- Pengambilan open since June, Membesar running beside it --
   that is the whole question.

   So the dialog reads, for B4:

     Pengambilan closes, dated today
     Membesar is untouched and keeps running
     the PALMS board will show B4 as Membesar only

   Held here through the real openStatuses and the real strings, because
   the value of this is entirely in the wording being true.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/the_confirm_names_the_statuses.cjs
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

/* The real strings, and the real {placeholder} substitution the app uses. */
const I18N = R('src/i18n.js');
const str = (key) => {
  const m = new RegExp("'" + key + "':\\s*'((?:[^'\\\\]|\\\\.)*)'").exec(I18N);
  if (!m) { fail('missing string ' + key); return ''; }
  return m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'");
};
const t = (key, vars) =>
  String(str(key)).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : '{' + k + '}'));

/* The real openStatuses. */
const SRC = R('src/modules/palms/cullingSource.js');
const from = SRC.indexOf('const stageKey =');
const to   = SRC.indexOf('/* Whether the last loadPlots()');
const code = SRC.slice(from, to).replace(/^export /gm, '');

function statuses(rows, stages) {
  const ctx = {
    console: { warn(){}, log(){} },
    plotKey: (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    todayStr: () => '2026-10-12',
    isOnline: () => true,
    fetchAllRows: async () => ({ data: [], error: null }),
    supabase: {
      from: (name) => {
        const q = {
          select: () => q,
          is: () => q,
          in: () => q,
          order: async () => ({ data: stages, error: null }),
          then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
        };
        if (name === 'nops_plot_status_stages') {
          q.then = (res) => Promise.resolve({ data: stages, error: null }).then(res);
        }
        return q;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__st = openStatuses;', ctx);
  return vm.runInContext('__st', ctx);
}

/* The same assembly removePlot does, so the test holds the message the
   admin actually reads rather than the pieces it is built from. */
function confirmText(st, plot) {
  const lines = [t('cull.removeAsk1', { plot })];
  lines.push(t('cull.removeCloses', { names: st.collecting.join(', ') }));
  if (st.other.length) {
    lines.push(t('cull.removeKeeps', { names: st.other.join(', ') }));
    lines.push(t('cull.removeBoard', { plot, names: st.other.join(', ') }));
  } else {
    lines.push(t('cull.removeBoardNone', { plot }));
  }
  lines.push(t('cull.removeAsk2'));
  return lines.join('\n');
}

const STAGES = [
  { name: 'Membesar',            sort_order: 3 },
  { name: 'Pengambilan',         sort_order: 4 },
  { name: 'Saringan Anak Bibit', sort_order: 2 },
];

(async () => {
  /* B4 as it really is. */
  const b4 = await statuses(
    [{ plot_name: 'B4', act_n: 3 }, { plot_name: 'B4', act_n: 4 }], STAGES)('B4');
  const msg = confirmText(b4, 'B4');

  const want = [
    [/THIS CHANGES THE PALMS STATUS/, 'it says the PALMS status changes'],
    [/Pengambilan closes, dated today/, 'Pengambilan closes, dated today'],
    [/Membesar is untouched and keeps running/, 'Membesar is untouched and keeps running'],
    [/the PALMS board will show B4 as Membesar only/, 'the board will show B4 as Membesar only'],
    [/Nothing is deleted/, 'nothing is deleted'],
  ];
  for (const [re, label] of want) {
    if (re.test(msg)) pass('the dialog says: ' + label);
    else fail('the dialog does not say "' + label + '". It reads:\n' +
              msg.split('\n').map((l) => '        ' + l).join('\n'));
  }
  if (!/Membesar closes/.test(msg)) pass('it does not claim Membesar closes');
  else fail('the dialog says Membesar closes, which is not what happens');

  /* A plot where collecting is the ONLY thing running: the board ends up
     empty, and the dialog has to say so rather than naming nothing. */
  const n16 = await statuses([{ plot_name: 'N16', act_n: 4 }], STAGES)('N16');
  const m2 = confirmText(n16, 'N16');
  if (/the PALMS board will show N16 with nothing running/.test(m2)) {
    pass('a plot with nothing else running is told the board goes empty');
  } else {
    fail('expected the "nothing running" wording for N16, got:\n' +
         m2.split('\n').map((l) => '        ' + l).join('\n'));
  }
  if (!/is untouched and keeps running/.test(m2)) pass('and it does not invent a status that keeps running');
  else fail('N16 has nothing else running, but the dialog named one');

  console.log(failed ? `\n${failed} failure(s)` : '\nall good');
  process.exit(failed ? 1 : 0);
})();

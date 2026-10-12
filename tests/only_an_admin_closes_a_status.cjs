/* THE X ON A PLOT ROW IS ADMIN-ONLY, AND IT CLOSES RATHER THAN DELETES.

   A plot sits on the culling calculator because a collecting status is
   open on it, and the ONLY thing that ever closes one is saving that plot
   in PALMS with the activity unticked. A plot nobody saves again keeps its
   open row for ever -- B4 read Membesar on the board with a Pengambilan
   row open since June, and sat on this screen the whole time.

   The X closes that status. Three things it must get right:

     1. Only an admin sees it, and isModuleAdmin fails CLOSED, so
        "permissions have not loaded yet" is not consent.
     2. It CLOSES the row (end_date = today). Deleting it would take a real
        collecting period out of the history to tidy up a list.
     3. It matches the plot exactly. A split plot logs against "B2#A", and
        a pattern loose enough to catch that also catches B20 -- closing a
        status on a plot nobody asked about.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/only_an_admin_closes_a_status.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

/* ── 1. WHO SEES IT ──────────────────────────────────────────────────── */
const ACCESS = R('src/lib/access.js');
const aFrom = ACCESS.indexOf('export function isModuleAdmin');
const aTo   = ACCESS.indexOf('export const canBarcode');
const actx  = { console };
vm.createContext(actx);
vm.runInContext(ACCESS.slice(aFrom, aTo).replace(/^export /gm, ''), actx);
const isAdmin = (perms) => vm.runInContext('isModuleAdmin', actx)(perms, 'palms');

const WHO = [
  ['nobody signed in / permissions not loaded', null,                                false],
  ['an ordinary Field Conductor',               { modules: { palms: 'normal' } },    false],
  ['palms set to none',                         { modules: { palms: 'none' } },      false],
  ['a palms admin',                             { modules: { palms: 'admin' } },     true ],
  ['the office account',                        { manage_users: true },              true ],
];
for (const [label, perms, want] of WHO) {
  const got = isAdmin(perms);
  if (got === want) pass(`${label} → ${got ? 'sees the X' : 'does not see the X'}`);
  else fail(`${label}: expected ${want ? 'to see' : 'NOT to see'} the X` +
            (want ? '' : '\n      This control changes a record other people read. It must fail closed.'));
}

/* ── 2 & 3. WHAT IT DOES ─────────────────────────────────────────────── */
const SRC = R('src/modules/palms/cullingSource.js');
const from = SRC.indexOf('const stageKey =');
const to   = SRC.indexOf('/* Whether the last loadPlots()');
if (from < 0 || to < 0) { fail('could not find closeCollectingStatus in cullingSource.js'); }
else {
  const code = SRC.slice(from, to).replace(/^export /gm, '');

  const STAGES = [
    { name: 'Membesar',            sort_order: 3 },
    { name: 'Pengambilan',         sort_order: 4 },
    { name: 'Saringan Anak Bibit', sort_order: 2 },
  ];
  /* B4 is the real case: Membesar running, Pengambilan still open. B20 and
     B4#A are the traps a loose plot match would spring. */
  const ROWS = [
    { id: 1, plot_name: 'B4',   act_n: 3 },  // Membesar — not collecting, must stay open
    { id: 2, plot_name: 'B4',   act_n: 4 },  // Pengambilan — close this
    { id: 3, plot_name: 'B4#A', act_n: 2 },  // a split area of B4 — close this too
    { id: 4, plot_name: 'B20',  act_n: 4 },  // a DIFFERENT plot — must not be touched
  ];

  function build({ online = true, rows = ROWS, stages = STAGES } = {}) {
    const calls = [];
    const table = (name) => {
      const q = {
        _t: name, _ids: null,
        select() { return q; },
        is() { return q; },
        in(col, v) { if (col === 'id') q._ids = v; return q; },
        order: async () => ({ data: stages, error: null }),
        update(patch) { calls.push({ table: name, patch, q }); return q; },
        then(res) { return Promise.resolve({ data: rows.filter((r) => r.act_n !== 3 || false), error: null }).then(res); },
      };
      /* The open-rows read resolves to every row with a collecting act_n,
         which is what .in('act_n', acts) would have filtered to. */
      if (name === 'fcportal_palms_plot_logs') {
        q.then = (res) => Promise.resolve({
          data: rows.filter((r) => [2, 4].includes(r.act_n)), error: null,
        }).then(res);
      }
      return q;
    };
    const ctx = {
      console: { warn(){}, log(){} },
      plotKey: (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
      todayStr: () => '2026-10-12',
      isOnline: () => online,
      fetchAllRows: async () => ({ data: [], error: null }),
      supabase: { from: table },
      __calls: calls,
    };
    vm.createContext(ctx);
    vm.runInContext(code + '\n;globalThis.__close = closeCollectingStatus;', ctx);
    return { ctx, run: (plot) => vm.runInContext('__close', ctx)(plot) };
  }

  (async () => {
    const a = build();
    const n = await a.run('B4');
    const call = a.ctx.__calls[0];

    if (n === 2) pass('closing B4 closes its two open collecting rows');
    else fail(`closing B4 reported ${n} rows, expected 2 (B4 Pengambilan and B4#A screening)`);

    if (call && call.patch && call.patch.end_date === '2026-10-12' && !('deleted' in call.patch)) {
      pass('the row is CLOSED with today date, not deleted — the history survives');
    } else {
      fail('expected an update setting end_date, got ' + JSON.stringify(call && call.patch));
    }

    const ids = (call && call.q && call.q._ids) || [];
    if (ids.includes(2) && ids.includes(3)) pass('it closes the plot and its split area (B4 and B4#A)');
    else fail('the split area B4#A was not closed with its plot: ' + JSON.stringify(ids));

    if (!ids.includes(4)) pass('B20 is left alone — the plot is matched exactly, not by prefix');
    else fail('closing B4 also closed B20. A loose plot match hits a plot nobody asked about.');

    if (!ids.includes(1)) pass('the Membesar row stays open — only collecting statuses are closed');
    else fail('it closed the Membesar row too, which is not what the X says it does');

    /* Offline must refuse rather than queue: an admin who taps X and sees
       the plot go should not find it back tomorrow. */
    let threw = '';
    try { await build({ online: false }).run('B4'); } catch (e) { threw = e.message; }
    if (threw === 'offline') pass('with no line it refuses, rather than queueing a change it cannot promise');
    else fail('offline should throw "offline", got ' + JSON.stringify(threw));

    console.log(failed ? `\n${failed} failure(s)` : '\nall good');
    process.exit(failed ? 1 : 0);
  })();
}

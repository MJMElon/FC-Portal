/* A TRANSPLANT FLOWS INTO THE FC PORTAL ONLY ONCE THE OFFICE VERIFIED IT.
 *
 * The office: "transplanting的要等我verify才可以进去". A Transplanted row
 * reaches the board and the Transplanting sheet only once it is signed off
 * on Tab 3 of the batch report: the whole tab (operation_batch_verifications,
 * stage transplanting) or that plot row (a Row_Verification log
 * 'transplanting::<plot>|...'). A sign-off list that cannot be read gates
 * nothing.
 *
 * The shipped reader and rules are lifted out of transplantData.js; only the
 * two database reads are stubbed.
 *
 * Run: node tests/a_transplant_waits_for_verify.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const is = (got, want, m) => {
  if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok    ' + m);
  else { failed++; console.log('FAIL  ' + m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
};
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/modules/maintenance/transplantData.js'), 'utf8');
const grab = (decl, name) => {
  const at = SRC.indexOf(decl + name);
  if (at < 0) return null;
  let depth = 0;
  for (let j = SRC.indexOf('{', SRC.indexOf(')', at)); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1).replace(/^export /, '');
  }
  return null;
};
const line = (re) => { const m = SRC.match(re); return m ? m[0].replace(/^export /, '') : ''; };

const parts = {
  loadSig: grab('export async function ', 'loadTransplantSignoffs'),
  sigs: grab('export function ', 'transplantSignoffs'),
  signed: grab('export function ', 'transplantRowSigned'),
};
is(Object.keys(parts).filter((k) => !parts[k]), [], 'the gate is in the shipped reader');

/* Every read goes through fetchAllRows; the stub answers by what is asked. */
let LEDGER = [], STAGES = [], ROWV = [], REFUSE = false;
const chain = (table) => {
  const q = { table, filters: [] };
  const w = new Proxy({}, { get: (_, k) => (k === '__q' ? q : (...a) => { q.filters.push([k, ...a]); return w; }) });
  return w;
};
const ctx = {
  console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean, Promise,
  supabase: { from: (t) => chain(t) },
  fetchAllRows: async (fn) => {
    const q = fn().__q;
    if (q.table === 'operation_batch_verifications') return REFUSE ? { data: null, error: { message: 'refused' } } : { data: STAGES, error: null };
    const rv = q.filters.some((f) => f[0] === 'eq' && f[2] === 'Row_Verification');
    return { data: rv ? ROWV : LEDGER, error: null };
  },
};
vm.createContext(ctx);
vm.runInContext([
  line(/^const plotKey = .*$/m),
  line(/^const TRANSPLANT_TYPES = .*$/m),
  line(/^export const TRANSPLANT_FLOW_FROM = .*$/m),
  grab('function ', 'logDate'),
  parts.loadSig || 'async function loadTransplantSignoffs(){return null;}',
  parts.sigs || '', parts.signed || 'function transplantRowSigned(){return true;}',
  grab('export async function ', 'loadTransplantingSince'),
  ';globalThis.__f = loadTransplantingSince;',
].join('\n'), ctx);
const load = vm.runInContext('__f', ctx);

const T = (plot, b, qty, when) => ({ plot_name: plot, batch_name: b, quantity_change: qty,
  transaction_date: when, created_at: when + 'T00:00:00Z', remark: '' });
LEDGER = [T('B2', '271', 3164, '2026-10-02'), T('B3', '271', 900, '2026-10-04'), T('B11', '269', 3168, '2026-10-09'), T('B11', '271', 135, '2026-10-24')];
const MINE = ['B2', 'B3', 'B11'];
const plots = (rows) => rows.map((p) => p.plot + ':' + p.qty).sort();

(async () => {
  console.log('\n-- 1 - NOTHING VERIFIED, NOTHING FLOWS IN --');
  is(plots(await load(MINE)), [], 'no plot reaches the board before the office verifies');

  console.log('\n-- 2 - A ROW SIGNED ON TAB 3 FLOWS IN, AND ONLY THAT ONE --');
  ROWV = [{ batch_name: '271', plot_name: 'transplanting::B2|2026-10-02' }];
  is(plots(await load(MINE)), ['B2:3164'], 'B2 batch 271 is signed, so B2 shows and B3 does not');

  console.log('\n-- 3 - THE SIGN-OFF IS PER BATCH --');
  ROWV.push({ batch_name: '269', plot_name: 'transplanting::B11|main|P24|2026-10-09' });
  const b11 = (await load(MINE)).find((p) => p.plot === 'B11');
  is(b11 && [b11.qty, b11.batches], [3168, ['269']], 'B11: 269 signed (an older per-tray key), the unsigned 135 of 271 does not flow in');

  console.log('\n-- 4 - A WHOLE TAB SIGNED IS EVERY PLOT OF THAT BATCH --');
  STAGES = [{ batch_name: '271', stage: 'transplanting' }];
  is(plots(await load(MINE)), ['B11:3303', 'B2:3164', 'B3:900'], 'batch 271 signed as a whole: B3 and B11 271 flow in too');

  console.log('\n-- 5 - A SIGN-OFF LIST THAT CANNOT BE READ GATES NOTHING --');
  STAGES = []; ROWV = []; REFUSE = true;
  is(plots(await load(MINE)), ['B11:3303', 'B2:3164', 'B3:900'], 'refused read: everything shows, as before the gate');

  console.log(failed ? '\nFAILED (' + failed + ')' : '\nall green');
  process.exit(failed ? 1 : 0);
})();

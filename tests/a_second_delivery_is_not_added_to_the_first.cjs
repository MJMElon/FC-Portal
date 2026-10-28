/* A SECOND DELIVERY IS A SECOND CREW, AND ITS FIGURE IS ITS OWN.
 *
 * B11 took **3,168** seedlings in September (batch 269) and its four jobs
 * were recorded on the 29th. On 24 October it took **135 more** (batch
 * 271), which is four more crews owed their pay — the rule one section
 * along in CLAUDE.md, and it works.
 *
 * What it then offered was the two deliveries ADDED TOGETHER. The card
 * read `3303 · 269, 271`, and `3303` is what `saveTransplantRecord` would
 * have written into `source_qty` — the figure the salary claim divides
 * among the crew. Four crews would have been paid for moving 3,303
 * seedlings when 135 arrived, and September's crew would have been paid
 * for the same 3,168 a second time.
 *
 * The office, in one line: *"之前3168记录了就记录了 这次的135 不要combine
 * 起来"*.
 *
 * So the ledger reader keeps each delivery apart (`byBatch`), and the
 * figure anywhere a job is OWED is the figure of the batches outstanding
 * ON THAT JOB. The REAL functions are lifted out of the shipped files:
 * the whole fault was a sum taken one level too high, and a restatement
 * here would prove nothing.
 *
 * Run: node tests/a_second_delivery_is_not_added_to_the_first.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const ok   = (m) => console.log('ok    ' + m);
const is = (got, want, m) => {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(m);
  else fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));
};
const yes = (v, m) => (v ? ok(m) : fail(m));
const no  = (v, m) => (!v ? ok(m) : fail(m));
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const DATA  = R('src/modules/maintenance/transplantData.js');
const PEND  = R('src/components/verify/pending.js');
const SHEET = R('src/modules/maintenance/TransplantSheet.jsx');
const BOARD = R('src/components/VerificationBoard.jsx');

/* A body opens after the PARAMETER LIST, not at the first `{` on the line. */
const grab = (src, decl, name, open = '{', close = '}') => {
  const at = src.indexOf(decl + name);
  if (at < 0) throw new Error(name + ' not found');
  const from = open === '{' ? src.indexOf(')', at) : at;
  let depth = 0;
  for (let j = src.indexOf(open, from); j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close && --depth === 0) return src.slice(at, j + 1).replace(/^export /, '');
  }
  throw new Error(name + ' not closed');
};
const line = (src, re) => {
  const m = src.match(re);
  if (!m) throw new Error('missing ' + re);
  return m[0].replace(/^export /, '');
};
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── THE LEDGER READER, as shipped ───────────────────────────────────── */
let LEDGER = [];
const dctx = {
  console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean,
  supabase: null, fetchAllRows: async () => ({ data: LEDGER, error: null }),
};
vm.createContext(dctx);
vm.runInContext([
  line(DATA, /^const plotKey = .*$/m),
  line(DATA, /^export const TRANSPLANT_FLOW_FROM = .*$/m),
  grab(DATA, 'function ', 'logDate'),
  grab(DATA, 'export async function ', 'loadTransplantingSince'),
  ';globalThis.__load = loadTransplantingSince;',
].join('\n'), dctx);
const loadTransplantingSince = vm.runInContext('__load', dctx);

/* ── THE RULES, as shipped ───────────────────────────────────────────── */
const JOBS = [{ key: 'blanket_spray' }, { key: 'lining' },
              { key: 'polybag_fill' }, { key: 'transplanting' }];
const pctx = { console, JSON, Object, Set, Array, String, Number, Boolean, TRANSPLANT_JOBS: JOBS };
vm.createContext(pctx);
vm.runInContext([
  line(PEND, /^const batchKey = .*$/m),
  line(PEND, /^const batchList = .*$/m),
  grab(PEND, 'export function ', 'missingJobs'),
  grab(PEND, 'export function ', 'owedBatches'),
  grab(PEND, 'export function ', 'owedQty'),
  grab(PEND, 'export function ', 'owedForJob'),
  grab(PEND, 'export function ', 'plotsOwingJobs'),
  ';globalThis.__x = { missingJobs, owedBatches, owedQty, owedForJob, plotsOwingJobs };',
].join('\n'), pctx);
const { owedQty, owedForJob, plotsOwingJobs } = vm.runInContext('__x', pctx);

/* ── B11's own two deliveries ────────────────────────────────────────── */
const row = (plot, batch, qty, when) => ({
  plot_name: plot, batch_name: batch, quantity_change: qty,
  transaction_date: when, created_at: when + 'T00:00:00Z', remark: '',
});
LEDGER = [
  row('B11', '269', 3168, '2026-09-26'),
  row('B11', '271', 135,  '2026-10-24'),
  row('B2',  '269', 3164, '2026-10-02'),   // one delivery, nothing recorded
];
/* September's four, recorded for 269 and nobody else. */
const rec = (plot, job, batch, qty, when, month) => ({
  plot_name: plot, work_type: job, batch_name: batch, source_qty: qty,
  work_date: when, schedule_month: month, workers: [{ name: 'Andi', qty: null }],
});
const SEPT = JOBS.map((j) => rec('B11', j.key, '269', 3168, '2026-09-29', 'Sep 2026'));

(async () => {
  const rows = await loadTransplantingSince(['B11', 'B2']);
  const b11 = rows.find((r) => r.plot === 'B11');

  console.log('\n-- 1 - THE READER KEEPS THE DELIVERIES APART --');
  is(b11.qty, 3303, 'the plot total is still every arrival since the floor');
  is(b11.byBatch, { 269: 3168, 271: 135 }, 'AND each delivery is kept on its own');
  is(b11.batches, ['269', '271'], 'both batches are named, newest included');

  console.log('\n-- 2 - THE CARD OFFERS WHAT IS OWED, NOT THE SUM --');
  const card = plotsOwingJobs(rows, SEPT).find((r) => r.plot === 'B11');
  is(card.owed, ['271'], 'the outstanding delivery is 271');
  is(card.owedQty, 135, 'and the figure beside it is 135 — NOT 3,303');
  no(card.owedQty === card.qty, 'the two are not the same number on this plot');
  is(card.missing.map((j) => j.key),
     ['blanket_spray', 'lining', 'polybag_fill', 'transplanting'],
     'all four jobs are owed again, which is the rule this one sits on');

  console.log('\n-- 2b - AND A PLOT NOBODY HAS RECORDED IS UNTOUCHED --');
  const b2 = plotsOwingJobs(rows, SEPT).find((r) => r.plot === 'B2');
  is([b2.owedQty, b2.qty, b2.owed], [3164, 3164, []],
     'everything is owed, so the figure is the whole of it');

  console.log('\n-- 3 - ONE JOB AT A TIME, because they are not recorded together --');
  /* The lining gets done for the new delivery first. The other three still
     owe 271; the lining owes nothing. */
  const AFTER = SEPT.concat([rec('B11', 'lining', '271', 135, '2026-10-26', 'Oct 2026')]);
  is(owedForJob(b11, AFTER, 'lining').batches, [],
     'the lining is answered for both deliveries');
  is(owedForJob(b11, AFTER, 'blanket_spray').batches, ['271'],
     'the spray still owes the new one');
  is(owedForJob(b11, AFTER, 'blanket_spray').qty, 135,
     'and it is worth 135');
  const still = plotsOwingJobs(rows, AFTER).find((r) => r.plot === 'B11');
  is(still.missing.map((j) => j.key), ['blanket_spray', 'polybag_fill', 'transplanting'],
     'three left, and the lining is off the list');

  console.log('\n-- 3b - A JOB NOBODY HAS RECORDED AT ALL TAKES THE WHOLE PLOT --');
  const fresh = owedForJob(b11, [], 'lining');
  is([fresh.batches, fresh.qty], [['269', '271'], 3303],
     'both deliveries, both figures — nothing has been paid for either');

  console.log('\n-- 4 - WHAT THE RECORD WOULD CARRY --');
  /* The sheet writes `batch: jr.batch, sourceQty: jr.qty`, and that is the
     figure the claim divides among the crew. */
  const S = bare(SHEET);
  yes(/sourceQty: jr\.qty/.test(S) && /batch: jr\.batch/.test(S),
      'the save takes the JOB row, not the plot row');
  no(/sourceQty: row\.qty/.test(S), 'the plot total never reaches source_qty again');
  yes(/const jobRow = /.test(S) && /owedForJob\(row, done, key\)/.test(S),
      'and the job row is built from the shipped rule');

  console.log('\n-- 5 - A NEW BATCH OPENS A NEW RECORD, never a correction --');
  yes(/existing=\{owedJobs\.has\(job\) \? null :/.test(S),
      'a job that owes a batch opens BLANK — September is not a draft to overwrite');
  yes(/prior=\{owedJobs\.has\(job\)/.test(S) && /tp\.priorBatch/.test(S),
      'and what was recorded before is shown, so nobody thinks it is a first record');
  yes(/tp\.monthTaken/.test(S),
      'two deliveries cannot share one month on one job — the unique key is (plot, job, month)');

  console.log('\n-- 6 - THE COUNTS AND THE TICKS FOLLOW THE SAME RULE --');
  yes(/TRANSPLANT_JOBS\.length - missingJobs\(r\.plot, records, r\.batches\)\.length/.test(S),
      'the plot list counts what is OWED, not what has any record at all');
  yes(/owes \? t\('tp\.todo'\)/.test(S),
      'a job owed again wears TO DO, not the green tick it had for the old batch');
  yes(/tp\.owesBatch/.test(S), 'and the row says which batch and how many');

  console.log('\n-- 7 - THE CARD ON THE BOARD --');
  const B = bare(BOARD);
  yes(/tpCard\.owedQty == null \? tpCard\.qty : tpCard\.owedQty/.test(B),
      'the card prints the owed figure, falling back to the total');

  console.log('\n-- 8 - EVERY NEW STRING IS IN BOTH LANGUAGES --');
  const I18N = R('src/i18n.js');
  ['tp.owesBatch', 'tp.priorBatch', 'tp.monthTaken'].forEach((k) => {
    is((I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length, 2,
       `${k} is in English and Malay`);
  });

  console.log(failed ? `\n${failed} FAILED` : '\nall good');
  process.exit(failed ? 1 : 0);
})();

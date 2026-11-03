/* A TRANSPLANTING JOB THAT WAS NOT DONE IS AN ANSWER, NOT A GAP.
 *
 * A plot that takes seedlings owes four jobs, and the Pending Verification
 * board raises it until all four are recorded. A BLANKET SPRAY IS NOT
 * ALWAYS NEEDED -- the grass does not always come -- so a plot can
 * genuinely never have one, and there was no way to say so. The plot owed
 * four jobs for ever: its card could never be cleared, and since a second
 * delivery now asks for the four jobs again it would come back on every
 * arrival. The office asked for it in one line: *"要有option是没有做"*.
 *
 * The answer is a RECORD and never a deletion -- the same choice the
 * admin-closed plot and the rejected signup made. An ordinary row of
 * nops_transplant_field_records with an EMPTY crew and `not_done` set, so
 * it goes through the one door everything else goes through, carries who
 * said so and when, pays nobody by construction, and can be reversed.
 *
 * The REAL writer and the REAL board rule are lifted out of the shipped
 * files: the whole of this is which row goes in and whether the job then
 * counts as answered, and a restatement here would prove neither.
 *
 * Run: node tests/a_job_that_was_not_done_is_an_answer.cjs
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

/* ── lifting the shipped code ────────────────────────────────────────── */
const DATA  = R('src/modules/maintenance/transplantData.js');
const PEND  = R('src/components/verify/pending.js');
const SHEET = R('src/modules/maintenance/TransplantSheet.jsx');

/* A body opens after the PARAMETER LIST, not at the first `{` on the line:
   a default argument matches first and hands back half a signature. Same
   lesson the harness in nobody_signed_for_this_work.cjs had to learn. */
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
/* Comments stripped before any source question is asked: these files
   explain in prose what they are NOT, and a plain text search reads the
   explanation as the thing. */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 1. THE WRITER ───────────────────────────────────────────────────── */
let WRITES = [];
let REFUSE = null;          // {message} the database sends back
const result = () => (REFUSE ? { error: REFUSE } : { error: null });
const table = {
  update: (row) => { WRITES.push({ how: 'update', row }); return { eq: () => result() }; },
  upsert: (row, opts) => { WRITES.push({ how: 'upsert', row, opts }); return result(); },
};
const ctx = {
  console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean,
  supabase: { from: () => table },
  fetchAllRows: async () => ({ data: [], error: null }),
};
vm.createContext(ctx);
vm.runInContext([
  line(DATA, /^const TABLE = .*$/m),
  line(DATA, /^export const TRANSPLANT_SETUP_NEEDED = .*$/m),
  line(DATA, /^export const TRANSPLANT_NOT_DONE_SETUP_NEEDED = .*$/m),
  grab(DATA, 'export const ', 'TRANSPLANT_JOBS', '[', ']') + ';',
  line(DATA, /^export const jobByKey\s+= .*$/m),
  grab(DATA, 'function ', 'missingTable'),
  grab(DATA, 'function ', 'missingNotDoneColumn'),
  grab(DATA, 'export async function ', 'saveTransplantRecord'),
  ';globalThis.__save = saveTransplantRecord;',
  ';globalThis.__ND = TRANSPLANT_NOT_DONE_SETUP_NEEDED;',
  ';globalThis.__SU = TRANSPLANT_SETUP_NEEDED;',
].join('\n'), ctx);
const save = vm.runInContext('__save', ctx);
const ND   = vm.runInContext('__ND', ctx);
const SU   = vm.runInContext('__SU', ctx);

const base = {
  date: '2026-10-28', nursery: 'BNN', plot: 'B2', batch: '269, 271',
  month: 'Oct 2026', sourceQty: 3164, reportedBy: 'Lalu Aenal',
};

/* ── 2. THE BOARD RULE ───────────────────────────────────────────────── */
const pctx = { console, JSON, Object, Set, Array, String, Number, Boolean,
               TRANSPLANT_JOBS: vm.runInContext('TRANSPLANT_JOBS', ctx) };
vm.createContext(pctx);
vm.runInContext([
  line(PEND, /^const batchKey = .*$/m),
  line(PEND, /^const batchList = .*$/m),
  grab(PEND, 'export function ', 'missingJobs'),
  ';globalThis.__m = missingJobs;',
].join('\n'), pctx);
const missingJobs = vm.runInContext('__m', pctx);
const owed = (recs, batches) =>
  missingJobs('B2', recs, batches).map((j) => j.key);

(async () => {
  console.log('\n-- 1 - THE ROW THAT GOES IN --');
  WRITES = []; REFUSE = null;
  await save({ ...base, workTypeKey: 'blanket_spray', workers: [], notDone: true });
  const r1 = WRITES[0] && WRITES[0].row;
  is(WRITES.length, 1, 'one write, and it is the ordinary table');
  is(r1.not_done, true, 'the row carries not_done');
  is(r1.workers, [], 'THE CREW IS EMPTY -- which is what keeps it off every claim line');
  is(r1.plot_name, 'B2', 'the plot is on it');
  is(r1.batch_name, '269, 271', 'AND THE BATCHES -- so a new delivery asks again');
  is(r1.work_date, '2026-10-28', 'the day the answer was given');
  is(r1.reported_by, 'Lalu Aenal', 'who said so');
  is(r1.source_qty, 3164, 'the plot own figure stays on the row');

  console.log('\n-- 1b - A SPLIT JOB NOBODY DID HAS NO TOTAL --');
  WRITES = [];
  await save({ ...base, workTypeKey: 'polybag_fill', workers: [], notDone: true });
  is(WRITES[0].row.total_qty, null,
     'total_qty is null, never 0 -- a nought reads as nobody filled any bag');

  console.log('\n-- 2 - A CALLER FROM BEFORE THIS EXISTED NAMES NO COLUMN --');
  /* The flag is sent only by code that knows about it. Every ordinary save
     must go on working on a database that has not had
     RUN_ME_transplant_not_done.sql run, and naming a column the table has
     not got fails the WHOLE write. */
  WRITES = [];
  await save({ ...base, workTypeKey: 'lining', workers: [{ name: 'Andi', qty: null }] });
  yes(!('not_done' in WRITES[0].row), 'an ordinary save does not name not_done at all');

  console.log('\n-- 2b - AND UNDOING ONE SENDS IT FALSE --');
  WRITES = [];
  await save({ ...base, workTypeKey: 'blanket_spray', id: 7,
               workers: [{ name: 'Andi', qty: null }], notDone: false });
  is(WRITES[0].how, 'update', 'a correction updates the row it names');
  is(WRITES[0].row.not_done, false,
     'FALSE IS SENT, not omitted -- a row left flagged would show the names and pay nobody');

  console.log('\n-- 3 - A DATABASE WITHOUT THE COLUMN REFUSES, AND SAYS WHICH FILE --');
  /* PostgREST says "Could not find the 'not_done' column of
     'nops_transplant_field_records' in the schema cache" -- and
     `missingTable` matches "schema cache", so a missing COLUMN tested
     second is reported as a missing TABLE. */
  WRITES = [];
  REFUSE = { message: "Could not find the 'not_done' column of "
    + "'nops_transplant_field_records' in the schema cache" };
  let threw = null;
  try {
    await save({ ...base, workTypeKey: 'blanket_spray', workers: [], notDone: true });
  } catch (e) { threw = e.message; }
  is(threw, ND, 'it is the not-done setup message, NOT the missing-table one');
  no(threw === SU, 'the schema-cache trap does not swallow it');
  is(WRITES.length, 1,
     'IT DOES NOT RETRY WITHOUT THE FLAG -- that would store a record naming nobody');

  console.log('\n-- 3b - A MISSING TABLE IS STILL A MISSING TABLE --');
  REFUSE = { message: "Could not find the table 'nops_transplant_field_records'"
    + ' in the schema cache' };
  threw = null;
  try { await save({ ...base, workTypeKey: 'lining', workers: [{ name: 'Andi' }] }); }
  catch (e) { threw = e.message; }
  is(threw, SU, 'the older message is untouched');
  REFUSE = null;

  console.log('\n-- 4 - THE JOB THEN COUNTS AS ANSWERED --');
  const notDoneRec = { plot_name: 'B2', work_type: 'blanket_spray',
                       batch_name: '269, 271', workers: [], not_done: true };
  const realRec = (k) => ({ plot_name: 'B2', work_type: k, batch_name: '269, 271',
                            workers: [{ name: 'Andi' }] });
  const four = ['blanket_spray', 'lining', 'polybag_fill', 'transplanting'];
  is(owed([notDoneRec, realRec('lining'), realRec('polybag_fill'),
           realRec('transplanting')], ['269', '271']), [],
     'the plot owes nothing, so it leaves the Verification board');
  is(owed(four.filter((k) => k !== 'blanket_spray').map(realRec), ['269', '271']),
     ['blanket_spray'],
     'and with no answer at all it is still owed -- the rule is unchanged');

  console.log('\n-- 4b - A NEW DELIVERY ASKS AGAIN --');
  /* The office rule for a second delivery: 要再做一次. A not-done answer is
     about the batches it was given, not about the plot for ever -- the
     grass may well come for the next lot. */
  is(owed([notDoneRec, realRec('lining'), realRec('polybag_fill'),
           realRec('transplanting')], ['269', '271', '280']),
     four, 'every job is owed again for batch 280, the spray included');

  console.log('\n-- 5 - THE SCREEN --');
  const S = bare(SHEET);
  yes(/tp\.notDoneBtn/.test(S), 'the form offers the answer');
  yes(/submitNotDone/.test(S) && /notDone: true/.test(S), 'and it writes it');
  yes(/confirmSkip/.test(S), 'behind a confirm');
  no(/\bprompt\(/.test(S), 'NEVER prompt() -- a prompt dismissed out of habit is a cancel that looks like a save');
  no(/\bconfirm\(/.test(S), 'and never confirm() either: what has to be read is three lines');
  yes(/tp\.notDoneConfirm\b/.test(S) && /row\.plot/.test(S),
      'the confirm names the plot and the job');
  yes(/tp\.notDoneTag/.test(S), 'the job list says Not done');
  yes(/tp\.allAnswered/.test(S),
      'and a plot carrying one reads ANSWERED rather than a green ALL DONE');
  yes(/isNotDone/.test(S), 'read through the shipped helper, not a second copy of the test');
  no(/\.delete\(/.test(S) || /deleteTransplantRecord/.test(S),
     'nothing is deleted -- it is a record');
  yes(/tp\.undoNotDone/.test(S), 'and it can be put right where somebody may correct it');

  console.log('\n-- 5b - EVERY STRING IS IN BOTH LANGUAGES --');
  const I18N = R('src/i18n.js');
  const keys = [...new Set((S.match(/tp\.notDone[A-Za-z]*|tp\.allAnswered/g) || []))];
  yes(keys.length >= 8, `${keys.length} new strings are used`);
  keys.forEach((k) => {
    const n = (I18N.match(new RegExp("'" + k + "':", 'g')) || []).length;
    is(n, 2, `${k} is in English and Malay`);
  });

  console.log(failed ? `\n${failed} FAILED` : '\nall good');
  process.exit(failed ? 1 : 0);
})();

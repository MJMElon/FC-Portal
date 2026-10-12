/* A SEAL IS SCANNED AGAINST THE RANGES ITS CUSTOMER WAS GIVEN, AND A DO
   NAMES ONLY THE SEALS THAT WENT OUT ON IT.

   A consent signed on Mobile Consent names the seal ranges handed to the
   customer. At the lorry the scanner asks of every seal: is it this
   customer's, somebody else's, or nobody's? An order signed before ranges
   existed has none, and must scan exactly as it always did.

   When a DO is issued from the card it carries the seals scanned since
   the card's LAST DO -- a part-collected order's second lorry must not
   name the first lorry's seals again, or those seals are collected twice.

   Driven for real, out of src/lib/sealRanges.js and
   src/modules/scan/store.js, and the scan module and PDF are read to make
   sure they still call the rules.

   Run: node tests/seal_range_on_collection.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const ok = (m) => console.log('ok    ' + m);
const is = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want)
  ? ok(m)
  : fail(m + '  — got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)));

const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const mem = {};
const ctx = {
  console,
  localStorage: {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
  },
  supabase: {},
  cacheGet: (k) => (('c:' + k) in mem ? JSON.parse(mem['c:' + k]) : null),
  cacheSet: (k, v) => { mem['c:' + k] = JSON.stringify({ at: 0, value: v }); },
  PERMANENT: 'permanent', flushOutbox: () => {}, looksOffline: () => false, queueJob: () => {},
};
vm.createContext(ctx);
vm.runInContext(strip(R('src/lib/sealRanges.js')) + '\n' + strip(R('src/modules/scan/store.js')) +
  '\n;globalThis.__s = { compressSeals, formatSealRanges, rangeHolding, rangeQty, defaultProgress, addBarcodes,' +
  ' dedupeProgress, allocationsOf, sealVerdict, sealsForNextDO, sealsAlreadyOnDO, markSealsOnDO,' +
  ' cachedSealAllocations, sealFeatureLive };', ctx);
const S = vm.runInContext('__s', ctx);
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ── the shared helper ─────────────────────────────────────────────── */
is(plain(S.compressSeals(['0009003', '0009001', '0009002', '9002', '0009010'])),
  [{ start: '0009001', end: '0009003', qty: 3 }, { start: '0009010', end: '0009010', qty: 1 }],
  'compressSeals: runs, a seal without its zeros is the same seal, widest width wins');
is(S.formatSealRanges(S.compressSeals(['0009001', '0009002', '0012345'])), '0009001 - 0009002, 0012345',
  'formatSealRanges: a run as start - end, a lone seal as itself');
const own = [{ start_no: 9001, end_no: 9600 }];
is(!!S.rangeHolding('0009297', own), true, 'rangeHolding: inside the range');
is(S.rangeHolding('0009601', own), null, 'rangeHolding: one past the end is outside');
is(S.rangeHolding('abc', own), null, 'rangeHolding: not a number holds nothing');

/* ── is this seal this customer's? ─────────────────────────────────── */
const allocs = [
  { id: 1, consent_id: 'c-1', al_number: 'AL-100', customer_name: 'Ladang A', start_code: '0009001', end_code: '0009600', start_no: 9001, end_no: 9600 },
  { id: 2, consent_id: 'c-2', al_number: 'AL-200', customer_name: 'Ladang B', start_code: '0009601', end_code: '0009800', start_no: 9601, end_no: 9800 },
];
const cardA = { id: 'c-1', memberIds: ['c-1'], al_number: 'AL-100', customer: 'Ladang A' };
const old = { id: 'c-9', memberIds: ['c-9'], al_number: 'AL-OLD', customer: 'Before seals' };

is(S.sealVerdict('0009297', old, allocs), null, 'an order with no allocations: no opinion, scans as it always did');
is(S.sealVerdict('0009297', cardA, null), null, 'no allocation cache at all (SQL not run): no opinion');
is(S.sealVerdict('0009297', cardA, allocs).ok, true, 'inside its own range: accepted');
const other = S.sealVerdict('0009700', cardA, allocs);
is([other.ok, other.kind, other.other && other.other.customer_name, other.other && other.other.al_number],
  [false, 'other', 'Ladang B', 'AL-200'], 'inside another customer range: refused, naming them');
const nobody = S.sealVerdict('0012000', cardA, allocs);
is([nobody.ok, nobody.kind], [false, 'outside'], 'inside nobody range: refused as not on this consent');
is(S.allocationsOf({ id: 'c-2', memberIds: ['c-2'], al_number: '' }, allocs).map((r) => r.id), [2],
  'a card with no AL finds its allocations by consent id');
is(S.allocationsOf({ id: 'x', memberIds: ['x', 'c-1'], al_number: 'AL-100' }, allocs).map((r) => r.id), [1],
  'a merged card answers to every member, once');

/* ── the feature is proved by a successful read, and only by one ────── */
is(S.sealFeatureLive(), false, 'never read seal_allocations: the feature is off (no seal keys on a DO)');
ctx.cacheSet('seal_allocations', []);
is(S.sealFeatureLive(), true, 'one successful read, even of nothing: the feature is on');

/* ── which seals go on the next DO ─────────────────────────────────── */
const line = (c) => ({ code: c, time: 't', over: false });
let p = S.addBarcodes(S.defaultProgress(), ['0009001', '0009002', '0009003'], line);
is(S.sealsForNextDO(p), ['0009001', '0009002', '0009003'], 'first DO: every seal scanned');
p = { ...S.markSealsOnDO(p, S.sealsForNextDO(p)), issuedQty: 3 };
is(S.sealsForNextDO(p), [], 'straight after the DO: nothing left to name');
p = S.addBarcodes(p, ['0009004', '0009005'], line);
is(S.sealsForNextDO(p), ['0009004', '0009005'], 'second DO: only the seals scanned since the first');
p = S.dedupeProgress(p);
is(Array.isArray(p.doSeals) && p.doSeals.length, 3, 'the list of seals already on a DO survives dedupe');
is(S.sealsForNextDO({ ...p, doSeals: ['9001', '9002', '9003'] }), ['0009004', '0009005'],
  'a seal is compared by its number, so "9001" on a DO is 0009001');
is(S.sealsForNextDO({ seen: ['0009001', '0009002', '0009003', '0009004'], issuedQty: 3 }), ['0009004'],
  'a card from before the list: the oldest issuedQty seals count as already gone');
is(S.markSealsOnDO({ seen: ['1', '2', '3'], issuedQty: 2 }, ['3']).doSeals, ['1', '2', '3'],
  'marking a card from before the list keeps what it had already delivered');
is(S.markSealsOnDO({ doSeals: ['1'] }, ['1', '0001', '2']).doSeals, ['1', '2'], 'marking never doubles a seal');
is(S.defaultProgress().doSeals, [], 'a new card starts with nothing on a DO');

/* ── the pages still call the rules ────────────────────────────────── */
const scan = R('src/modules/scan/ScanModule.jsx');
const recordScan = scan.slice(scan.indexOf('const recordScan'), scan.indexOf('function labelOfConsent'));
is(/sealVerdict\(/.test(recordScan), true, 'recordScan asks sealVerdict');
is(recordScan.indexOf('sealVerdict(') < recordScan.indexOf('seenRef.current.add(code)'), true,
  'and asks it BEFORE the seal is counted');
is(/sealFeatureLive\(\)/.test(scan.slice(scan.indexOf('function withSeals'), scan.indexOf('function onDoSaved'))), true,
  'a DO carries seal keys only once the seal SQL is proved in');
is(/withSeals\(args/.test(scan), true, 'the scan card wraps the DO payload with its seals');
is(/markSealsOnDO\(/.test(scan.slice(scan.indexOf('function onDoSaved'))), true, 'a saved DO marks its seals as gone');
const pdf = R('src/lib/pdf.js');
is(pdf.indexOf('SEAL NO.') > pdf.indexOf('TOTAL QUANTITY') && pdf.indexOf('SEAL NO.') < pdf.indexOf('CUSTOMER ACKNOWLEDGEMENT'),
  true, 'the DO PDF prints the seals between the total and the acknowledgement');
const i18n = R('src/i18n.js');
['scan.sealOtherCustomer', 'scan.sealNotOnConsent', 'scan.sealRangesLine', 'scan.sealInRange'].forEach((k) => {
  const n = i18n.split("'" + k + "'").length - 1;
  is(n, 2, k + ' is in both the en and the ms block');
});

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);

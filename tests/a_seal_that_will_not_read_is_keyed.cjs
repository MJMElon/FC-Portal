/* A SEAL THE SCANNER WILL NOT READ IS KEYED BY HAND -- THROUGH THE SAME DOOR.
 *
 * A sticker gets wet, creased or printed short, and the conductor is
 * standing at the lorry with it in his hand. Before this the only ways on
 * were to wave it until the battery went or to leave the order short, and
 * a count that is short for a reason nobody wrote down is the one the
 * office cannot settle later.
 *
 * The whole risk in adding a keyboard is that it becomes a SECOND WRITER:
 * a path that skips the guards the camera goes through, and the one it
 * would skip is exactly the one that catches a typed mistake. So the Add
 * button hands its seal to `recordScan`, the same function the camera and
 * the Bluetooth gun hand theirs to, and this drives the REAL function out
 * of the shipped file to prove the guards still answer.
 *
 * Two things differ for a typed seal, and this holds both:
 *
 *   - the DEBOUNCE is skipped (it exists because a camera reads the same
 *     barcode ten times a second; a person pressing Add has done one
 *     deliberate thing, and swallowing it is silence where the answer
 *     matters most)
 *   - it RETURNS its verdict, so the dialog prints the very sentence the
 *     toast prints
 *
 * Run: node tests/a_seal_that_will_not_read_is_keyed.cjs
 * No build and no server needed.
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
const yes = (c, m) => (c ? ok(m) : fail(m));

const SRC = R('src/modules/scan/ScanModule.jsx');

/* ── THE REAL recordScan, lifted out of the shipped file ───────────────
   Everything it leans on is supplied below: the COUNTING halves come from
   the real store.js (same trick as a_seal_is_counted_once.cjs), and only
   the noises, the toast and React's setters are stubbed. */
function liftArrow(src, header, params) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not in the shipped file: ' + header);
  /* The arrow's OWN opening bracket, not useCallback's -- starting at
     useCallback's would take a bracket this never closes. */
  const from = src.indexOf(params, at);
  if (from < 0) throw new Error('the arrow does not take ' + params);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(from, j + 1);
  }
  throw new Error('unbalanced braces after ' + header);
}
const recordSrc = liftArrow(SRC, 'const recordScan = useCallback(', '(rawCode, opts)');

/* The real seal rule and the real store, both with their import lines cut
   away and loaded side by side -- store.js leans on sealNo/sealDigits, and
   a stub of those would be a second copy of the very rule under test. */
const strip = (f) => R(f).replace(/^import .*$/gm, '').replace(/^export /gm, '');
const store = strip('src/lib/sealRanges.js') + '\n' + strip('src/modules/scan/store.js');

const said = [];          // every flash the run put up
const sent = [];          // every row handed to the server
function build(card, allocs) {
  const ctx = {
    console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    supabase: { from: () => ({ insert: async () => ({}), select: () => ({}) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(store, ctx);
  Object.assign(ctx, {
    DEDUPE_DEBOUNCE_MS: 800,
    OVER_REPEAT_MS: 1200,
    activeRef: { current: card },
    consentsRef: { current: [card] },
    sealAllocsRef: { current: allocs },
    lastCodeRef: { current: '' },
    lastTimeRef: { current: 0 },
    lastOverRef: { current: 0 },
    seenRef: { current: new Set() },
    progressRef: { current: {} },
    flash: (text, kind) => said.push({ text, kind }),
    t: (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    beepDuplicate: () => {}, beepAlarm: () => {}, beepSuccess: () => {}, beepComplete: () => {},
    vibrate: () => {},
    setLastInfo: () => {},
    setProgress: (fn) => { ctx.progressRef.current = fn(ctx.progressRef.current); },
    saveScanRecord: async (id, al, code) => { sent.push(code); },
    findBarcodeElsewhere: async () => null,
    takeBackScan: () => {},
    labelOfConsent: () => 'another order',
    sealRangesText: () => '0035190-0035199',
    useCallback: (fn) => fn,
  });
  vm.runInContext('globalThis.__rec = ' + recordSrc + ';', ctx);
  return { rec: vm.runInContext('__rec', ctx), ctx };
}

/* One consent for 5, with seals 0035190-0035199 allocated to it. */
const CARD = { id: 'c1', al_number: 'AL-1', customer: 'Tan', qty: 5, memberIds: ['c1'] };
const ALLOCS = [{ consent_id: 'c1', al_number: 'AL-1', start_no: 35190, end_no: 35199 }];

/* ── 1. A keyed seal is counted, exactly like a scanned one ──────────── */
{
  const { rec, ctx } = build(CARD, ALLOCS);
  const r = rec('0035190', { typed: true });
  is(r.ok, true, 'a seal keyed by hand is taken');
  is(ctx.progressRef.current.c1.unique, 1, 'and it counts toward the card');
  is(sent[sent.length - 1], '0035190', 'and it is written to the server like any other scan');
}

/* ── 2. The debounce does NOT swallow it ─────────────────────────────── */
/* Two different seals keyed inside the debounce window is the ordinary
   case -- somebody with a handful of wet stickers. And keying the SAME one
   twice must come back "duplicate" rather than nothing at all, which is
   what the debounce would have returned. */
{
  const { rec, ctx } = build(CARD, ALLOCS);
  is(rec('0035190', { typed: true }).ok, true, 'first keyed seal in');
  is(rec('0035191', { typed: true }).ok, true, 'a second one straight after is NOT debounced away');
  is(ctx.progressRef.current.c1.unique, 2, 'both are counted');
  const again = rec('0035191', { typed: true });
  is(again.ok, false, 'keying one already in is refused');
  is(again.key, 'scan.duplicate', 'and it SAYS duplicate rather than going quiet');
}

/* ── 3. The camera keeps its debounce ────────────────────────────────── */
{
  const { rec, ctx } = build(CARD, ALLOCS);
  rec('0035190');
  const burst = rec('0035190');
  is(burst.ok, false, 'the camera reading the same barcode again is still swallowed');
  is(burst.key, undefined, 'silently, which is what a ten-a-second burst wants');
  is(ctx.progressRef.current.c1.unique, 1, 'and it is counted once');
}

/* ── 4. A typo is refused by the CONSENT, not waved through ──────────── */
/* This is the whole argument for one writer. 0035190 fat-fingered into
   600 is not this customer's seal, and the guard that says so is the one a
   second insert path would have skipped. */
{
  const { rec, ctx } = build(CARD, ALLOCS);
  const r = rec('600', { typed: true });
  is(r.ok, false, 'a number outside the seals on this consent is refused');
  yes(/sealNotOnConsent|sealOtherCustomer/.test(r.key || ''), '  and the refusal names why');
  is(ctx.progressRef.current.c1, undefined, 'nothing is counted');
  is(sent.indexOf('600'), -1, 'and nothing is written to the server');
}

/* ── 5. Over quota still counts, and still says so ───────────────────── */
{
  const { rec } = build(CARD, ALLOCS);
  ['0035190', '0035191', '0035192', '0035193', '0035194'].forEach((c) => rec(c, { typed: true }));
  const over = rec('0035195', { typed: true });
  is(over.ok, true, 'the sixth seal on a card of five is still recorded');
  is(over.key, 'scan.overItem', 'and comes back saying it is over, not merely added');
}

/* ── 6. Nothing typed is nothing done ────────────────────────────────── */
{
  const { rec } = build(CARD, ALLOCS);
  is(rec('   ', { typed: true }).key, 'scan.manualEmpty', 'an empty box asks for the number');
}

/* ── 7. The wiring on the page ───────────────────────────────────────── */
/* The button is beside the scan log, it is off on a card with nothing
   left to collect, and -- the one that matters -- the dialog hands its
   seal to the SAME writer rather than inserting one of its own. */
yes(/\+ \{t\('scan\.manualAdd'\)\}/.test(SRC), 'an Add button sits in the scan-log header');
yes(/disabled=\{fullyCollected\}/.test(SRC), 'and is off on a fully collected card, like the camera');
yes(/onScanRef\.current\(code, \{ typed: true \}\)/.test(SRC),
    'the dialog hands its seal to recordScan -- the one writer');
yes(/const code = sealDigits\(manualCode\)/.test(SRC),
    'what was typed is normalised by the shared seal rule, not by a copy of it');
/* Comments go first: this file EXPLAINS in prose why it is not a prompt,
   and a check that reads its own explanation as the thing it forbids is a
   check that can never pass. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scanner = code.slice(code.indexOf('function Scanner('));
yes(!/insertScanRecord|saveScanRecord/.test(scanner),
    'and the dialog opens NO second path to the scan table');
yes(!/\bprompt\(/.test(code), 'it is a dialog, never a prompt() somebody dismisses out of habit');

console.log('');
console.log(failed ? 'FAILED (' + failed + ')' : 'all green');
process.exit(failed ? 1 : 0);

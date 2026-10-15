/* THE REST OF AN ORDER REACHES THE SCAN LIST.

   Order 0HVUL3: 1,000 ordered, 700 collected, the AL list reading a balance
   of 300 -- and nothing on the FC Portal scan list to scan it against.

   The scan list is built from SIGNED CONSENTS, and a DO names its AL and
   not the consent it was collected on. So the server can only say how much
   has gone out on the WHOLE order, and that figure was written onto EVERY
   card of the AL. A second consent for the other 300 therefore arrived
   reading 700 collected against a quantity of 300: finished before a seal
   was scanned, and filtered off the list.

   A cancelled DO counted as collected too, where the office AL list (the
   cumulMap in operation_delivery.html) has always left it out.

   Driven for real out of src/modules/scan/store.js and src/modules/do/data.js,
   and through the list filter lifted out of ScanModule.jsx.

   Run: node tests/the_rest_of_an_order_reaches_the_scan_list.cjs
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

const strip = (src) => src.replace(/^import [\s\S]*?;$/gm, '').replace(/^export /gm, '');
const ctx = {
  console,
  localStorage: { getItem: () => null, setItem: () => {} },
  supabase: {}, cacheGet: () => null, cacheSet: () => {},
  PERMANENT: 'p', flushOutbox: () => {}, looksOffline: () => false, queueJob: () => {},
  sealNo: () => null, rangeHolding: () => null,
};
vm.createContext(ctx);
vm.runInContext(strip(R('src/modules/scan/store.js')) + '\n;globalThis.__s = { defaultProgress, mergeConsents, issuedShares, applyIssuedShares };', ctx);
const S = vm.runInContext('__s', ctx);

// Only the pure half of data.js: the two functions this rule needs.
const data = R('src/modules/do/data.js');
const lift = (name) => {
  const at = data.indexOf('export function ' + name);
  if (at < 0) throw new Error(name + ' not found in data.js');
  let depth = 0, i = data.indexOf('{', at);
  for (; i < data.length; i++) { if (data[i] === '{') depth++; if (data[i] === '}' && --depth === 0) break; }
  return data.slice(at, i + 1).replace(/^export /, '');
};
vm.runInContext(lift('isCancelledDO') + '\n' + lift('issuedQtyByAL') + '\n;globalThis.__d = { isCancelledDO, issuedQtyByAL };', ctx);
const D = vm.runInContext('__d', ctx);

// The list's own filter, the line that decides what is on screen.
const scan = R('src/modules/scan/ScanModule.jsx');
const filt = scan.match(/const pending = consents\.filter\((\(c\) => [^;]+)\);/);
if (!filt) { console.log('FAIL  the list filter was not found in ScanModule.jsx'); process.exit(1); }
const onList = vm.runInContext('(' + filt[1] + ')', ctx);

const AL = '0HVUL3';
const first = { id: 'c1', al_number: AL, order_number: AL, customer_name: 'DING HARVEST PLANTATION SDN. BHD.', consent_qty: 700, created_at: '2026-10-13T02:00:00Z' };
const second = { id: 'c2', al_number: AL, order_number: AL, customer_name: 'DING HARVEST PLANTATION SDN. BHD.', consent_qty: 300, created_at: '2026-10-14T02:00:00Z' };
const doRows = [{ al_number: AL, total_qty: 700, status: 'Issued', remark: '' }];

/* What the phone held after the first trip: the 700 card collected. */
let progress = { c1: { ...S.defaultProgress(), doIssued: true, issuedQty: 700 } };

/* ── 1. the old rule, kept here so the fault is on record ───────────── */
function oldRule(prev, cards, byAL) {
  const map = { ...prev };
  cards.forEach((c) => {
    const q = byAL[c.al_number] || 0;
    if (!q) return;
    const cur = map[c.id] || S.defaultProgress();
    if ((cur.issuedQty || 0) >= q) return;
    map[c.id] = { ...cur, issuedQty: q, doIssued: true };
  });
  return map;
}
{
  const cards = S.mergeConsents([second, first], progress);
  const after = oldRule(progress, cards, D.issuedQtyByAL(doRows));
  const shown = S.mergeConsents([second, first], after).filter(onList).map((c) => c.id);
  is(shown, [], 'OLD RULE: the 300 consent is called collected and is not on the list (the fault)');
}

/* ── 2. the new rule: the 300 is on the list, the 700 is not ─────────── */
{
  const cards = S.mergeConsents([second, first], progress);
  const shares = S.issuedShares(cards, D.issuedQtyByAL(doRows));
  is(shares, { c1: 700, c2: 0 }, 'the 700 collected is the first consent, oldest first');
  const after = S.applyIssuedShares(progress, cards, shares, new Set());
  const list = S.mergeConsents([second, first], after).filter(onList);
  is(list.map((c) => [c.id, c.qty, c.issuedQty]), [['c2', 300, 0]], 'the 300 consent is on the scan list, nothing collected on it');
}

/* ── 3. a phone already carrying the old wrong figure is put right ───── */
{
  const bad = { ...progress, c2: { ...S.defaultProgress(), doIssued: true, issuedQty: 700 } };
  const cards = S.mergeConsents([second, first], bad);
  const after = S.applyIssuedShares(bad, cards, S.issuedShares(cards, D.issuedQtyByAL(doRows)), new Set());
  is([after.c2.issuedQty, after.c2.doIssued], [0, false], 'the wrongly closed 300 card is reopened');
  is(S.mergeConsents([second, first], after).filter(onList).map((c) => c.id), ['c2'], 'and comes back onto the list');
  const held = S.applyIssuedShares(bad, cards, S.issuedShares(cards, D.issuedQtyByAL(doRows)), new Set([AL]));
  is(held.c2.issuedQty, 700, 'but not while a DO for that AL is still waiting on the phone to be sent');
}

/* ── 4. one consent, part collected: still on the list ───────────────── */
{
  const only = { ...first, consent_qty: 1000 };
  const p0 = {};
  const cards = S.mergeConsents([only], p0);
  const after = S.applyIssuedShares(p0, cards, S.issuedShares(cards, D.issuedQtyByAL(doRows)), new Set());
  is(S.mergeConsents([only], after).filter(onList).map((c) => [c.qty, c.issuedQty]), [[1000, 700]], 'a 1,000 consent with 700 out stays on the list');
}

/* ── 5. a cancelled DO took nothing ───────────────────────────────────── */
{
  const withCancel = doRows.concat([
    { al_number: AL, total_qty: 300, status: 'Cancelled', remark: '' },
    { al_number: AL, total_qty: 50, status: 'Issued', remark: 'wrong lorry [CANCELLED]' },
  ]);
  is(D.issuedQtyByAL(withCancel), { [AL]: 700 }, 'cancelled DOs are not counted as collected, either way of marking them');
}

/* ── 6. all collected: nothing left on the list ──────────────────────── */
{
  const all = doRows.concat([{ al_number: AL, total_qty: 300, status: 'Issued', remark: '' }]);
  const cards = S.mergeConsents([second, first], progress);
  const after = S.applyIssuedShares(progress, cards, S.issuedShares(cards, D.issuedQtyByAL(all)), new Set());
  is(S.mergeConsents([second, first], after).filter(onList).map((c) => c.id), [], 'once the 300 goes out too, the order leaves the list');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall good');
process.exit(failed ? 1 : 0);

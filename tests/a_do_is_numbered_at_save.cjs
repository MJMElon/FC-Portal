/* A DO IS NUMBERED AT SAVE, AND A RETRY IS NOT A SECOND DO.
 *
 * The office opened the delivery order list and found DO-MUGJB901 on it
 * TWICE — qty 13 saved at 06:31 and qty 47 at 06:33 on 5 Nov, two signed
 * rows wearing one number. The Entry modal generates its DO number when it
 * OPENS (useEffect []) and the insert happens minutes later, so a second
 * save out of the same session — or a second modal opened before the first
 * insert landed, which is what two surfaces (the DO module and the scan
 * popup) make easy — wrote a second row under the same number.
 *
 * So the number is CLAIMED AT SAVE: persistDO re-derives it right before
 * the insert, when the generator can see every row already in the table.
 * And two retry shapes that double a DO are closed with it:
 *   - the balance deduct throwing AFTER the insert landed used to throw
 *     the whole save into the offline queue, whose flush inserted the DO
 *     a second time — a timeout is not a refusal;
 *   - a queued DO whose insert landed (acknowledgement lost) is retired
 *     by the flush as already-saved, and one whose number was taken while
 *     it waited gets the next free number instead of a twin.
 *
 * The REAL functions are lifted out of the shipped src/modules/do/data.js —
 * the whole fault is in when the number is derived, so a restatement here
 * would prove nothing.
 *
 * Run: node tests/a_do_is_numbered_at_save.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const ok   = (m) => console.log('ok    ' + m);
const yes  = (v, m) => (v ? ok(m) : fail(m));
const is = (got, want, m) => {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(m);
  else fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));
};

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/modules/do/data.js'), 'utf8');

/* A body opens after the PARAMETER LIST, not at the first `{` on the line. */
const grab = (decl, name) => {
  const at = SRC.indexOf(decl + name);
  if (at < 0) throw new Error(name + ' not found');
  const from = SRC.indexOf(')', at);
  let depth = 0;
  for (let j = SRC.indexOf('{', from); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1).replace(/^export /, '');
  }
  throw new Error(name + ' not closed');
};

/* ── A supabase stub that KEEPS A TABLE. One that swallows writes signs
      off whatever the page sent it — the house rule. ─────────────────── */
function makeSupabase(state) {
  const exec = (q) => {
    if (q.table === 'shared_al_orders' && q.op === 'update') {
      if (state.failALUpdate) return Promise.reject(new Error('network blip on the deduct'));
      const row = state.als.find((a) => q.filters.every(([f, v]) => a[f] === v));
      if (row) Object.assign(row, q.patch);
      return Promise.resolve({ data: null, error: null });
    }
    if (q.op === 'insert') {
      const rows = q.rows.map((r) => ({ id: ++state.nextId, ...r }));
      state.dos.push(...rows);
      state.inserts.push(...rows);
      return Promise.resolve({ data: q.single ? rows[0] : rows, error: null });
    }
    // select
    let rows = (q.table === 'shared_al_orders' ? state.als : state.dos).slice();
    for (const [f, v, kind] of q.filters) {
      if (kind === 'ilike') {
        const pre = String(v).replace(/%$/, '').toLowerCase();
        rows = rows.filter((r) => String(r[f] || '').toLowerCase().startsWith(pre));
      } else rows = rows.filter((r) => r[f] === v);
    }
    if (q.single) return Promise.resolve({ data: rows[0] || null, error: null });
    return Promise.resolve({ data: rows, error: null });
  };
  return {
    from(table) {
      const q = { table, op: 'select', filters: [], single: false };
      const api = {
        select() { return api; },
        insert(rows) { q.op = 'insert'; q.rows = rows; return api; },
        update(patch) { q.op = 'update'; q.patch = patch; return api; },
        eq(f, v) { q.filters.push([f, v]); return api; },
        ilike(f, v) { q.filters.push([f, v, 'ilike']); return api; },
        order() { return api; },
        single() { q.single = true; return api; },
        maybeSingle() { q.single = true; return api; },
        then(res, rej) { return exec(q).then(res, rej); },
      };
      return api;
    },
  };
}

function build(state) {
  const store = {};
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, Boolean, Promise, parseInt,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    supabase: makeSupabase(state),
    // Best-effort neighbours of the save, stubbed: the uploads hand back
    // what they were given and the attach records that it ran.
    uploadDOPhoto: async (b64) => b64,
    uploadDOSignature: async (b64) => b64,
    attachDOToOrder: async () => { state.attaches++; return true; },
  };
  vm.createContext(ctx);
  vm.runInContext([
    SRC.match(/^const DO_QUEUE_KEY = .*$/m)[0],
    grab('export async function ', 'generateDONumber'),
    grab('export async function ', 'saveDORecord'),
    grab('export async function ', 'persistDO'),
    grab('export function ', 'offlineDONumber'),
    grab('export function ', 'readDOQueue'),
    grab('function ', 'writeDOQueue'),
    grab('export function ', 'queueDO'),
    grab('export async function ', 'flushDOQueue'),
    ';globalThis.__api = { generateDONumber, persistDO, flushDOQueue, readDOQueue, queueDO };',
  ].join('\n'), ctx);
  return vm.runInContext('__api', ctx);
}

const freshState = () => ({
  dos: [], als: [{ id: 1, al_number: 'MUGJB9', balance_quantity: 120 }],
  inserts: [], attaches: 0, nextId: 0, failALUpdate: false,
});
const AL = { id: 1, al_number: 'MUGJB9', balance_quantity: 120, customer_name: 'ROZALIA BINTI SAHARI' };
const payloadOf = (doNumber, qty) => ({
  do_number: doNumber, al_number: 'MUGJB9', delivery_date: '2026-11-05',
  total_qty: qty, remark: 'ROZALIA BINTI SAHARI', status: 'Delivered',
});

(async () => {
  // ── 1. The office's own morning: two saves off one pre-generated number ──
  console.log('1. Two saves carrying the same modal-generated number become TWO numbers');
  {
    const state = freshState();
    const api = build(state);
    const preview = await api.generateDONumber(AL);
    is(preview, 'DO-MUGJB901', 'the modal preview number is DO-MUGJB901');
    const r1 = await api.persistDO({ payload: payloadOf(preview, 13), al: AL });
    // The second save still carries the number the modal generated at open —
    // which is exactly what both saves did on 5 Nov.
    const r2 = await api.persistDO({ payload: payloadOf(preview, 47), al: AL });
    yes(!r1.queued && !r2.queued, 'both saves went straight in (nothing queued)');
    const nums = state.dos.map((d) => d.do_number);
    is(nums, ['DO-MUGJB901', 'DO-MUGJB902'], 'the rows are numbered 901 and 902 — no number twice');
    is(r2.payload.do_number, 'DO-MUGJB902', 'the second save was told its REAL number (the PDF and toast carry it)');
    yes(new Set(nums).size === nums.length, 'no DO number appears twice on the list');
  }

  // ── 2. A blip on the balance deduct is not a second DO ─────────────────
  console.log('\n2. The deduct failing AFTER the insert landed does not queue a twin');
  {
    const state = freshState();
    state.failALUpdate = true;
    const api = build(state);
    const res = await api.persistDO({ payload: payloadOf('DO-MUGJB901', 47), al: AL });
    yes(!res.queued, 'the save reports saved, not queued — the row IS in the table');
    is(state.dos.length, 1, 'one row in the table');
    is(api.readDOQueue().length, 0, 'nothing waiting in the offline queue');
    // and even on a build where it DID queue, the flush must not double it:
    api.queueDO({ payload: payloadOf('DO-MUGJB901', 47) });
    state.failALUpdate = false;
    const f = await api.flushDOQueue();
    is(state.dos.length, 1, 'after a flush the table still holds ONE row — the queued copy was retired');
    is(f.synced, 1, 'and the flush counts it as synced, so it leaves the queue');
  }

  // ── 3. A queued DO whose number was taken gets the next one ────────────
  console.log('\n3. A queued DO whose number was taken while it waited is renumbered, not a twin');
  {
    const state = freshState();
    const api = build(state);
    state.dos.push({ id: ++state.nextId, ...payloadOf('DO-MUGJB901', 13) });
    api.queueDO({ payload: payloadOf('DO-MUGJB901', 47) });
    await api.flushDOQueue();
    is(state.dos.map((d) => d.do_number), ['DO-MUGJB901', 'DO-MUGJB902'],
      'the queued 47 went in as DO-MUGJB902 beside the 13 that took 901');
  }

  // ── 4. The offline placeholder path is untouched ───────────────────────
  console.log('\n4. An OFF placeholder still becomes the next real number on sync');
  {
    const state = freshState();
    const api = build(state);
    state.dos.push({ id: ++state.nextId, ...payloadOf('DO-MUGJB901', 13) });
    api.queueDO({ payload: payloadOf('DO-MUGJB9OFFABC123', 20) });
    await api.flushDOQueue();
    is(state.dos.map((d) => d.do_number).sort(), ['DO-MUGJB901', 'DO-MUGJB902'],
      'the OFF placeholder synced as DO-MUGJB902');
  }

  console.log('\n' + (failed ? failed + ' FAILED' : 'all checks passed'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('harness died: ' + e.message); process.exit(1); });

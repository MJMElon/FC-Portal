/* MY PHONE SYNC ALWAYS FAILS.

   The office sent a screenshot of the dashboard with the big red cross in the
   middle of it and nothing else. That was all the button could ever say: the
   step that refused and its reason were written into the button's TITLE,
   which a phone has no way to show. So a sync that fails on one step, every
   press, reads exactly like a sync that does not work at all.

   Three faults made it fail as often as it did, and this holds all three:

   1. NO SECOND CHANCE AND NO CEILING. Seven reads and writes, each one
      dropped packet from a red cross; and one that never answered held the
      button spinning. runStep gives each a time limit and one retry when the
      failure looks like the line -- and not when the server refused, which
      would only refuse again.
   2. PALMS SENT THE WHOLE ESTATE EVERY PRESS. push() upserted every entry the
      phone holds, and a phone that has pulled holds everybody's, so each sync
      was thousands of rows in one statement -- the step that times out, and
      one refused row sank the lot for ever. It now sends what differs from
      the server's copy the pull just read.
   3. PALMS HID ITS REASON. syncPalms answered null and the button said
      "could not reach the server" over a refusal with a sentence of its own.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/sync_reports_what_refused.cjs
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);
const ok = (m, c, got) => (c ? pass(m) : fail(m + (got !== undefined ? '  -> got ' + JSON.stringify(got) : '')));

const ENV = '--define:import.meta.env={"VITE_SUPABASE_URL":"https://stub.supabase.co",'
  + '"VITE_SUPABASE_ANON_KEY":"stub","VITE_GEMINI_KEY":"","MODE":"test","DEV":false,"PROD":true}';
function bundle(entry, out) {
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', ENV,
    '--log-level=error', '--outfile=' + out], { cwd: ROOT, stdio: 'pipe' });
  return import('file://' + out + '?' + Date.now());
}
/* The previous code may live elsewhere (PREV_DIR holds its two files); it is
   bundled from inside src/ so its relative imports resolve the same way. */
function bundlePrev(file, rel) {
  const dir = process.env.PREV_DIR;
  if (!dir || !fs.existsSync(path.join(dir, file))) return null;
  const tmp = path.join(ROOT, rel, '.__prev_' + file);
  fs.copyFileSync(path.join(dir, file), tmp);
  try { return bundle(tmp, path.join(os.tmpdir(), 'mjm-prev-' + file.replace('.js', '.mjs'))); }
  finally { fs.unlinkSync(tmp); }
}

(async () => {
  const all = await bundle(path.join(ROOT, 'src/lib/syncAll.js'), path.join(os.tmpdir(), 'mjm-syncall.mjs'));
  const palms = await bundle(path.join(ROOT, 'src/modules/palms/sync.js'), path.join(os.tmpdir(), 'mjm-palmssync.mjs'));

  console.log('\n1. A step gets a second chance on the line, and none on a refusal');
  ok('runStep is exported', typeof all.runStep === 'function');
  if (typeof all.runStep === 'function') {
    let n = 0;
    const r1 = await all.runStep('flaky', async () => { if (++n === 1) throw new TypeError('Failed to fetch'); }, { pauseMs: 1 });
    ok('a dropped packet once is a sync that WORKED', r1.ok === true, r1);
    ok('…on its second try', r1.tries === 2, r1);
    let m = 0;
    const r2 = await all.runStep('refused', async () => { m++; throw { message: 'new row violates row-level security policy', code: '42501' }; }, { pauseMs: 1 });
    ok('a refusal is not retried', m === 1, m);
    ok('…and its reason is kept, word for word', r2.ok === false && /row-level security/.test(r2.error), r2);
    const t0 = Date.now();
    const r3 = await all.runStep('hangs', () => new Promise(() => {}), { timeoutMs: 80, pauseMs: 1 });
    ok('a step that never answers ends', r3.ok === false && /timeout/.test(r3.error), r3);
    ok('…inside its ceiling, twice over at most', Date.now() - t0 < 1000, Date.now() - t0);
    let k = 0;
    const r4 = await all.runStep('down', async () => { k++; throw new TypeError('Failed to fetch'); }, { pauseMs: 1 });
    ok('a line that is really down is tried twice, then named', k === 2 && r4.ok === false && /Failed to fetch/.test(r4.error), { k, r4 });
  }

  console.log('\n2. PALMS sends what differs, not the whole estate');
  ok('entriesToSend is exported', typeof palms.entriesToSend === 'function');
  const mk = () => {
    const logs = {};
    for (let i = 1; i <= 400; i++) logs['B' + i] = [{ uid: 'u' + i, actN: 3, start: '2026-10-01', end: null }];
    logs.B7.push({ uid: 'new1', actN: 4, start: '2026-11-19', end: null, dirty: 1 });
    logs.B9[0].end = '2026-11-18'; logs.B9[0].dirty = 1;
    logs.DEMO = [{ uid: 'd1', actN: 1, start: '2026-01-01', end: null, demo: true }];
    return { logs, history: [{ key: 'B5', at: '2026-11-19', acts: [3] }, { key: 'B6', at: '2026-10-01', acts: [3] }] };
  };
  if (typeof palms.entriesToSend === 'function') {
    const db = mk();
    const seenLogs = new Map();
    for (let i = 1; i <= 400; i++) seenLogs.set('u' + i, { key: 'B' + i, actN: 3, start: '2026-10-01', end: null });
    const seen = { logs: seenLogs, history: new Map([['B6|2026-10-01', JSON.stringify([[3], null])]]) };
    const sent = palms.entriesToSend(db, seen).map((x) => x.e.uid).sort();
    ok('401 entries on the phone, two changed: two are sent', JSON.stringify(sent) === JSON.stringify(['new1', 'u9']), sent);
    seenLogs.set('u12', { key: 'B12', actN: 3, start: '2026-10-01', end: '2026-11-01' });
    ok('one the server holds differently is sent back too',
      palms.entriesToSend(db, seen).some((x) => x.e.uid === 'u12'));
    ok('a demo entry is never sent', !palms.entriesToSend(db, null).some((x) => x.e.uid === 'd1'));
    ok('with no snapshot it sends everything, as it always did',
      palms.entriesToSend(db, null).length === 401, palms.entriesToSend(db, null).length);
    const h = palms.historyToSend(db, seen).map((x) => x.key);
    ok("today's report the server has not got is sent, one it holds is not",
      JSON.stringify(h) === JSON.stringify(['B5']), h);
  }

  console.log('\n3. PALMS says why');
  ok('the reason syncPalms swallowed can be asked for', typeof palms.palmsSyncError === 'function');
  const allSrc = fs.readFileSync(path.join(ROOT, 'src/lib/syncAll.js'), 'utf8');
  ok('…and the Sync button asks it', /palmsSyncError\(\)/.test(allSrc));
  ok('the DO queue is part of the press', /flushDOQueue\(\)/.test(allSrc.slice(allSrc.indexOf('export async function syncAll'), allSrc.indexOf('export function startAutoSync'))));

  console.log('\n4. The reason is on the SCREEN, not in a title');
  const btn = fs.readFileSync(path.join(ROOT, 'src/components/SyncButton.jsx'), 'utf8');
  ok('a panel carries the note', /data-sync-note/.test(btn) && /\{note && \(/.test(btn));
  ok('…naming each step that refused, with what it said', /data-sync-step=\{s\.name\}/.test(btn) && /s\.error/.test(btn));

  console.log('\n5. The previous code, for comparison');
  const prevAll = await bundlePrev('syncAll.js', 'src/lib');
  const prevPalms = await bundlePrev('sync.js', 'src/modules/palms');
  if (!prevAll || !prevPalms) console.log('  (set PREV_DIR to the previous syncAll.js and sync.js to run this half)');
  else {
    ok('previous: no runStep, so one dropped packet was a red cross', typeof prevAll.runStep !== 'function');
    ok('previous: PALMS had nothing to choose what to send with', typeof prevPalms.entriesToSend !== 'function');
    ok('previous: PALMS kept its reason to itself', typeof prevPalms.palmsSyncError !== 'function');
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

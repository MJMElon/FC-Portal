/* A HANDLER THAT NEVER ANSWERS MUST NOT STOP THE QUEUE.

   SHARED RULE -- the audit app has the same one in the office repository
   (mjm-ai-system, tests/sync_cannot_wedge.cjs). Change one, change the
   other.

   It cost two rounds there. Seventy finished audits would not leave an
   auditor phone. The first round was real: the database refused every
   row. That was repaired and proved -- and the phone still would not
   empty, because the sweep that sends the records had no timeout on
   anything it sent. One stalled upload on a nursery signal held it on
   item one for ever, and the sixty-eight behind it were never tried.
   Nothing on screen could tell that apart from a server saying no.

   This queue is chained rather than dropped, which makes a hang WORSE:
   every flush asked for afterwards -- the online event, the Sync button,
   the next save -- waits behind the stalled one for ever, and nothing in
   the app can let go of it.

   The timeout is safe here for the reason written at the top of
   outbox.js: the job uid goes to the server with the row and hits a
   unique index, so a retry of a send that did land is already-done, not
   a duplicate. A timed-out send is the same case as a flush cut off by
   the phone going to sleep, which this queue was built to survive.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/outbox_cannot_wedge.cjs
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.NODE_PATH + '/playwright');

const ROOT = path.resolve(__dirname, '..');
const PAGE = `<!doctype html><meta charset="utf-8"><title>outbox harness</title><body></body>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, {'Content-Type':'text/html'}); res.end(PAGE); return; }
  const f = path.join(ROOT, url);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/plain' });
  res.end(fs.readFileSync(f));
});

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(async (port) => {
    window.ob = await import(`http://127.0.0.1:${port}/src/lib/outbox.js`);
  }, port);

  /* Four maintenance records queued with no signal. The first one's send
     never comes back -- the shape a stalled photo upload has from here. */
  const result = await page.evaluate(async () => {
    const { queueJob, flushOutbox, listJobs } = window.ob;
    for (const p of ['U01','U02','U03','U04']) await queueJob('maint', {plot:p});

    let n = 0;
    const handlers = { maint: async () => { if (++n === 1) return new Promise(()=>{}); } };

    const started = Date.now();
    const first = await Promise.race([
      flushOutbox(handlers),
      new Promise(r => setTimeout(() => r('never came back'), 150000))
    ]);
    if (first === 'never came back') return { verdict:'wedged' };

    /* And the chain is clear: a flush asked for afterwards runs rather
       than queueing behind a send that will never finish. */
    const second = await Promise.race([
      flushOutbox({ maint: async () => {} }),
      new Promise(r => setTimeout(() => r('never came back'), 20000))
    ]);
    if (second === 'never came back') return { verdict:'chain blocked' };

    return { verdict:'ok', first, second, left: (await listJobs()).length,
             seconds: Math.round((Date.now()-started)/1000) };
  });

  if (result.verdict === 'wedged') {
    fail('a send that never answers stops the flush for ever\n' +
         '      The handler call needs a ceiling - see JOB_TIMEOUT_MS in src/lib/outbox.js.');
  } else if (result.verdict === 'chain blocked') {
    fail('the stalled flush is still holding the chain - every later Sync waits behind it for ever');
  } else {
    pass(`a send that never answers gives up after ${result.seconds}s instead of hanging`);
    if (result.second && result.second.sent === 4) {
      pass('the next flush sends all four - nothing was lost and nothing was dropped');
    } else {
      fail('the next flush did not send the four queued records: ' + JSON.stringify(result.second));
    }
    if (result.left === 0) pass('the queue is empty afterwards');
    else fail(result.left + ' record(s) left in the queue');
  }

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} failure(s)` : '\nall good');
  process.exit(failed ? 1 : 0);
})();

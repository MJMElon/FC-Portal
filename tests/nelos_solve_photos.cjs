/* SOLVING A NELOS CASE TAKES AS MANY PHOTOS AS THE JOB NEEDED.

   The FC portal's solve form took exactly one — and worse for the person
   holding the phone, it had `capture="environment"`, so the camera opened
   directly, took one shot, and the picker VANISHED behind the thumbnail.
   There was no second tap to be had. One is rarely the job: the gap before
   and the planting after, three trays that needed the same thing, a wide
   shot and the close-up that shows what it actually was.

   This drives the BUILT app in a browser with the Supabase REST, auth and
   Storage endpoints answered by the harness, so what is exercised is the
   real component over the real client — the picker, the uploads, and the
   row that is written.

   Three things this repo will cost you an hour each on, all from CLAUDE.md:
     · Routes match in REVERSE registration order — the catch-all goes FIRST.
     · The entry HTML is app.html, not index.html.
     · The session is read synchronously out of localStorage at boot, so it
       has to be seeded in an init script before any of the app runs.

   Run:  npm run build
         NODE_PATH=/opt/node22/lib/node_modules node tests/nelos_solve_photos.cjs
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.NODE_PATH + '/playwright');

const DIST = path.resolve(__dirname, '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
                '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, url === '/' ? 'app.html' : url);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'app.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const PROJECT = 'kibqjztozokohqmhqqqf';
const ME = { id: '00000000-0000-0000-0000-000000000009', email: 'fc@mjmnursery.com',
             user_metadata: { full_name: 'Azman' } };
const CASE = {
  id: 'case-1', title: 'Irrigation line burst', description: 'Water running down the path at B8.',
  status: 'open', priority: 'high', module: 'scan', nursery_name: 'BNN', plot_name: 'B8',
  created_at: '2026-09-20T01:00:00Z', due_at: '2026-09-30T01:00:00Z',
  assignee_name: 'Azman', assignee_id: ME.id, created_by: 'HQ'
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  const uploads = [];                 // what reached storage
  const patches = [];                 // every PATCH the client sent, refused or not
  const state = { refuseUrlsColumn: false };

  /* CATCH-ALL FIRST — routes match in reverse registration order. */
  await page.route('**/*.supabase.co/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ user: ME, access_token: 'x', token_type: 'bearer',
                             expires_in: 3600, refresh_token: 'y' }) }));
  await page.route('**/rest/v1/shared_profiles**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: ME.id, role: 'admin', user_type: 'staff',
        permissions: { modules: { scan: 'admin', nelos: 'admin' }, manage_users: true } }) }));
  await page.route('**/storage/v1/object/**', (r) => {
    const req = r.request();
    if (req.method() === 'POST' || req.method() === 'PUT') {
      const buf = req.postDataBuffer();
      uploads.push({ url: req.url(), bytes: buf ? buf.length : 0,
                     type: req.headers()['content-type'] || '' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
    }
    return r.fulfill({ status: 200, contentType: 'image/jpeg', body: '' });
  });
  await page.route('**/rest/v1/nelos_cases**', (r) => {
    const req = r.request();
    if (req.method() === 'PATCH') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      patches.push(body);
      /* What PostgREST answers a database that has not run
         shared/RUN_ME_nelos_solve_photos.sql. */
      if (state.refuseUrlsColumn && 'resolution_photo_urls' in body) {
        return r.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST204',
            message: "Could not find the 'resolution_photo_urls' column of 'nelos_cases' in the schema cache" }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json',
                         body: JSON.stringify({ ...CASE, ...body }) });
    }
    /* .single() asks for ONE OBJECT through the Accept header, and handing it
       an array back gives a case with no status — which renders as "nothing
       to do on this case" and no solve form at all. */
    const one = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    return r.fulfill({ status: 200, contentType: 'application/json',
                       body: JSON.stringify(one ? CASE : [CASE]) });
  });

  await page.addInitScript(({ project, me }) => {
    try {
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
        access_token: 'x', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'y', user: me }));
    } catch (e) {}
    // A service worker would serve a stale shell over the build under test.
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('off'));
  }, { project: PROJECT, me: ME });

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  /* A real photo off a real camera: three thousand pixels wide and a couple
     of megabytes, which is the size the shrink exists for. Made in the page
     so it is a genuinely decodable JPEG. */
  const jpegB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const x = c.getContext('2d');
    for (let i = 0; i < 400; i++) {
      x.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 50)}%)`;
      x.fillRect((i * 271) % 3000, (i * 577) % 2000, 260, 260);
    }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  const photo = Buffer.from(jpegB64, 'base64');

  /* The dock is a coin that fans open; Nelos is one of its arms. Pressing
     the arm before the fan is open finds nothing. */
  const openCase = async () => {
    await page.click('button[aria-label*="cases waiting"]');
    await page.waitForTimeout(700);
    await page.click('button[aria-label="Nelos"]');
    await page.waitForTimeout(1000);
    await page.click('text=Irrigation line burst');
    await page.waitForTimeout(1000);
  };
  await openCase();

  const shotUi = () => page.evaluate(() => {
    const inp = document.querySelector('.nel-shot-in');
    const label = inp && inp.closest('label');
    return {
      picker: !!inp,
      multiple: !!(inp && inp.multiple),
      capture: !!(inp && inp.hasAttribute('capture')),
      labelText: label ? (label.textContent || '').replace(/\s+/g, ' ').trim() : '',
      thumbs: document.querySelectorAll('img[alt^="Photo "]').length,
      inputValue: inp ? inp.value : null
    };
  });

  const before = await shotUi();

  await page.setInputFiles('.nel-shot-in', { name: 'one.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForTimeout(400);
  const afterOne = await shotUi();

  // The second photo: the picker has to STILL BE THERE to take it.
  await page.setInputFiles('.nel-shot-in', { name: 'two.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.waitForTimeout(400);
  const afterTwo = await shotUi();

  // …and a third chosen in one go alongside a fourth, from the gallery.
  await page.setInputFiles('.nel-shot-in', [
    { name: 'three.jpg', mimeType: 'image/jpeg', buffer: photo },
    { name: 'four.jpg',  mimeType: 'image/jpeg', buffer: photo }]);
  await page.waitForTimeout(400);
  const afterFour = await shotUi();

  // One taken by mistake comes off again.
  await page.click('button[aria-label="Remove photo"]');
  await page.waitForTimeout(300);
  const afterRemove = await shotUi();

  await page.fill('textarea', 'Replaced the burst section and pressure-tested the line.');
  await page.click('button:has-text("Save & Solve")');
  await page.waitForTimeout(2500);

  const solved = patches[patches.length - 1] || {};
  /* Taken before the second run clears them — the checks run at the end, and
     `uploads` is reset in between. */
  const firstRunUploads = uploads.slice();

  /* ── AND THE SAME AGAIN ON A DATABASE WITHOUT THE COLUMN ──────────────
     shared/RUN_ME_nelos_solve_photos.sql has not been run: PostgREST
     refuses the whole patch. The solve must still go through with the one
     photo the old column holds, rather than failing over a column. */
  state.refuseUrlsColumn = true;
  patches.length = 0;
  uploads.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await openCase();
  await page.setInputFiles('.nel-shot-in', [
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: photo },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  await page.waitForTimeout(400);
  await page.fill('textarea', 'Same fix, older database.');
  await page.click('button:has-text("Save & Solve")');
  await page.waitForTimeout(2500);
  const oldDb = {
    tries: patches.length,
    first: patches[0] || {},
    last: patches[patches.length - 1] || {},
    uploaded: uploads.length,
    text: await page.evaluate(() => document.body.innerText)
  };

  console.log('picker before  :', JSON.stringify(before));
  console.log('after one      :', JSON.stringify(afterOne));
  console.log('after two      :', JSON.stringify(afterTwo));
  console.log('after four     :', JSON.stringify(afterFour));
  console.log('after removing :', JSON.stringify(afterRemove));
  console.log('original photo :', photo.length, 'bytes');
  console.log('uploads        :', JSON.stringify(firstRunUploads.map(u =>
    ({ bytes: u.bytes, path: u.url.split('/nelos-photos/')[1] }))));
  console.log('row written    :', JSON.stringify(solved));
  console.log('old database   :', JSON.stringify({ tries: oldDb.tries, first: Object.keys(oldDb.first),
                                                   last: Object.keys(oldDb.last), uploaded: oldDb.uploaded }));
  console.log('page errors    :', errs.length ? errs.join(' | ') : 'none');

  const checks = [
    // ── the picker
    ['the case opens with a photo picker', before.picker === true],
    ['that takes more than one', before.multiple === true],
    ['and does not force the camera, so the gallery is still there', before.capture === false],
    ['one photo does not take the picker away', afterOne.picker === true && afterOne.thumbs === 1],
    ['it invites the next one', /add another/i.test(afterOne.labelText)],
    ['and the input is cleared so the same tap works again', afterOne.inputValue === ''],
    ['a second photo is ADDED, not swapped in', afterTwo.thumbs === 2],
    ['several chosen at once all come in', afterFour.thumbs === 4],
    ['and one taken by mistake comes off', afterRemove.thumbs === 3],

    // ── what was stored
    ['every photo is uploaded', firstRunUploads.length === 3],
    /* The request itself is multipart — supabase-js posts a FormData — so
       the JPEG is inside the body, not in the request's content type. What
       can be checked from out here is that it SHRANK and that it was stored
       as a .jpg. */
    ['shrunk first — a camera photo does not go up whole',
      firstRunUploads.every(u => u.bytes > 0 && u.bytes < photo.length / 2)],
    ['and stored as a .jpg', firstRunUploads.every(u => /\.jpg$/.test(u.url))],
    ['each to its own path', new Set(firstRunUploads.map(u => u.url)).size === 3],

    // ── the row
    ['the case is resolved', solved.status === 'resolved'],
    ['with every photo in resolution_photo_urls',
      Array.isArray(solved.resolution_photo_urls) && solved.resolution_photo_urls.length === 3],
    ['and the first of them still in resolution_photo_url, for every old reader',
      solved.resolution_photo_url === (solved.resolution_photo_urls || [])[0]],

    // ── a database that has not run the SQL
    ['an old database refuses the array', oldDb.tries === 2],
    ['and it is sent again without it',
      'resolution_photo_urls' in oldDb.first && !('resolution_photo_urls' in oldDb.last)],
    ['the case still resolves', oldDb.last.status === 'resolved'],
    ['keeping one photo rather than none', !!oldDb.last.resolution_photo_url],
    ['and both were uploaded, waiting for the column', oldDb.uploaded === 2],

    ['no page errors', errs.length === 0],
  ];
  let bad = 0;
  console.log('');
  for (const [l, p] of checks) { console.log((p ? 'ok   ' : 'FAIL ') + l); if (!p) bad++; }
  await browser.close(); server.close();
  process.exit(bad ? 1 : 0);
})();

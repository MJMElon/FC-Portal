/* Start Camera threw "Camera error: Invalid type of 'cameraIdOrConfig' =
   boolean" -- html5-qrcode's own cameraIdOrConfig validator only accepts a
   deviceId string or an object with EXACTLY ONE key (facingMode or
   deviceId; see createVideoConstraints in node_modules/html5-qrcode). The
   old fallback chain in ScanModule.jsx's startCamera() broke that twice:
   `{facingMode:{ideal:'environment'}, ...adv}` carried THREE keys
   (facingMode, width, height), and the last-resort entry was the literal
   boolean `true`. Both throw SYNCHRONOUSLY, before ever asking the OS for
   a camera -- so the two plain `{facingMode:'environment'|'user'}'
   attempts were the only ones that could ever really try, and whatever
   real error they hit was masked by this one once they fell through to
   the broken entries.

   This drives the REAL html5-qrcode library (not a mock) against a real
   <video> element, with Chromium's synthetic camera device, to prove:
   the OLD shapes throw that exact validation error before touching the
   camera, and the NEW shapes (resolution hint moved into
   config.videoConstraints, which the library uses INSTEAD of
   cameraIdOrConfig and validates far more leniently; the broken `true`
   replaced with a real Html5Qrcode.getCameras() fallback) do not, and
   the camera genuinely starts.

   Run: node tests/scan_camera_starts.cjs
   with `python3 -m http.server 8782` serving the repository root.       */
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
function checkTrue(name, got) { check(name, !!got, true); }

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error] ' + e.message));
  await page.goto('http://localhost:8782/tests/fixtures/camera_start_harness.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__harnessReady === true);

  console.log('\nThe OLD attempt shapes -- what startCamera() used to pass');
  const oldResult = await page.evaluate(async () => {
    const Html5Qrcode = window.Html5Qrcode;
    const config = { fps: 15 };
    const adv = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const attempts = [
      { facingMode: { ideal: 'environment' }, ...adv },
      true,
    ];
    const errors = [];
    for (const cam of attempts) {
      const qr = new Html5Qrcode('reader', { verbose: false });
      try {
        await qr.start(cam, config, () => {}, () => {});
        errors.push(null); // started -- should not happen for either shape
      } catch (e) {
        errors.push(String(e));
      } finally {
        try { await qr.clear(); } catch (_) {}
      }
    }
    return errors;
  });
  checkTrue('the 3-key shape throws before touching the camera', oldResult[0] && /exactly 1 key/i.test(oldResult[0]));
  checkTrue('the boolean `true` throws the exact reported error', oldResult[1] && /Invalid type of .cameraIdOrConfig. = boolean/.test(oldResult[1]));

  console.log('\nThe FIXED attempt shapes -- what startCamera() passes now');
  const newResult = await page.evaluate(async () => {
    const Html5Qrcode = window.Html5Qrcode;
    const config = { fps: 15 };
    const hdHint = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const attempts = [
      { cam: { facingMode: 'environment' }, videoConstraints: { facingMode: 'environment', ...hdHint } },
      { cam: { facingMode: 'environment' } },
      { cam: { facingMode: 'user' } },
    ];
    let started = false, usedVideoConstraints = false;
    const attemptErrors = [];
    for (const a of attempts) {
      const qr = new Html5Qrcode('reader', { verbose: false });
      let thisStarted = false;
      try {
        const cfg = a.videoConstraints ? { ...config, videoConstraints: a.videoConstraints } : config;
        await qr.start(a.cam, cfg, () => {}, () => {});
        thisStarted = true;
      } catch (e) {
        attemptErrors.push(String(e));
      }
      // Teardown is a separate concern from whether start() itself
      // worked -- a flaky stop()/clear() here must not read as the
      // camera having failed to start.
      try { await qr.stop(); } catch (_) {}
      try { await qr.clear(); } catch (_) {}
      if (thisStarted) {
        started = true;
        usedVideoConstraints = !!a.videoConstraints;
        break;
      }
    }
    return { started, usedVideoConstraints, attemptErrors };
  });
  console.log('  (per-attempt errors before the one that worked, if any): ' + JSON.stringify(newResult.attemptErrors));
  checkTrue('the camera actually starts', newResult.started);
  checkTrue('none of the attempts hit the cameraIdOrConfig validator', !newResult.attemptErrors.some(e => /cameraIdOrConfig/.test(e)));

  console.log('\nThe getCameras() last resort, if every facingMode attempt is refused');
  // Fresh page/context: avoids any leftover state from the camera this
  // same browser context already opened and released above.
  const page2 = await browser.newPage();
  page2.on('pageerror', e => console.log('  [page error] ' + e.message));
  await page2.goto('http://localhost:8782/tests/fixtures/camera_start_harness.html', { waitUntil: 'load' });
  await page2.waitForFunction(() => window.__harnessReady === true);
  const fallbackResult = await page2.evaluate(async () => {
    const Html5Qrcode = window.Html5Qrcode;
    const cams = await Html5Qrcode.getCameras();
    if (!cams || !cams.length) return { ok: false, reason: 'no cameras reported' };
    const qr = new Html5Qrcode('reader', { verbose: false });
    let ok = false, reason = null;
    try {
      await qr.start(cams[0].id, { fps: 15 }, () => {}, () => {});
      ok = true;
    } catch (e) {
      reason = String(e);
    }
    try { await qr.stop(); } catch (_) {}
    try { await qr.clear(); } catch (_) {}
    return { ok, reason };
  });
  checkTrue('a plain device id (string) starts the camera too', fallbackResult.ok);
  if (!fallbackResult.ok) console.log('  reason: ' + fallbackResult.reason);
  await page2.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

/**
 * The dashboard's one Sync button.
 *
 * Everything here already happens by itself — each module flushes its own
 * outbox when the line returns and refreshes its own cache when opened. The
 * button exists for the moment BEFORE the field: standing somewhere with
 * signal, about to walk into somewhere without, a Field Conductor wants to
 * press one thing and know the phone is loaded — queued work sent up, fresh
 * data pulled down — rather than trust that five modules each did their part
 * at some point.
 *
 * PUSH first, then PULL, so what was recorded offline is on the server
 * before the caches are re-read — a pull first would fetch a picture the
 * phone's own queue is about to change.
 *
 * Dynamic imports throughout: the modules are lazy-loaded chunks (see
 * App.jsx) and a static import here would weld the scanner, PALMS and
 * maintenance into the shell bundle the dashboard ships in.
 *
 * The stamp is only written when EVERY step succeeded — the card shows the
 * last time a sync fully worked, not the last time one was attempted, so
 * the date on it can be trusted the way it reads.
 */
import { isOnline } from './outbox.js';

export const SYNC_STAMP_KEY = 'mjm_fc_last_sync_v1';

/** { at, ok } of the last fully successful sync, or null. */
export function lastSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_STAMP_KEY));
    return s && s.at ? s : null;
  } catch (e) {
    return null;
  }
}

/* ONE STEP, with a ceiling and a second chance.

   A step that never answers used to hold the whole button on a spinner,
   and a step that failed once on a nursery signal failed the press: seven
   reads and writes, each of them one dropped packet from a red cross, is a
   button that "always fails" while every one of the seven works. So each
   step gets STEP_TIMEOUT_MS, and a failure that looks like the line gets
   ONE more try after a short pause. A refusal from the server is not
   retried -- it would only refuse again, and the second wait is time the
   person stands there for nothing. */
export const STEP_TIMEOUT_MS = 60000;
const RETRY_PAUSE_MS = 1500;

function within(promise, ms, name) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${Math.round(ms / 1000)}s (${name})`)), ms);
    }),
  ]);
}

const looksLikeTheLine = (msg) =>
  /Failed to fetch|NetworkError|Network request failed|load failed|timeout|ETIMEDOUT|ENOTFOUND|ERR_|fetch|abort|503|502|504|could not reach/i.test(String(msg || ''));

const messageOf = (e) =>
  String((e && (e.message || e.details || e.hint || e.code)) || e || 'unknown error').slice(0, 200);

export async function runStep(name, fn, opts = {}) {
  const ms = opts.timeoutMs || STEP_TIMEOUT_MS;
  const pause = opts.pauseMs == null ? RETRY_PAUSE_MS : opts.pauseMs;
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await within(fn(), ms, name);
      return { name, ok: true, tries: attempt };
    } catch (e) {
      last = messageOf(e);
      if (attempt === 2 || !looksLikeTheLine(last)) break;
      await new Promise((r) => setTimeout(r, pause));
    }
  }
  return { name, ok: false, error: last };
}

export async function syncAll() {
  if (!isOnline()) return { ok: false, offline: true, steps: [] };

  const steps = [];
  const run = async (name, fn) => { steps.push(await runStep(name, fn)); };

  // ── PUSH: everything this phone has queued ──
  await run('culling queue', async () => {
    const m = await import('../modules/palms/cullingOffline.js');
    await m.flushCulling();
  });
  await run('maintenance queue', async () => {
    const m = await import('../modules/maintenance/data.js');
    await m.flushMaintenance();
  });
  /* A DO queued with no line was sent only by the scan screen and the
     30-second tick; the one press that promises "everything queued went up"
     did not include it. flushDOQueue is single-flight, so this cannot send
     one twice. */
  await run('delivery orders', async () => {
    const m = await import('../modules/do/data.js');
    await m.flushDOQueue();
  });
  await run('scan records', async () => {
    const m = await import('../modules/scan/store.js');
    await m.flushScanRecords();
  });
  // PALMS is push AND pull in one call — its own sync merges both ways.
  await run('palms', async () => {
    const m = await import('../modules/palms/sync.js');
    const r = await m.syncPalms();
    // syncPalms answers null when it could not reach the server at all.
    // The reason it gave is the useful half -- a refusal reads very
    // differently from a dropped line.
    if (r === null) throw new Error(m.palmsSyncError() || 'PALMS could not reach the server');
  });

  // ── PULL: refresh what the offline caches hold ──
  await run('culling blocks', async () => {
    const m = await import('../modules/palms/cullingSource.js');
    await m.loadPlots();
  });
  /* Maintenance was PUSH-only here, which made the button a half-truth: a
     Field Conductor pressed Sync, walked out of coverage, opened Maintenance
     and found an empty board — because nothing had ever pulled the plan, the
     plots or the records down. The month asked for is the one he is standing
     in, which is the one the board opens on.

     The nursery keys are the ones his own access allows, read the same way
     the module reads them, so this loads exactly what he will be shown and
     not the whole estate. */
  await run('maintenance board', async () => {
    const m = await import('../modules/maintenance/data.js');
    const { monthLabelOf } = await import('../modules/maintenance/schedule.js');
    const { nurseryKey } = await import('./access.js');
    const { plots } = await m.loadMaintenanceData();
    // Nice to have, not the point — neither should sink the pull.
    await m.loadPlotBatches().catch(() => {});
    await m.loadWorkers().catch(() => {});
    const names = [...new Set((plots || []).map((p) => p.nursery_name).filter(Boolean))];
    const keys = [...new Set(names.flatMap((n) => [n, nurseryKey(n)]))];
    if (keys.length) await m.loadSchedules(keys, monthLabelOf(m.todayStr()));
  });
  await run('consents & bookings', async () => {
    const m = await import('../modules/scan/store.js');
    await m.fetchConsents();
    await m.fetchTodayBookingALs();
  });

  const ok = steps.every((s) => s.ok);
  const at = Date.now();
  if (ok) {
    try { localStorage.setItem(SYNC_STAMP_KEY, JSON.stringify({ at, ok: true })); } catch (e) { /* */ }
  }
  return { ok, offline: false, steps, at };
}

/**
 * The 30-second background flush — the audit module's rhythm, brought here.
 *
 * PUSH ONLY, deliberately. The queues are cheap to ask ("anything waiting?"
 * is a local IndexedDB read, and an empty queue sends nothing), so ticking
 * them every half minute costs almost nothing and catches the cases the
 * 'online' event misses — a flush that failed once, a connection that came
 * back without the browser saying so. The PULL half of syncAll() re-reads
 * whole tables from the server and belongs behind the button, not on a
 * timer in every open tab.
 *
 * One tick at a time: a slow flush must not stack a second one on top.
 */
let autoTimer = null;
let autoBusy = false;

export function startAutoSync(intervalMs = 30000) {
  if (autoTimer) return;
  const tick = async () => {
    if (autoBusy || !isOnline()) return;
    autoBusy = true;
    try {
      const culling = await import('../modules/palms/cullingOffline.js');
      await culling.flushCulling();
      const maint = await import('../modules/maintenance/data.js');
      await maint.flushMaintenance();
      /* A DO goes up the moment there is a line, wherever the app is
         open -- it was only sent from the scan screen own timer, so a DO
         queued with no line waited until somebody opened that screen.
         flushDOQueue is single-flight, so this cannot send one twice. */
      const dos = await import('../modules/do/data.js');
      await dos.flushDOQueue().catch(() => {});
      /* The scans whose DO has been issued go up the moment there is a
         line. A scan with no DO yet is never sent from here -- the flush
         skips it, so it stays on the phone and can still be reset. See
         saveScanRecord. */
      const scan = await import('../modules/scan/store.js');
      await scan.flushScanRecords();
    } catch (e) { /* next tick tries again */ }
    autoBusy = false;
  };
  autoTimer = setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
}

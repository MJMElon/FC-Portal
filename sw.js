/* The FC Portal's offline app shell.
 *
 * HISTORY, because this file has a production incident behind it: an earlier
 * precaching worker served a STALE app shell — cache first, network never —
 * and phones kept opening a dead build long after the fix had shipped. This
 * file then spent months as a self-destruct worker whose only job was to
 * unregister that one. Offline entry is now wanted on purpose (a Field
 * Conductor loses signal for hours and must still open the portal), so a
 * worker is back — built so the old failure cannot recur:
 *
 *   - HTML is NETWORK FIRST. Anyone with signal always gets the live deploy;
 *     the cache answers only when the network itself fails. The incident was
 *     precache-first HTML; this property is the load-bearing one. Do not
 *     flip it.
 *   - Hashed assets (assets/*-<hash>.js/css) are cache first, which is safe
 *     BECAUSE of the hashes: fresh HTML can only ever name fresh files, so a
 *     cached old chunk can never be served into a new page.
 *   - Supabase is never touched — not cached, not intercepted. A stale row
 *     mistaken for the truth is worse than a failed request, and the outbox
 *     already owns "the request failed".
 *
 * The escape hatch survives: app.html's recovery code still unregisters
 * every worker and clears every cache when the app fails to mount, so a
 * misbehaving worker is two automatic reloads away from gone.
 */
/* Both lines are rewritten by the build (see the sw-precache plugin in
   vite.config.js): VER gets a per-build value so every deploy opens a fresh
   cache, and PRECACHE gets the full list of built files — the entry HTML and
   every hashed chunk. Without the list, a module tab nobody had opened while
   online had no code on the phone at all: the modules are lazy chunks,
   fetched the first time their tab is pressed, and a runtime-only cache
   cannot hold a file that was never fetched. Field test found it exactly
   that way — sync pressed, airplane mode on, a tab that had not been opened
   online refused to draw. */
const VER = 'fc-shell-mwyc9bhp';
const PRECACHE = ["./","./index.html","./icon.svg","./assets/CullingModule-BY_daTLg.js","./assets/CullingTab-BCECDai1.js","./assets/DoModule-DQL8ztEM.js","./assets/EntryModal-DYuY4VJ7.js","./assets/MaintenanceModule-ClCqE2qj.js","./assets/PalmsBody-BYPBvdzu.js","./assets/PalmsModule-PGqyVp5B.js","./assets/ScanModule-BG1YnRbS.js","./assets/TrackMap-Dgihpmma.css","./assets/TrackMap-O5QSGNUz.js","./assets/TransplantSheet-Bq5QUxL8.js","./assets/VerificationBoard-B1KY1_cO.js","./assets/WorkerPortal-DEs0yZdb.js","./assets/WorkerTickModal-0adeEQwM.js","./assets/ago-Bxn_7WUD.js","./assets/app-ChkFB1F0.css","./assets/app-kUJABhjW.js","./assets/apple-touch-icon-S6sv4MlH.png","./assets/b1-CSzJ9mIh.jpeg","./assets/b4-DxhMv_2i.jpeg","./assets/cullingData-D_Z93roR.js","./assets/cullingOffline-m4aAFGke.js","./assets/cullingSource-CAVIQZ8-.js","./assets/day-CnnvTOpn.js","./assets/html2canvas.esm-CBrSDip1.js","./assets/icon-192-qA6CMvfK.png","./assets/icon-512-DwyxxBVP.png","./assets/icon-B5EoKwz6.svg","./assets/index.es-CFzZgM7V.js","./assets/parked-BNgiEYaH.js","./assets/purify.es-BwoZCkIS.js","./assets/store-Ll96iJcq.js","./assets/sync-BQWTR5en.js","./assets/u8-C1D4M1Bz.jpeg"];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  /* Best effort, one file at a time — a single 404 must not sink the rest.
     {cache:'reload'} bypasses the HTTP cache, or a version bump could fill
     the new cache with the same stale files the old one held. Precache only
     SEEDS the store: HTML stays network-first below, so this cannot recreate
     the stale-shell incident — a phone with signal always gets the live
     page, whatever was seeded. */
  e.waitUntil(
    caches.open(VER).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => {
              if (!res || res.status !== 200) throw new Error('HTTP ' + (res && res.status));
              return cache.put(url, res);
            })
            .catch(() => {})
        )
      )
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith('http')) return;
  if (url.includes('supabase.co')) return;

  const isHTML = e.request.mode === 'navigate'
    || (e.request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(VER).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        /* ignoreSearch: the stale-build recovery in app.html reloads with a
           ?cb=<timestamp> cache-buster, and offline that unique URL would
           never match anything — the shell it wants is the same one. */
        .catch(() =>
          caches.match(e.request, { ignoreSearch: true })
            .then((hit) => hit || caches.match('./index.html', { ignoreSearch: true }))
        )
    );
    return;
  }

  /* Assets: cache first, refreshed in the background so the next load picks
     up changes to any non-hashed file (icon.svg, fonts). For the hashed
     bundles the refresh is a no-op by construction. */
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(VER).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => null);
      return cached || fetchPromise;
    })
  );
});

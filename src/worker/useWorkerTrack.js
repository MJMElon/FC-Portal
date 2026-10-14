import { useCallback, useEffect, useRef, useState } from 'react';
import { holdScreenAwake } from '../lib/screenWake.js';
import { START_ACCURACY_M, mayStart } from '../modules/maintenance/track/track.js';
import * as T from './taskTrack.js';

/**
 * The phone's GPS, wired to one walked job.
 *
 * ONE at a time, deliberately. A worker is standing in one plot doing one
 * thing; two tracks running at once would be two lines drawn from the same
 * pocket, and neither of them would be a record of anything. Starting a second
 * job stops the first — see `start`.
 *
 * Everything about what a fix means lives in taskTrack.js, which has no React
 * in it and is tested in plain node. This file is the part that cannot be:
 * asking the browser for positions, and stopping asking.
 *
 * `watchIdle` asks it to keep watching even when no walk is running. That is
 * what lets the list know how good the fix is BEFORE Start is pressed —
 * a track may only begin under ±30 m (START_ACCURACY_M, the same rule the
 * full-screen map has always applied), and a Start that can be pressed and
 * then refuses is worse than one that says why it is grey.
 */
export function useWorkerTrack(watchIdle = false) {
  /* Whatever was running when the page went away, back as PAUSED. A worker
     whose phone locked mid-row finds the track where they left it rather than
     starting again. */
  const [session, setSession] = useState(() => T.load());
  const [denied, setDenied] = useState(false);
  // The newest position, whether or not a walk is running. What decides
  // whether Start may be pressed at all.
  const [fix, setFix] = useState(null);
  // Re-rendered once a second while running, so the clock on the row moves.
  const [, tick] = useState(0);
  const watchRef = useRef(null);

  const put = useCallback((next) => {
    setSession(next);
    T.save(next);
    return next;
  }, []);

  const running = !!session && session.status === 'running';

  /* Watching costs battery and is the one thing that must stop when it should.
     It runs while a walk is running — obviously — and also while the list is
     open and nothing is running, so the accuracy is known before Start is
     pressed. Idle watching stops the moment the page is hidden. */
  useEffect(() => {
    const geo = typeof navigator !== 'undefined' && navigator.geolocation;
    if ((!running && !watchIdle) || !geo) return undefined;

    watchRef.current = geo.watchPosition(
      (pos) => {
        setDenied(false);
        const c = pos && pos.coords;
        if (!c) return;
        setFix({ lat: c.latitude, lng: c.longitude,
                 accuracy: c.accuracy == null ? null : Math.round(c.accuracy) });
        setSession((s) => {
          const next = T.fix(s, { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy });
          T.save(next);
          return next;
        });
      },
      (err) => {
        /* Permission refused is the only one worth saying out loud. A timeout
           or a temporary failure is what standing under a shade house looks
           like, and the row already says the line has stopped growing. */
        if (err && err.code === 1) setDenied(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    return () => {
      if (watchRef.current != null && geo.clearWatch) geo.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [running, watchIdle]);

  /* Keeping the screen awake while a walk is running. The whole of the why
     is in lib/screenWake.js, which is now the only copy of it — the FC Portal
     track map had its own one-line version and was losing tracks to exactly
     the case the comment there describes. Held only while running, because a
     lock held for the sake of a to-do list is a battery spent on nothing. */
  useEffect(() => (running ? holdScreenAwake() : undefined), [running]);

  // The clock. Only while running — a paused row's time is not moving.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  /* Refuses on a fix too rough to walk from, rather than starting a track that
     the first hundred metres would be a guess at. The same threshold the
     full-screen map has always used. */
  const start = useCallback((task) => {
    if (!mayStart(fix)) return null;
    return put(T.start(task));
  }, [put, fix]);
  /* Through setSession rather than put(), so the copy written to storage is
     the SAME object React is given. Saving one built from a `session` the
     callback closed over is how a track comes back off a locked phone a point
     short of where it was. */
  const pause  = useCallback(() => setSession((s) => { const n = T.pause(s);  T.save(n); return n; }), []);
  const resume = useCallback(() => setSession((s) => { const n = T.resume(s); T.save(n); return n; }), []);

  /** Stop, and hand back what should be saved with the record. */
  const stop = useCallback(() => {
    const payload = T.payload(session);
    put(null);
    setDenied(false);
    return payload;
  }, [session, put]);

  /** Throw the walk away without recording anything. */
  const cancel = useCallback(() => { put(null); setDenied(false); }, [put]);

  return {
    session,
    denied,
    running,
    fix,
    /* Whether Start may be pressed at all, and the number behind the answer
       so the screen can say why not. */
    canStart: mayStart(fix),
    accuracy: fix && fix.accuracy != null ? fix.accuracy : null,
    needAccuracy: START_ACCURACY_M,
    trackingId: session ? session.id : null,
    elapsed: T.elapsed(session),
    start,
    pause,
    resume,
    stop,
    cancel,
  };
}

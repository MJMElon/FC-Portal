/**
 * Keeping the screen awake while a track is being walked.
 *
 * A BROWSER STOPS GIVING POSITIONS WHEN THE PAGE IS NOT ON SCREEN. Not
 * throttles — stops. So a phone that locks itself mid-walk records nothing
 * until it is woken, and the person finds out at the end of the plot, when the
 * line on the map is four metres long. There is no way to walk a track from a
 * web app with the screen off; only a native app can do that.
 *
 * What CAN be done is stop the screen turning itself off, which is the case
 * that actually happens: somebody presses Start, drops the phone in a pocket
 * or just stops touching it, and the display timeout does the rest.
 *
 * ASKING ONCE IS ASKING FOR THE FIRST TIME ONLY. The browser releases the lock
 * on its own the moment the page is hidden and does not hand it back — so a
 * single `wakeLock.request()` at Start is a lock that is gone for good after
 * the first notification, app switch or glance away, and every walk after that
 * moment is at the mercy of the display timeout. That is what this exists to
 * stop, and it is exactly how the FC Portal was losing tracks: the Worker
 * Portal had the full treatment and the map had the one-line version.
 *
 * Two more things learned the hard way, both kept here:
 *
 *   · The reference is forgotten on `hidden` rather than on the lock's own
 *     `release` event. Waiting for the event left the reference set, so the
 *     re-ask returned early and never asked at all.
 *   · Every part of it is best effort. The API is not on every phone, it can
 *     refuse, and a walk must still record on one where it does.
 *
 * ONE COPY, TWO CALLERS: the Worker Portal task row and the FC Portal track
 * map. They were two, and the second one drifted.
 *
 * Returns the function that lets go. Safe to call with no DOM at all.
 */
export function holdScreenAwake() {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let lock = null;
  let dead = false;

  const hold = async () => {
    try {
      if (!navigator.wakeLock || !navigator.wakeLock.request) return;
      if (lock || document.visibilityState !== 'visible') return;
      const got = await navigator.wakeLock.request('screen');
      if (dead) { if (got && got.release) got.release().catch(() => {}); return; }
      lock = got;
      if (got && got.addEventListener) {
        got.addEventListener('release', () => { if (lock === got) lock = null; });
      }
    } catch (e) {
      /* a walk records without it, just not through a lock */
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') { hold(); return; }
    // Hidden: the browser has taken the lock back whether or not it said so.
    lock = null;
  };

  hold();
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    dead = true;
    document.removeEventListener('visibilitychange', onVisible);
    if (lock && lock.release) lock.release().catch(() => {});
    lock = null;
  };
}

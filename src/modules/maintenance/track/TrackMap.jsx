import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLang } from '../../../context/LanguageContext.jsx';
import {
  HEADING_DENIED,
  HEADING_UNSUPPORTED,
  startHeading,
} from './compass.js';
import {
  GOOGLE_ATTR,
  FALLBACK_ATTR,
  MAX_ZOOM,
  satelliteLayer,
} from './tiles.js';
import {
  START_ACCURACY_M,
  addFix,
  formatDistance,
  formatDuration,
  mayStart,
  trackPayload,
} from './track.js';
import { cachedBoundaries, loadSiteBoundaries } from '../../../lib/siteBoundary.js';

/** Close enough to see a seedling bed, far enough to see the plot round it. */
const WORK_ZOOM = 18;

/* The site outline, drawn as a line and not as a filled shape.
 *
 * A fill over satellite imagery hides the thing somebody is standing in — the
 * beds, the rows, the path they are about to walk — to say something they only
 * need at the edges. So: a bright edge, a faint one under it so the line reads
 * against both pale sand and dark canopy, and nothing in the middle.
 *
 * Not interactive either. Every tap on this screen while walking is meant for
 * a button, and a boundary that swallows one is a boundary in the way. */
const BOUNDARY_STYLE   = { color: '#facc15', weight: 3, opacity: 0.95, fill: false, interactive: false };
const BOUNDARY_SHADOW  = { color: '#000000', weight: 6, opacity: 0.35, fill: false, interactive: false };

/* Which outlines are on the map, so a refresh that found the same ones does
   not take them off and put them back — a redraw the size of three estates is
   a visible flicker on a phone. updated_at where the office has one, the shape
   itself where it does not. */
export const boundaryStamp = (list) => JSON.stringify(
  (Array.isArray(list) ? list : []).map((b) => (b && (b.updated_at || b.geojson)) || null));

/* Every nursery's outline the phone is entitled to, in one layer group.
   Nurseries are separate sites, so this is several shapes and not one — and
   which several is decided before it gets here, in the database for a worker
   and by the table for a Field Conductor. */
export function drawBoundary(map, boundaries) {
  const list = (Array.isArray(boundaries) ? boundaries : []).filter((b) => b && b.geojson);
  if (!map || !list.length) return null;
  const g = L.layerGroup();
  g._mjmStamp = boundaryStamp(boundaries);
  list.forEach((b) => {
    try {
      /* GeoJSON is longitude-first and so is L.geoJSON, so nothing is
         reordered anywhere on this path. A boundary that turns up in the Gulf
         of Guinea is an upload that was wrong before it got here. */
      L.geoJSON(b.geojson, { style: () => BOUNDARY_SHADOW }).addTo(g);
      L.geoJSON(b.geojson, { style: () => BOUNDARY_STYLE }).addTo(g);
    } catch (e) {
      /* One malformed outline is not worth losing the other two over, let
         alone the map. */
      console.warn(`[track] the outline for ${b.nursery || 'a nursery'} could not be drawn:`, e);
    }
  });
  g.addTo(map);
  return g;
}

/* The rotating box is bigger than the hole it is seen through, or turning it
   would show the page's background in the corners. √2 is the worst case — a
   square turned 45° — and 1.45 leaves a little margin on top of that. */
const OVERSIZE = 1.45;
const INSET = `${((1 - OVERSIZE) / 2) * 100}%`;
const SIZE = `${OVERSIZE * 100}%`;

/**
 * Recording a walked track, on a satellite map.
 *
 * Full screen, because this is used walking: it is the only thing on the phone
 * while it is open, and every control is thumb-sized and down the bottom.
 *
 * ── The compass button, in three presses ──
 *
 *   1st  find me      zoom to where you are, and keep the map there
 *   2nd  heading up   turn the map so the way you are facing is up the screen
 *   3rd  release      let go of both
 *
 * That is the order asked for, and it is also the order of increasing
 * commitment — each press takes another decision off the person walking. The
 * third gives the map back.
 *
 * Heading-up turns the map by turning a box that is bigger than the window it
 * is seen through. Leaflet does not rotate, and the alternative was a plugin
 * or a second map library; a CSS transform on an oversized container is the
 * whole of it, and the controls sit OUTSIDE that box so they stay the right
 * way up.
 *
 * Dragging is switched off while the map is turned. Not a limitation to work
 * around — a rotated Leaflet does not know its own pointer maths, and a map
 * being driven by a compass is not one somebody should be pushing about with a
 * thumb at the same time.
 */
/**
 * `viewOnly` — the map with nothing to press but Close and the compass.
 *
 * The Worker Portal records a track from the task row, not from here, so
 * opening the map to LOOK at a walk must not offer a second Start that would
 * begin a rival recording of the same job. `live` is that walk, handed in and
 * followed as it grows: { points, distance, startedAt, running }.
 *
 * `fix` and `watchOwn: false` go with it. The Worker Portal is ALREADY
 * watching the GPS — it has to be, to know whether Start may be pressed — and
 * a second watchPosition on top of that is not free and not reliable: with two
 * running, only the first was answered, so this map never got a position at
 * all and Find Me did nothing every time. The caller that is already watching
 * hands its fix in instead. Nobody else passes these, so the FC Portal and a
 * finished job's map keep their own watch exactly as before.
 */
export default function TrackMap({ onClose, onDone, initial = null, viewOnly = false, live = null,
                                   fix: fedFix = null, watchOwn = true }) {
  const { t } = useLang();

  const boxRef = useRef(null);          // the hole it is seen through
  const mapElRef = useRef(null);        // the oversized, turning box
  const mapRef = useRef(null);
  const posLayerRef = useRef(null);     // dot + accuracy circle
  const lineRef = useRef(null);         // the track drawn so far
  const boundaryRef = useRef(null);     // the nursery outlines, behind both

  const [ownFix, setOwnFix] = useState(null);      // the newest position, when watching for itself
  const fix = watchOwn ? ownFix : fedFix;
  const [state, setState] = useState(() => (initial && initial.track
    ? { points: initial.track, distance: initial.distance_m || 0, startedAt: initial.started_at }
    : { points: [], distance: 0, startedAt: null }));
  const [recording, setRecording] = useState(false);
  const [compass, setCompass] = useState('off');   // off | follow | heading
  const [heading, setHeading] = useState(null);
  const [note, setNote] = useState(null);
  const [attr, setAttr] = useState(GOOGLE_ATTR);
  const [elapsed, setElapsed] = useState(0);

  const stopHeadingRef = useRef(null);
  const startedAtMsRef = useRef(null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  const flash = (msg) => {
    setNote(msg);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setNote(null), 3500);
  };

  // ── the map ──
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return undefined;
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      attributionControl: false,
      // Everything the map does is either the GPS's doing or a button's.
      // Leaflet's own inertia on a turned container is a fight nobody wins.
      inertia: false,
      maxZoom: MAX_ZOOM,
    });
    // Somewhere to be until the first fix arrives — the middle of the estate's
    // half of Malaysia, zoomed out far enough that it reads as "no fix yet"
    // rather than as a wrong place.
    map.setView([4.2, 108.0], 5);
    satelliteLayer({ onFallback: () => { setAttr(FALLBACK_ATTR); flash(t('mt.trkFellBack')); } })
      .addTo(map);
    /* The site outlines go on BEFORE the track, so the track is drawn over
       them rather than under. What somebody is walking now matters more than
       where a nursery ends, and a line hidden behind a boundary is a line
       nobody can follow. */
    boundaryRef.current = drawBoundary(map, cachedBoundaries());
    lineRef.current = L.polyline([], {
      color: '#f43f5e', weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round',
    }).addTo(map);
    mapRef.current = map;
    // The container only has a size once the overlay is on screen.
    setTimeout(() => map.invalidateSize(), 60);
    return () => { map.remove(); mapRef.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the site outlines, refreshed behind whatever was already drawn ──
     The cached copies are on the map before this runs, so a phone with no
     signal shows them immediately and one with signal quietly replaces them
     with today's. Nothing is said either way: a nursery with no outline
     uploaded is not a fault, and a map that cannot reach the office still
     draws the last ones it saw. */
  useEffect(() => {
    let dead = false;
    loadSiteBoundaries().then((b) => {
      const map = mapRef.current;
      if (dead || !map) return;
      const was = boundaryRef.current ? boundaryRef.current._mjmStamp : null;
      if (boundaryStamp(b) === was) return;    // same outlines, leave them alone
      if (boundaryRef.current) map.removeLayer(boundaryRef.current);
      boundaryRef.current = drawBoundary(map, b);
    });
    return () => { dead = true; };
  }, []);

  // ── the position, watched for as long as this is open ──
  useEffect(() => {
    // Somebody else is watching and handing the fix in; see the note above.
    if (!watchOwn) return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      flash(t('mt.gpsNone'));
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords || {};
        const next = {
          lat: c.latitude, lng: c.longitude,
          accuracy: c.accuracy == null ? null : Math.round(c.accuracy),
        };
        setOwnFix(next);
        if (recordingRef.current) {
          const t0 = startedAtMsRef.current || Date.now();
          /* Spread over the old state, not straight from addFix. addFix
             answers about points and distance and nothing else — deliberately,
             so it stays a pure function with a test — and taking its return as
             the whole state threw `startedAt` away on the very first fix. */
          setState((s) => ({ ...s, ...addFix(s, { ...next, t: (Date.now() - t0) / 1000 }) }));
        }
      },
      (err) => flash(err && err.code === 1 ? t('mt.gpsDenied') : t('mt.gpsUnavailable')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watchOwn]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── the clock, while recording ──
  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(
      () => setElapsed((Date.now() - (startedAtMsRef.current || Date.now())) / 1000), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // ── draw the dot, the accuracy ring, and the line ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    if (posLayerRef.current) { map.removeLayer(posLayerRef.current); }
    const g = L.layerGroup();
    if (fix.accuracy != null) {
      L.circle([fix.lat, fix.lng], {
        radius: fix.accuracy, color: '#0ea5e9', weight: 1,
        fillColor: '#0ea5e9', fillOpacity: 0.12,
      }).addTo(g);
    }
    L.circleMarker([fix.lat, fix.lng], {
      radius: 7, color: '#ffffff', weight: 3,
      fillColor: (recording || (viewOnly && live && live.running)) ? '#f43f5e' : '#0ea5e9',
      fillOpacity: 1,
    }).addTo(g);
    g.addTo(map);
    posLayerRef.current = g;
    if (compass !== 'off') map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), WORK_ZOOM), { animate: false });
  }, [fix, compass, recording, viewOnly, live && live.running]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lineRef.current) return;
    lineRef.current.setLatLngs((state.points || []).map((p) => [p[1], p[0]]));
  }, [state.points]);

  /* Go to the track.
   *
   * The map opens on the middle of the estate's half of Malaysia at zoom 5,
   * which is the right thing to show while there is nothing to show — but a
   * track handed in as `initial` is already there, drawn, four hundred miles
   * below the visible square. Somebody opening a finished walk had to find it
   * by pinching in, which is not a thing anybody should have to do to see the
   * answer they just asked for.
   *
   * ONCE. The first points that arrive decide the view and nothing moves it
   * again: a live walk that re-fitted on every fix would crawl out from under
   * the finger of whoever was trying to look at the other end of it, and
   * following a walk is the compass button's job, not this one's.
   *
   * Capped at MAX_ZOOM — the tightest the imagery itself goes — and not at
   * WORK_ZOOM, which is the zoom to RECORD at: close enough to see a seedling
   * bed, far enough to see the plot round it, because somebody walking wants
   * the ground ahead of them. Reading a finished walk is the other job, and a
   * round of one plot capped at the walking zoom came up a third of the size
   * it could be. The cap is still needed: a track of one point has no extent
   * at all, and without one fitBounds answers that with the tightest zoom
   * there is. */
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current, line = lineRef.current;
    if (!map || !line || fitted.current) return undefined;
    if (!(state.points || []).length) return undefined;
    fitted.current = true;
    /* After the container has its size. The overlay is painted in the same
       commit that mounts the map, so fitting before that measures a box of
       zero and lands somewhere else entirely. */
    const id = setTimeout(() => {
      map.invalidateSize();
      /* The padding is measured against the map ELEMENT, which is bigger
         than the window it is seen through — that overflow is what lets it
         turn under the compass without showing its corners. The track ends
         up centred in the element and so comfortably inside the window,
         which is the point; no arithmetic needed for that. */
      map.fitBounds(line.getBounds(), { padding: [32, 32], maxZoom: MAX_ZOOM, animate: false });
    }, 80);
    return () => clearTimeout(id);
  }, [state.points]);

  /* Following somebody else's walk. Depends on the LENGTH and the distance
     rather than on `live` itself: the caller builds a fresh object every
     render, so depending on the object would set state on every render and
     spin. */
  useEffect(() => {
    /* Only when a live walk is handed in. Without this guard, opening the map
       on a walk that is FINISHED — where `initial` is the whole thing and
       there is no live session — set the points to an empty list and wiped
       the line the sheet had just fetched. */
    if (!viewOnly || !live) return;
    setState({
      points: (live && live.points) || [],
      distance: (live && live.distance) || 0,
      startedAt: (live && live.startedAt) || null,
    });
  }, [viewOnly, live && live.points && live.points.length, live && live.distance,
      live && live.startedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── dragging follows the compass state ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (compass === 'heading') { map.dragging.disable(); map.touchZoom.disable(); }
    else { map.dragging.enable(); map.touchZoom.enable(); }
  }, [compass]);

  // Let the compass go whenever this screen does.
  useEffect(() => () => { if (stopHeadingRef.current) stopHeadingRef.current(); }, []);

  /* The three presses. startHeading has to be called from inside this handler
     and not from an effect: iOS refuses a permission request that is not part
     of a real tap, silently, and the button just looks broken. */
  const pressCompass = useCallback(async () => {
    if (compass === 'off') {
      if (!fix) return flash(t('mt.trkNoFixYet'));
      const map = mapRef.current;
      if (map) map.setView([fix.lat, fix.lng], WORK_ZOOM);
      setCompass('follow');
      return undefined;
    }

    if (compass === 'follow') {
      try {
        const stop = await startHeading((deg, absolute) => {
          setHeading(deg);
          if (!absolute && !pressCompass._warned) {
            pressCompass._warned = true;
            flash(t('mt.trkHeadingRough'));
          }
        });
        stopHeadingRef.current = stop;
        setCompass('heading');
      } catch (e) {
        const code = (e && e.message) || '';
        flash(code === HEADING_DENIED ? t('mt.trkHeadingDenied')
            : code === HEADING_UNSUPPORTED ? t('mt.trkHeadingNone')
            : t('mt.trkHeadingNone'));
      }
      return undefined;
    }

    // heading → off: let go of both
    if (stopHeadingRef.current) { stopHeadingRef.current(); stopHeadingRef.current = null; }
    setHeading(null);
    setCompass('off');
    return undefined;
  }, [compass, fix, t]);

  function startRecording() {
    if (!mayStart(fix)) return;
    startedAtMsRef.current = Date.now();
    setElapsed(0);
    setState({ points: [], distance: 0, startedAt: new Date().toISOString() });
    setRecording(true);
    // A track is walked, and a phone that sleeps stops giving fixes. Best
    // effort — the API is not everywhere, and it is not worth failing over.
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  }

  function stopRecording() {
    setRecording(false);
    const payload = trackPayload({ ...state, startedAt: state.startedAt });
    if (!payload) { flash(t('mt.trkNothingWalked')); return; }
    onDone(payload);
  }

  const canStart = mayStart(fix);
  const acc = fix && fix.accuracy != null ? fix.accuracy : null;

  const btn = 'rounded-2xl font-black uppercase tracking-widest text-[12px] transition-colors';

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900 flex flex-col">
      {/* The map, in a box that is bigger than the hole it is seen through. */}
      <div ref={boxRef} className="relative flex-1 overflow-hidden">
        <div
          ref={mapElRef}
          className="absolute"
          style={{
            top: INSET, left: INSET, width: SIZE, height: SIZE,
            transform: `rotate(${compass === 'heading' && heading != null ? -heading : 0}deg)`,
            transformOrigin: 'center center',
            transition: 'transform .18s linear',
          }}
        />

        {/* ── everything below here sits OUTSIDE the turning box ── */}

        <button
          onClick={onClose}
          className="absolute top-3 left-3 w-11 h-11 rounded-2xl bg-slate-900/70 text-white text-xl font-black backdrop-blur"
          aria-label={t('common.close')}
        >
          ✕
        </button>

        {/* Accuracy, said plainly and all the time — it is the number that
            decides whether the button below can be pressed at all. */}
        <div className="absolute top-3 right-3 rounded-2xl bg-slate-900/70 backdrop-blur px-3.5 py-2 text-right">
          <div className={`text-[15px] font-black tabular-nums ${
            acc == null ? 'text-slate-400' : acc < START_ACCURACY_M ? 'text-emerald-400' : 'text-amber-400'}`}>
            {acc == null ? '—' : `±${acc} m`}
          </div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {t('mt.trkAccuracy')}
          </div>
        </div>

        {/* North, when the map is turned — the one thing a rotated map has to
            keep saying, or somebody reads it as north-up and walks the wrong
            way down a row. */}
        {compass === 'heading' && heading != null && (
          <div className="absolute top-20 right-4 w-10 h-10 rounded-full bg-slate-900/70 backdrop-blur grid place-items-center pointer-events-none">
            <div style={{ transform: `rotate(${-heading}deg)` }} className="text-center leading-none">
              <div className="text-rose-400 text-[13px] font-black">▲</div>
              <div className="text-white text-[8px] font-black">N</div>
            </div>
          </div>
        )}

        <button
          onClick={pressCompass}
          className={`absolute bottom-4 right-3 w-14 h-14 rounded-2xl backdrop-blur grid place-items-center text-[22px] ${
            compass === 'off' ? 'bg-slate-900/70 text-slate-300'
            : compass === 'follow' ? 'bg-sky-500 text-white'
            : 'bg-emerald-500 text-white'}`}
          title={compass === 'off' ? t('mt.trkFindMe')
               : compass === 'follow' ? t('mt.trkHeadingUp') : t('mt.trkRelease')}
          aria-label={compass === 'off' ? t('mt.trkFindMe')
                    : compass === 'follow' ? t('mt.trkHeadingUp') : t('mt.trkRelease')}
        >
          {compass === 'heading' ? '🧭' : compass === 'follow' ? '◎' : '⊕'}
        </button>
        <div className="absolute bottom-[76px] right-3 w-14 text-center text-[8.5px] font-black uppercase tracking-wider text-white/70 pointer-events-none">
          {compass === 'off' ? t('mt.trkFindMe')
           : compass === 'follow' ? t('mt.trkHeadingUp') : t('mt.trkRelease')}
        </div>

        {note && (
          <div className="absolute bottom-4 left-3 right-20 rounded-2xl bg-slate-900/85 backdrop-blur px-4 py-2.5 text-[12px] font-bold text-white">
            {note}
          </div>
        )}

        <div className="absolute bottom-0 left-0 px-2 py-0.5 text-[8.5px] font-semibold text-white/60 bg-slate-900/40">
          {attr}
        </div>
      </div>

      {/* The bar with the one button that matters. */}
      <div className="shrink-0 bg-slate-900 px-3 pt-3 pb-5 space-y-2.5">
        <div className="flex items-center gap-3 text-white">
          <div className="flex-1">
            <div className="text-[22px] font-black tabular-nums leading-none">
              {formatDistance(state.distance)}
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
              {t('mt.trkWalked')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-black tabular-nums leading-none">
              {formatDuration(recording ? elapsed : (state.points.length ? state.points[state.points.length - 1][2] : 0))}
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
              {t('mt.trkPointsN', { n: state.points.length })}
            </div>
          </div>
        </div>

        {viewOnly ? (
          /* Nothing to press. The walk is being run from the task row, and a
             Start here would be a second recording of the same job. */
          <div className={`${btn} w-full py-3.5 text-center ${
            live && live.running ? 'bg-rose-600/20 text-rose-300'
            : live && live.points && live.points.length ? 'bg-amber-500/20 text-amber-300'
            : 'bg-slate-800 text-slate-400'}`}>
            {live && live.running ? (
              <span className="inline-flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                {t('wk.mapRecording')}
              </span>
            ) : live && live.points && live.points.length ? t('wk.mapPaused')
              : live ? t('wk.mapLooking')
              /* No live session at all: a walk that already happened, opened
                 from a finished job. */
              : t('wk.mapDone')}
          </div>
        ) : !recording ? (
          <>
            <button
              onClick={startRecording}
              disabled={!canStart}
              className={`${btn} w-full py-4 ${canStart
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
            >
              {state.points.length ? t('mt.trkStartAgain') : t('mt.trkStart')}
            </button>
            {/* Why the button will not press. Said here rather than left to be
                worked out from the number in the corner. */}
            {!canStart && (
              <div className="text-[11.5px] font-bold text-amber-400 text-center leading-snug">
                {acc == null ? t('mt.trkWaitingFix')
                             : t('mt.trkTooRough', { acc, need: START_ACCURACY_M })}
              </div>
            )}
            {state.points.length > 0 && (
              <button
                onClick={() => onDone(trackPayload(state))}
                className={`${btn} w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white`}
              >
                {t('mt.trkUse')}
              </button>
            )}
          </>
        ) : (
          <button
            onClick={stopRecording}
            className={`${btn} w-full py-4 bg-white text-rose-700 flex items-center justify-center gap-2.5`}
          >
            <span className="w-3 h-3 rounded-sm bg-rose-600 animate-pulse" />
            {t('mt.trkStop')}
          </button>
        )}
      </div>
    </div>
  );
}

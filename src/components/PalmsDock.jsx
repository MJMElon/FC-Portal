import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { canPalms, visibleNurseries } from '../lib/access.js';
import { NURSERIES, keysOfPlot, loadDB, plotsOf, tickedToday } from '../modules/palms/data.js';
import { applyCachedOfficeConfig, refreshOfficeConfig } from '../modules/palms/officeConfig.js';
import PalmsWindow from './PalmsWindow.jsx';

/**
 * The PALMS train — the artwork and the day's progress.
 *
 * This used to BE the floating button. It is now the PALMS half of one:
 * FloatingDock owns the single button, the drag and where it sits, and
 * borrows Train and todayProgress from here. Two floating buttons on one
 * phone screen is one too many, and the second one always lands on the
 * thing somebody needs to tap.
 *
 * The default export is kept and still works on its own — nothing else
 * mounts it today, and deleting a working component to save a file is how
 * you lose the only copy of the drag maths.
 *
 * Updating every plot's status is the first job of the morning, and a card
 * sitting fifth in a list on one screen is easy to walk past. This follows
 * the Field Conductor around the portal instead, and says at a glance whether
 * the job is done:
 *
 *   out of fuel   the engine is grey and still, the gauge is empty and the
 *                 count says how many plots are left. Today is not done.
 *   under steam   the engine has its colour back and smoke is coming out of
 *                 the funnel. Every plot has been keyed in.
 *
 * Draggable, because a fixed button will eventually sit on top of the one
 * thing somebody needs to tap. Where it is dropped is remembered per device.
 */

const POS_KEY = 'palms_dock_pos_v1';
const SIZE = 62;      // the button, in px
const EDGE = 10;      // never closer than this to the edge of the screen
/* Past this much movement it was a drag, not a tap. Below it, a thumb that
   shifted a couple of pixels while pressing still opens PALMS. */
const DRAG_SLOP = 6;

function readPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY));
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number') return raw;
  } catch (e) { /* first run, or storage unavailable */ }
  return null;
}

/* Keep it on screen. A phone rotated, or a button dropped at the bottom of a
   tall window and reopened on a short one, must not leave it unreachable. */
function clamp(pos) {
  const maxX = Math.max(EDGE, window.innerWidth - SIZE - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
  return {
    x: Math.min(Math.max(pos.x, EDGE), maxX),
    y: Math.min(Math.max(pos.y, EDGE), maxY),
  };
}

function defaultPos() {
  // Bottom right, above where a thumb rests, and clear of the language and
  // sign-out controls in the top bar.
  return clamp({ x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - 90 });
}

/** How much of today's round is keyed in, across the nurseries this person
    may see. Areas count separately, because that is how the work is logged —
    a plot split in three is three things to key in, not one. */
export function todayProgress(permissions) {
  const db = loadDB();
  const keys = visibleNurseries(permissions, Object.keys(NURSERIES), null, 'palms')
    .flatMap((nk) => plotsOf(nk))
    .flatMap(keysOfPlot);
  const done = keys.filter((k) => tickedToday(db, k)).length;
  return { done, total: keys.length };
}

export function Train({ steaming }) {
  const body = steaming ? '#0f766e' : '#94a3b8';
  const trim = steaming ? '#5eead4' : '#cbd5e1';
  const wheel = steaming ? '#134e4a' : '#64748b';
  return (
    <svg viewBox="0 0 48 40" width="34" height="30" aria-hidden="true">
      {/* Smoke. Only when the round is finished — three puffs climbing out of
          the funnel and fading, so "working" reads without any words. */}
      {steaming && (
        <g fill="#e2e8f0" opacity="0.95">
          <circle cx="13" cy="10" r="3.1">
            <animate attributeName="cy" values="10;2;10" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="r" values="2.4;4.4;2.4" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values=".95;0;.95" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="13" cy="10" r="2.6">
            <animate attributeName="cy" values="10;3;10" dur="2.4s" begin="0.8s" repeatCount="indefinite" />
            <animate attributeName="r" values="2;3.8;2" dur="2.4s" begin="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values=".9;0;.9" dur="2.4s" begin="0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="13" cy="10" r="2.2">
            <animate attributeName="cy" values="10;4;10" dur="2.4s" begin="1.6s" repeatCount="indefinite" />
            <animate attributeName="r" values="1.7;3.2;1.7" dur="2.4s" begin="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values=".85;0;.85" dur="2.4s" begin="1.6s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      {/* The funnel, the cab and the boiler — a side-on steam engine. */}
      <rect x="9.5" y="12" width="7" height="7" rx="1.4" fill={body} />
      <rect x="8" y="10.5" width="10" height="2.6" rx="1.3" fill={trim} />
      <rect x="6" y="19" width="30" height="10" rx="2.6" fill={body} />
      <rect x="26" y="9" width="12" height="12" rx="2.4" fill={body} />
      <rect x="28.5" y="11.5" width="7" height="6" rx="1.2" fill={trim} />
      <rect x="4" y="27.5" width="36" height="3.2" rx="1.6" fill={wheel} />

      {/* Wheels. They turn only when the engine is working. */}
      <g fill={wheel}>
        <circle cx="12" cy="33" r="4.2" />
        <circle cx="24" cy="33" r="3.4" />
        <circle cx="34" cy="33" r="3.4" />
        {steaming && (
          <>
            <rect x="11.2" y="29.4" width="1.6" height="7.2" rx=".8" fill={trim}>
              <animateTransform attributeName="transform" type="rotate"
                values="0 12 33;360 12 33" dur="1.1s" repeatCount="indefinite" />
            </rect>
            <rect x="23.3" y="30" width="1.4" height="6" rx=".7" fill={trim}>
              <animateTransform attributeName="transform" type="rotate"
                values="0 24 33;360 24 33" dur="1.1s" repeatCount="indefinite" />
            </rect>
          </>
        )}
      </g>

      {/* Out of fuel: an empty gauge on the cab, needle hard left, and the
          tender behind it standing empty. Grey alone reads as "disabled";
          the empty gauge is what says "it has not been done yet". */}
      {!steaming && (
        <>
          <circle cx="32" cy="14.5" r="3.6" fill="#f8fafc" stroke="#64748b" strokeWidth="1" />
          <path d="M32 14.5 L29.4 12.8" stroke="#dc2626" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="32" cy="14.5" r=".9" fill="#64748b" />
        </>
      )}
    </svg>
  );
}

export default function PalmsDock() {
  const { mayEnter, permissions } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  const [pos, setPos] = useState(() => null);   // set on mount, once the window is measurable
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const drag = useRef(null);

  /* Keyed on the nurseries rather than on the permissions OBJECT. The auth
     context hands out a fresh object on every render, so depending on it made
     this callback — and anything listing it as a dependency — new every time.
     That is what put the button back where it started mid-drag. */
  const scopeSig = (visibleNurseries(permissions, Object.keys(NURSERIES), null, 'palms') || []).join('|');
  const refresh = useCallback(
    () => setProgress(todayProgress(permissions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeSig]
  );

  /* The office's plot list. Without it the button counts the built-in 52 and
     would say "5 left" on a nursery that has 40 plots.
     The cache is what PALMS leaves behind, and is enough every time after the
     first. On a device that has never opened PALMS there is no cache and this
     button is the first thing seen, so it fetches once itself rather than
     showing a count off the built-in list. */
  useEffect(() => {
    let live = true;
    applyCachedOfficeConfig();
    refresh();
    /* EVERY time, not only when nothing is cached. The cache is drawn first
       so the screen is immediate; the read behind it is what takes a stage
       the office has REMOVED off this phone. Asked only when there was no
       cache, a phone that had ever opened PALMS kept its old list for good —
       which is how entries went on being keyed as "Stage 12" (Up-keep) weeks
       after the office took it off the list. */
    refreshOfficeConfig().then((ok) => { if (live && ok) refresh(); });
    return () => { live = false; };
  }, [refresh]);

  // Position: placed once, then only ever moved by a drag or a resize.
  useEffect(() => {
    const saved = readPos();
    setPos(saved ? clamp(saved) : defaultPos());
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* The engine has to change the moment the round is saved, and the save
     happens inside PALMS on a different screen. Re-read on every navigation,
     and again when the tab comes back to the front — a phone that was in a
     pocket over midnight is looking at yesterday's answer. */
  useEffect(() => { refresh(); }, [location.pathname, refresh]);

  useEffect(() => {
    const onWake = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [refresh]);

  function onPointerDown(e) {
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: 0,
                     x0: e.clientX, y0: e.clientY };
    setDragging(true);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    // A tap opens the window over whatever screen this is, rather than
    // navigating away from it.
    if (d.moved < DRAG_SLOP) { setOpen(true); return; }
    setPos((p) => {
      const next = clamp(p);
      try { localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }

  // Nothing but signing in belongs on the login screen. canScan() fails
  // OPEN by design — no permissions loaded reads as "not restricted" — so
  // without this the train steams away over the 555 cover, badge and all,
  // before anybody has said who they are. The same test App uses to decide
  // between the app and the login, so the two cannot disagree: this also
  // keeps the train off the "no operations access yet" screen, which is
  // still outside the door.
  if (!mayEnter) return null;
  // Not for someone without PALMS, and not on top of PALMS itself.
  if (!canPalms(permissions, 'view')) return null;
  if (location.pathname.startsWith('/palms')) return null;
  if (!pos) return null;

  const steaming = progress.total > 0 && progress.done >= progress.total;
  const left = progress.total - progress.done;
  const label = steaming
    ? t('dock.done')
    : t('dock.left', { n: left, total: progress.total });

  return (
    <>
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={label}
      aria-label={label}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: SIZE, height: SIZE,
        zIndex: 40, touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? 'none' : 'box-shadow .15s, transform .15s',
        transform: dragging ? 'scale(1.06)' : 'none',
      }}
      className={`grid place-items-center rounded-full border-2 shadow-[0_8px_24px_rgba(0,0,0,.22)] select-none ${
        steaming
          ? 'bg-white border-teal-500'
          : 'bg-white border-slate-300'
      }`}
    >
      <Train steaming={steaming} />

      {/* How many are left, on the button itself. A Field Conductor should not
          have to open PALMS to find out whether PALMS needs opening. */}
      {!steaming && progress.total > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 grid place-items-center rounded-full bg-rose-600 text-white text-[11px] font-black tabular-nums border-2 border-white"
        >
          {left}
        </span>
      )}
      {steaming && (
        <span className="absolute -top-1 -right-1 w-[22px] h-[22px] grid place-items-center rounded-full bg-teal-600 text-white text-[12px] font-black border-2 border-white">
          ✓
        </span>
      )}
    </button>

    {/* The engine has to react as the last plot is keyed in, not when the
        window is shut — onDayChange fires on every save inside it. */}
    {open && <PalmsWindow onClose={() => { setOpen(false); refresh(); }} onDayChange={refresh} />}
    </>
  );
}

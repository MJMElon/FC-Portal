/* ══════════════════════════════════════════════════════════════════════
   ONE FLOATING BUTTON, UP TO FOUR THINGS BEHIND IT

   PALMS, Nelos, Pending Verification and the Culling Calculator all want
   to follow the Field Conductor around the portal: the plot round is the
   first job of the morning, a case can land while somebody is halfway
   through a scan, a DO or a transplanted plot can go unanswered, and the
   calculator is reached for mid-walk. Four floating buttons is three too
   many — on a 360px screen the second one already started sitting on the
   thing that needed tapping, and every one of them wants the bottom-right
   corner a thumb reaches.

   So there is one. Tap it and it fans open into whichever of the four this
   login may open; tap one of those and its window opens over whatever
   screen you were on. Tap the trigger again, tap away, or press Escape and
   it folds back.

   The trigger carries the WORST of the states that carry a count — PALMS
   plots left, Nelos cases pending, work still to verify — because the
   point of a button that follows you is to be answerable at a glance: a
   red count when anything is waiting, quiet only when all three are clear.
   The Culling Calculator carries no count; it is a tool, not a worklist.
   Opening the dock shows which is which.

   Drag and position are here, once, rather than in each of them — see
   PalmsDock, which is where this drag maths came from and which still
   holds the artwork and the day's count.
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { allowedNurseries, canCulling, canDo, canMaintain, canPalms } from '../lib/access.js';
import { NURSERIES } from '../modules/palms/data.js';
import { applyCachedOfficeConfig, refreshOfficeConfig } from '../modules/palms/officeConfig.js';
import { visibleNurseries } from '../lib/access.js';
import { pendingCases } from '../lib/nelos.js';
import { pendingVerifyCount } from '../lib/verifyCount.js';
import Coin from './Coin.jsx';
import Icon from './Icon.jsx';
import PalmsWindow from './PalmsWindow.jsx';
import NelosWindow from './NelosWindow.jsx';
import VerifyWindow from './VerifyWindow.jsx';
import CullingWindow from './CullingWindow.jsx';
import { Train, todayProgress } from './PalmsDock.jsx';

const POS_KEY = 'mjm_dock_pos_v1';
const SIZE = 62;      // the trigger, in px
const EDGE = 10;      // never closer than this to the edge of the screen
const MINI = 48;      // one fanned-out action
const GAP = 12;
/* Past this much movement it was a drag, not a tap. Below it, a thumb that
   shifted a couple of pixels while pressing still opens the fan. */
const DRAG_SLOP = 6;

function readPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY));
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number') return raw;
  } catch (e) { /* first run, or storage unavailable */ }
  return null;
}

/* Keep it on screen. A phone rotated, or a button dropped at the bottom of
   a tall window and reopened on a short one, must not leave it out of
   reach. */
function clamp(pos) {
  const maxX = Math.max(EDGE, window.innerWidth - SIZE - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - SIZE - EDGE);
  return {
    x: Math.min(Math.max(pos.x, EDGE), maxX),
    y: Math.min(Math.max(pos.y, EDGE), maxY),
  };
}

function defaultPos() {
  // Bottom right, above where a thumb rests, clear of the top bar.
  return clamp({ x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - 90 });
}

/* A small round NL, the mark Nelos wears on the portal's own dock. */
function NelosMark() {
  return (
    <span className="grid place-items-center leading-none">
      <span className="text-[15px] font-black tracking-tight text-[#3b162f]">NL</span>
    </span>
  );
}

/* Pending Verification's own mark in the fan — the same hourglass its
   window opens with, amber like the card it replaced. */
function VerifyMark() {
  return <Icon name="hourglass" className="w-[22px] h-[22px] text-amber-800" />;
}

/* The Culling Calculator's own mark — the same calculator its dashboard
   tile used to wear, rose like that tile's icon box. It carries no badge:
   counting pokok inang is a tool somebody reaches for, not a worklist with
   something pending. */
function CullingMark() {
  return <Icon name="calculator" className="w-[22px] h-[22px] text-rose-700" />;
}

/* The trigger's own face — neither module's. It used to wear the train,
   which is PALMS's engine and stays there, in the fan, as PALMS's own
   button below. What opens the fan belongs to both, so it wears the MJM
   coin instead: the M on one face and a palm seedling on the other, the
   two things PALMS and Nelos are between them about.

   The coin is Coin.jsx, and it is a real one: a stack of discs whose rims
   are its thickness, so halfway through a turn you see its SIDE. What was
   here before was a flat disc that hopped and spun once every forty seconds
   — the same idea, but as a picture turning rather than an object, with
   nothing on the far face because it had no far face. Its styles have gone
   from index.css with it rather than being left behind unused. */

export default function FloatingDock() {
  const { mayEnter, permissions } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  const [pos, setPos] = useState(null);          // set on mount, once measurable
  const [dragging, setDragging] = useState(false);
  const [fan, setFan] = useState(false);         // the actions showing
  const [open, setOpen] = useState(null);        // 'palms' | 'nelos' | 'verify' | null
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [cases, setCases] = useState(null);      // null until the first read
  const [verifyCount, setVerifyCount] = useState(null); // null until the first read
  const drag = useRef(null);
  /* The tap handler runs before the render that decides this, so it is read
     through a ref rather than closing over a stale value. */
  const soloRef = useRef(null);

  /* Keyed on the nurseries rather than on the permissions OBJECT: the auth
     context hands out a fresh object every render, so depending on it made
     this callback new every time — which is what put the button back where
     it started mid-drag. */
  const scopeSig = (visibleNurseries(permissions, Object.keys(NURSERIES), null, 'palms') || []).join('|');
  const refreshPalms = useCallback(
    () => setProgress(todayProgress(permissions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeSig]
  );

  /* The count only. Reading the whole list to show a number is what the
     window is for; this is the badge. Fails soft to null — no badge — so a
     case log that cannot be reached never reads as "nothing pending". */
  const refreshCases = useCallback(async () => {
    try {
      const { rows, failed } = await pendingCases({ module: 'scan' });
      setCases(failed ? null : rows.length);
    } catch (e) {
      setCases(null);
    }
  }, []);

  /* Same shape as refreshCases — the badge's own light read, not the
     window's. See lib/verifyCount.js: this is the SAME query the window
     draws its cards from, not a second copy of it.

     Keyed on a signature rather than the permissions object itself, for
     the same reason scopeSig is above it: a fresh object every render
     would make this callback — and everything that depends on it — new
     every render too. */
  const verifySig = `${canDo(permissions, 'view') ? 1 : 0}${canMaintain(permissions, 'view') ? 1 : 0}|` +
    (allowedNurseries(permissions, 'maintenance') || []).join(',');
  const refreshVerify = useCallback(
    async () => setVerifyCount(await pendingVerifyCount(permissions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verifySig]
  );

  /* The office's plot list. Without it the button counts the built-in 52 and
     would say "5 left" on a nursery that has 40 plots. */
  useEffect(() => {
    let live = true;
    applyCachedOfficeConfig();
    refreshPalms();
    /* EVERY time, not only when nothing is cached. The cache is drawn first
       so the screen is immediate; the read behind it is what takes a stage
       the office has REMOVED off this phone. Asked only when there was no
       cache, a phone that had ever opened PALMS kept its old list for good —
       which is how entries went on being keyed as "Stage 12" (Up-keep) weeks
       after the office took it off the list. */
    refreshOfficeConfig().then((ok) => { if (live && ok) refreshPalms(); });
    return () => { live = false; };
  }, [refreshPalms]);

  useEffect(() => {
    const saved = readPos();
    setPos(saved ? clamp(saved) : defaultPos());
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* All three have to react to work done on another screen: PALMS to the
     round being saved, Nelos to a case being raised or settled, Verify to a
     DO or a transplant plot being answered. Re-read on every navigation,
     and again when the tab comes back to the front — a phone that was in a
     pocket over midnight is looking at yesterday. */
  useEffect(() => { refreshPalms(); refreshCases(); refreshVerify(); },
    [location.pathname, refreshPalms, refreshCases, refreshVerify]);

  useEffect(() => {
    const onWake = () => { if (!document.hidden) { refreshPalms(); refreshCases(); refreshVerify(); } };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [refreshPalms, refreshCases, refreshVerify]);

  // Escape folds the fan, as it would any transient thing.
  useEffect(() => {
    if (!fan) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFan(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fan]);

  function onPointerDown(e) {
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: 0, x0: e.clientX, y0: e.clientY };
    setDragging(true);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    // Dragging the button is not choosing between the two; fold first.
    if (d.moved >= DRAG_SLOP && fan) setFan(false);
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.moved < DRAG_SLOP) {
      // One thing behind the button is not a fan — tapping opens it, and
      // tapping it again is how you pop it back in, now that there is no
      // backdrop behind the window to tap instead.
      if (soloRef.current) {
        if (open === soloRef.current) closeCurrent(); else setOpen(soloRef.current);
        return;
      }
      setFan((v) => !v);
      return;
    }
    setPos((p) => {
      const next = clamp(p);
      try { localStorage.setItem(POS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }

  /* Nothing but signing in belongs on the login screen. canScan() fails OPEN
     by design — no permissions loaded reads as "not restricted" — so without
     this the dock floats over the 555 cover before anybody has said who they
     are. The same test App uses to decide between the app and the login, so
     the two cannot disagree. */
  if (!mayEnter) return null;
  if (!pos) return null;

  const mayPalms = canPalms(permissions, 'view') && !location.pathname.startsWith('/palms');
  /* Nelos is not a PALMS permission. Anybody signed in to the portal can be
     sent a case, so anybody signed in can read their own list — what they
     may see inside it is nelos_my_scope()'s answer, not this button's. */
  const mayVerify = canDo(permissions, 'view') || canMaintain(permissions, 'view');
  const mayCulling = canCulling(permissions, 'view') && !location.pathname.startsWith('/culling');
  const actions = [];
  if (mayPalms) actions.push('palms');
  actions.push('nelos');
  if (mayVerify) actions.push('verify');
  if (mayCulling) actions.push('culling');
  // One thing behind it is not a fan. Tapping opens that one thing.
  soloRef.current = actions.length === 1 ? actions[0] : null;

  const steaming = progress.total > 0 && progress.done >= progress.total;
  const plotsLeft = mayPalms ? Math.max(0, progress.total - progress.done) : 0;
  const casesLeft = cases || 0;
  const verifyLeft = mayVerify ? (verifyCount || 0) : 0;
  const total = plotsLeft + casesLeft + verifyLeft;
  const label = total
    ? [
        plotsLeft ? `${plotsLeft} plots` : '',
        casesLeft ? `${casesLeft} cases` : '',
        verifyLeft ? `${verifyLeft} to verify` : '',
      ].filter(Boolean).join(', ') + ' waiting'
    : t('dock.done');

  /* The fan opens towards the middle of the screen, so the two actions
     never run off the edge the button was parked against. */
  const goUp = pos.y > window.innerHeight / 2;
  const step = MINI + GAP;
  const miniAt = (i) => {
    const n = actions.length;
    const slot = i + 1;
    return {
      left: pos.x + (SIZE - MINI) / 2,
      top: goUp ? pos.y - slot * step : pos.y + SIZE + (slot - 1) * step + GAP,
    };
  };

  const miniCls =
    'fixed grid place-items-center rounded-full border-2 shadow-[0_6px_18px_rgba(0,0,0,.2)] cursor-pointer select-none';

  // What the × on each window already does on close, shared with the two
  // other ways a window now closes without it: tapping the trigger again,
  // and picking the same fan action a second time.
  function closeCurrent() {
    if (open === 'palms') refreshPalms();
    else if (open === 'nelos') refreshCases();
    else if (open === 'verify') refreshVerify();
    setOpen(null);
  }

  function choose(which) {
    setFan(false);
    if (open === which) closeCurrent(); else setOpen(which);
  }

  // Each fan action's face, badge count and style — one place for all three
  // rather than an on/off branch that only ever knew how to tell two apart.
  const FACE = {
    palms:  { label: 'PALMS', cls: 'bg-white border-teal-500',
              icon: <span style={{ transform: 'scale(.62)' }}><Train steaming={steaming} /></span>,
              n: plotsLeft },
    nelos:  { label: 'Nelos', cls: 'bg-[#efc7e2] border-[#cf6eaf]', icon: <NelosMark />, n: casesLeft },
    verify: { label: t('vrf.title'), cls: 'bg-amber-100 border-amber-400', icon: <VerifyMark />, n: verifyLeft },
    culling: { label: t('cull.title'), cls: 'bg-rose-100 border-rose-400', icon: <CullingMark />, n: 0 },
  };

  return (
    <>
      {/* A tap anywhere else folds the fan. Transparent and only while open,
          so it never eats a tap the portal wanted. */}
      {fan && <div className="fixed inset-0 z-[38]" onClick={() => setFan(false)} />}

      {fan && actions.map((a, i) => {
        const p = miniAt(i);
        const face = FACE[a];
        return (
          <button
            key={a}
            type="button"
            onClick={() => choose(a)}
            title={face.label}
            aria-label={face.label}
            style={{ left: p.left, top: p.top, width: MINI, height: MINI, zIndex: 41 }}
            className={`${miniCls} ${face.cls}`}
          >
            {face.icon}
            {face.n > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 grid place-items-center rounded-full bg-rose-600 text-white text-[10px] font-black tabular-nums border-2 border-white">
                {face.n}
              </span>
            )}
          </button>
        );
      })}

      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={label}
        aria-label={label}
        aria-expanded={fan}
        data-dock-trigger
        style={{
          position: 'fixed', left: pos.x, top: pos.y, width: SIZE, height: SIZE,
          zIndex: 40, touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab',
          transition: dragging ? 'none' : 'box-shadow .15s, transform .15s',
          transform: dragging ? 'scale(1.06)' : 'none',
        }}
        className={`relative grid place-items-center rounded-full select-none ${
          fan
            ? 'bg-white border-2 border-slate-300 shadow-[0_8px_24px_rgba(0,0,0,.22)]'
            : 'drop-shadow-[0_8px_18px_rgba(0,0,0,.35)]'
        }`}
      >
        {/* Closed, it is a coin — neither module's, which the train was.
            Fanned open it becomes a cross: the train is already in the fan
            as PALMS's own button, and the same engine twice, one above the
            other, would read as two PALMS rather than "close this".

            The coin draws its own gold, its own rim and its own thickness, so
            the button behind it carries no background or border of its own —
            two rims, one flat and one struck, read as a coin sitting in a
            ring. It stops turning while it is being dragged: a thumb moving
            it across the screen is doing something, and the coin should not
            look like it is doing something else at the same time. */}
        {fan
          ? <span className="text-[26px] leading-none font-black text-slate-500">×</span>
          : <Coin size={SIZE} spin={!dragging} />}

        {!fan && total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 grid place-items-center rounded-full bg-rose-600 text-white text-[11px] font-black tabular-nums border-2 border-white">
            {total}
          </span>
        )}
        {!fan && total === 0 && (
          <span className="absolute -top-1 -right-1 w-[22px] h-[22px] grid place-items-center rounded-full bg-teal-600 text-white text-[12px] font-black border-2 border-white">
            ✓
          </span>
        )}
      </button>

      {/* All four present the same way now — the Nelos pop-out, anchored
          to wherever the button sits, each at its own size. */}
      {open === 'palms' && (
        <PalmsWindow onClose={() => { setOpen(null); refreshPalms(); }} onDayChange={refreshPalms}
          anchor={{ x: pos.x, y: pos.y, size: SIZE }} />
      )}
      {open === 'nelos' && (
        <NelosWindow onClose={() => { setOpen(null); refreshCases(); }} onCount={setCases}
          anchor={{ x: pos.x, y: pos.y, size: SIZE }} />
      )}
      {open === 'verify' && (
        <VerifyWindow onClose={() => { setOpen(null); refreshVerify(); }} onCount={setVerifyCount}
          anchor={{ x: pos.x, y: pos.y, size: SIZE }} />
      )}
      {open === 'culling' && (
        <CullingWindow onClose={() => setOpen(null)}
          anchor={{ x: pos.x, y: pos.y, size: SIZE }} />
      )}
    </>
  );
}

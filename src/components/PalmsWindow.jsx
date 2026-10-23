import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import anchoredFrame from './anchoredFrame.js';
import { createPortal } from 'react-dom';
import { useLang } from '../context/LanguageContext.jsx';

const PalmsBody = lazy(() => import('../modules/palms/PalmsBody.jsx'));

/**
 * PALMS in a window over whatever you were doing.
 *
 * Keying the day in takes two minutes and is the first job of the morning.
 * Sending someone to a different page for it means losing the screen they
 * were on and finding their way back, so the train opens this instead.
 * /palms still exists for a bookmark.
 *
 * Two shapes, because one does not fit both:
 *
 *   phone    a sheet up from the bottom, nearly full height. A 300px
 *            draggable window on a 390px screen is a toy, not a tool.
 *   wider    a real floating window, dragged by its title bar, position
 *            remembered. It can be pushed aside to read what is underneath,
 *            which is the whole point of not being a page.
 */

const POS_KEY = 'palms_window_pos_v1';
const WIDE = 640;          // px — below this it is a sheet, above it a window
const W = 560;             // window width on a wide screen
const EDGE = 8;

const isWide = () => window.innerWidth >= WIDE;

function readPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
  } catch (e) { /* first run */ }
  return null;
}

/* The title bar must always be reachable. A window dropped near the bottom of
   a tall screen and reopened on a short one would otherwise have its only
   handle off-screen, and no way to be moved back. */
function clamp(p) {
  const w = Math.min(W, window.innerWidth - EDGE * 2);
  return {
    x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE)),
    y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - 120)),
  };
}

const defaultPos = () => clamp({
  x: Math.round((window.innerWidth - Math.min(W, window.innerWidth - EDGE * 2)) / 2),
  y: 56,
});

/* The cog belongs in the title bar, but only PalmsBody knows whether this
   person may open Settings and whether it is currently open. Rendered into
   the bar through a placeholder node rather than lifting that state up, which
   would mean PalmsBody reporting to two different frames. */
function HeaderCog({ on, onClick, label }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('palms-win-cog')); }, []);
  if (!slot) return null;
  return createPortal(
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid place-items-center w-9 h-9 rounded-full cursor-pointer shrink-0 ${
        on ? 'bg-emerald-600 text-white' : 'bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-700'
      }`}
    >
      <CogIcon />
    </button>,
    slot
  );
}

function Spinner({ label }) {
  return (
    <div className="py-16 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
      {label}
    </div>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

export default function PalmsWindow({ onClose, onDayChange, anchor }) {
  const { t } = useLang();
  const [wide, setWide] = useState(isWide);
  const [pos, setPos] = useState(() => (isWide() ? readPos() || defaultPos() : null));
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const onResize = () => {
      const w = isWide();
      setWide(w);
      setPos((p) => (w ? clamp(p || readPos() || defaultPos()) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape closes it, the way every other window on the device does.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* The page underneath must not scroll while this is open — on a phone a
     sheet that scrolls the page behind it feels broken. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function onPointerDown(e) {
    if (!wide || !pos) return;
    /* Not on a control. The title bar is the drag handle, and it captures the
       pointer so a drag survives the cursor leaving it — but a capture also
       redirects the pointerup, and without a pointerup on the button the
       browser fires no click at all. So pressing × started a one-pixel drag
       and closed nothing. The cog beside it was just as dead. */
    if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setPos((p) => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
      return p;
    });
  }

  const frame = wide
    ? {
        position: 'fixed', left: pos.x, top: pos.y,
        width: Math.min(W, window.innerWidth - EDGE * 2),
        maxHeight: '84vh',
      }
    /* A phone gets the Nelos pop-out shape — a floating card beside the
       dock icon, not a sheet glued to the bottom edge — at THIS window's
       own width (the office asked for the presentation to match and the
       size to stay). anchoredFrame clamps the width to the screen less
       its margins and sizes the height to the room on the icon's side;
       the 92vh cap the sheet had stays as the ceiling. */
    : (() => {
        const f = anchoredFrame(anchor, { w: window.innerWidth, minH: 260 });
        f.maxHeight = Math.min(f.maxHeight, window.innerHeight * 0.92);
        return f;
      })();

  return (
    <>
      <div
        onClick={onClose}
        /* No dark or blurred backdrop — same rule as NelosWindow: a pop-out
            beside the icon reads as attached to it, not as a dialog that has
            taken over the screen. This catcher only closes on a tap away. */
        className="fixed inset-0 z-[55]"
      />

      <div
        style={{ ...frame, zIndex: 56, transition: dragging ? 'none' : 'box-shadow .15s' }}
        className={`bg-slate-100 shadow-[0_24px_70px_rgba(0,0,0,.35)] flex flex-col overflow-hidden ${
          'rounded-2xl border border-slate-300'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="PALMS"
      >
        {/* Title bar — the drag handle on a wide screen, and on a phone the
            grab bar a sheet is expected to have. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none', cursor: wide ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          className="shrink-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2.5 flex items-center gap-2 select-none"
        >
          <span className="font-black text-slate-800 text-sm">PALMS</span>
          <span className="font-black text-emerald-600 text-[10px] uppercase tracking-[0.18em] truncate">
            {t('pm.tabEntry')}
          </span>
          <span id="palms-win-cog" className="ml-auto flex items-center" />
          <button
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="grid place-items-center w-9 h-9 rounded-full bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-xl leading-none cursor-pointer shrink-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
          <Suspense fallback={<Spinner label={t('common.loading')} />}>
            {/* The title bar above IS the header, so PalmsBody draws no bar of
                its own — it only hands back the settings state, which the cog
                is wired into through a portal into the bar. Without this the
                cog would have nowhere to live: the dashboard card is gone, so
                the window is now the only way in. */}
            <PalmsBody
              onDayChange={onDayChange}
              header={({ maySetUp, showSettings, toggleSettings }) => (
                maySetUp ? <HeaderCog on={showSettings} onClick={toggleSettings} label={t('set.title')} /> : null
              )}
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}

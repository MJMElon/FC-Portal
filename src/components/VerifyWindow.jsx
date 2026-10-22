import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import anchoredFrame from './anchoredFrame.js';
import { useLang } from '../context/LanguageContext.jsx';
import Icon from './Icon.jsx';

const VerificationBoard = lazy(() => import('./VerificationBoard.jsx'));

/**
 * Pending Verification, in the same kind of window PALMS and Nelos already
 * open from the floating dock — a sheet up from the bottom on a phone, a
 * draggable window on anything wider. It used to be a card that pushed
 * itself onto the dashboard and hid itself when there was nothing to
 * verify; see VerificationBoard.jsx for why that changed along with it.
 *
 * Copied in shape from PalmsWindow.jsx rather than built from scratch —
 * three windows with three slightly different drag/sheet implementations
 * is three places the next fix has to be made.
 */

const POS_KEY = 'verify_window_pos_v1';
const WIDE = 640;
const W = 560;
const EDGE = 8;

const isWide = () => window.innerWidth >= WIDE;

function readPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
  } catch (e) { /* first run */ }
  return null;
}

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

function Spinner({ label }) {
  return (
    <div className="py-16 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
      {label}
    </div>
  );
}

export default function VerifyWindow({ onClose, onCount, anchor }) {
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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function onPointerDown(e) {
    if (!wide || !pos) return;
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
        className={`bg-white shadow-[0_24px_70px_rgba(0,0,0,.35)] flex flex-col overflow-hidden ${
          'rounded-2xl border border-slate-300'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={t('vrf.title')}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none', cursor: wide ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          className="relative shrink-0 bg-amber-50 border-b border-slate-200 px-3 sm:px-4 py-2.5 flex items-center gap-1.5 select-none"
        >
          <Icon name="hourglass" className="w-3.5 h-3.5 shrink-0 text-amber-700" />
          <span className="font-black uppercase tracking-widest text-[11px] sm:text-xs text-amber-800 truncate">
            {t('vrf.title')}
          </span>
          <button
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="ml-auto grid place-items-center w-9 h-9 rounded-full bg-white/60 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-xl leading-none cursor-pointer shrink-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 sm:px-3 py-2">
          <Suspense fallback={<Spinner label={t('common.loading')} />}>
            <VerificationBoard onCount={onCount} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

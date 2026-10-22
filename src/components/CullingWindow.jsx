import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import anchoredFrame from './anchoredFrame.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { isModuleAdmin, visibleNurseries } from '../lib/access.js';
import { NURSERIES } from '../modules/palms/data.js';

const CullingTab = lazy(() => import('../modules/palms/CullingTab.jsx'));

/**
 * The Culling Calculator, in the same kind of window PALMS, Nelos and
 * Pending Verification already open from the floating dock — a sheet up
 * from the bottom on a phone, a draggable window on anything wider.
 * /culling still exists for a bookmark, carrying the same CullingTab this
 * window does — a calculator somebody reaches for mid-count must not have
 * to be found again from a cold page load.
 *
 * Dark, because the screen is a calculator and the calculator is the
 * screen — CullingModule's own reasoning, copied here rather than losing
 * it on the way into a window: a tool held up in the sun, not a page read
 * in an office.
 *
 * Copied in shape from PalmsWindow.jsx rather than built from scratch —
 * four windows with four slightly different drag/sheet implementations is
 * four places the next fix has to be made.
 */

const POS_KEY = 'culling_window_pos_v1';
const WIDE = 640;
const W = 480;             // narrower than Palms/Verify — the calculator itself caps its own width
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

export default function CullingWindow({ onClose, anchor }) {
  const { staffName, permissions, session } = useAuth();
  const { t } = useLang();
  const [wide, setWide] = useState(isWide);
  const [pos, setPos] = useState(() => (isWide() ? readPos() || defaultPos() : null));
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  const [toast, setToast] = useState(null);
  const flash = (msg) => {
    setToast(msg);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setToast(null), 2500);
  };

  // Same nursery scoping and admin check CullingModule derives — see its
  // own comments for why each is asked the way it is.
  const nurseryKeys = visibleNurseries(permissions, Object.keys(NURSERIES), null, 'culling');
  const canRemove = isModuleAdmin(permissions, 'palms') || isModuleAdmin(permissions, 'culling');

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
        className={`bg-[#050a0e] shadow-[0_24px_70px_rgba(0,0,0,.5)] flex flex-col overflow-hidden ${
          'rounded-2xl border border-[#1f2a38]'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={t('cull.title')}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none', cursor: wide ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          className="relative shrink-0 bg-[#0f1620] border-b border-[#1f2a38] px-3 sm:px-4 py-2.5 flex items-center gap-2 select-none"
        >
          <span className="font-black text-slate-100 text-sm truncate">{t('cull.title')}</span>
          <button
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="ml-auto grid place-items-center w-9 h-9 rounded-full bg-[#111821] hover:bg-rose-900/50 text-slate-400 hover:text-rose-400 text-xl leading-none cursor-pointer shrink-0"
          >
            ×
          </button>
        </div>

        <div className="relative flex-1 min-h-0 px-3 py-3 sm:py-4">
          <Suspense fallback={<Spinner label={t('common.loading')} />}>
            <CullingTab
              t={t}
              staffName={staffName}
              userId={session?.user?.id || null}
              flash={flash}
              nurseryKeys={nurseryKeys}
              canRemove={canRemove}
            />
          </Suspense>

          {toast && (
            <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-xl z-[60]">
              {toast}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useMemo } from 'react';
import anchoredFrame from './anchoredFrame.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useOnline } from '../hooks/useOnline.js';
import { allowedNurseries, nurseryKey } from '../lib/access.js';
import SecondCullCard from '../modules/maintenance/SecondCullCard.jsx';

/**
 * The 2nd cull (Pusing Polibeg) card, in the same pop-out shape the Culling
 * Calculator and the other dock windows use — anchored to the PP icon in the
 * floating dock. The card itself is unchanged; it only lives here now, not on
 * the Dashboard or the Maintenance page.
 *
 * `onPending` is how the dock's blinking mark stays true to the card: every
 * time the card reads or presses Done it reports how many nurseries still
 * owe a Done press.
 */
export default function Cull2Window({ onClose, onPending, anchor }) {
  const { permissions } = useAuth();
  const online = useOnline();

  // Keyed on the joined list, not the array: allowedNurseries hands back a
  // fresh array each render, and the card reloads whenever its allowed set
  // changes identity.
  const list = allowedNurseries(permissions, 'maintenance');
  const sig = list === null ? '*' : (list || []).map(nurseryKey).join(',');
  const allowed = useMemo(
    () => (sig === '*' ? null : new Set(sig ? sig.split(',') : [])),
    [sig]
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = anchoredFrame(anchor, { w: window.innerWidth, minH: 260 });
  f.maxHeight = Math.min(f.maxHeight, window.innerHeight * 0.92);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[55]" />

      <div
        style={{ ...f, zIndex: 56 }}
        className="bg-slate-50 rounded-2xl border border-slate-200 shadow-[0_24px_70px_rgba(0,0,0,.25)] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="2nd Cull · Pusing Polibeg"
      >
        <div className="shrink-0 bg-white border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
          <span className="font-black text-slate-800 text-sm truncate">2nd Cull · Pusing Polibeg</span>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="ml-auto grid place-items-center w-9 h-9 rounded-full bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-xl leading-none cursor-pointer shrink-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <SecondCullCard allowed={allowed} online={online} onPending={onPending} />
        </div>
      </div>
    </>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import { compressImage, dataUrlBytes } from '../../lib/image.js';
import { numText } from '../../lib/numberText.js';

/**
 * Numbered photo slots — the same control the plot audit uses, so a photo is
 * taken the same way wherever in the system it is being taken.
 *
 * A slot keeps its number: clearing the first one does not shuffle the second
 * up into its place. `value` is therefore a fixed-length array with nulls in
 * the empty slots, and the caller filters the nulls out when it saves.
 *
 * Every picture is scaled and re-encoded before it leaves the phone (see
 * lib/image.js) — an eight-megabyte camera frame becomes about a tenth of a
 * megabyte, which is what makes keeping three of them per record reasonable.
 */
export const CameraIcon = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M9 5l1.5-2h3L15 5" />
  </svg>
);

const GalleryIcon = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m4 17 4.5-5 3.5 4 3-3.5L20 17" />
    <circle cx="8.5" cy="9.5" r="1.4" />
  </svg>
);

export default function PhotoSlots({ value, onChange, max = 3, busyLabel }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(0);        // the slot being shrunk, or 0
  const [picking, setPicking] = useState(0);  // the slot whose chooser is open
  const [err, setErr] = useState('');
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const slotRef = useRef(0);

  const slots = useMemo(() => {
    const a = Array(max).fill(null);
    (value || []).forEach((v, i) => { if (i < max) a[i] = v || null; });
    return a;
  }, [value, max]);

  const taken = slots.filter(Boolean);
  const bytes = slots.reduce((s, p) => s + (p ? dataUrlBytes(p) : 0), 0);

  /* Camera or gallery, the same choice the plot audit offers. On a phone the
     capture input opens the camera; the other opens the roll. */
  function choose(slot, useCamera) {
    slotRef.current = slot;
    setPicking(0);
    const el = useCamera ? camRef.current : fileRef.current;
    if (el) el.click();
  }

  async function picked(e) {
    const f = (e.target.files || [])[0];
    e.target.value = '';        // so the same photo can be chosen twice
    if (!f) return;
    const slot = slotRef.current;
    setBusy(slot);
    setErr('');
    try {
      const shrunk = await compressImage(f);
      onChange(slots.map((x, i) => (i === slot - 1 ? shrunk : x)));
    } catch {
      setErr(t('mt.photoFailed'));
    }
    setBusy(0);
  }

  const drop = (slot) => onChange(slots.map((x, i) => (i === slot - 1 ? null : x)));

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5">
        {slots.map((src, i) => {
          const slot = i + 1;
          return (
            <div key={slot}
              onClick={() => !src && busy !== slot && setPicking(slot)}
              className={`relative aspect-square rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 transition-colors ${
                src ? 'border-2 border-slate-200'
                    : 'border-2 border-dashed border-emerald-200 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50 cursor-pointer'}`}>
              {src ? (
                <>
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  <button type="button" onClick={(e) => { e.stopPropagation(); drop(slot); }}
                    className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-black/55 text-white text-[13px] font-black leading-none flex items-center justify-center">×</button>
                </>
              ) : busy === slot ? (
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1 text-center">
                  {busyLabel || t('mt.shrinking')}
                </span>
              ) : (
                <>
                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white text-[11px] font-black flex items-center justify-center">
                    {slot}
                  </span>
                  <CameraIcon className="w-[22px] h-[22px] text-slate-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('mt.photoN', { n: slot })}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment"
             className="hidden" onChange={picked} />
      <input ref={fileRef} type="file" accept="image/*"
             className="hidden" onChange={picked} />

      <p className="text-[11px] font-bold text-slate-400 text-center mt-2">
        {err
          ? <span className="text-amber-700">{err}</span>
          : taken.length
            ? t('mt.photoSize', { kb: numText(Math.round(bytes / 1024)) })
            : t('mt.photoOptional')}
      </p>

      {/* Camera or gallery. Fixed to the viewport rather than to the sheet:
          the sheet scrolls, and a chooser that scrolls away with it is a
          chooser nobody can reach. */}
      {picking > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/45 flex items-end justify-center"
             onClick={() => setPicking(0)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl p-4 pb-7"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[14px] font-black text-slate-800 text-center mb-4">
              {t('mt.photoN', { n: picking })}
            </div>
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <button type="button" onClick={() => choose(picking, true)}
                className="h-16 rounded-2xl bg-emerald-700 text-white font-black text-[12px] uppercase tracking-wider flex flex-col items-center justify-center gap-1">
                <CameraIcon className="w-6 h-6" /> {t('mt.camera')}
              </button>
              <button type="button" onClick={() => choose(picking, false)}
                className="h-16 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 font-black text-[12px] uppercase tracking-wider flex flex-col items-center justify-center gap-1">
                <GalleryIcon className="w-6 h-6" /> {t('mt.gallery')}
              </button>
            </div>
            <button type="button" onClick={() => setPicking(0)}
              className="w-full h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 font-black text-[12px] uppercase tracking-wider">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

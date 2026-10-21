/*
 * "Who did this work" — the tick list on a Field Conductor's record form.
 *
 * Workers record their own mornings from the 555 Worker Portal, and on a good
 * day a conductor never opens this. It is for the other days: a phone that
 * will not charge, a PIN that will not take, somebody who left theirs at
 * home. The conductor keys the job and ticks whose it was, and the record
 * says Ali did the work while still remembering the conductor wrote it down.
 *
 * Left untouched, nothing is claimed and the record reads as the conductor's
 * own — which is right, because sometimes he did do it himself.
 *
 * Names come from the payroll register, the same roster the Worker Portal
 * signs people in against, so a name ticked here and a name a worker records
 * under themselves are the same string.
 */

import Icon from '../../components/Icon.jsx';

export default function WhoDidIt({ workers, value, onChange, t }) {
  if (!workers || !workers.length) return null;

  const picked = value || [];
  const toggle = (name) =>
    onChange(picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);

  return (
    <div className="mb-3">
      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
        {t('mt.whoDidIt')}
      </label>
      <div className="text-[11px] font-semibold text-slate-400 mb-2 leading-snug">
        {picked.length ? t('mt.whoDidItPicked', { n: picked.length }) : t('mt.whoDidItHint')}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {workers.map((w) => {
          const on = picked.includes(w.full_name);
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => toggle(w.full_name)}
              className={`px-2.5 py-1.5 rounded-lg border text-[12px] font-bold transition-colors cursor-pointer ${
                on
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {on && <Icon name="check" className="w-3 h-3 inline-block mr-1" />}
              {w.full_name}
            </button>
          );
        })}
      </div>

      {picked.length > 1 && (
        <div className="text-[11px] font-semibold text-slate-400 mt-2">
          {t('mt.whoDidItShared')}
        </div>
      )}
    </div>
  );
}

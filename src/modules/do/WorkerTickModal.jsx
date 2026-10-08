import { useLang } from '../../context/LanguageContext.jsx';

/* "Who Loaded This DO" — one toggle-button section per nursery the DO's
   items touch, same picker style as WhoDidIt.jsx. Rendered by both the DO
   module (after a manual/AI-scan save, and from a DO row's Workers button)
   and the scan module (after Issue DO). state comes from useWorkerTick(). */
export default function WorkerTickModal({ wt, staffName }) {
  const { t, lang } = useLang();
  if (!wt.wtOpen || !wt.wtDO) return null;

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return iso;
    }
  };

  return (
    <div className="modal-overlay open" onClick={() => !wt.wtSaving && wt.skipWorkerTick()}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 rounded-t-[24px] flex justify-between items-start" style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }}>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
              {wt.wtDO.do_number}
            </div>
            <div className="text-lg font-black text-white">{t('do.whoLoadedTitle')}</div>
          </div>
          <button
            onClick={() => !wt.wtSaving && wt.skipWorkerTick()}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center shrink-0 ml-4"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] font-semibold text-slate-400 leading-snug">{t('do.whoLoadedHint')}</p>

          {wt.wtLocked && (
            <div className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {t('do.whoLoadedLocked', { by: wt.wtDO.worked_by_locked_by || '—', date: fmtDate(wt.wtDO.worked_by_locked_at) })}
            </div>
          )}

          {!wt.wtNurseries.length ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🌱</div>
              <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">{t('do.whoLoadedNoNurseries')}</div>
            </div>
          ) : (
            wt.wtNurseries.map((key) => {
              const workers = wt.byNursery[key] || [];
              const picked = wt.wtPicked[key] || [];
              return (
                <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{key}</span>
                    <span className="text-[10px] font-bold text-slate-400">
                      {picked.length ? t('do.workersTicked') + ' · ' + picked.length : t('do.workersNotTicked')}
                    </span>
                  </div>
                  {!workers.length ? (
                    <div className="text-[11px] font-semibold text-slate-400">—</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {workers.map((w) => {
                        const on = picked.includes(w.full_name);
                        return (
                          <button
                            key={w.id}
                            type="button"
                            disabled={wt.wtLocked}
                            onClick={() => wt.toggleWorkerPick(key, w.full_name)}
                            className={`px-2.5 py-1.5 rounded-lg border text-[12px] font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                              on
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {on && <span className="mr-1" aria-hidden="true">✓</span>}
                            {w.full_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3 justify-end border-t border-slate-100 pt-4">
          <button
            onClick={() => wt.skipWorkerTick()}
            disabled={wt.wtSaving}
            className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer disabled:opacity-50"
          >
            {t('do.skipForNow')}
          </button>
          {!wt.wtLocked && (
            <button
              onClick={() => wt.saveWorkerTick(staffName)}
              disabled={wt.wtSaving}
              className="text-[10px] font-black text-white uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 px-7 py-3 rounded-xl border-none cursor-pointer disabled:opacity-60"
            >
              {wt.wtSaving ? t('do.savingWorkers') : t('do.saveWorkers')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

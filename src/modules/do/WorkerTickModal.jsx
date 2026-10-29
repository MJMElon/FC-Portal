import { useLang } from '../../context/LanguageContext.jsx';
import Icon from '../../components/Icon.jsx';
import { customerOfDO, itemsFromRecord } from './data.js';
import { numText } from '../../lib/numberText.js';

/* "Who Loaded This DO" — one toggle-button section per nursery the DO's
   items touch, same picker style as WhoDidIt.jsx. Rendered by both the DO
   module (after a manual/AI-scan save, and from a DO row's Workers button)
   and the scan module (after Issue DO). state comes from useWorkerTick(). */
export default function WorkerTickModal({ wt, staffName }) {
  const { t, lang } = useLang();
  if (!wt.wtOpen || !wt.wtDO) return null;

  const lines = itemsFromRecord(wt.wtDO, wt.wtPlotMap || {});
  const total = Number(wt.wtDO.total_qty) || lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

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
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* WHAT THIS DO IS, where the question about it is being asked.

              The popup carried a DO number and nothing else, and a DO number
              is not a thing anybody recognises — the person ticking has to
              know WHICH delivery, off WHICH plot, of HOW MANY, to know which
              gang carried it. All three were one screen behind this one.

              The quantity is the DO's OWN total where it has one, not the sum
              of the lines: that figure is what the paper says, and a total
              worked out here could differ from the one on the row this popup
              was opened from. */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {t('do.customerNameLabel')}
            </div>
            <div className="text-sm font-black text-slate-800 break-words">
              {customerOfDO(wt.wtDO) || '—'}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
              {lines.length ? lines.map((l, i) => (
                <div key={i} className="flex justify-between items-baseline gap-3">
                  <span className="text-[12px] font-bold text-slate-600 truncate">
                    {l.plot || '—'}
                    {l.nursery && l.nursery !== l.plot && l.nursery !== '—' && (
                      <span className="ml-1.5 text-[10px] font-bold text-slate-400">{l.nursery}</span>
                    )}
                  </span>
                  <span className="font-mono text-[12px] font-black text-slate-800 shrink-0">
                    {l.qty ? numText(l.qty) : '—'}
                  </span>
                </div>
              )) : (
                <div className="text-[12px] font-bold text-slate-400">{t('do.whoLoadedNoPlots')}</div>
              )}
              <div className="flex justify-between items-baseline gap-3 pt-1 border-t border-slate-200">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {t('do.whoLoadedTotal')}
                </span>
                <span className="font-mono text-sm font-black text-slate-900 shrink-0">
                  {total ? numText(total) : '—'}
                </span>
              </div>
            </div>
          </div>

          <p className="text-[11px] font-semibold text-slate-400 leading-snug">{t('do.whoLoadedHint')}</p>

          {wt.wtLocked && (
            <div className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {t('do.whoLoadedLocked', { by: wt.wtDO.worked_by_locked_by || '—', date: fmtDate(wt.wtDO.worked_by_locked_at) })}
            </div>
          )}

          {!wt.wtNurseries.length && !wt.wtOtherNurseries.length ? (
            <div className="text-center py-8">
              <Icon name="seedling" className="w-9 h-9 mx-auto mb-2 text-slate-400" />
              <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">{t('do.whoLoadedNoNurseries')}</div>
            </div>
          ) : (
            wt.wtNurseries.map((key) => {
              const workers = wt.byNursery[key] || [];
              const picked = wt.wtPicked[key] || [];
              const own = wt.wtOwn.includes(key);
              return (
                <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {key}
                      {!own && (
                        <span className="ml-2 text-[9px] font-bold text-slate-400 normal-case tracking-normal">
                          {t('do.whoLoadedAddedByHand')}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400">
                        {picked.length ? t('do.workersTicked') + ' · ' + picked.length : t('do.workersNotTicked')}
                      </span>
                      {!own && !wt.wtLocked && (
                        <button
                          type="button"
                          title={t('do.whoLoadedRemoveNursery')}
                          onClick={() => wt.removeNursery(key)}
                          className="w-5 h-5 rounded-md bg-white border border-slate-200 text-slate-400 hover:text-slate-700 text-[11px] font-black leading-none flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="close" className="w-3 h-3" />
                        </button>
                      )}
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
                            {on && <Icon name="check" className="w-3 h-3 inline-block mr-1" />}
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

          {/* ANOTHER NURSERY'S GANG. The seedlings stood in one nursery and
              were loaded by another often enough that it cannot be an
              edit-the-record job: every other nursery with workers on the
              roster is one tap away, and tapping one opens its own list of
              names underneath the DO's. */}
          {!wt.wtLocked && wt.wtOtherNurseries.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-bold text-slate-400 mb-2">{t('do.whoLoadedOther')}</div>
              <div className="flex flex-wrap gap-1.5">
                {wt.wtOtherNurseries.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => wt.addNursery(key)}
                    className="px-3 py-1.5 rounded-lg border border-dashed border-slate-300 bg-white text-[12px] font-black text-slate-500 uppercase tracking-widest hover:border-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    + {key}
                  </button>
                ))}
              </div>
            </div>
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

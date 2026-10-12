import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TopNav from '../../components/TopNav.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import { useAutoSync } from '../../hooks/useOnline.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { AI_SCAN_ENABLED } from '../../config.js';
import { printDO } from '../../lib/pdf.js';
import { compressImage } from '../../lib/gemini.js';
import {
  loadActiveALs,
  loadConsentALSet,
  loadDropdownData,
  loadDOWorkers,
  persistDO,
  flushDOQueue,
} from './data.js';
import { useWorkerTick } from './useWorkerTick.js';
import ManageModal from './ManageModal.jsx';
import EntryModal from './EntryModal.jsx';
import WorkerTickModal from './WorkerTickModal.jsx';

export default function DoModule() {
  const { staffName } = useAuth();
  const { t } = useLang();
  // Seed from cache so the order list shows instantly and works offline.
  const [als, setAls] = useState(() => cacheGet('do_als')?.value || null);
  const [consentSet, setConsentSet] = useState(() => new Set(cacheGet('do_consentAls')?.value || []));
  const [plots, setPlots] = useState(() => cacheGet('do_plots')?.value || []);
  const [breeds, setBreeds] = useState(() => cacheGet('do_breeds')?.value || []);
  const [workers, setWorkers] = useState(() => cacheGet('do_workers')?.value || []);
  const wt = useWorkerTick(workers);
  const plotMap = {};
  plots.forEach((p) => { plotMap[p.plot_name] = p.nursery_name; });
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [manageAL, setManageAL] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [choiceAL, setChoiceAL] = useState(null);
  const [entry, setEntry] = useState(null);
  const [printPrompt, setPrintPrompt] = useState(null);
  const cameraRef = useRef(null);

  // When arriving from the scanner's "Issue DO" (/do?al=...), focus that order:
  // pre-fill the search and open its Manage DOs panel once the list is loaded.
  const [searchParams] = useSearchParams();
  const alParam = searchParams.get('al');
  const handledParamRef = useRef(false);
  useEffect(() => {
    if (!alParam || handledParamRef.current || !als) return;
    handledParamRef.current = true;
    setQuery(alParam);
    const found = als.find((r) => r.al_number === alParam);
    if (found) setManageAL(found);
  }, [alParam, als]);

  const flash = (text) => {
    setToast(text);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setToast(null), 3000);
  };

  async function reload() {
    if (!navigator.onLine) {
      // Offline: fall back to cached data, no error.
      const c = cacheGet('do_als');
      if (c) setAls(c.value);
      setError(null);
      return;
    }
    try {
      const [data, set] = await Promise.all([loadActiveALs(), loadConsentALSet()]);
      setAls(data);
      setConsentSet(set);
      setError(null);
      cacheSet('do_als', data);
      cacheSet('do_consentAls', [...set]);
    } catch (e) {
      // Network blip — keep whatever (cached) data we already have.
      if (!als) {
        const c = cacheGet('do_als');
        setAls(c?.value || []);
      }
    }
  }

  // Refresh data + flush any offline DOs roughly every minute (and on reconnect).
  useAutoSync(async () => {
    const res = await flushDOQueue();
    if (res.synced > 0) flash(t('do.doSavedToast', { do: res.synced + '×' }));
    await reload();
    loadDropdownData()
      .then(({ plots, breeds }) => {
        setPlots(plots);
        setBreeds(breeds);
        cacheSet('do_plots', plots);
        cacheSet('do_breeds', breeds);
      })
      .catch(() => {});
    loadDOWorkers()
      .then((rows) => { setWorkers(rows); cacheSet('do_workers', rows); })
      .catch(() => {});
  }, 60000);

  // Online insert, falling back to the offline queue on no-network / failure.
  async function submitDO({ payload, photoBase64, al, sigDataUrl }) {
    const res = await persistDO({ payload, photoBase64, al, sigDataUrl, staff: staffName });
    if (res.queued) {
      // Optimistically reflect the deducted balance in the cached list.
      setAls((prev) => {
        if (!prev) return prev;
        const next = prev.map((r) =>
          r.al_number === al.al_number
            ? { ...r, balance_quantity: (r.balance_quantity ?? 0) - (payload.total_qty || 0) }
            : r
        );
        cacheSet('do_als', next);
        return next;
      });
    }
    return res;
  }

  const lower = query.trim().toLowerCase();
  const groups = (() => {
    if (!als) return [];
    const matched = [], signed = [], pending = [];
    als.forEach((r) => {
      const isMatch = lower.length >= 1 && (
        (r.al_number || '').toLowerCase().includes(lower) ||
        (r.order_number || '').toLowerCase().includes(lower) ||
        (r.customer_name || '').toLowerCase().includes(lower)
      );
      if (isMatch) matched.push(r);
      else if (consentSet.has(r.al_number)) signed.push(r);
      else pending.push(r);
    });
    const g = [];
    if (lower.length >= 1 && matched.length) g.push({ key: 'match', label: t('do.groupMatch'), rows: matched, theme: 'amber' });
    if (signed.length) g.push({ key: 'signed', label: t('do.groupSigned'), rows: signed, theme: 'emerald' });
    if (pending.length) g.push({ key: 'pending', label: t('do.groupPending'), rows: pending, theme: 'blue' });
    return g;
  })();

  const themeMap = {
    amber: { head: 'bg-amber-50 text-amber-700 border-amber-200', bal: 'text-amber-700' },
    emerald: { head: 'bg-emerald-50 text-emerald-700 border-emerald-200', bal: 'text-emerald-700' },
    blue: { head: 'bg-blue-50 text-blue-700 border-blue-200', bal: 'text-blue-700' },
  };

  function openChoice(al) {
    if (AI_SCAN_ENABLED) setChoiceAL(al);
    else setEntry({ al, photoBase64: null });
  }

  async function onCameraFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const al = choiceAL;
    setChoiceAL(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = await compressImage(ev.target.result);
      setEntry({ al, photoBase64: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function onSaved(payload, sigDataUrl, queued, photoBase64, savedRow) {
    setEntry(null);
    flash(queued ? t('do.savedOffline') : t('do.doSavedToast', { do: payload.do_number }));
    reload();
    setRefreshToken((x) => x + 1);
    const al = (als || []).find((r) => r.al_number === payload.al_number);
    if (al) setManageAL(al);
    const printJob = { payload, sigDataUrl, photoBase64 };
    // A queued (offline) save has no server row yet to tick workers
    // against, so it keeps the old flow straight to the print prompt — the
    // row's own Workers button picks it up once the DO has actually synced.
    if (!queued && savedRow) {
      wt.openWorkerTick(savedRow, plotMap, () => setPrintPrompt(printJob));
    } else {
      setTimeout(() => setPrintPrompt(printJob), 300);
    }
  }

  function doPrint(doRec, sigDataUrl = null, photoBase64 = null) {
    const al = (als || []).find((r) => r.al_number === doRec.al_number) || manageAL || {};
    printDO(doRec, al, staffName, sigDataUrl, photoBase64);
    flash(t('do.printedToast', { do: doRec.do_number }));
  }

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      <TopNav title={t('do.headerTitle')} back="/dashboard" user={staffName} />
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="dash-card bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] p-5 sm:p-6">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('do.searchLabel')}</div>
          <div className="flex gap-3 mb-5">
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="search-input" placeholder={t('do.searchPlaceholder')} />
          </div>

          <div className="flex flex-wrap gap-3 mb-5">
            <Legend color="bg-amber-400" text={t('do.legendMatch')} tone="text-amber-700" />
            <Legend color="bg-emerald-500" text={t('do.legendSigned')} tone="text-emerald-700" />
            <Legend color="bg-blue-400" text={t('do.legendPending')} tone="text-blue-700" />
          </div>

          {error && <div className="text-center py-4 text-red-400 text-xs font-bold">{error}</div>}

          {als === null ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📭</div>
              <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">{t('do.noALs')}</div>
            </div>
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden sm:block rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>{t('do.colAL')}</th><th>{t('do.colOrder')}</th><th>{t('do.colCustomer')}</th><th>{t('do.colQtyOrdered')}</th><th>{t('do.colBalance')}</th><th>{t('do.colAction')}</th></tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const tm = themeMap[g.theme];
                      return (
                        <FragmentRows
                          key={g.key}
                          label={`${g.label} (${g.rows.length})`}
                          headClass={tm.head}
                          balClass={tm.bal}
                          rows={g.rows}
                          manageLabel={t('do.manageDOs')}
                          onManage={(al) => setManageAL(al)}
                          onCamera={(al) => openChoice(al)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile: cards (the table columns don't fit a phone) */}
              <div className="sm:hidden space-y-4">
                {groups.map((g) => {
                  const tm = themeMap[g.theme];
                  return (
                    <div key={g.key}>
                      <div className={`text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border mb-2 ${tm.head}`}>
                        {g.label} ({g.rows.length})
                      </div>
                      <div className="space-y-2">
                        {g.rows.map((r) => (
                          <div key={r.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                            <div className="font-black text-slate-800">{r.al_number || '—'}</div>
                            <div className="text-sm font-bold text-slate-600 mt-0.5 break-words">{r.customer_name || '—'}</div>
                            <div className="text-[11px] font-bold text-slate-400 mt-2 leading-relaxed">
                              📋 {t('do.colOrder')}: <span className="text-slate-600">{r.order_number || '—'}</span><br />
                              {t('do.colQtyOrdered')}: <span className="text-slate-600">{r.quantity_ordered ?? '—'}</span> &nbsp;·&nbsp;
                              {t('do.colBalance')}: <span className={`font-black ${tm.bal}`}>{r.balance_quantity ?? '—'}</span>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <button onClick={() => setManageAL(r)} className="btn-open flex-1 text-center">{t('do.manageDOs')}</button>
                              <button onClick={() => openChoice(r)} title="Add DO" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white border-none cursor-pointer">📷</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {manageAL && (
        <ManageModal
          al={manageAL}
          plots={plots}
          refreshToken={refreshToken}
          onAddDO={() => openChoice(manageAL)}
          onPrint={(doRec) => doPrint(doRec)}
          onManageWorkers={(doRec) => wt.openWorkerTick(doRec, plotMap)}
          onClose={() => setManageAL(null)}
        />
      )}

      <WorkerTickModal wt={wt} staffName={staffName} />

      {choiceAL && (
        <div className="modal-overlay open" onClick={() => setChoiceAL(null)}>
          <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl mb-2">📋</div>
            <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">{t('do.addNewDO')}</div>
            <div className="text-xs font-bold text-slate-400 mb-1">{choiceAL.al_number} · {choiceAL.customer_name}</div>
            <div className="text-[11px] font-bold text-slate-300 mb-6">{t('do.orderLabel', { x: choiceAL.order_number || '—' })}</div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <button onClick={() => cameraRef.current?.click()} className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 hover:border-blue-500 transition-all cursor-pointer">
                <span className="text-3xl">📷</span>
                <span className="text-[11px] font-black text-blue-700 uppercase tracking-wide">{t('do.takePhoto')}<br /><span className="text-[9px] font-bold text-blue-400 normal-case">{t('do.aiScanDoc')}</span></span>
              </button>
              <button onClick={() => { const al = choiceAL; setChoiceAL(null); setEntry({ al, photoBase64: null }); }} className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border-2 border-slate-200 hover:border-slate-400 transition-all cursor-pointer">
                <span className="text-3xl">✏️</span>
                <span className="text-[11px] font-black text-slate-600 uppercase tracking-wide">{t('do.keyInManually')}<br /><span className="text-[9px] font-bold text-slate-400 normal-case">{t('do.fillFormDirectly')}</span></span>
              </button>
            </div>
            <button onClick={() => setChoiceAL(null)} className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest cursor-pointer border-none bg-transparent">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {entry && (
        <EntryModal
          al={entry.al}
          plots={plots}
          breeds={breeds}
          photoBase64={entry.photoBase64}
          toast={flash}
          onSubmit={submitDO}
          onSaved={onSaved}
          onClose={() => setEntry(null)}
        />
      )}

      {printPrompt && (
        <div className="modal-overlay open" onClick={() => setPrintPrompt(null)}>
          <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">🖨️</div>
            <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">{t('do.doSavedTitle')}</div>
            <div className="text-sm font-bold text-slate-500 mb-1">{printPrompt.payload.do_number}</div>
            <div className="text-xs font-bold text-slate-400 mb-6">{t('do.printPrompt')}</div>
            <div className="flex flex-col gap-3">
              <button onClick={() => { doPrint(printPrompt.payload, printPrompt.sigDataUrl, printPrompt.photoBase64); setPrintPrompt(null); }} className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer">{t('do.yesPrint')}</button>
              <button onClick={() => setPrintPrompt(null)} className="w-full py-2.5 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">{t('do.maybeLater')}</button>
            </div>
          </div>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onCameraFile} />

      {toast && (
        <div className="fixed bottom-6 right-6 text-white px-5 py-3.5 rounded-xl text-[13px] font-bold z-[999] shadow-lg flex items-center gap-2" style={{ background: 'linear-gradient(135deg,#064e3b,#10b981)' }}>
          ✅ {toast}
        </div>
      )}
    </div>
  );
}

function Legend({ color, text, tone }) {
  return (
    <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${tone}`}>
      <span className={`w-3 h-3 rounded ${color} inline-block`} />
      {text}
    </span>
  );
}

function FragmentRows({ label, headClass, balClass, rows, manageLabel, onManage, onCamera }) {
  return (
    <>
      <tr><td colSpan={6} className={`py-2 px-4 text-[9px] font-black uppercase tracking-widest border-b ${headClass}`}>{label}</td></tr>
      {rows.map((r) => (
        <tr key={r.id}>
          <td><span className="font-black text-slate-800">{r.al_number || '—'}</span></td>
          <td>{r.order_number || '—'}</td>
          <td>{r.customer_name || '—'}</td>
          <td>{r.quantity_ordered ?? '—'}</td>
          <td><span className={`font-black ${balClass}`}>{r.balance_quantity ?? '—'}</span></td>
          <td className="whitespace-nowrap">
            <button onClick={() => onManage(r)} className="btn-open mr-1">{manageLabel}</button>
            <button onClick={() => onCamera(r)} title="Add DO" className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white border-none cursor-pointer align-middle">📷</button>
          </td>
        </tr>
      ))}
    </>
  );
}

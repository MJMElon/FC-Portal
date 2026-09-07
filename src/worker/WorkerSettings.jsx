import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';
import { MAINT_FUNCTIONS, MAINT_FUNCTION_DEFAULT } from '../modules/maintenance/functions.js';
import { useWorker } from './WorkerAuthContext.jsx';
import * as api from './workerApi.js';
import WorkerNav from './WorkerNav.jsx';

/*
 * Worker Portal → Settings. Two sections, as asked for:
 *
 *   USER ACCESS      which workers may open which parts of the portal
 *   BOUNDARY SETTING which ground each worker may record work on
 *
 * Both are per worker, both are saved onto that worker's own row, and both
 * are enforced in the database rather than here — worker_set_portal() and
 * worker_plots() in shared/create_worker_portal.sql. This screen is the way
 * the answer is written down, not the thing that makes it true.
 *
 * A worker with no boundary set is bounded to the nursery on their Payroll
 * row. That is the default, it is shown as such, and it is why most workers
 * never need touching here at all.
 */
/* What each switch means when nobody has said — the one list, not a second
   opinion of it. `record` used to be spelt out here because the shared table
   did not name it; it does now, for the same reason this screen needed it. */
const DEFAULT_FN = MAINT_FUNCTION_DEFAULT;

export default function WorkerSettings() {
  const { t } = useLang();
  const { token, worker, refresh } = useWorker();

  const [rows, setRows] = useState([]);
  const [plots, setPlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);   // worker id being edited
  const [draft, setDraft] = useState(null); // the portal JSON being edited
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.roster(token), api.plots(token)])
      .then(([r, p]) => {
        if (!alive) return;
        setRows(r);
        setPlots(p);
        setErr(null);
      })
      .catch((e) => alive && setErr((e && e.message) || 'Could not load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  /* Every nursery this supervisor can see, to offer as boundary ticks. They
     cannot hand out ground they do not hold themselves. */
  const nurseries = useMemo(() => {
    const seen = [];
    plots.forEach((p) => {
      if (p.nursery_name && seen.indexOf(p.nursery_name) === -1) seen.push(p.nursery_name);
    });
    return seen;
  }, [plots]);

  const plotsIn = (nurseryList) =>
    plots
      .filter((p) => !nurseryList || nurseryList.length === 0 || nurseryList.indexOf(p.nursery_name) !== -1)
      .map((p) => p.plot_name);

  function startEdit(row) {
    setOpen(row.id === open ? null : row.id);
    setSaved(null);
    setErr(null);
    // A copy, so cancelling really does cancel.
    setDraft(row.id === open ? null : JSON.parse(JSON.stringify(row.portal || {})));
  }

  function setModule(key, on) {
    setDraft((d) => ({ ...d, modules: { ...(d.modules || {}), [key]: on } }));
  }

  /* ── The functions inside Maintenance ──
     The same switches, with the same keys and the same defaults, that the
     office sets per Field Conductor on ai.mjmnursery.com → 555 Worker Portal
     Manage → Setting. One list, in modules/maintenance/functions.js.

     Absent is left absent rather than written as `true`: the default lives in
     one place, and a row full of ticks written out here would freeze today's
     defaults onto every worker who was ever opened in this screen. */
  const fnOn = (d, key) => {
    const v = (((d && d.actions) || {}).maintenance || {})[key];
    return v === undefined ? DEFAULT_FN[key] === true : !!v;
  };

  function setFn(key, on) {
    setDraft((d) => ({
      ...d,
      actions: {
        ...(d.actions || {}),
        maintenance: { ...((d.actions || {}).maintenance || {}), [key]: on },
      },
    }));
  }

  /* null ⇄ array. "Everything" is a real state, distinct from a list that
     happens to name everything today: a nursery added next month is inside
     an "everything" boundary and outside a list. */
  function setNurseryAll(all) {
    setDraft((d) => ({
      ...d,
      boundary: { ...(d.boundary || {}), nurseries: all ? null : [] },
    }));
  }

  function toggleNursery(name) {
    setDraft((d) => {
      const cur = (d.boundary && d.boundary.nurseries) || [];
      const list = Array.isArray(cur) ? cur : [];
      const next = list.indexOf(name) === -1 ? [...list, name] : list.filter((n) => n !== name);
      return { ...d, boundary: { ...(d.boundary || {}), nurseries: next } };
    });
  }

  function setPlotAll(all) {
    setDraft((d) => ({
      ...d,
      boundary: { ...(d.boundary || {}), plots: all ? null : [] },
    }));
  }

  function togglePlot(name) {
    setDraft((d) => {
      const cur = (d.boundary && d.boundary.plots) || [];
      const list = Array.isArray(cur) ? cur : [];
      const next = list.indexOf(name) === -1 ? [...list, name] : list.filter((n) => n !== name);
      return { ...d, boundary: { ...(d.boundary || {}), plots: next } };
    });
  }

  async function save(row) {
    setBusy(true);
    setErr(null);
    try {
      const fresh = await api.setPortal(token, row.id, draft);
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, portal: fresh } : r)));
      setSaved(row.id);
      setOpen(null);
      setDraft(null);
      // Changing your own access has to take effect on your own screen.
      if (worker && row.id === worker.id) await refresh();
    } catch (e) {
      setErr((e && e.message) || t('wk.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const chip = 'px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border';
  const tick = (on) =>
    `px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
      on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
    }`;
  const head = 'text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-2';

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      <WorkerNav title={t('wk.settingsTitle')} back="/worker" />

      <div className="max-w-[900px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {err && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 text-[13px] font-semibold text-red-800">
            {err}
          </div>
        )}

        {loading ? (
          <div className="text-center py-10 text-[12px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">
            {t('common.loading')}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em]">
                {t('wk.userAccess')}
              </div>
              <div className="text-[11px] font-semibold text-slate-400 mt-1">
                {t('wk.userAccessHelp')}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {rows.map((row) => {
                const p = row.portal || {};
                const mods = p.modules || {};
                const editing = open === row.id;
                const d = editing ? draft || {} : null;
                const dNur = d && d.boundary ? d.boundary.nurseries : undefined;
                const dPlot = d && d.boundary ? d.boundary.plots : undefined;

                return (
                  <div key={row.id} className={editing ? 'bg-slate-50' : ''}>
                    <button
                      onClick={() => startEdit(row)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-black text-slate-800 truncate">
                          {row.name}
                          {!row.has_pin && (
                            <span className="ml-2 text-[10px] font-black text-amber-700 uppercase tracking-wider">
                              {t('wk.noPin')}
                            </span>
                          )}
                          {saved === row.id && (
                            <span className="ml-2 text-[10px] font-black text-emerald-600 uppercase tracking-wider">
                              {t('wk.savedTick')}
                            </span>
                          )}
                        </div>
                        {/* Nursery, then the boundary — but only when the
                            boundary says something the nursery did not. The
                            default boundary IS the worker's own nursery, so
                            most rows would otherwise read "BNN · BNN". */}
                        <div className="text-[11px] font-semibold text-slate-400 truncate">
                          {(() => {
                            const bound = api.describeBoundary(p.boundary, t);
                            const nursery = row.nursery || '—';
                            return bound === nursery ? nursery : `${nursery} · ${bound}`;
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {mods.maintenance && (
                          <span className={`${chip} bg-teal-50 border-teal-200 text-teal-700`}>
                            {t('wk.modMaint')}
                          </span>
                        )}
                        {mods.settings && (
                          <span className={`${chip} bg-slate-100 border-slate-300 text-slate-600`}>
                            {t('wk.modSettings')}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-300 font-black shrink-0">{editing ? '⌄' : '›'}</div>
                    </button>

                    {editing && (
                      <div className="px-4 pb-4">
                        {/* ── User access ── */}
                        <div className={head}>{t('wk.modulesFor', { name: row.name })}</div>
                        <div className="flex gap-2 mb-4 flex-wrap">
                          <button
                            onClick={() => setModule('maintenance', !(d.modules || {}).maintenance)}
                            className={tick(!!(d.modules || {}).maintenance)}
                          >
                            🛠️ {t('wk.modMaint')}
                          </button>
                          <button
                            onClick={() => setModule('settings', !(d.modules || {}).settings)}
                            className={tick(!!(d.modules || {}).settings)}
                          >
                            ⚙️ {t('wk.modSettings')}
                          </button>
                        </div>

                        {/* ── What they may do inside Maintenance ──
                            Only while Maintenance itself is open to them: a
                            list of functions under a module that is switched
                            off is a list of settings with nothing to govern. */}
                        {!!(d.modules || {}).maintenance && (
                          <>
                            <div className={head}>{t('wk.fnTitle')}</div>
                            <div className="mb-4 space-y-2">
                              {MAINT_FUNCTIONS.map((fn) => (
                                <div key={fn.key}>
                                  <button onClick={() => setFn(fn.key, !fnOn(d, fn.key))}
                                          className={tick(fnOn(d, fn.key))}>
                                    {fn.icon} {t(fn.label)}
                                  </button>

                                  {/* The record form's own parts, indented
                                      under it and only while it is on. */}
                                  {!!fn.children && fnOn(d, fn.key) && (
                                    <div className="flex gap-2 flex-wrap mt-2 ml-4 pl-3 border-l-2 border-slate-200">
                                      {/* Every one of them settable. Which a
                                          worker gets is the office's call, so
                                          nothing is withheld here — and any
                                          switch stored ahead of being acted on
                                          says so, rather than being discovered
                                          on a phone in a plot. Photos was the
                                          last of those and is not any more. */}
                                      {fn.children.map((sub) => (
                                        <button key={sub.key}
                                                title={sub.notYet ? t('wk.fnNotYet') : undefined}
                                                onClick={() => setFn(sub.key, !fnOn(d, sub.key))}
                                                className={`${tick(fnOn(d, sub.key))} ${
                                                  sub.notYet && fnOn(d, sub.key)
                                                    ? '!bg-amber-500 !border-amber-500' : ''}`}>
                                          {sub.icon} {t(sub.label)}
                                          {sub.notYet && <span className="ml-1 opacity-70">*</span>}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {/* The line explaining the asterisk, shown only
                                while there is an asterisk to explain. With
                                nothing marked it was a footnote about a mark
                                that appears nowhere on the screen — furniture
                                that reads as a warning. */}
                            {MAINT_FUNCTIONS.some((f) => (f.children || []).some((c) => c.notYet)) && (
                              <div className="text-[11px] font-semibold text-slate-400 mb-4 -mt-2">
                                {t('wk.fnNotYetHint')}
                              </div>
                            )}
                          </>
                        )}

                        {/* ── Boundary setting ── */}
                        <div className={head}>{t('wk.boundarySetting')}</div>
                        <div className="text-[11px] font-semibold text-slate-400 mb-2.5 -mt-1">
                          {t('wk.boundaryHelp')}
                        </div>

                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                          {t('wk.nurseries')}
                        </div>
                        <div className="flex gap-2 mb-3.5 flex-wrap">
                          <button onClick={() => setNurseryAll(true)} className={tick(api.boundaryAll(dNur))}>
                            {t('wk.allNurseries')}
                          </button>
                          {nurseries.map((n) => (
                            <button
                              key={n}
                              onClick={() => toggleNursery(n)}
                              className={tick(Array.isArray(dNur) && dNur.indexOf(n) !== -1)}
                            >
                              {n}
                            </button>
                          ))}
                        </div>

                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                          {t('wk.plotsLabel')}
                        </div>
                        <div className="flex gap-2 mb-4 flex-wrap max-h-52 overflow-y-auto">
                          <button onClick={() => setPlotAll(true)} className={tick(api.boundaryAll(dPlot))}>
                            {t('wk.allPlots')}
                          </button>
                          {plotsIn(Array.isArray(dNur) ? dNur : null).map((pn) => (
                            <button
                              key={pn}
                              onClick={() => togglePlot(pn)}
                              className={tick(Array.isArray(dPlot) && dPlot.indexOf(pn) !== -1)}
                            >
                              {pn}
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => save(row)}
                            disabled={busy}
                            className="flex-1 h-11 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-[12px] font-black uppercase tracking-[0.15em] cursor-pointer transition-colors"
                          >
                            {busy ? t('wk.saving') : t('wk.save')}
                          </button>
                          <button
                            onClick={() => {
                              setOpen(null);
                              setDraft(null);
                            }}
                            className="px-5 h-11 rounded-xl bg-white border border-slate-200 text-slate-600 text-[12px] font-black uppercase tracking-[0.15em] cursor-pointer hover:border-slate-300 transition-colors"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-[11px] font-semibold text-slate-400 mt-4 leading-relaxed">
          {t('wk.pinNote')}
        </div>
      </div>
    </div>
  );
}

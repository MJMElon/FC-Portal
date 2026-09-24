import { useEffect, useMemo, useState } from 'react';
import CfSelect from '../../components/CfSelect.jsx';
import PlotAreaEditor from './PlotAreaEditor.jsx';
import { fetchPlotMaps, loadCachedMaps, weightsFromDividers } from './plotMaps.js';
import {
  ACTIVITIES,
  NURSERIES,
  activityByN,
  applySettings,
  carryLogsToAreas,
  plotPhoto,
  plotsOf,
  saveDB,
} from './data.js';
import { AREA_LETTERS, defaultSettings, loadSettings, readImageScaled, saveSettings } from './settings.js';

// Settings — the two things that used to need a code change: how a plot is
// divided into areas, and when a plot starts needing attention.
//
// Both used to be on screen at once, which made a page you visit to change one
// thing look like a page you have to read. You pick what you are here to set
// up first, and only that opens.

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

// The caption written from the drawing: each area and the share it takes.
// The shares are whole numbers that add to 100 (weightsFromDividers rounds by
// largest remainder), so the caption never shows 33.333% or three shares that
// come to 99.
function autoCaption(areas, weights) {
  if (!areas || !weights) return '';
  return areas.map((a) => `${a} ${Math.round(Number(weights[a]) || 0)}%`).join(' · ');
}

export default function SettingsTab({ db, t, flash, refresh }) {
  const [section, setSection] = useState(null); // null = the menu
  const [settings, setSettings] = useState(() => loadSettings());
  const allPlots = useMemo(
    () => Object.keys(NURSERIES).flatMap((nk) => plotsOf(nk).map((p) => ({ plot: p, nursery: nk }))),
    []
  );
  const [plot, setPlot] = useState(allPlots[0].plot);

  // Plot outlines and the nursery aerial maps come from the main portal's
  // Nursery Operation Management, so a plot drawn there is the plot shown
  // here rather than a second, drifting copy.
  const [maps, setMaps] = useState(() => loadCachedMaps());
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [mapErr, setMapErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoadingMaps(true);
    fetchPlotMaps()
      .then((m) => alive && setMaps(m))
      .catch((e) => alive && setMapErr(e.message || String(e)))
      .finally(() => alive && setLoadingMaps(false));
    return () => {
      alive = false;
    };
  }, []);

  const cfg = settings.multi[plot];
  const [count, setCount] = useState(cfg ? cfg.areas.length : 1);
  const [dividers, setDividers] = useState(() => (cfg && cfg.dividers ? cfg.dividers : []));
  const [cap, setCap] = useState(cfg ? cfg.cap : '');
  // Whether the caption has been typed over. Until it has, it follows the
  // drawing; once it has, it is left alone.
  const [capEdited, setCapEdited] = useState(() => {
    const auto = cfg ? autoCaption(cfg.areas, cfg.weights) : '';
    return !!(cfg && cfg.cap && cfg.cap !== auto);
  });
  const [photo, setPhoto] = useState(() => settings.photos[plot] || null);
  const [busy, setBusy] = useState(false);

  function selectPlot(p) {
    const c = settings.multi[p];
    setPlot(p);
    setCount(c ? c.areas.length : 1);
    setDividers(c && c.dividers ? c.dividers : []);
    setCap(c ? c.cap : '');
    setCapEdited(!!(c && c.cap && c.cap !== autoCaption(c.areas, c.weights)));
    setPhoto(settings.photos[p] || null);
  }

  // A close-up of one plot is far sharper than a crop out of the whole-nursery
  // map, so an upload takes over once there is one.
  async function pickPhoto(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true);
    try {
      const dataUrl = await readImageScaled(f, 1600, 0.85);
      const next = { ...settings, photos: { ...settings.photos, [plot]: dataUrl } };
      if (!saveSettings(next)) {
        flash(t('set.saveFull'));
      } else {
        applySettings(next);
        setSettings(next);
        setPhoto(dataUrl);
        flash(t('set.photoSaved', { p: plot }));
      }
    } catch (err) {
      flash(t('set.photoErr'));
    }
    setBusy(false);
  }

  function clearPhoto() {
    const next = { ...settings, photos: { ...settings.photos } };
    delete next.photos[plot];
    saveSettings(next);
    applySettings(next);
    setSettings(next);
    setPhoto(null);
    flash(t('set.photoCleared', { p: plot }));
  }

  const areas = AREA_LETTERS.slice(0, count);
  const plotMap = maps && maps.plots ? maps.plots[plot] : null;
  const poly = plotMap ? plotMap.poly : null;
  const nurseryOfSel = plotMap ? plotMap.nursery : allPlots.find((x) => x.plot === plot).nursery;
  const mapUrl = maps && maps.nurseries ? maps.nurseries[nurseryOfSel] : null;
  const ownPhoto = photo || plotPhoto(plot);
  const photoCount = Object.keys(settings.photos || {}).length;
  const photoMb = (
    Object.values(settings.photos || {}).reduce((n, d) => n + d.length, 0) /
    1024 /
    1024
  ).toFixed(1);
  const ready = count < 2 || dividers.length === count - 1;
  // With a photo of the plot alone the whole frame is the plot, so the shares
  // are measured over the picture rather than inside the outline.
  const weights = ready && count > 1 ? weightsFromDividers(areas, dividers, ownPhoto ? null : poly) : null;

  // What the caption actually says: the drawing's own description until
  // somebody types over it. Derived rather than pushed into state, so redrawing
  // a line updates it immediately and cannot fight the typing.
  const autoCap = autoCaption(areas, weights);
  const capValue = capEdited ? cap : autoCap;

  function changeCount(n) {
    setCount(n);
    setDividers((d) => d.slice(0, Math.max(0, n - 1)));
  }

  function savePlot() {
    if (count > 1 && !ready) {
      flash(t('set.drawFirst'));
      return;
    }
    const next = { ...settings, multi: { ...settings.multi } };
    if (count <= 1) {
      delete next.multi[plot];
    } else {
      next.multi[plot] = {
        areas: [...areas],
        weights,
        dividers,
        cap: capValue.trim(),
      };
    }
    if (!saveSettings(next)) {
      flash(t('set.saveFull'));
      return;
    }
    applySettings(next);
    setSettings(next);

    // Splitting redraws boundaries; it does not start the plot again. Hand the
    // plot's history to each new area so the work already logged is still
    // there, on both sides of the line.
    let seeded = 0;
    if (count > 1) {
      seeded = carryLogsToAreas(db, plot, areas);
      if (seeded) {
        saveDB(db);
        refresh();
      }
    }
    flash(seeded ? t('set.savedPlotKept', { p: plot, n: seeded }) : t('set.savedPlot', { p: plot }));
  }

  /* ---- needs attention ----
     Edited as a draft and written on Save. Every keystroke used to be a write
     to storage, so a half-typed "1" on the way to "14" was a live rule for as
     long as it took to type the second digit. */
  const rulesOf = (attn) => Object.entries(attn).map(([n, d]) => ({ n: Number(n), d }));
  const [rules, setRules] = useState(() => rulesOf(settings.attention));
  const dirty = JSON.stringify(rules) !== JSON.stringify(rulesOf(settings.attention));

  function saveRules() {
    const attention = {};
    rules.forEach((r) => {
      if (r.n && r.d !== '' && Number(r.d) > 0) attention[r.n] = Number(r.d);
    });
    const next = { ...settings, attention };
    if (!saveSettings(next)) {
      flash(t('set.saveFull'));
      return;
    }
    applySettings(next);
    setSettings(next);
    setRules(rulesOf(attention));
    flash(t('set.rulesSaved'));
  }

  function setRule(i, field, v) {
    setRules((list) => list.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addRule() {
    const used = new Set(rules.map((r) => r.n));
    const unused = ACTIVITIES.find((a) => !used.has(a.n));
    if (!unused) return;
    setRules((list) => [...list, { n: unused.n, d: 7 }]);
  }
  function removeRule(i) {
    setRules((list) => list.filter((_, idx) => idx !== i));
  }

  function resetAll() {
    const d = defaultSettings();
    saveSettings(d);
    applySettings(d);
    setSettings(d);
    setRules(rulesOf(d.attention));
    selectPlot(plot);
    flash(t('set.reset'));
  }

  const MENU = [
    ['areas', t('set.areasTitle')],
    ['attn', t('set.attnTitle')],
  ];

  if (!section) {
    return (
      <>
        {MENU.map(([id, title]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className="w-full text-left bg-white rounded-2xl border-2 border-slate-200 hover:border-emerald-400 shadow-[0_4px_16px_rgba(0,0,0,.06)] px-4 sm:px-6 py-4 sm:py-5 transition-all hover:-translate-y-0.5 cursor-pointer flex items-center gap-3"
          >
            <span className="flex-1 min-w-0 text-[13px] font-black text-slate-800">{title}</span>
            <span className="shrink-0 text-slate-300 text-xl font-black">›</span>
          </button>
        ))}
        {/* Two things people look for in here are not here, and saying so is
            cheaper than letting somebody hunt. Both are the office's: the same
            list has to be true for every phone, which a per-device setting
            can never be. */}
        <div className="bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3.5">
          <p className="text-[12px] text-sky-900 leading-relaxed">
            {t('set.officeOwned')}
          </p>
          <p className="text-[11px] font-bold text-sky-700 mt-1.5">{t('set.officeWhere')}</p>
        </div>

        <div className="text-center pt-1">
          <button
            onClick={resetAll}
            className="text-[11px] font-bold text-slate-400 hover:text-rose-500 cursor-pointer"
          >
            {t('set.resetAll')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setSection(null)}
        className="flex items-center gap-2 text-[11px] font-black text-slate-500 hover:text-emerald-700 uppercase tracking-wider cursor-pointer"
      >
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-white border border-slate-200">
          <BackArrow />
        </span>
        {MENU.find(([id]) => id === section)[1]}
      </button>

      {/* ---------------- plot areas ---------------- */}
      {section === 'areas' && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] overflow-hidden">

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Plot
              <div className="mt-1">
                <CfSelect value={plot} onChange={(e) => selectPlot(e.target.value)}>
                  {Object.keys(NURSERIES).map((nk) => (
                    <optgroup key={nk} label={NURSERIES[nk].label}>
                      {plotsOf(nk).map((p) => (
                        <option key={p} value={p}>
                          {p}
                          {settings.multi[p] ? ` — ${settings.multi[p].areas.length} ${t('set.areasWord')}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </CfSelect>
              </div>
            </label>

            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              {t('set.areaCount')}
              <div className="mt-1">
                <CfSelect value={count} onChange={(e) => changeCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? t('set.oneArea') : n}
                    </option>
                  ))}
                </CfSelect>
              </div>
            </label>
          </div>

          {mapErr && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-[12px] font-bold">
              {t('set.mapErr', { msg: mapErr })}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <label className="bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 text-[11px] font-black uppercase tracking-wider rounded-lg px-3 py-2 cursor-pointer">
              {busy ? t('set.reading') : photo ? t('set.replacePhoto') : t('set.uploadPhoto')}
              <input type="file" accept="image/*" onChange={pickPhoto} hidden />
            </label>
            {photo && (
              <button
                onClick={clearPhoto}
                className="text-[11px] font-bold text-slate-400 hover:text-rose-500 cursor-pointer"
              >
                {t('set.usePortalMap')}
              </button>
            )}
            <span className="text-[11px] font-semibold text-slate-400">
              {ownPhoto ? t('set.srcPhoto') : mapUrl ? t('set.srcMap') : ''}
            </span>
          </div>

          {/* Photos live in browser storage, which is small — worth showing
              before an upload fails for want of room. */}
          {photoCount > 0 && (
            <div className="text-[11px] font-semibold text-slate-400">
              {t('set.storage', { n: photoCount, mb: photoMb })}
            </div>
          )}

          {/* The map is the point of this screen, so it shows for every plot
              — a plot with one area still wants looking at before it is split.
              The editor itself knows there is nothing to draw. */}
          <>
            {ownPhoto || mapUrl ? (
                <PlotAreaEditor
                  key={`${plot}-${count}-${ownPhoto ? 'p' : 'm'}`}
                  photoUrl={ownPhoto}
                  mapUrl={mapUrl}
                  poly={poly}
                  areas={areas}
                  dividers={dividers}
                  onChange={setDividers}
                  t={t}
                />
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-6 text-center text-[12px] font-bold text-slate-400">
                  {loadingMaps ? t('common.loading') : t('set.noMap', { n: nurseryOfSel })}
                </div>
              )}

              {weights && (
                <div className="flex gap-2 flex-wrap">
                  {areas.map((a) => (
                    <span
                      key={a}
                      className="text-[12px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1"
                    >
                      {a} · {weights[a]}%
                    </span>
                  ))}
                  <span className="text-[11px] font-semibold text-slate-400 self-center">{t('set.measured')}</span>
                </div>
              )}

              <div>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {t('set.caption')}
                  </div>
                  {/* Written from the drawing until it is typed over, and one
                      tap puts it back — so redrawing a line does not quietly
                      throw away a caption somebody wrote by hand. */}
                  {capEdited && autoCap && capValue !== autoCap ? (
                    <button
                      onClick={() => setCapEdited(false)}
                      className="text-[10px] font-black uppercase tracking-wider text-emerald-700 hover:text-emerald-800 cursor-pointer"
                    >
                      {t('set.capAuto')}
                    </button>
                  ) : (
                    autoCap && (
                      <span className="text-[10px] font-bold text-slate-400">{t('set.capFromDrawing')}</span>
                    )
                  )}
                </div>
                <textarea
                  rows={2}
                  value={capValue}
                  onChange={(e) => {
                    setCapEdited(true);
                    setCap(e.target.value);
                  }}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-500"
                />
              </div>
          </>

          <button
            onClick={savePlot}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[12px] uppercase tracking-widest rounded-xl px-6 py-3 cursor-pointer"
          >
            {count <= 1 ? t('set.saveSingle', { p: plot }) : t('set.savePlot', { p: plot })}
          </button>

        </div>
      </div>
      )}

      {/* ---------------- needs attention ---------------- */}
      {section === 'attn' && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] overflow-hidden">
        <div className="px-4 py-3 space-y-2">
          {rules.length === 0 && (
            <div className="text-[12px] font-semibold text-slate-400">{t('set.attnEmpty')}</div>
          )}
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[150px]">
                <CfSelect value={r.n} onChange={(e) => setRule(i, 'n', Number(e.target.value))}>
                  {ACTIVITIES.map((a) => (
                    <option key={a.n} value={a.n}>
                      {a.n}. {a.name}
                    </option>
                  ))}
                </CfSelect>
              </div>
              <span className="text-[11px] font-bold text-slate-500">{t('set.warnUnder')}</span>
              <input
                type="number"
                min="1"
                value={r.d}
                onChange={(e) => setRule(i, 'd', e.target.value)}
                className="w-20 bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold tabular-nums outline-none focus:border-emerald-500"
              />
              <span className="text-[11px] font-bold text-slate-500">{t('set.daysWord')}</span>
              <button
                onClick={() => removeRule(i)}
                className="text-rose-500 hover:text-rose-700 font-black text-lg px-2 cursor-pointer"
                aria-label={t('set.removeRule')}
                title={t('set.removeRule')}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              onClick={addRule}
              className="bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 text-[11px] font-black uppercase tracking-wider rounded-lg px-3 py-2 cursor-pointer"
            >
              + {t('set.addRule')}
            </button>
            <button
              onClick={saveRules}
              disabled={!dirty}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-wider rounded-lg px-4 py-2 cursor-pointer"
            >
              {dirty ? t('set.saveRules') : t('set.rulesSaved')}
            </button>
            <span className="text-[11px] font-semibold text-slate-400">
              {t('set.attnNote', {
                list: rules.length
                  ? rules.map((r) => `${activityByN(r.n) ? activityByN(r.n).name : r.n} < ${r.d}d`).join(', ')
                  : '—',
              })}
            </span>
          </div>
        </div>
      </div>
      )}
    </>
  );
}

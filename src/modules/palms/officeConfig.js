import { supabase } from '../../lib/supabase.js';
import { ACTIVITIES, NURSERIES, applyOfficeConfig, isReplantPlot, nurseryOfPlot } from './data.js';

/**
 * Where PALMS gets its plots and its statuses: the office, not this file.
 *
 * Two things used to be constants in data.js — the 52 plots (B1–B14, U1–U18,
 * N1–N20) and the eleven activities a plot moves through. Adding a plot or
 * renaming a stage therefore meant editing the app and deploying it, which is
 * the wrong shape for something the nursery changes and the office owns.
 *
 * Both already existed on the office side and neither was being read:
 *
 *   plots     shared_plots — the same table Maintenance and the batch picker
 *             read, kept in Seedling Stock Management
 *   statuses  nops_plot_status_stages — kept on Nursery Operation Management
 *             → Life of Plot → Status Stages, with each stage's ideal days
 *
 * Cached on the device, because a Field Conductor standing in a plot with no
 * signal still has to be able to key the day in. Read fails silently and the
 * cache (or, on a phone that has never had signal, the constants) stands.
 */

const KEY = 'palms_office_config_v1';

/** Which nursery a plot belongs to, by the letter it starts with. */
const nurseryKeyOf = (plotName) => nurseryOfPlot(String(plotName || '').trim().toUpperCase());

/**
 * A stage's number is its sort_order — the position the office put it in.
 *
 * NOT its database id: the plot log stores act_n, and the whole point of the
 * number is that stage 1 comes before stage 2. Reordering stages in the office
 * therefore re-reads history against the new order, which is correct for
 * "what does this plot's stage mean" and is why the office page warns before
 * moving one.
 */
function activitiesFromStages(rows) {
  const stages = (rows || [])
    .filter((r) => r && r.name)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name)));
  return stages.map((r, i) => {
    const name = String(r.name).trim();
    return {
      n: r.sort_order || i + 1,
      name,
      // The picker has to show every stage on a phone without scrolling, so
      // the office's own name is trimmed for the small label rather than a
      // second column being asked for.
      mShort: name.length > 16 ? name.slice(0, 15) + '…' : name,
      short: name,
      days: r.ideal_days == null ? 1 : Number(r.ideal_days),
      stageId: r.id,
    };
  });
}

function plotsFromShared(rows) {
  const out = {};
  Object.keys(NURSERIES).forEach((nk) => { out[nk] = []; });
  (rows || []).forEach((r) => {
    // Hidden in the office — not a plot the Field Conductor should be
    // offered. Absent column means nothing is hidden.
    if (r.is_active === false) return;
    const plot = String(r.plot_name || '').trim().toUpperCase();
    const nk = nurseryKeyOf(plot);
    if (!plot || !nk || !out[nk]) return;
    // A -R plot is not a PALMS plot — see isReplantPlot in data.js.
    if (isReplantPlot(plot)) return;
    if (out[nk].indexOf(plot) === -1) out[nk].push(plot);
  });
  // B2 before B10, the way the nursery says them.
  Object.keys(out).forEach((nk) => out[nk].sort((a, b) =>
    (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0)
    || a.localeCompare(b)));
  return out;
}

function readCache() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Apply whatever was cached last time. Synchronous, so the first paint is
    already the office's plots rather than the constants flashing first. */
export function applyCachedOfficeConfig() {
  const cached = readCache();
  if (cached) applyOfficeConfig(cached);
  return !!cached;
}

/**
 * Read both lists and apply them. Returns true when something was applied.
 *
 * Best effort throughout: a stage table that has never been filled in leaves
 * the app on its built-in eleven, and an unreachable server leaves it on the
 * cache. Neither is an error worth putting in front of somebody in a field.
 */
export async function refreshOfficeConfig() {
  let cfg = null;
  try {
    const [plotsRes, stagesRes] = await Promise.all([
      // is_active is newer than the table (migration_plot_hide.sql). A select
      // naming a missing column fails the whole read, so this asks for it and
      // plotsFromShared falls back to "everything" when it is absent.
      supabase.from('shared_plots').select('nursery_name, plot_name, is_active').order('plot_name')
        .then((r) => (r.error && /is_active/i.test(r.error.message || '')
          ? supabase.from('shared_plots').select('nursery_name, plot_name').order('plot_name')
          : r)),
      supabase.from('nops_plot_status_stages').select('id, name, sort_order, ideal_days').order('sort_order'),
    ]);
    cfg = {
      plots: plotsRes.error ? null : plotsFromShared(plotsRes.data),
      activities: stagesRes.error ? null : activitiesFromStages(stagesRes.data),
      at: Date.now(),
    };
    // A plot list that came back completely empty is a read that found
    // nothing, not a nursery with no plots. Keeping it would blank every
    // screen, so it is dropped and the fallback stands.
    if (cfg.plots && !Object.keys(cfg.plots).some((k) => cfg.plots[k].length)) cfg.plots = null;
    if (cfg.activities && !cfg.activities.length) cfg.activities = null;
    if (!cfg.plots && !cfg.activities) return false;
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
  } catch (e) {
    console.warn('[palms] could not read the office config:', (e && e.message) || e);
    return false;
  }
  applyOfficeConfig(cfg);
  return true;
}

/** What the screens are running on, for the settings page to show. */
export function officeConfigSummary() {
  const cached = readCache();
  return {
    plots: Object.keys(NURSERIES).reduce((n, nk) => n + (NURSERIES[nk].plots || []).length, 0),
    stages: ACTIVITIES.length,
    fromOffice: !!(cached && (cached.plots || cached.activities)),
    at: cached ? cached.at : null,
  };
}

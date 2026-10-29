// Culling Calculator — the numbers on screen and the formulas over them.
//
// Two different things live here and they are kept apart on purpose:
//
//   FIGURES   Transplant and Baki, read off the Seedling Stock ledger by
//             cullingFigures.js. Nobody types these; they are refreshed from
//             the server and cached so the calculator still works offline.
//   ENTRIES   Pokok Inang (Field Conductor, then Site Auditor) and the video
//             filename. These are typed in the field and belong to the
//             device until there is somewhere to send them.
//
// They were one blob before, dealt as random trial values. Refreshing the
// figures would then have wiped the amounts somebody had just keyed in, so
// entries are stored per plot and survive every refresh.

import { NURSERIES as PALMS_NURSERIES, plotsOf } from './data.js';
import { numText } from '../../lib/numberText.js';

/** The nurseries, with the long name the plot modal shows. Plots themselves
    come from PALMS, so there is one list of what exists, not two. */
export const NURSERIES = {
  BNN: { prefix: PALMS_NURSERIES.BNN.prefix, count: PALMS_NURSERIES.BNN.count, label: '' },
  UNN1: { prefix: PALMS_NURSERIES.UNN1.prefix, count: PALMS_NURSERIES.UNN1.count, label: 'Nurseri Ulu 1' },
  UNN2: { prefix: PALMS_NURSERIES.UNN2.prefix, count: PALMS_NURSERIES.UNN2.count, label: 'Nurseri Ulu 2' },
};

const STORE_KEY = 'palms_culling_v2';

let sessionData = null;

/** A plot with no server figures yet: the rate is unknown, not zero. */
function blankRow(plot) {
  return { plot, transplant: 0, balance: 0, pokok: null, pokokAuditor: null, video: null };
}

function buildRows() {
  const data = {};
  for (const key in NURSERIES) data[key] = plotsOf(key).map(blankRow);
  return data;
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Entries and the last figures seen, keyed by plot so neither can be lost
    by the other being rewritten. */
export function persistSessionData() {
  try {
    const entries = {};
    const figures = {};
    for (const key in sessionData) {
      for (const r of sessionData[key]) {
        if (r.pokok !== null || r.pokokAuditor !== null || r.video) {
          entries[r.plot] = { pokok: r.pokok, pokokAuditor: r.pokokAuditor, video: r.video };
        }
        if (r.transplant) figures[r.plot] = { transplant: r.transplant, balance: r.balance };
      }
    }
    localStorage.setItem(STORE_KEY, JSON.stringify({ entries, figures }));
    return true;
  } catch (e) {
    return false;
  }
}

export function getSessionData() {
  if (sessionData) return sessionData;
  sessionData = buildRows();
  const saved = readStored() || {};
  const entries = saved.entries || {};
  const figures = saved.figures || {};
  for (const key in sessionData) {
    for (const r of sessionData[key]) {
      Object.assign(r, entries[r.plot] || {}, figures[r.plot] || {});
    }
  }
  return sessionData;
}


/** Clear what people typed. The figures are the office's, not the demo's, so
    they are left alone — reseeding plot statuses does not un-transplant a
    plot. */
export function resetSessionData() {
  const data = getSessionData();
  for (const key in data) {
    for (const r of data[key]) { r.pokok = null; r.pokokAuditor = null; r.video = null; }
  }
  persistSessionData();
  return data;
}




export function fmtPct(fraction) {
  return (fraction * 100).toFixed(2) + '%';
}

export function fmtNum(n) {
  // Through the one formatter rather than pinning a second copy of the
  // locale here -- see lib/numberText.js for why it is pinned at all.
  return numText(n);
}


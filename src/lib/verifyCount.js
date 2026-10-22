/* WHAT IS PENDING VERIFICATION — the two reads, shared.
 *
 * FloatingDock needs a COUNT to badge its icon with, before anybody has
 * tapped anything; VerificationBoard (now the window the icon opens) needs
 * the full rows to draw the cards from. Both used to run their own copy of
 * these two queries — a DO's missing-worker read and a plot's missing-job
 * read — which is exactly the shape of bug this codebase keeps finding:
 * two readers of one question, free to drift apart. So there is one copy
 * of each, here, and both callers go through it.
 */
import { allowedNurseries, canDo, canMaintain, nurseryKey } from './access.js';
import { loadDOsMissingWorkers, loadDOWorkers, loadDropdownData } from '../modules/do/data.js';
import {
  loadTransplantRecords,
  loadTransplantingSince,
  TRANSPLANT_SETUP_NEEDED,
} from '../modules/maintenance/transplantData.js';
import { doNeedsWorkers, LOADING_WORKERS_FROM, plotsOwingJobs } from '../components/verify/pending.js';

/* A delivery order whose loading gang was never named. Fails soft to an
   empty list: this exists to RAISE work, and raising none is better than
   raising a wrong one over a read that failed. */
export async function loadPendingDOs(permissions) {
  if (!canDo(permissions, 'view')) return { dos: [], plotMap: {}, workers: [] };
  try {
    const [rows, { plots }, ws] = await Promise.all([
      loadDOsMissingWorkers(LOADING_WORKERS_FROM),
      loadDropdownData().catch(() => ({ plots: [] })),
      loadDOWorkers().catch(() => []),
    ]);
    const plotMap = {};
    (plots || []).forEach((p) => { plotMap[p.plot_name] = p.nursery_name; });
    return { dos: (rows || []).filter(doNeedsWorkers), plotMap, workers: ws || [] };
  } catch (e) {
    return { dos: [], plotMap: {}, workers: [] };
  }
}

/* A transplanted plot whose four jobs are not all recorded, scoped to the
   same nurseries the Maintenance module scopes itself to — through
   nurseryKey, the same rule the access tick list is matched by everywhere
   else, because it is typed by hand and says "UNN1" where shared_plots
   says "UNN 1". */
export async function loadPendingTransplants(permissions) {
  if (!canMaintain(permissions, 'view')) return [];
  try {
    const allowed = allowedNurseries(permissions, 'maintenance');
    const { plots } = await loadDropdownData();
    const mine = (plots || []).filter((p) => allowed === null
      || allowed.some((a) => nurseryKey(a) === nurseryKey(p.nursery_name)));
    const names = mine.map((p) => p.plot_name);
    if (!names.length) return [];

    const nurseries = [...new Set(mine.map((p) => p.nursery_name).filter(Boolean))];
    const [rows, ...recsPer] = await Promise.all([
      loadTransplantingSince(names),
      ...nurseries.map((n) => loadTransplantRecords(n).catch((e) => {
        if (e && e.message === TRANSPLANT_SETUP_NEEDED) return [];
        throw e;
      })),
    ]);
    const recs = recsPer.flat();
    const nurseryOf = {};
    mine.forEach((p) => { nurseryOf[p.plot_name] = p.nursery_name; });
    return plotsOwingJobs(rows, recs).map((r) => ({
      ...r,
      nursery: nurseryOf[r.plot] || '',
      plotNames: mine
        .filter((p) => nurseryKey(p.nursery_name) === nurseryKey(nurseryOf[r.plot] || ''))
        .map((p) => p.plot_name),
    }));
  } catch (e) {
    return [];
  }
}

/* The badge only — FloatingDock's own count, read before anybody has
   opened the window. Fails soft to null (no badge), the same shape
   pendingCases() answers Nelos with, so a read that could not be reached
   never reads as "nothing pending". */
export async function pendingVerifyCount(permissions) {
  if (!canDo(permissions, 'view') && !canMaintain(permissions, 'view')) return 0;
  try {
    const [{ dos }, tp] = await Promise.all([
      loadPendingDOs(permissions),
      loadPendingTransplants(permissions),
    ]);
    return dos.length + tp.length;
  } catch (e) {
    return null;
  }
}

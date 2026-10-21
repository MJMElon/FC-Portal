import { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { nurseriesOfDO, saveDOWorkers } from './data.js';
import { generalWorkers } from '../maintenance/helpers.js';
import { nurseryKey } from '../../lib/access.js';

/* Every active worker, grouped by nursery key and narrowed to general
   workers only — the same roster and the same "who does maintenance work"
   rule WhoDidIt.jsx uses, reused rather than re-filtered here. A nursery
   nobody has keyed workers for simply has no group. */
function groupWorkersByNursery(allWorkers) {
  const byKey = {};
  (allWorkers || []).forEach((w) => {
    const k = nurseryKey(w.nursery);
    if (!k) return;
    (byKey[k] = byKey[k] || []).push(w);
  });
  const out = {};
  Object.keys(byKey).forEach((k) => { out[k] = generalWorkers(byKey[k]); });
  return out;
}

/* WHERE THE SEEDLINGS WERE IS NOT WHO CARRIED THEM, and the three decisions
   that follow from it are pure, so they live out here where a test can drive
   the real ones instead of a restatement of them.
   `tests/another_nursery_can_load_the_do.cjs` lifts all three.

   SAME RULE IN the Mobile repository's src/pages/DoSigning.jsx, which has
   its own copy of this popup for the admin portal. Change one, change the
   other — the test here is the one that holds both. */

/* Which sections the popup opens with. `own` is what the DO's own plots say
   and is never closed; `extra` is a nursery somebody added BY HAND on an
   earlier visit, and it has to come back open — otherwise the answer they
   gave is on the record and nowhere on the screen, and the next save, built
   from what is on screen, would quietly drop it. */
export function sectionsForDO(doRecord, plotMap) {
  const own = nurseriesOfDO(doRecord || {}, plotMap || {});
  const saved = (doRecord && doRecord.worked_by_by_nursery) || {};
  const extra = Object.keys(saved).filter((k) => !own.includes(k) && (saved[k] || []).length);
  return { own, extra };
}

/* MAIN NURSERY ONLY, and it is the company's own grouping that says which
   those are — the Location card on the 555 Worker Portal's System Setting
   files every section under Pre Nursery, Main Nursery or Estate. A DO is
   loaded out of a main nursery: PN is the tray shed and UNE is the estate,
   and neither has a gang that carries seedlings onto a lorry.

   It RECOGNISES rather than lists, so BNN, UNN1 and UNN2 today and a BNN2
   or a UNN3 the day somebody adds one — no edit here, no edit there. UNE is
   not caught by it: the estate is UNE, not UNN.

   SAME RULE as LOCATIONS.main in mjm-ai-system's shared/
   shared_worker_locations.js, which is where the Location card and the Team
   Board read it from. Change one, change the other. */
export function isMainNursery(key) {
  return /^(BNN|UNN)\d*$/.test(String(key || ''));
}

/* What is offered underneath: every MAIN nursery with workers on the roster
   that is not already a section. Sorted, so the row does not reshuffle
   itself between two DOs. */
export function otherNurseries(byNursery, open) {
  return Object.keys(byNursery || {})
    .filter((k) => isMainNursery(k) && (open || []).indexOf(k) < 0)
    .sort();
}

/* AN EMPTY NURSERY IS NOT AN ANSWER. A section opened by hand and then left
   alone would otherwise write `{ "UNN1": [] }`, which reads on every other
   screen as a nursery that was involved. */
export function cleanPicks(open, picked) {
  const out = {};
  (open || []).forEach((k) => { if (((picked || {})[k] || []).length) out[k] = picked[k]; });
  return out;
}

/* "Who Loaded This DO" — shared between the DO module and the scan module,
   both of which save a DO through the same persistDO() and both of which
   need the same popup after. One hook, one modal (WorkerTickModal.jsx),
   rather than two copies that can drift apart. */
export function useWorkerTick(workers) {
  const { permissions } = useAuth();
  const isAdmin = !!(permissions && permissions.manage_users);

  const [wtOpen, setWtOpen] = useState(false);
  const [wtDO, setWtDO] = useState(null);
  /* WHERE THE SEEDLINGS WERE is not WHO CARRIED THEM. The DO's own plots
     say which nursery they came out of, and that nursery is always open
     because it is the answer nearly every time. It is not the only answer:
     seedlings standing in BNN, on a DO issued against BNN, are regularly
     loaded by a UNN 1 gang. So the DO's nurseries are the ones OPENED and
     every other nursery with workers on the roster can be opened by hand —
     the two lists are kept apart because only the first can be derived. */
  const [wtOwn, setWtOwn] = useState([]);
  const [wtExtra, setWtExtra] = useState([]);
  /* Kept so the popup can SHOW what this DO is -- the customer, the plots
     and the quantity -- and resolve a plot to its nursery where the DO
     named one. The question "who loaded this" is unanswerable from a DO
     number alone, and that number was all the popup carried. */
  const [wtPlotMap, setWtPlotMap] = useState({});
  const [wtPicked, setWtPicked] = useState({});
  const [wtSaving, setWtSaving] = useState(false);
  const thenRef = useRef(null);

  const wtLocked = !!(wtDO && wtDO.worked_by_locked_at) && !isAdmin;
  const byNursery = groupWorkersByNursery(workers);

  const wtNurseries = wtOwn.concat(wtExtra.filter((k) => !wtOwn.includes(k)));
  // Offered underneath, never above: a nursery nobody has opened is a
  // prompt, not a section.
  const wtOtherNurseries = otherNurseries(byNursery, wtNurseries);

  // Opened right after a fresh online save AND from a DO row's own Workers
  // button once it has been issued, so a skipped step is never a dead end.
  function openWorkerTick(doRecord, plotMap, after = null) {
    const { own, extra } = sectionsForDO(doRecord, plotMap);
    const saved = doRecord.worked_by_by_nursery || {};
    const seeded = {};
    own.concat(extra).forEach((k) => { seeded[k] = saved[k] || []; });
    setWtDO(doRecord);
    setWtPlotMap(plotMap || {});
    setWtOwn(own);
    setWtExtra(extra);
    setWtPicked(seeded);
    thenRef.current = after;
    setWtOpen(true);
  }

  function addNursery(key) {
    if (wtLocked || !key || wtNurseries.includes(key)) return;
    setWtExtra((prev) => prev.concat([key]));
    setWtPicked((prev) => (prev[key] ? prev : { ...prev, [key]: [] }));
  }

  // Only a hand-opened one can be closed again, and closing it drops its
  // ticks — the DO's own nursery is not a choice anybody made.
  function removeNursery(key) {
    if (wtLocked || wtOwn.includes(key)) return;
    setWtExtra((prev) => prev.filter((k) => k !== key));
    setWtPicked((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  function closeWorkerTick() {
    setWtOpen(false);
    const fn = thenRef.current;
    thenRef.current = null;
    if (fn) setTimeout(fn, 250);
  }

  // Never writes anything — a DO with no worked_by_by_nursery and no lock
  // reads identically to one nobody has looked at yet, which is exactly
  // right: the Workers button is how it gets answered later.
  function skipWorkerTick() {
    closeWorkerTick();
  }

  function toggleWorkerPick(key, name) {
    if (wtLocked) return;
    setWtPicked((prev) => {
      const cur = prev[key] || [];
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      return { ...prev, [key]: next };
    });
  }

  async function saveWorkerTick(staffName) {
    if (!wtDO || !wtDO.id || wtSaving) return;
    setWtSaving(true);
    try {
      await saveDOWorkers(wtDO.id, cleanPicks(wtNurseries, wtPicked), staffName || null);
      closeWorkerTick();
    } finally {
      setWtSaving(false);
    }
  }

  return {
    wtOpen, wtDO, wtPlotMap, wtNurseries, wtOwn, wtOtherNurseries, wtPicked, wtSaving, wtLocked, isAdmin, byNursery,
    openWorkerTick, closeWorkerTick, skipWorkerTick, toggleWorkerPick, saveWorkerTick,
    addNursery, removeNursery,
  };
}

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

/* "Who Loaded This DO" — shared between the DO module and the scan module,
   both of which save a DO through the same persistDO() and both of which
   need the same popup after. One hook, one modal (WorkerTickModal.jsx),
   rather than two copies that can drift apart. */
export function useWorkerTick(workers) {
  const { permissions } = useAuth();
  const isAdmin = !!(permissions && permissions.manage_users);

  const [wtOpen, setWtOpen] = useState(false);
  const [wtDO, setWtDO] = useState(null);
  const [wtNurseries, setWtNurseries] = useState([]);
  const [wtPicked, setWtPicked] = useState({});
  const [wtSaving, setWtSaving] = useState(false);
  const thenRef = useRef(null);

  const wtLocked = !!(wtDO && wtDO.worked_by_locked_at) && !isAdmin;
  const byNursery = groupWorkersByNursery(workers);

  // Opened right after a fresh online save AND from a DO row's own Workers
  // button once it has been issued, so a skipped step is never a dead end.
  function openWorkerTick(doRecord, plotMap, after = null) {
    const keys = nurseriesOfDO(doRecord, plotMap || {});
    const seeded = {};
    keys.forEach((k) => { seeded[k] = (doRecord.worked_by_by_nursery || {})[k] || []; });
    setWtDO(doRecord);
    setWtNurseries(keys);
    setWtPicked(seeded);
    thenRef.current = after;
    setWtOpen(true);
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
      await saveDOWorkers(wtDO.id, wtPicked, staffName || null);
      closeWorkerTick();
    } finally {
      setWtSaving(false);
    }
  }

  return {
    wtOpen, wtDO, wtNurseries, wtPicked, wtSaving, wtLocked, isAdmin, byNursery,
    openWorkerTick, closeWorkerTick, skipWorkerTick, toggleWorkerPick, saveWorkerTick,
  };
}

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import TopNav from '../../components/TopNav.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { printDO } from '../../lib/pdf.js';
import EntryModal from '../do/EntryModal.jsx';
import { loadALByNumber, loadDropdownData, persistDO, flushDOQueue, loadDOsForAL, loadConsentsForAL } from '../do/data.js';
import {
  cachedConsents,
  fetchConsents,
  cachedTodayALs,
  fetchTodayBookingALs,
  loadProgress,
  saveProgress,
  defaultProgress,
  mergeConsents,
  statusOf,
  saveScanRecord,
  flushScanRecords,
  fetchScanRecords,
  subscribeScanRecords,
  unsubscribeScanRecords,
} from './store.js';
import { ensureAudio, beepSuccess, beepDuplicate, beepComplete, beepAlarm, vibrate } from './audio.js';

const DEDUPE_DEBOUNCE_MS = 800;
const OVER_REPEAT_MS = 1200;

export default function ScanModule() {
  const { t } = useLang();
  const { staffName } = useAuth();

  const [serverConsents, setServerConsents] = useState(() => cachedConsents());
  const [todayALs, setTodayALs] = useState(() => cachedTodayALs());
  const [progress, setProgress] = useState(() => loadProgress());
  const [activeId, setActiveId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastInfo, setLastInfo] = useState({ key: 'scan.waitingFirst' });

  // Issue DO popup state (opens the DO entry form in-place, no navigation).
  const [doEntry, setDoEntry] = useState(null); // { al, suggestQty, consentId }
  const [doPlots, setDoPlots] = useState([]);
  const [doBreeds, setDoBreeds] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [printPrompt, setPrintPrompt] = useState(null);
  const [activeDOs, setActiveDOs] = useState([]);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const seenRef = useRef(new Set());
  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);
  const lastOverRef = useRef(0);
  const activeRef = useRef(null);
  const realtimeChannelRef = useRef(null);

  const flash = useCallback((text, kind = '') => {
    setToast({ text, kind });
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setToast(null), 1800);
  }, []);

  const consents = useMemo(() => mergeConsents(serverConsents, progress), [serverConsents, progress]);
  const active = consents.find((c) => c.id === activeId) || null;
  activeRef.current = active;

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await flushDOQueue().catch(() => {});
      await flushScanRecords().catch(() => {});
      const [data, today] = await Promise.all([fetchConsents(), fetchTodayBookingALs().catch(() => null)]);
      setServerConsents(data);
      if (today) setTodayALs(today);
      flash(t('scan.synced', { n: data.length }), 'done');
    } catch (e) {
      flash(t('scan.syncFailed', { msg: e.message }), 'danger');
    } finally {
      setSyncing(false);
    }
  }, [flash, t]);

  useEffect(() => {
    if (navigator.onLine) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load issued DOs from the server for the active consent's AL.
  // Also sync the server-derived total issued qty into localStorage so that the
  // consent list shows the correct balance even if the DO was issued through the
  // AI system rather than through this scan module.
  useEffect(() => {
    const alNumber = active?.al_number;
    const consentId = active?.id;
    if (!alNumber || /^MANUAL-/i.test(alNumber)) {
      setActiveDOs([]);
      return;
    }
    if (!navigator.onLine) return;
    loadDOsForAL(alNumber).then((dos) => {
      setActiveDOs(dos);
      if (!consentId || !dos.length) return;
      const serverIssuedQty = dos.reduce((sum, d) => sum + (d.total_qty || 0), 0);
      setProgress((prev) => {
        const cur = prev[consentId] || defaultProgress();
        if ((cur.issuedQty || 0) >= serverIssuedQty) return prev;
        const map = {
          ...prev,
          [consentId]: { ...cur, issuedQty: serverIssuedQty, doIssued: serverIssuedQty > 0 },
        };
        saveProgress(map);
        return map;
      });
    }).catch(() => {});
  }, [active?.al_number]);

  // Unsubscribe from Realtime on full unmount.
  useEffect(() => {
    return () => unsubscribeScanRecords(realtimeChannelRef.current);
  }, []);

  // On consent change: reset dedupe, seed from localStorage, then merge server records
  // and subscribe to live scans from other devices.
  useEffect(() => {
    unsubscribeScanRecords(realtimeChannelRef.current);
    realtimeChannelRef.current = null;

    lastCodeRef.current = '';
    lastTimeRef.current = 0;
    lastOverRef.current = 0;
    setLastInfo({ key: 'scan.waitingFirst' });

    // Seed from localStorage immediately — works offline and is instant.
    seenRef.current = new Set(progressRef.current[activeId]?.seen || []);

    if (!activeId || !navigator.onLine) return;

    // Pull server records → merge in barcodes scanned by other devices.
    fetchScanRecords(activeId).then((rows) => {
      const newBarcodes = rows.map((r) => r.barcode).filter((b) => !seenRef.current.has(b));
      if (!newBarcodes.length) return;
      setProgress((prev) => {
        const cur = prev[activeId] || defaultProgress();
        const newUnique = cur.unique + newBarcodes.length;
        const qty = activeRef.current?.qty || 0;
        const next = {
          ...cur,
          seen: [...cur.seen, ...newBarcodes],
          scans: [...newBarcodes.map((b) => ({ code: b, time: '–', over: false })), ...cur.scans],
          unique: newUnique,
          over: Math.max(0, newUnique - qty),
        };
        newBarcodes.forEach((b) => seenRef.current.add(b));
        const map = { ...prev, [activeId]: next };
        saveProgress(map);
        return map;
      });
    }).catch(() => {/* stay with localStorage */});

    // Subscribe to live INSERTs from other devices scanning the same consent.
    realtimeChannelRef.current = subscribeScanRecords(activeId, (barcode) => {
      if (seenRef.current.has(barcode)) return;
      seenRef.current.add(barcode);
      setProgress((prev) => {
        const cur = prev[activeId] || defaultProgress();
        const unique = cur.unique + 1;
        const qty = activeRef.current?.qty || 0;
        const next = {
          ...cur,
          seen: [...cur.seen, barcode],
          scans: [{ code: barcode, time: new Date().toLocaleTimeString(), over: unique > qty }, ...cur.scans],
          unique,
          over: Math.max(0, unique - qty),
        };
        const map = { ...prev, [activeId]: next };
        saveProgress(map);
        return map;
      });
    });
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const recordScan = useCallback(
    (rawCode) => {
      const a = activeRef.current;
      if (!a) return;
      const code = String(rawCode).trim();
      if (!code) return;
      const now = Date.now();
      if (code === lastCodeRef.current && now - lastTimeRef.current < DEDUPE_DEBOUNCE_MS) return;
      lastCodeRef.current = code;
      lastTimeRef.current = now;

      if (seenRef.current.has(code)) {
        beepDuplicate();
        vibrate([20, 40, 20]);
        flash(t('scan.duplicate', { code }), 'warn');
        return;
      }
      seenRef.current.add(code);

      // Write to server so other devices see this scan in real time. With no
      // line it QUEUES instead of being skipped — see saveScanRecord — so the
      // other phones hear about it when the line returns rather than never.
      saveScanRecord(a.id, a.al_number, code).catch(() => {});

      const cur = progressRef.current[a.id] || defaultProgress();
      const unique = cur.unique + 1;
      const willBeOver = unique > a.qty;
      const time = new Date().toLocaleTimeString();
      const next = {
        ...cur,
        unique,
        seen: [...cur.seen, code],
        scans: [{ code, time, over: willBeOver }, ...cur.scans],
        over: willBeOver ? cur.over + 1 : cur.over,
      };

      if (willBeOver) {
        setLastInfo({ key: 'scan.overItem', vars: { code } });
        if (now - lastOverRef.current > OVER_REPEAT_MS) {
          beepAlarm();
          lastOverRef.current = now;
        }
        vibrate([120, 60, 120, 60, 200]);
        flash(t('scan.overQuota', { u: unique, q: a.qty }), 'danger');
        next.overFired = true;
      } else {
        setLastInfo({ key: 'scan.latest', vars: { code } });
        beepSuccess();
        vibrate(40);
      }
      if (!cur.completedFired && unique === a.qty) {
        next.completedFired = true;
        next.completedAt = Date.now();
        beepComplete();
        vibrate([80, 60, 80, 60, 200]);
        flash(t('scan.targetReached', { q: a.qty }), 'done');
      }

      setProgress((prev) => {
        const map = { ...prev, [a.id]: next };
        saveProgress(map);
        return map;
      });
    },
    [flash, t]
  );

  async function openIssueDO(consent) {
    if (!consent || issuing) return;
    setIssuing(true);
    let al = null;
    try {
      al = await loadALByNumber(consent.al_number);
    } catch (e) {
      /* offline / not found */
    }
    if (!al) {
      al = {
        id: null,
        al_number: consent.al_number || '',
        customer_name: consent.customer || '',
        order_number: consent.order_number || '',
        product_name: '',
        quantity_ordered: consent.qty || null,
        balance_quantity: 999999,
      };
    }
    let plots = cacheGet('do_plots')?.value || [];
    let breeds = cacheGet('do_breeds')?.value || [];
    if (navigator.onLine && (!plots.length || !breeds.length)) {
      try {
        const dd = await loadDropdownData();
        plots = dd.plots;
        breeds = dd.breeds;
        cacheSet('do_plots', plots);
        cacheSet('do_breeds', breeds);
      } catch (e) {
        /* keep cached */
      }
    }
    setDoPlots(plots);
    setDoBreeds(breeds);
    setIssuing(false);
    // Use the higher of localStorage-tracked qty and server-derived qty from activeDOs.
    const serverIssuedQty = activeDOs.reduce((sum, d) => sum + (d.total_qty || 0), 0);
    const issuedQty = Math.max(progress[consent.id]?.issuedQty || 0, serverIssuedQty);
    const newScans = Math.max(0, consent.unique - issuedQty);
    const remainingBalance = Math.max(0, consent.qty - issuedQty);
    const suggestQty = newScans > 0 ? newScans : remainingBalance;
    setDoEntry({ al, suggestQty, consentId: consent.id });
  }

  function onDoSaved(payload, sigDataUrl, queued, photoBase64) {
    const al = doEntry?.al || {};
    const consentId = doEntry?.consentId;
    setDoEntry(null);
    if (consentId) {
      setProgress((prev) => {
        const cur = prev[consentId] || defaultProgress();
        const map = {
          ...prev,
          [consentId]: {
            ...cur,
            doIssued: true,
            issuedQty: (cur.issuedQty || 0) + (payload.total_qty || 0),
          },
        };
        saveProgress(map);
        return map;
      });
    }
    setActiveId(null);
    flash(queued ? t('do.savedOffline') : t('do.doSavedToast', { do: payload.do_number }), 'done');
    setPrintPrompt({ payload, sigDataUrl, al, plots: doPlots, photoBase64 });
  }

  function doPrint(pp) {
    printDO(pp.payload, pp.al || {}, staffName, pp.sigDataUrl, pp.photoBase64);
    flash(t('do.printedToast', { do: pp.payload.do_number }), 'done');
  }

  function shareWhatsApp(pp) {
    const p = pp.payload;
    const al = pp.al || {};
    const plots = pp.plots || [];
    const customer = al.customer_name || p.remark || '—';
    const orderNumber = al.order_number || '—';

    const lines = [
      '*MJM Nursery — Delivery Order*',
      `Order No: ${orderNumber}`,
      `DO No: ${p.do_number}`,
      `Customer: ${customer}`,
      `Date: ${p.delivery_date || '—'}`,
      '',
      '*Items:*',
    ];

    for (let i = 1; i <= 5; i++) {
      const plotName = p[`plot_${i}`];
      const breed = p[`breed_${i}`];
      const qty = p[`qty_${i}`];
      if (!plotName && !breed && !qty) continue;
      const nurseryName = plots.find((pl) => pl.plot_name === plotName)?.nursery_name || '';
      const parts = [];
      if (nurseryName) parts.push(`Nursery: ${nurseryName}`);
      if (plotName) parts.push(`Plot: ${plotName}`);
      if (breed) parts.push(`Breed: ${breed}`);
      if (qty) parts.push(`Qty: ${qty}`);
      lines.push(parts.join(', '));
    }

    lines.push('', `*Total Qty: ${p.total_qty || 0}*`);
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  }

  return (
    <div className="min-h-screen bg-[#0a0f14] text-[#e6edf3]">
      <TopNav title="MJM // SCAN" back={active ? undefined : '/dashboard'} user={staffName} theme="dark" />
      {active ? (
        <Scanner
          consent={active}
          lastInfo={lastInfo}
          issuing={issuing}
          activeDOs={activeDOs}
          onScan={recordScan}
          onBack={() => setActiveId(null)}
          onIssueDO={() => openIssueDO(active)}
        />
      ) : (
        <ConsentList consents={consents} todayALs={todayALs} loaded={serverConsents !== null} syncing={syncing} onSync={sync} onOpen={setActiveId} />
      )}

      {doEntry && (
        <EntryModal
          al={doEntry.al}
          plots={doPlots}
          breeds={doBreeds}
          photoBase64={null}
          initialQty={doEntry.suggestQty}
          toast={(m) => flash(m, 'warn')}
          onSubmit={(args) => persistDO({ ...args, staff: staffName })}
          onSaved={onDoSaved}
          onClose={() => setDoEntry(null)}
        />
      )}

      {printPrompt && (
        <div className="modal-overlay open" onClick={() => setPrintPrompt(null)}>
          <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">✅</div>
            <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">{t('do.doSavedTitle')}</div>
            <div className="text-sm font-bold text-slate-500 mb-1">{printPrompt.payload.do_number}</div>
            <div className="text-xs font-bold text-slate-400 mb-5">{t('do.printPrompt')}</div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { shareWhatsApp(printPrompt); setPrintPrompt(null); }}
                className="w-full py-3 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer"
                style={{ background: '#25D366' }}
              >
                {t('scan.shareWhatsApp')}
              </button>
              <button
                onClick={() => { doPrint(printPrompt); setPrintPrompt(null); }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer"
              >
                {t('do.yesPrint')}
              </button>
              <button
                onClick={() => setPrintPrompt(null)}
                className="w-full py-2.5 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 border border-slate-200 rounded-xl cursor-pointer"
              >
                {t('do.maybeLater')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed left-1/2 bottom-6 -translate-x-1/2 px-5 py-3 rounded-xl font-mono text-xs tracking-wider z-50 border bg-[#111821] ${
            toast.kind === 'danger'
              ? 'border-red-500 text-red-400'
              : toast.kind === 'warn'
              ? 'border-amber-400 text-amber-300'
              : toast.kind === 'done'
              ? 'border-emerald-400 text-emerald-300'
              : 'border-slate-600 text-slate-200'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ── Consent list view ──────────────────────────────────────────
function ConsentList({ consents, todayALs = {}, loaded, syncing, onSync, onOpen }) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const order = { over: 0, progress: 1, pending: 2, done: 3 };
  const bookedToday = (c) => c.al_number && c.al_number in todayALs;
  const pending = consents.filter((c) => !c.doIssued || (c.issuedQty || 0) < c.qty);
  const sorted = pending.slice().sort((a, b) => {
    const ta = bookedToday(a) ? 0 : 1;
    const tb = bookedToday(b) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (ta === 0) {
      const sa = todayALs[a.al_number] || '99:99';
      const sb = todayALs[b.al_number] || '99:99';
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
    const d = order[statusOf(a)] - order[statusOf(b)];
    return d !== 0 ? d : b.createdAt - a.createdAt;
  });

  const lower = query.trim().toLowerCase();
  const filtered = lower
    ? sorted.filter(
        (c) =>
          c.customer.toLowerCase().includes(lower) ||
          (c.al_number && c.al_number.toLowerCase().includes(lower))
      )
    : sorted;

  return (
    <div className="max-w-[560px] mx-auto px-4 py-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-mono text-xl font-extrabold tracking-tight">{t('scan.brandTitle')}</h1>
        <button
          onClick={onSync}
          disabled={syncing}
          className="shrink-0 bg-emerald-500 text-[#0a0f14] font-mono font-bold text-xs uppercase tracking-wider rounded-lg px-4 py-2.5 disabled:opacity-60"
        >
          {syncing ? t('scan.syncing') : '⟳ ' + t('scan.sync')}
        </button>
      </div>
      <p className="text-slate-400 text-sm mb-3">{t('scan.subtitle')}</p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('scan.searchPlaceholder')}
        className="w-full bg-[#0f1620] border border-[#1f2a38] text-slate-200 placeholder-slate-500 font-mono text-sm rounded-xl px-4 py-2.5 mb-4 outline-none focus:border-emerald-500 transition-colors"
      />

      <div className="flex flex-col gap-2.5">
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-slate-500 font-mono text-xs bg-[#0f1620] border border-dashed border-[#1f2a38] rounded-2xl px-4">
            {loaded ? (lower ? t('scan.noSearchResults') : t('scan.noneSynced')) : t('common.loading')}
          </div>
        ) : (
          filtered.map((c) => {
            const st = statusOf(c);
            const pct = c.qty > 0 ? Math.min(100, (c.unique / c.qty) * 100) : 0;
            const collected = c.issuedQty || 0;
            const balance = c.qty - collected;
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                className={`text-left bg-[#0f1620] border rounded-2xl px-4 py-3.5 transition-colors ${
                  st === 'over' ? 'border-red-500' : st === 'done' ? 'border-emerald-600' : 'border-[#1f2a38]'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    {bookedToday(c) && (
                      <span className="inline-block bg-amber-400 text-[#0a0f14] text-[9px] font-black rounded px-1.5 py-0.5 uppercase tracking-wider mb-1">
                        📅 {t('scan.today')} {todayALs[c.al_number]}
                      </span>
                    )}
                    <div className="font-semibold text-base break-words">{c.customer}</div>
                  </div>
                  <span className="bg-emerald-500 text-[#0a0f14] text-[11px] font-bold rounded-md px-3 py-1 uppercase shrink-0">{t('scan.start')}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-400 mt-1.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full border mr-1.5 text-[10px] tracking-widest ${
                      c.unique > collected ? 'text-amber-300 border-amber-400' : 'text-slate-400 border-[#1f2a38]'
                    }`}
                  >
                    {c.unique > collected ? t('scan.pendingIssueDO') : t('scan.pendingToScan')}
                  </span>
                  {collected > 0 && balance > 0
                    ? <>{t('scan.qty')} {c.qty} · Collected <b className="text-emerald-300">{collected}</b> · Balance <b className="text-amber-300">{balance}</b></>
                    : <>{t('scan.qty')} <b className="text-slate-200">{c.qty}</b> · {t('scan.scanned')} <b className="text-slate-200">{c.unique}</b></>
                  }
                  {c.over ? (
                    <>
                      {' '}
                      · {t('scan.over')} <b className="text-red-400">{c.over}</b>
                    </>
                  ) : null}
                  {c.al_number && !/^MANUAL-/i.test(c.al_number) ? ` · ${c.al_number}` : ''}
                </div>
                <div className="h-1 bg-[#0a0f14] rounded-full overflow-hidden mt-2">
                  <div className={`h-full ${st === 'over' ? 'bg-red-500' : st === 'done' ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: pct + '%' }} />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Scanner view ──────────────────────────────────────
function Scanner({ consent, lastInfo, issuing, activeDOs, onScan, onBack, onIssueDO }) {
  const { t } = useLang();
  const [scanning, setScanning] = useState(false);
  const [statusKey, setStatusKey] = useState('ready');
  const [viewDO, setViewDO] = useState(null);
  const [viewConsents, setViewConsents] = useState(null); // null=not loaded, []=empty
  const [loadingConsents, setLoadingConsents] = useState(false);
  const qrRef = useRef(null);
  const trackRef = useRef(null);
  const camStateRef = useRef('idle');
  const cancelRef = useRef(false);

  // Hardware (Bluetooth/USB) barcode scanner support. These scanners act as a
  // keyboard: they "type" the whole code in a fast burst, usually ending with
  // Enter or Tab. Once one is detected we remember it (localStorage) and show
  // the scanner-linked panel instead of opening the camera.
  const [hwMode, setHwMode] = useState(() => {
    try { return localStorage.getItem('mjm_hw_scanner') === '1'; } catch (e) { return false; }
  });
  const hwModeRef = useRef(hwMode);
  hwModeRef.current = hwMode;
  const wedgeRef = useRef({ chars: '', last: 0, timer: null });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  // Use the higher of localStorage-tracked qty and server-derived qty from activeDOs.
  // This ensures the correct balance even when DOs were issued through the AI system.
  const serverIssuedQty = activeDOs.reduce((sum, d) => sum + (d.total_qty || 0), 0);
  const issuedQty = Math.max(consent.issuedQty || 0, serverIssuedQty);
  // No floor here — a consent whose whole qty is already issued (balance 0)
  // has nothing left to scan for, and used to show a phantom "0/1, 1
  // remaining" from Math.max(1, ...) that let scanning carry on past a
  // fully collected order. fullyCollected below is what actually turns the
  // scan controls off.
  const sessionQty = Math.max(0, consent.qty - issuedQty);
  const fullyCollected = sessionQty === 0;
  // When issuedQty > consent.unique the DO was issued before any scanning (e.g. via
  // the AI system). In that case every scan in this module counts toward the current
  // balance, so use consent.unique directly rather than subtracting issuedQty.
  const sessionUnique = issuedQty > consent.unique
    ? consent.unique
    : Math.max(0, consent.unique - issuedQty);
  const remain = Math.max(0, sessionQty - sessionUnique);
  const st = statusOf(consent);
  const pct = sessionQty > 0 ? Math.min(100, (sessionUnique / sessionQty) * 100) : 0;
  const statusText = scanning
    ? st === 'over'
      ? t('scan.statusOver')
      : st === 'done'
      ? t('scan.statusDone')
      : t('scan.scanning')
    : t('scan.' + statusKey);

  // Open the DO detail modal and load the matching consent record.
  async function handleViewDO(d) {
    setViewDO(d);
    setViewConsents(null);
    const alNum = d.al_number || consent.al_number;
    if (!alNum || /^MANUAL-/i.test(alNum) || !navigator.onLine) {
      setViewConsents([]);
      return;
    }
    setLoadingConsents(true);
    try {
      const cs = await loadConsentsForAL(alNum);
      setViewConsents(cs);
    } catch (e) {
      setViewConsents([]);
    } finally {
      setLoadingConsents(false);
    }
  }

  function closeViewDO() {
    setViewDO(null);
    setViewConsents(null);
  }

  async function startCamera() {
    if (camStateRef.current !== 'idle') return;
    camStateRef.current = 'starting';
    cancelRef.current = false;
    ensureAudio();
    const config = {
      fps: 15,
      qrbox: (vw, vh) => ({
        width: Math.floor(Math.min(vw * 0.95, 460)),
        height: Math.floor(Math.min(vh * 0.7, 140)),
      }),
      aspectRatio: 2.2,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };

    const adv = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const attempts = [
      { facingMode: { ideal: 'environment' }, ...adv },
      { facingMode: 'environment' },
      { facingMode: 'user' },
      true,
    ];

    let started = false;
    let lastErr = null;
    for (const cam of attempts) {
      const qr = new Html5Qrcode('reader', { verbose: false });
      try {
        await qr.start(cam, config, onScan, () => {});
        qrRef.current = qr;
        started = true;
        break;
      } catch (e) {
        lastErr = e;
        try { await qr.clear(); } catch (_) { /* ignore */ }
      }
    }
    if (!started) {
      camStateRef.current = 'idle';
      throw lastErr || new Error('No camera available');
    }
    if (cancelRef.current) {
      try { await qrRef.current.stop(); await qrRef.current.clear(); } catch (_) { /* ignore */ }
      qrRef.current = null;
      camStateRef.current = 'idle';
      return;
    }

    try {
      const track = document.querySelector('#reader video')?.srcObject?.getVideoTracks?.()[0];
      trackRef.current = track || null;
      if (track?.applyConstraints) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    } catch (e) { /* optional */ }
    camStateRef.current = 'scanning';
    setScanning(true);
    setStatusKey('scanning');
  }

  async function refocus() {
    const track = trackRef.current;
    if (!track || !track.applyConstraints) return;
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const modes = caps.focusMode || [];
      if (modes.includes('single-shot')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
        setTimeout(() => {
          track.applyConstraints({ advanced: [{ focusMode: modes.includes('continuous') ? 'continuous' : 'single-shot' }] }).catch(() => {});
        }, 600);
      } else if (modes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {});
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
    } catch (e) { /* device doesn't support focus control */ }
  }

  async function stopCamera() {
    cancelRef.current = true;
    if (camStateRef.current === 'starting') return;
    if (camStateRef.current !== 'scanning') return;
    camStateRef.current = 'stopping';
    try {
      if (qrRef.current?.isScanning) {
        await qrRef.current.stop();
        await qrRef.current.clear();
      }
    } catch (e) { /* ignore */ }
    qrRef.current = null;
    camStateRef.current = 'idle';
    setScanning(false);
    setStatusKey('ready');
  }

  useEffect(() => {
    // Balance 0 — nothing left to scan for, so don't even open the camera.
    // See fullyCollected above and the camera panel's own conditional below.
    if (fullyCollected) { setStatusKey('ready'); return; }
    // A linked hardware scanner replaces the camera; the camera stays one tap
    // away via the "Use Camera Instead" button.
    if (hwModeRef.current) setStatusKey('hwLinked');
    else startCamera().catch(() => setStatusKey('ready'));
    return () => {
      cancelRef.current = true;
      if (qrRef.current?.isScanning) qrRef.current.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Covers the rarer case: the camera was already open when the balance hit
  // 0 out from under it (e.g. a DO for this same consent got issued from
  // another device mid-session) — stop scanning rather than let it keep
  // reading seals against an order that no longer has anything to collect.
  useEffect(() => {
    if (fullyCollected && scanning) stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullyCollected]);

  // Keyboard-wedge listener: catches the fast keystroke bursts a hardware
  // barcode scanner sends and routes them into the same recordScan flow as
  // camera reads. Also how a scanner is auto-detected the first time.
  useEffect(() => {
    function submitWedge(code) {
      ensureAudio();
      if (!hwModeRef.current) {
        try { localStorage.setItem('mjm_hw_scanner', '1'); } catch (e) { /* private mode */ }
        setHwMode(true);
        setStatusKey('hwLinked');
        stopCamera();
      }
      onScanRef.current(code);
    }
    function onKey(e) {
      const el = e.target;
      const tag = el && el.tagName;
      // Never swallow real typing into form fields (search box, DO modal...).
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      const b = wedgeRef.current;
      const now = Date.now();
      // Humans pause >250ms between keys; scanners blast the whole code.
      if (now - b.last > 250) b.chars = '';
      b.last = now;
      if (e.key === 'Enter' || e.key === 'Tab') {
        clearTimeout(b.timer);
        if (b.chars.length >= 3) {
          e.preventDefault();
          submitWedge(b.chars);
        }
        b.chars = '';
        return;
      }
      if (e.key.length === 1) {
        b.chars += e.key;
        clearTimeout(b.timer);
        // Scanners configured without an Enter suffix: flush after the burst.
        b.timer = setTimeout(() => {
          if (b.chars.length >= 6) submitWedge(b.chars);
          b.chars = '';
        }, 300);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(wedgeRef.current.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBack() {
    await stopCamera();
    onBack();
  }

  return (
    <div className="max-w-[560px] mx-auto px-4 py-5">
      <div className="flex items-center gap-2.5 mb-3">
        <button
          onClick={handleBack}
          title={t('common.back')}
          aria-label={t('common.back')}
          className="grid place-items-center bg-[#111821] border border-[#1f2a38] rounded-lg w-10 h-10 shrink-0"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight break-words">{consent.customer}</h2>
          <div className="font-mono text-[11px] text-slate-400">
            {issuedQty > 0
              ? `${t('scan.qty')} ${consent.qty} · Collected ${issuedQty} · Balance ${consent.qty - issuedQty}`
              : `${t('scan.qty')} ${consent.qty}`}
            {consent.al_number && !/^MANUAL-/i.test(consent.al_number) ? ` · ${consent.al_number}` : ''}
          </div>
        </div>
        <div className={`ml-auto font-mono text-[11px] tracking-wider ${st === 'over' ? 'text-red-400' : st === 'done' ? 'text-amber-300' : scanning ? 'text-emerald-400' : 'text-slate-400'}`}>
          {statusText}
        </div>
      </div>

      {fullyCollected ? (
        <div className="bg-[#0f1620] border border-emerald-600/40 rounded-2xl p-6 mb-3 flex flex-col items-center text-center gap-1.5">
          <div className="text-3xl">✅</div>
          <div className="font-mono text-sm font-bold text-emerald-400 uppercase tracking-wider">{t('scan.fullyCollected')}</div>
          <div className="font-mono text-[11px] text-slate-400">{t('scan.fullyCollectedHint')}</div>
        </div>
      ) : (
        <div className="bg-[#0f1620] border border-[#1f2a38] rounded-2xl p-3 mb-3">
          {/* #reader must stay mounted (html5-qrcode targets it by id), so it is
              hidden — not removed — while the hardware-scanner panel shows. */}
          <div
            id="reader"
            onClick={scanning ? refocus : undefined}
            className={`rounded-xl overflow-hidden bg-black min-h-[160px] cursor-pointer ${hwMode && !scanning ? 'hidden' : ''}`}
          />
          {hwMode && !scanning && (
            <div className="rounded-xl bg-[#0a0f14] border border-emerald-600/40 min-h-[160px] flex flex-col items-center justify-center gap-2.5 px-4 text-center">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div className="font-mono text-sm font-bold text-emerald-400 uppercase tracking-wider">🔗 {t('scan.hwTitle')}</div>
              <div className="font-mono text-[11px] text-slate-400">{t('scan.hwReady')}</div>
            </div>
          )}
          {scanning && (
            <div className="text-center text-[10px] font-mono text-slate-500 mt-1.5">{t('scan.focusHint')}</div>
          )}
          <div className="flex gap-2 mt-2.5">
            {hwMode && !scanning ? (
              <button
                onClick={() => {
                  setHwMode(false);
                  try { localStorage.removeItem('mjm_hw_scanner'); } catch (e) { /* ignore */ }
                  setTimeout(() => startCamera().catch((e) => { setStatusKey('error'); alert(t('scan.cameraError', { msg: e?.message || e })); }), 50);
                }}
                className="flex-1 bg-[#111821] border border-[#1f2a38] text-slate-200 font-mono font-bold text-xs uppercase tracking-wider rounded-lg py-3.5"
              >
                {t('scan.hwUseCamera')}
              </button>
            ) : (
              <>
                <button
                  onClick={() => (scanning ? stopCamera() : startCamera().catch((e) => { setStatusKey('error'); alert(t('scan.cameraError', { msg: e?.message || e })); }))}
                  className="flex-1 bg-emerald-500 text-[#0a0f14] font-mono font-bold text-xs uppercase tracking-wider rounded-lg py-3.5"
                >
                  {scanning ? t('scan.stopCamera') : t('scan.startCamera')}
                </button>
                {scanning && (
                  <button
                    onClick={refocus}
                    className="shrink-0 bg-[#111821] border border-[#1f2a38] text-emerald-400 font-mono font-bold text-xs uppercase tracking-wider rounded-lg px-4 py-3.5"
                  >
                    🎯 {t('scan.refocus')}
                  </button>
                )}
              </>
            )}
          </div>
          {!hwMode && (
            <div className="text-center text-[10px] font-mono text-slate-500 mt-2">{t('scan.hwHint')}</div>
          )}
        </div>
      )}

      <div className={`bg-[#0f1620] border rounded-2xl px-5 py-4 text-center mb-3 ${st === 'over' ? 'border-red-500' : 'border-[#1f2a38]'}`}>
        <div className="font-mono text-[10px] tracking-[0.3em] text-slate-400 uppercase mb-1.5">{t('scan.sealsScanned')}</div>
        <div className={`font-mono text-[56px] font-extrabold leading-none ${st === 'over' ? 'text-red-500' : st === 'done' ? 'text-amber-400' : 'text-emerald-400'}`}>
          {sessionUnique}
          <span className="text-[22px] text-slate-500 ml-1">/{sessionQty}</span>
        </div>
        <div className="h-1.5 bg-[#0a0f14] rounded-full overflow-hidden mt-2.5 border border-[#1f2a38]">
          <div className={`h-full ${st === 'over' ? 'bg-red-500' : st === 'done' ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: pct + '%' }} />
        </div>
        {st === 'over' && (
          <div className="mt-3 bg-red-500/10 border border-red-500 text-red-400 rounded-lg p-3 font-mono text-xs">
            {t('scan.overBanner', { u: sessionUnique, q: sessionQty, e: sessionUnique - sessionQty })}
          </div>
        )}
        <div className="grid mt-2.5">
          <div className="bg-[#0a0f14] border border-[#1f2a38] rounded-lg px-3 py-2 flex justify-between items-center">
            <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">{t('scan.remaining')}</span>
            <span className={`font-mono text-lg font-bold ${sessionUnique > sessionQty ? 'text-red-400' : 'text-slate-100'}`}>{remain}</span>
          </div>
        </div>
        <div className={`mt-2 font-mono text-xs break-all ${st === 'over' ? 'text-red-400' : 'text-slate-400'}`}>{t(lastInfo.key, lastInfo.vars)}</div>
      </div>

      <div className="bg-[#0f1620] border border-[#1f2a38] rounded-2xl p-5 mb-3">
        <div className="flex justify-between items-center mb-3">
          <div className="font-mono text-[11px] tracking-[0.3em] text-slate-400 uppercase">{t('scan.scanLog')}</div>
          <div className="font-mono text-[11px] text-emerald-400">{t('scan.entries', { n: consent.scans.length })}</div>
        </div>
        <div className="max-h-[240px] overflow-y-auto font-mono text-xs">
          {consent.scans.length === 0 ? (
            <div className="text-center py-6 text-slate-500">{t('scan.noScans')}</div>
          ) : (
            // consent.scans is stored newest-first (each new scan is
            // prepended — see recordScan/pushScan). Capped at the 100 most
            // recent before reversing (slice(0,100) already returns a new
            // array, so reverse() here is safe and never mutates
            // consent.scans itself) — "ascending" means oldest-of-those-
            // 100 first, not the very first scan ever made once there are
            // more than 100.
            consent.scans.slice(0, 100).reverse().map((s, i) => (
              <div key={i} className="flex justify-between items-center gap-2 py-2 border-b border-[#1f2a38] last:border-0 text-slate-400">
                <span className={`flex-1 break-all ${s.over ? 'text-red-400' : 'text-slate-200'}`}>{s.code}</span>
                {s.over && <span className="text-[9px] text-red-400 tracking-widest uppercase">{t('scan.statusOver')}</span>}
                <span className="text-[10px] shrink-0">{s.time}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        disabled={issuing || fullyCollected}
        onClick={async () => {
          await stopCamera();
          onIssueDO();
        }}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-mono font-bold text-sm uppercase tracking-wider rounded-xl py-4 mb-3 flex items-center justify-center gap-2"
      >
        📋 {issuing ? t('do.saving') : t('scan.issueDO')}
      </button>

      {activeDOs.length > 0 && (
        <div className="bg-[#0f1620] border border-[#1f2a38] rounded-2xl p-4 mb-3">
          <div className="font-mono text-[11px] tracking-[0.3em] text-slate-400 uppercase mb-2">
            {t('scan.issuedDOs')}
          </div>
          <div className="space-y-1.5">
            {activeDOs.map((d) => (
              <div
                key={d.id}
                onClick={() => handleViewDO(d)}
                className="flex justify-between items-center gap-2 py-1.5 border-b border-[#1f2a38] last:border-0 cursor-pointer hover:bg-[#1a2332] rounded-lg px-1 -mx-1 transition-colors"
              >
                <span className="font-mono text-xs text-slate-200 flex-1 min-w-0 truncate">{d.do_number}</span>
                <span className="font-mono text-[10px] text-slate-400 shrink-0">{d.delivery_date || '—'}</span>
                <span className="font-mono text-[10px] text-emerald-400 shrink-0">{t('scan.qty')} {d.total_qty}</span>
                <span className="font-mono text-[9px] text-slate-500 shrink-0">›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewDO && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={closeViewDO}
        >
          <div
            className="bg-[#0f1620] border border-[#1f2a38] rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-[#0f1620] border-b border-[#1f2a38] rounded-t-3xl px-5 pt-5 pb-4 flex justify-between items-start">
              <div>
                <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase mb-1">Issued DO</div>
                <div className="font-mono text-base font-extrabold text-white">{viewDO.do_number}</div>
                <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                  {viewDO.delivery_date || '—'}
                  <span className="text-emerald-400 font-bold ml-3">Total: {viewDO.total_qty}</span>
                </div>
              </div>
              <button
                onClick={closeViewDO}
                className="w-8 h-8 rounded-xl bg-[#1f2a38] text-slate-300 hover:text-white font-bold flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* DO items */}
              <div className="space-y-2">
                {[1, 2, 3, 4, 5]
                  .filter((n) => viewDO[`plot_${n}`] || viewDO[`breed_${n}`] || viewDO[`qty_${n}`])
                  .map((n) => (
                    <div key={n} className="bg-[#0a0f14] border border-[#1f2a38] rounded-xl px-3 py-2.5">
                      <div className="flex justify-between items-center">
                        <div className="font-mono text-xs">
                          {viewDO[`plot_${n}`] && <span className="text-slate-200">{viewDO[`plot_${n}`]}</span>}
                          {viewDO[`breed_${n}`] && <span className="text-slate-400 ml-2">· {viewDO[`breed_${n}`]}</span>}
                        </div>
                        <span className="font-mono text-sm font-bold text-emerald-400 ml-3">×{viewDO[`qty_${n}`]}</span>
                      </div>
                    </div>
                  ))}
              </div>
              {viewDO.remark && (
                <div className="font-mono text-[10px] text-slate-400">{viewDO.remark}</div>
              )}

              {/* Signed DO photo */}
              {viewDO.image_url && (
                <div>
                  <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase mb-2">📄 Signed DO</div>
                  <a
                    href={viewDO.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-2xl overflow-hidden border border-[#1f2a38] hover:border-emerald-500 transition-colors"
                  >
                    <img
                      src={viewDO.image_url}
                      alt="Signed DO"
                      className="w-full object-contain"
                      style={{ maxHeight: '200px' }}
                    />
                    <div className="text-center font-mono text-[9px] text-slate-500 py-1.5">Tap to open full size ↗</div>
                  </a>
                </div>
              )}

              {/* Signed consent */}
              <div>
                <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase mb-2">✍️ Signed Consent</div>
                {loadingConsents || viewConsents === null ? (
                  <div className="font-mono text-[10px] text-slate-500 text-center py-3">Loading…</div>
                ) : viewConsents.length === 0 ? (
                  <div className="font-mono text-[10px] text-slate-500 text-center py-3">No consent record found</div>
                ) : (
                  viewConsents.map((c, i) => (
                    <div key={c.id || i} className="bg-[#0a0f14] border border-[#1f2a38] rounded-2xl p-3 mb-2">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-mono text-[9px] text-slate-400">
                          {c.created_at
                            ? new Date(c.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </div>
                        <span className="font-mono text-[10px] font-bold text-emerald-400">{(c.consent_qty || 0)} seedlings</span>
                      </div>
                      {/* Sticker photo */}
                      {c.photo_url && (
                        <div className="mb-2">
                          <div className="font-mono text-[8px] text-slate-500 uppercase tracking-widest mb-1">📷 Sticker Photo</div>
                          <a
                            href={c.photo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block rounded-xl overflow-hidden border border-[#1f2a38] hover:border-blue-500 transition-colors"
                          >
                            <img
                              src={c.photo_url}
                              alt="Sticker photo"
                              className="w-full object-contain"
                              style={{ maxHeight: '140px' }}
                            />
                          </a>
                        </div>
                      )}
                      {/* Signature */}
                      {c.signature_data && (
                        <div>
                          <div className="font-mono text-[8px] text-slate-500 uppercase tracking-widest mb-1">✍️ Customer Signature</div>
                          <div className="bg-white rounded-xl p-2">
                            <img
                              src={c.signature_data}
                              alt="Customer Signature"
                              style={{ height: '52px', maxWidth: '100%', objectFit: 'contain' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

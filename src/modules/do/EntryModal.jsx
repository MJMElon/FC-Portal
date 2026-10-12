import { useEffect, useMemo, useRef, useState } from 'react';
import CfSelect from '../../components/CfSelect.jsx';
import SignaturePad from './SignaturePad.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import { callGemini, compressImage, DO_SCAN_PROMPT } from '../../lib/gemini.js';
import { generateDONumber, offlineDONumber, loadPlotBreeds, loosePlot } from './data.js';
import { batchKey, batchesIn } from '../maintenance/plotBatches.js';
import { rowQty, lineCount, totalQty as sumQty, scanTally, applyScannedQty } from './qty.js';

/* picks is the batches chosen on this row, each with its OWN quantity:
   [{ batch, breed, qty }]. One delivery order line per batch, because
   that is the only shape the rest of the system can read -- see
   expandRows below. batch/breed/qty on the row itself are still used for
   a plot that offers no batches at all. */
/* B1, B2, B3 ... B10, B11 -- not B1, B10, B11, B2.
   A plain sort compares "B10" and "B2" letter by letter, so the 1 beats
   the 2 and a conductor scrolling for B4 finds it after B39. Split the
   name into its letters, its NUMBER and whatever follows (a -R transfer
   plot keeps its suffix), and compare the number as a number. A plot with
   no digits at all falls back to comparing the text. */
function comparePlots(a, b) {
  const part = (v) => {
    const m = /^([A-Za-z]*)(\d*)(.*)$/.exec(String(v == null ? '' : v).trim());
    return m ? { pre: m[1].toUpperCase(), n: m[2] === '' ? null : parseInt(m[2], 10), rest: m[3].toUpperCase() }
             : { pre: '', n: null, rest: '' };
  };
  const x = part(a), y = part(b);
  if (x.pre !== y.pre) return x.pre < y.pre ? -1 : 1;
  if (x.n === null || y.n === null) {
    return String(a).localeCompare(String(b));
  }
  if (x.n !== y.n) return x.n - y.n;
  /* Same number: the bare plot first, then its -R and anything else. */
  if (x.rest !== y.rest) return x.rest < y.rest ? -1 : 1;
  return 0;
}

const emptyRow = () => ({ key: Math.random().toString(36).slice(2), nursery: '', plot: '', picks: [], batch: '', breed: '', qty: '', ai: false });

// Add / scan a new Delivery Order for the given AL.
// props: al, plots, breeds, photoBase64 (null for manual),
//        onSaved(payload, sigDataUrl, queued, photoBase64, savedRow), onClose, toast
export default function EntryModal({ al, plots, breeds, batchMap, photoBase64, initialQty, scannedQty, onSubmit, onSaved, onClose, toast }) {
  const { t } = useLang();
  const [doNumber, setDoNumber] = useState('…');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customer, setCustomer] = useState(al?.customer_name || '');
  const [rows, setRows] = useState(() => {
    const r = emptyRow();
    if (initialQty) r.qty = String(initialQty);
    return [r];
  });
  const [aiState, setAiState] = useState(photoBase64 ? 'loading' : 'manual');
  const [saving, setSaving] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const sigRef = useRef(null);
  const photoInputRef = useRef(null);

  async function onPhotoPicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result);
      setCapturedPhoto(compressed);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const nurseryOptions = useMemo(
    () => [...new Set((plots || []).map((p) => p.nursery_name).filter(Boolean))].sort(),
    [plots]
  );
  const plotOptions = useMemo(
    () => [...new Set((plots || []).map((p) => p.plot_name).filter(Boolean))].sort(comparePlots),
    [plots]
  );
  /* Which batches stand in the row plot, straight off the Nursery Movement
     Report. Empty for a plot with nothing standing, a PN plot (no main
     nursery movement), or a map that could not be read — in all three the
     batch row simply does not appear and the form works as it did. */
  const batchesFor = (plot) => (plot && batchMap ? batchesIn(batchMap, plot) : []);

  /* The breed of each batch IN A PLOT, keyed by plot. Fetched when a plot
     is chosen and kept, so switching back and forth does not ask twice.
     A breed belongs to the plot and batch together: one batch can be
     transplanted into several plots, and it is the log that put it into
     THIS plot that says what went in. */
  const [plotBreeds, setPlotBreeds] = useState(() => ({}));
  const ledgerBreed = (plot, batch) => {
    const m = plotBreeds[loosePlot(plot)];
    return (m && batch) ? (m.get(batchKey(batch)) || '') : '';
  };

  /* One read per plot the form is actually using, filtered to the batches
     standing in it. Never the whole ledger. */
  useEffect(() => {
    let live = true;
    const wanted = [...new Set(rows.map((r) => r.plot).filter(Boolean))];
    for (const plot of wanted) {
      const key = loosePlot(plot);
      if (!key || plotBreeds[key]) continue;
      const names = batchesFor(plot).map((b) => b.batch);
      if (!names.length) continue;
      loadPlotBreeds(plot, names).then((m) => {
        if (!live) return;
        setPlotBreeds((prev) => (prev[key] ? prev : { ...prev, [key]: m }));
        /* A batch tapped before the read came back carries no breed yet.
           Fill those in now rather than leaving a line that will print
           with the breed blank. */
        setRows((rs) => rs.map((r) => (loosePlot(r.plot) !== key ? r : {
          ...r,
          picks: (r.picks || []).map((pk) => (pk.breed ? pk
            : { ...pk, breed: m.get(batchKey(pk.batch)) || '' })),
        })));
      }, () => {});
    }
    return () => { live = false; };
  }, [rows, batchMap]);

  /* Tap a batch to add it to the row, tap it again to take it off. Each
     one carries its own quantity, and its breed comes off the ledger when
     it is added -- the breed is a fact about the batch, so there is one
     place it can come from and no second way to say it.

     Refused at five lines, because the record has five slots. Silently
     dropping the sixth at save time would mean a Field Conductor signing
     a delivery order for more than it records. */
  function togglePick(rowKey, batch) {
    setRows((rs) => {
      const row = rs.find((r) => r.key === rowKey);
      const on = row && (row.picks || []).some((p) => p.batch === batch);
      if (!on && lineCount(rs) >= MAX_LINES) { toast(t('do.maxRows')); return rs; }
      return rs.map((r) => {
        if (r.key !== rowKey) return r;
        const picks = r.picks || [];
        return {
          ...r,
          picks: picks.some((p) => p.batch === batch)
            ? picks.filter((p) => p.batch !== batch)
            : [...picks, { batch, breed: ledgerBreed(r.plot, batch), qty: '' }],
        };
      });
    });
  }
  function updatePick(rowKey, batch, field, value) {
    setRows((rs) => rs.map((r) => (r.key !== rowKey ? r : {
      ...r,
      picks: (r.picks || []).map((p) => (p.batch === batch ? { ...p, [field]: value } : p)),
    })));
  }


  function plotOptionsForRow(nursery) {
    if (!nursery) return plotOptions;
    const filtered = (plots || []).filter((p) => p.nursery_name === nursery).map((p) => p.plot_name).filter(Boolean);
    return [...new Set(filtered)].sort(comparePlots);
  }

  const withCurrent = (list, val) => (val && !list.includes(val) ? [val, ...list] : list);

/* ── ONE DELIVERY ORDER LINE PER BATCH ───────────────────────────────
   A row can name several batches, and each becomes its own line with its
   own quantity. It cannot be one line naming several, and that is not a
   layout choice -- it is what the readers can take.

   The office movement report does

       const bk = _mvBatchKey(dRec[`batch_${i}`]);
       const batch = [...r.batches].find(x => _mvBatchKey(x) === bk);
       if (!batch) continue;

   so "256,268" matches no batch and the WHOLE SALE disappears from the
   report. The phone reader, plotBatches.js, splits differently and would
   take 256 alone and subtract the whole quantity from it. One column, two
   wrong answers, neither of them visible. So the form carries the several
   and the record keeps them apart.

   It is also the only honest answer to "how many came off each", which a
   single shared quantity cannot give. */
function expandRows(rows) {
  const out = [];
  for (const r of rows) {
    const nursery = (r.nursery || '').trim();
    const plot = (r.plot || '').trim();
    if (r.picks && r.picks.length) {
      for (const p of r.picks) {
        out.push({ nursery, plot, batch: (p.batch || '').trim(),
                   breed: (p.breed || '').trim(), qty: parseInt(p.qty) || 0 });
      }
    } else {
      out.push({ nursery, plot, batch: (r.batch || '').trim(),
                 breed: (r.breed || '').trim(), qty: parseInt(r.qty) || 0 });
    }
  }
  return out;
}
/* Five slots on the record — plot_1..plot_5 — so five LINES, not five
   rows. A row naming three batches spends three of them. */
const MAX_LINES = 5;

  const totalQty = sumQty(rows);
  /* What the scanner counted onto the lorry, and whether the lines add
     up to it. Nought, and every bit of this is inert -- see qty.js. */
  const scan = scanTally(rows, scannedQty);
  /* One line: the scanned count IS the quantity, so it is filled in
     rather than keyed. More than one: whatever the scan filled in is
     withdrawn, because only the conductor knows the split. */
  useEffect(() => {
    if (!scannedQty) return;
    setRows((rs) => applyScannedQty(rs, scannedQty));
  }, [scannedQty, rows]);
  const balance = al?.balance_quantity ?? 0;
  const remain = balance - totalQty;
  const customerMatch = customer.trim().toLowerCase() === (al?.customer_name || '').toLowerCase();

  useEffect(() => {
    if (!navigator.onLine) {
      setDoNumber(offlineDONumber(al));
      return;
    }
    generateDONumber(al)
      .then(setDoNumber)
      .catch(() => setDoNumber(offlineDONumber(al)));
  }, []);

  useEffect(() => {
    if (!photoBase64) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await callGemini(photoBase64, 'image/jpeg', DO_SCAN_PROMPT);
        if (cancelled) return;
        const items = (result.items || []).slice(0, 5);
        if (items.length) {
          setRows(items.map((it) => ({ key: Math.random().toString(36).slice(2), nursery: it.nursery || '', plot: '', picks: [], batch: '', breed: it.breed || '', qty: it.quantity || '', ai: true })));
        }
        if (result.date) setDate(result.date);
        if (result.customer_name) setCustomer(result.customer_name);
        setAiState(items.length ? 'done' : 'failed');
      } catch (e) {
        if (!cancelled) setAiState('failed');
      }
    })();
    return () => { cancelled = true; };
  }, [photoBase64]);

  function updateRow(key, field, value) {
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const updated = { ...r, [field]: value };
      if (field === 'nursery') updated.plot = '';
      /* The batches belong to the plot. Moving the row to another plot
         must take them with it, or a line goes out naming a batch that
         never stood there. */
      if (field === 'nursery' || field === 'plot') updated.picks = [];
      return updated;
    }));
  }
  function addRow() {
    setRows((rs) => (lineCount(rs) >= MAX_LINES ? (toast(t('do.maxRows')), rs) : [...rs, emptyRow()]));
  }
  function removeRow(key) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));
  }

  async function save() {
    const items = expandRows(rows)
      .filter((it) => it.nursery || it.plot || it.batch || it.breed || it.qty > 0);
    if (items.length > MAX_LINES) return alert(t('do.maxRows'));
    if (!date) return alert(t('do.selectDate'));
    if (!items.length) return alert(t('do.addItem'));
    if (totalQty <= 0) return alert(t('do.qtyGtZero'));
    /* The scanner counted them onto the lorry. A delivery order issued
       off that scan and signed for a different number is a record that
       disagrees with the count it came from, so it does not save. */
    if (!scan.tallies) return alert(t('do.mustTallyScan', { t: totalQty, s: scan.scanned }));
    if (totalQty > balance) return alert(t('do.exceedsBalance', { t: totalQty, b: balance }));
    if (!sigRef.current?.hasSig()) return alert(t('do.pleaseSign'));

    const sigDataUrl = sigRef.current.toDataURL();
    setSaving(true);

    const payload = {
      do_number: doNumber,
      al_number: al.al_number,
      delivery_date: date,
      total_qty: totalQty,
      remark: al.customer_name,
      status: 'Delivered',
    };
    // Store plot name in plot_N: prefer explicit plot selection, fall back to nursery name.
    items.slice(0, 5).forEach((it, i) => {
      const n = i + 1;
      payload[`plot_${n}`] = it.plot || it.nursery || null;
      /* Saved so the DO says which block the seedlings came off, which is
         what the culling calculator matches its collected figure on. The PDF
         is untouched: lib/pdf.js names plot_N, breed_N and qty_N one by one
         and never walks the columns, so a new one cannot appear on a
         customer copy. */
      payload[`batch_${n}`] = it.batch || null;
      payload[`breed_${n}`] = it.breed || null;
      payload[`qty_${n}`] = it.qty || null;
    });

    let res;
    try {
      res = await onSubmit({ payload, photoBase64: capturedPhoto || photoBase64, al, sigDataUrl });
    } catch (e) {
      setSaving(false);
      return alert(t('do.saveError', { msg: e.message }));
    }
    setSaving(false);
    onSaved(res.payload, sigDataUrl, res.queued, capturedPhoto || photoBase64, res.savedRow || null);
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 rounded-t-[24px] flex justify-between items-start" style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }}>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
              {photoBase64 ? t('do.aiScanLabel') : t('do.manualLabel')}
            </div>
            <div className="text-lg font-black text-white">{t('do.newDeliveryOrder')}</div>
            <div className="text-[11px] font-bold text-slate-400 mt-1">
              <span className="text-white font-black">{al?.al_number || '—'}</span>
              <span className="text-amber-400 mx-2">✶</span>
              <span className="text-slate-300">{al?.customer_name || '—'}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center shrink-0 ml-4">✕</button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {photoBase64 && (
            <div className="rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-50" style={{ maxHeight: 200 }}>
              <img src={photoBase64} alt="DO" className="w-full object-contain" style={{ maxHeight: 200 }} />
            </div>
          )}

          {aiState === 'loading' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🤖</div>
              <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{t('do.aiReading')}</div>
            </div>
          )}

          {aiState !== 'loading' && (
            <>
              {aiState === 'failed' && (
                <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  {t('do.aiFailed')}
                </div>
              )}
              {aiState === 'done' && (
                <div className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 uppercase tracking-wider">
                  {t('do.aiComplete')}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">{t('do.doNumber')} <span className="text-blue-500">AUTO</span></label>
                  <input value={doNumber} readOnly className="search-input text-sm font-black bg-blue-50 border-blue-200 w-full" style={{ padding: '9px 12px' }} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">{t('do.deliveryDate')}</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="search-input text-sm w-full" style={{ padding: '9px 12px' }} />
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">{t('do.customerNameLabel')}</label>
                <div className="flex gap-2 items-center">
                  <input value={customer} onChange={(e) => setCustomer(e.target.value)} className="search-input text-sm flex-1" style={{ padding: '9px 12px' }} />
                  {customer.trim() && (
                    <div className={`shrink-0 text-[10px] font-black px-3 py-2 rounded-xl border ${customerMatch ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      {customerMatch ? t('do.match') : t('do.mismatch')}
                    </div>
                  )}
                </div>
              </div>

              {/* Items — card layout, mobile-friendly */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('do.itemsLabel')} <span className="text-slate-300">{t('do.maxRowsNote')}</span></label>
                  {rows.length < 5 && (
                    <button onClick={addRow} className="text-[9px] font-black text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg cursor-pointer uppercase tracking-widest">{t('do.addRow')}</button>
                  )}
                </div>
                {/* WHAT THE SCANNER COUNTED, kept on screen for the
                    whole of the form. It is the figure this delivery
                    order is being issued for, so it is not a default
                    that disappears into a box -- the conductor is
                    splitting it between batches and has to be able to
                    see what they are splitting. */}
                {scan.scanned > 0 && (
                  <div className={`rounded-2xl border px-4 py-2.5 mb-2 ${scan.tallies ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{t('do.scannedLabel')}</span>
                      <span className="text-lg font-black tabular-nums text-slate-800">{scan.scanned.toLocaleString()}</span>
                    </div>
                    <div className={`text-[10px] font-bold leading-tight mt-0.5 ${scan.tallies ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {scan.auto
                        ? t('do.scanOneLine')
                        : scan.left === 0
                          ? t('do.scanTallies')
                          : scan.left > 0
                            ? t('do.scanShort', { n: scan.left })
                            : t('do.scanOver', { n: -scan.left })}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {rows.map((r, i) => {
                    const rowPlotOpts = plotOptionsForRow(r.nursery);
                    return (
                      <div key={r.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            {t('do.itemLabel')} {i + 1}
                            {r.ai && <span className="ml-2 text-emerald-600 normal-case">✨ AI</span>}
                          </span>
                          {rows.length > 1 && (
                            <button
                              onClick={() => removeRow(r.key)}
                              className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 font-black text-base leading-none flex items-center justify-center border-none cursor-pointer"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className="space-y-2.5">
                          {/* Nursery — button toggle group */}
                          <div className="flex flex-wrap gap-1.5">
                            {withCurrent(nurseryOptions, r.nursery).map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => updateRow(r.key, 'nursery', r.nursery === n ? '' : n)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-black border cursor-pointer transition-colors ${
                                  r.nursery === n
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          {/* Plot — dropdown, filtered by selected nursery */}
                          <CfSelect
                            value={r.plot}
                            onChange={(e) => updateRow(r.key, 'plot', e.target.value)}
                          >
                            <option value="">{t('do.plotPlaceholder')}</option>
                            {withCurrent(rowPlotOpts, r.plot).map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </CfSelect>
                          {/* Batch — what is standing in that plot, per the
                              Nursery Movement Report. Number, balance and
                              breed on one tile: three facts about one block
                              of ground, read together. Tap more than one. */}
                          {batchesFor(r.plot).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {batchesFor(r.plot).map((b) => {
                                const bBreed = ledgerBreed(r.plot, b.batch);
                                const on = (r.picks || []).some((p) => p.batch === b.batch);
                                return (
                                  <button
                                    key={b.batch}
                                    type="button"
                                    onClick={() => togglePick(r.key, b.batch)}
                                    className={`px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                                      on
                                        ? 'bg-amber-600 text-white border-amber-600'
                                        : 'bg-white text-slate-600 border-slate-300 hover:border-amber-400'
                                    }`}
                                  >
                                    <div className="text-[12px] font-black leading-tight">{b.batch}</div>
                                    <div className={`text-[11px] font-bold tabular-nums leading-tight ${on ? 'opacity-80' : 'text-slate-500'}`}>
                                      {Number(b.qty || 0).toLocaleString()}
                                    </div>
                                    {/* A batch nobody has recorded a breed for
                                        shows no line, rather than an empty one
                                        pretending to be an answer. */}
                                    {bBreed && (
                                      <div className={`text-[10px] font-bold leading-tight ${on ? 'opacity-80' : 'text-slate-400'}`}>
                                        {bBreed}
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* One quantity per batch chosen. A single figure
                              shared across several batches cannot say how
                              many came off each, and that is the one thing
                              the movement report needs from a delivery
                              order. The breed is shown here, not asked for:
                              it is the ledger answer for that batch. */}
                          {(r.picks || []).map((p) => (
                            <div key={p.batch} className="flex items-center gap-2 pl-1">
                              <div className="min-w-[92px]">
                                <div className="text-[12px] font-black text-slate-700 leading-tight">{p.batch}</div>
                                {p.breed
                                  ? <div className="text-[10px] font-bold text-slate-400 leading-tight">{p.breed}</div>
                                  : <div className="text-[10px] font-bold text-amber-600 leading-tight">{t('do.noBreedOnBatch')}</div>}
                              </div>
                              <input
                                type="number"
                                min="0"
                                value={p.qty}
                                onChange={(e) => updatePick(r.key, p.batch, 'qty', e.target.value)}
                                readOnly={scan.auto}
                                placeholder="0"
                                className={`search-input text-sm w-28 ${scan.auto ? 'bg-emerald-50 border-emerald-200 font-black' : ''}`}
                              />
                              {scan.auto && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">{t('do.fromTheScan')}</span>
                              )}
                            </div>
                          ))}

                          {/* No breed chips. The breed is a fact about the
                              plot and batch, read off the ledger, and asking
                              for it by hand is a second way to say one thing.

                              The quantity box stays, for a plot that offers no
                              batches -- a PN plot, or a balance read that
                              failed -- or the row could record nothing at all.

                              What this costs, so the next person is not
                              surprised: such a line saves with breed_N empty,
                              and breed_N is on the customer PDF. */}
                          {batchesFor(r.plot).length === 0 && (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                value={r.qty}
                                onChange={(e) => updateRow(r.key, 'qty', e.target.value)}
                                readOnly={scan.auto}
                                placeholder="0"
                                className={`search-input text-sm w-28 ${scan.auto ? 'bg-emerald-50 border-emerald-200 font-black' : ''}`}
                              />
                              {scan.auto && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">{t('do.fromTheScan')}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[10px] font-bold text-slate-400 mt-2 text-right">
                  {t('do.totalQtyLabel')} <span className="font-black text-slate-700">{totalQty}</span>
                  &nbsp;·&nbsp; {t('do.balanceLabel')} <span className={`font-black ${remain < 0 ? 'text-red-600' : 'text-blue-700'}`}>{remain}</span>
                </div>
              </div>

              {/* Photo: customer car plate with loaded seedlings */}
              <div className="border-t border-slate-100 pt-4">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('do.photoTitle')}</div>
                <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />
                {capturedPhoto ? (
                  <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-200 bg-slate-50">
                    <img src={capturedPhoto} alt="DO photo" className="w-full object-contain" style={{ maxHeight: 200 }} />
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-widest text-white bg-black/60 px-3 py-2 rounded-xl border-none cursor-pointer"
                    >
                      📷 {t('do.retakePhoto')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full py-4 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 text-emerald-700 font-black text-xs uppercase tracking-widest cursor-pointer flex items-center justify-center gap-2"
                  >
                    📷 {t('do.takePhoto')}
                  </button>
                )}
                <p className="text-[10px] font-bold text-slate-300 mt-1.5">{t('do.photoHint')}</p>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('do.sigTitle')}</div>
                <p className="text-[10px] font-bold text-slate-300 mb-3">{t('do.sigNote')}</p>
                <SignaturePad ref={sigRef} height={160} />
              </div>

              <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
                <button onClick={onClose} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-5 py-2.5 rounded-full border border-slate-200 cursor-pointer">{t('common.cancel')}</button>
                <button onClick={save} disabled={saving} className="text-[10px] font-black text-white uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 px-7 py-2.5 rounded-xl border-none cursor-pointer disabled:opacity-60">
                  {saving ? t('do.saving') : t('do.saveSign')}
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import CfSelect from '../../components/CfSelect.jsx';
import SignaturePad from './SignaturePad.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import { callGemini, compressImage, DO_SCAN_PROMPT } from '../../lib/gemini.js';
import { generateDONumber, offlineDONumber } from './data.js';

const emptyRow = () => ({ key: Math.random().toString(36).slice(2), nursery: '', plot: '', breed: '', qty: '', ai: false });

// Add / scan a new Delivery Order for the given AL.
// props: al, plots, breeds, photoBase64 (null for manual), onSaved(payload, sigDataUrl), onClose, toast
export default function EntryModal({ al, plots, breeds, photoBase64, initialQty, onSubmit, onSaved, onClose, toast }) {
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
    () => [...new Set((plots || []).map((p) => p.plot_name).filter(Boolean))].sort(),
    [plots]
  );
  const breedOptions = useMemo(
    () => [...new Set((breeds || []).map((b) => b.name).filter(Boolean))].sort(),
    [breeds]
  );

  function plotOptionsForRow(nursery) {
    if (!nursery) return plotOptions;
    const filtered = (plots || []).filter((p) => p.nursery_name === nursery).map((p) => p.plot_name).filter(Boolean);
    return [...new Set(filtered)].sort();
  }

  const withCurrent = (list, val) => (val && !list.includes(val) ? [val, ...list] : list);

  const totalQty = rows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
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
          setRows(items.map((it) => ({ key: Math.random().toString(36).slice(2), nursery: it.nursery || '', plot: '', breed: it.breed || '', qty: it.quantity || '', ai: true })));
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
      return updated;
    }));
  }
  function addRow() {
    setRows((rs) => (rs.length >= 5 ? (toast(t('do.maxRows')), rs) : [...rs, emptyRow()]));
  }
  function removeRow(key) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));
  }

  async function save() {
    const items = rows
      .map((r) => ({ nursery: r.nursery.trim(), plot: r.plot.trim(), breed: r.breed.trim(), qty: parseInt(r.qty) || 0 }))
      .filter((it) => it.nursery || it.plot || it.breed || it.qty > 0);
    if (!date) return alert(t('do.selectDate'));
    if (!items.length) return alert(t('do.addItem'));
    if (totalQty <= 0) return alert(t('do.qtyGtZero'));
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
    onSaved(res.payload, sigDataUrl, res.queued, capturedPhoto || photoBase64);
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
                          {/* Breed — button toggle group */}
                          <div className="flex flex-wrap gap-1.5">
                            {withCurrent(breedOptions, r.breed).map((b) => (
                              <button
                                key={b}
                                type="button"
                                onClick={() => updateRow(r.key, 'breed', r.breed === b ? '' : b)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-black border cursor-pointer transition-colors ${
                                  r.breed === b
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                                }`}
                              >
                                {b}
                              </button>
                            ))}
                          </div>
                          {/* Qty */}
                          <input
                            type="number"
                            min="0"
                            value={r.qty}
                            onChange={(e) => updateRow(r.key, 'qty', e.target.value)}
                            placeholder="0"
                            className="search-input text-sm w-28"
                            style={{ padding: '8px 12px' }}
                          />
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

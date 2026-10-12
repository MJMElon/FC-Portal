import { useEffect, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import { loadDOsForAL, loadConsentsForAL, itemsFromRecord } from './data.js';

// Manage DOs for one AL: shows AL details, issued DO records, signed consent
// records, and an entry point to add a new DO.
// props: al, plots, onAddDO(), onPrint(doRec), onManageWorkers(doRec), onClose, refreshToken
export default function ManageModal({ al, plots, onAddDO, onPrint, onManageWorkers, onClose, refreshToken }) {
  const { t } = useLang();
  const [dos, setDos] = useState(null);
  const [consents, setConsents] = useState(null);

  const plotMap = {};
  plots.forEach((p) => { plotMap[p.plot_name] = p.nursery_name; });

  useEffect(() => {
    let alive = true;
    setDos(null);
    setConsents(null);
    loadDOsForAL(al.al_number).then((d) => alive && setDos(d)).catch(() => alive && setDos([]));
    loadConsentsForAL(al.al_number).then((c) => alive && setConsents(c)).catch(() => alive && setConsents([]));
    return () => { alive = false; };
  }, [al.al_number, refreshToken]);

  const totalIssued = (dos || [])
    .filter((d) => d.status !== 'Cancelled')
    .reduce((s, d) => s + (parseInt(d.total_qty) || 0), 0);

  const fields = [
    [t('do.fieldALNumber'), al.al_number || '—'],
    [t('do.fieldOrderNumber'), al.order_number || '—'],
    [t('do.fieldCustomerName'), al.customer_name || '—'],
    [t('do.fieldProduct'), al.product_name || '—'],
    [t('do.fieldQtyOrdered'), al.quantity_ordered ?? '—'],
    [t('do.fieldBalance'), al.balance_quantity ?? '—', true],
  ];

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 rounded-t-[24px] flex justify-between items-start" style={{ background: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)' }}>
          <div>
            <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">{t('do.deliveryOrders')}</div>
            <div className="text-xl font-black text-white tracking-wide">{t('do.manageForAL', { al: al.al_number })}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center shrink-0 ml-4">✕</button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fields.map(([label, value, isBal]) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                <div className={`font-black text-sm leading-snug ${isBal ? 'text-blue-700 text-base' : 'text-slate-800'}`}>{value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('do.doRecordsIssued')}</div>
              <button onClick={onAddDO} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-xl border-none cursor-pointer">
                {t('do.addDO')}
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>{t('do.colDeliveryDate')}</th><th>{t('do.colDONumber')}</th><th>{t('do.colNursery')}</th><th>{t('do.colBreed')}</th><th>{t('do.colQty')}</th><th>{t('do.colPhotoPrint')}</th></tr>
                </thead>
                <tbody>
                  {dos === null ? (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-400 text-xs font-bold uppercase tracking-widest">{t('common.loading')}</td></tr>
                  ) : dos.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-10"><div className="text-3xl mb-2">📭</div><div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{t('do.noDOs')}</div></td></tr>
                  ) : (
                    dos.map((d) => {
                      const lines = itemsFromRecord(d, plotMap);
                      const cancelled = d.status === 'Cancelled';
                      const dateFmt = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('en-MY') : '—';
                      return (
                        <tr key={d.id} className={cancelled ? 'opacity-50' : ''}>
                          <td className="text-slate-500 font-bold whitespace-nowrap">{dateFmt}</td>
                          <td><span className={`font-black ${cancelled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{d.do_number || '—'}</span></td>
                          <td className="text-slate-600 text-xs">{lines.length ? lines.map((l, i) => <div key={i}>{l.nursery}</div>) : '—'}</td>
                          <td className="text-slate-600 text-xs">{lines.length ? lines.map((l, i) => <div key={i}>{l.breed}</div>) : '—'}</td>
                          <td>{lines.length ? lines.map((l, i) => <div key={i} className="font-black text-emerald-700">{l.qty}</div>) : <span className="font-black text-emerald-700">{d.total_qty ?? '—'}</span>}</td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              {d.image_url ? (
                                <button onClick={() => window.open(d.image_url, '_blank')} className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 cursor-pointer bg-slate-50">
                                  <img src={d.image_url} className="w-full h-full object-cover" loading="lazy" alt="doc" />
                                </button>
                              ) : (
                                <span className="text-slate-200 text-xs">—</span>
                              )}
                              <button onClick={() => onPrint(d)} title="Print" className="w-10 h-10 rounded-lg border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 flex items-center justify-center cursor-pointer bg-slate-50 text-slate-400 hover:text-emerald-600">
                                🖨️
                              </button>
                              {onManageWorkers && (
                                <button
                                  onClick={() => onManageWorkers(d)}
                                  title={t('do.workersButtonTitle')}
                                  className={`relative w-10 h-10 rounded-lg border flex items-center justify-center cursor-pointer ${
                                    d.worked_by_locked_at
                                      ? 'border-slate-200 bg-slate-50 text-slate-400 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600'
                                      : 'border-amber-200 bg-amber-50 text-amber-500 hover:border-amber-400 hover:bg-amber-100'
                                  }`}
                                >
                                  👷
                                  {d.worked_by_locked_at ? (
                                    <span className="absolute -top-1 -right-1 text-[9px]">🔒</span>
                                  ) : (
                                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 border border-white" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {dos && dos.length > 0 && (
              <div className="text-[10px] font-bold text-slate-400 mt-2 text-right">
                {t('do.totalIssued', { issued: totalIssued, bal: al.balance_quantity ?? '—' })}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('do.signedConsentRecords')}</div>
            {consents === null ? (
              <div className="text-center py-4 text-slate-300 text-xs font-bold uppercase tracking-widest">{t('common.loading')}</div>
            ) : consents.length === 0 ? (
              <div className="text-center py-5 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{t('do.noConsentRecords')}</div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-bold text-slate-400">{t('do.consentCount', { n: consents.length })}</span>
                  <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                    {t('do.totalConsented', { n: consents.reduce((s, c) => s + (c.consent_qty || 0), 0).toLocaleString() })}
                  </span>
                </div>
                {consents.map((c, i) => (
                  <div key={c.id || i} className="bg-white rounded-2xl border border-emerald-200 p-4 mb-3 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">{t('do.consentN', { n: i + 1 })}</span>
                        <div className="text-xs font-bold text-slate-500 mt-0.5">
                          {c.created_at ? new Date(c.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </div>
                      <span className="text-sm font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">{t('do.seedlings', { n: (c.consent_qty || 0).toLocaleString() })}</span>
                    </div>
                    {c.ai_sticker_count != null && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-2 mt-2">
                        <span className="text-[9px] font-black text-blue-700 uppercase tracking-widest">{t('do.aiCount')}</span>
                        <span className="font-black text-blue-700">{c.ai_sticker_count.toLocaleString()}</span>
                      </div>
                    )}
                    {c.photo_url && (
                      <div className="mt-2">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('do.stickerPhoto')}</div>
                        <img src={c.photo_url} alt="sticker" className="rounded-xl border border-slate-200" style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }} />
                      </div>
                    )}
                    {c.signature_data && (
                      <div className="mt-2">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('do.signature')}</div>
                        <img src={c.signature_data} alt="signature" style={{ height: 48, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc' }} />
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-6 flex justify-end border-t border-slate-100 pt-5">
          <button onClick={onClose} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer">{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

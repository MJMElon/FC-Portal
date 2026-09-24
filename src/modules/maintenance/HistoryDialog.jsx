import { useEffect, useMemo, useState } from 'react';
import CfSelect from '../../components/CfSelect.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import { WORK_TYPES, workTypeLabel } from './data.js';
import { monthLabelOf, monthRank } from './schedule.js';
import RecordCard from './RecordCard.jsx';

/**
 * Everything that has been recorded, with the two questions actually asked of
 * it: which month, and which job.
 *
 * The list used to sit at the bottom of the dashboard and grew without end —
 * five hundred records under a week that needed two decisions. It is a
 * reference, not part of the day's work, so it opens when it is wanted and
 * takes the whole screen when it does.
 */
export default function HistoryDialog({
  records, today, mayVerify, mayEdit, mayDelete, onVerify, onEdit, onDelete, onClose,
}) {
  const { t, lang } = useLang();
  const [month, setMonth] = useState('');       // '' = every month
  const [work, setWork] = useState('');         // '' = every job

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The months that actually have records, newest first. Offering a month
  // with nothing in it is offering a filter that empties the list.
  const months = useMemo(() => {
    const seen = new Set();
    (records || []).forEach((r) => {
      const m = monthLabelOf(r.work_date);
      if (m) seen.add(m);
    });
    return [...seen].sort((a, b) => monthRank(b) - monthRank(a));
  }, [records]);

  const shown = useMemo(
    () => (records || []).filter(
      (r) => (!month || monthLabelOf(r.work_date) === month) && (!work || r.work_type === work)
    ),
    [records, month, work]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-100 w-full sm:max-w-[720px] rounded-t-3xl sm:rounded-3xl
                      shadow-2xl h-[92vh] sm:h-[85vh] flex flex-col overflow-hidden">
        <div className="shrink-0 bg-white border-b border-slate-200 px-5 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-wide">
              🗂️ {t('mt.history')}
            </h3>
            <button onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 text-xl">×</button>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="w-[150px]">
              <CfSelect value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">{t('mt.allMonths')}</option>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </CfSelect>
            </div>
            <div className="w-[170px]">
              <CfSelect value={work} onChange={(e) => setWork(e.target.value)}>
                <option value="">{t('mt.allWork')}</option>
                {WORK_TYPES.map((w) => (
                  <option key={w.key} value={w.key}>{workTypeLabel(w, lang)}</option>
                ))}
              </CfSelect>
            </div>
            <span className="ml-auto self-center text-[11px] font-black text-slate-400 uppercase tracking-widest">
              {t('mt.nRecords', { n: shown.length })}
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2.5">
          {shown.length ? (
            shown.map((r) => (
              <RecordCard key={r.id} record={r} today={today}
                          mayVerify={mayVerify} mayEdit={mayEdit} mayDelete={mayDelete}
                          onVerify={onVerify} onEdit={onEdit} onDelete={onDelete} />
            ))
          ) : (
            <div className="text-center text-slate-400 text-sm font-bold py-16">
              {t('mt.noRecords')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

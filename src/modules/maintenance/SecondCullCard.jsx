import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { raiseCase } from '../../lib/nelos.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  SECOND_CULL_CATEGORY,
  SECOND_CULL_NURSERIES,
  SECOND_CULL_PRIORITY,
  TRANSPLANT_TYPES,
  doneByNursery,
  dueItems,
  monthKeyOf,
  plotsOf,
  transplantMonthOf,
  requestText,
} from './secondCull.js';

/**
 * 2nd cull (Pusing Polibeg), one card on the Maintenance page.
 *
 * Each nursery's FC sees the plots and batches due this month, and presses
 * "2nd cull done" once their nursery is finished. When all three nurseries
 * have pressed it, the system opens ONE Nelos case for the month, routed to
 * the Audit Portal's seat 2. Nobody presses anything for the case itself.
 *
 * The list comes from the ledger, not from this page, so every FC sees the
 * same plots. Only the completion and the case are stored.
 */

const PAGE = 1000;

// PostgREST answers at most 1,000 rows per request, so every read below is
// paged, and a silent cut is never taken as the end of the list.
async function readAllPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const TRANSPLANT_COLS = 'plot_name, batch_name, transaction_date, created_at, transaction_type';

/**
 * The rows the due list is worked out from, for one due month.
 *
 * A batch is due in the month after four months only when its FIRST transplant
 * into that plot was in the transplant month, so two reads are needed:
 *   1. every transplant in the transplant month (the candidates), and
 *   2. every EARLIER transplant of those same batches, which knocks out any
 *      that were first transplanted before that month.
 * Both are small. Nothing older than the batches on the list is read.
 */
async function readTransplants(dueYm) {
  const tYm = transplantMonthOf(dueYm);
  const from = `${tYm}-01`;
  const [y, m] = tYm.split('-').map(Number);
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const inMonth = await readAllPages(() => supabase
    .from('shared_inventory_logs')
    .select(TRANSPLANT_COLS)
    .in('transaction_type', TRANSPLANT_TYPES)
    .gte('transaction_date', from)
    .lt('transaction_date', to)
    .order('id', { ascending: true }));

  const batches = [...new Set(inMonth.map((r) => r.batch_name).filter(Boolean))];
  if (!batches.length) return inMonth;

  const earlier = await readAllPages(() => supabase
    .from('shared_inventory_logs')
    .select(TRANSPLANT_COLS)
    .in('transaction_type', TRANSPLANT_TYPES)
    .in('batch_name', batches)
    .lt('transaction_date', from)
    .order('id', { ascending: true }));

  return [...inMonth, ...earlier];
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

export default function SecondCullCard({ allowed, online }) {
  const { session, staffName } = useAuth();
  const userId = session?.user?.id || null;
  const month = monthKeyOf();

  const [due, setDue] = useState(null);       // { items, unplaced }
  const [doneRows, setDoneRows] = useState({}); // nursery -> row
  const [caseRow, setCaseRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [rows, doneRes, caseRes] = await Promise.all([
        readTransplants(month),
        supabase.from('nops_2nd_cull_nursery').select('*').eq('month', month),
        supabase.from('nops_2nd_cull_case').select('*').eq('month', month).maybeSingle(),
      ]);
      if (doneRes.error) throw doneRes.error;
      if (caseRes.error) throw caseRes.error;
      setDue(dueItems(rows, month));
      setDoneRows(doneByNursery(doneRes.data));
      setCaseRow(caseRes.data || null);
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => SECOND_CULL_NURSERIES.filter((n) => !allowed || allowed.has(n)),
    [allowed]
  );

  const doneCount = SECOND_CULL_NURSERIES.filter((n) => doneRows[n]).length;
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null); // [{ month, done: {nursery: row}, caseOpened }]

  useEffect(() => {
    if (!showHistory || history) return;
    (async () => {
      try {
        const [doneRes, caseRes] = await Promise.all([
          supabase.from('nops_2nd_cull_nursery').select('*').order('month', { ascending: false }).limit(500),
          supabase.from('nops_2nd_cull_case').select('*').order('month', { ascending: false }).limit(120),
        ]);
        if (doneRes.error) throw doneRes.error;
        if (caseRes.error) throw caseRes.error;
        const byMonth = new Map();
        const slot = (m) => {
          if (!byMonth.has(m)) byMonth.set(m, { month: m, done: {}, caseOpened: false });
          return byMonth.get(m);
        };
        for (const r of doneRes.data || []) {
          if (allowed && !allowed.has(r.nursery)) continue;
          slot(r.month).done[r.nursery] = r;
        }
        for (const c of caseRes.data || []) slot(c.month).caseOpened = true;
        setHistory([...byMonth.values()].sort((x, y) => (x.month < y.month ? 1 : -1)));
      } catch (e) {
        setError(String(e?.message || e));
        setShowHistory(false);
      }
    })();
  }, [showHistory, history, allowed]);


  async function markDone(nursery) {
    if (busy || !online || doneRows[nursery]) return;
    setBusy(true);
    setError('');
    try {
      const { error: upErr } = await supabase.from('nops_2nd_cull_nursery').upsert(
        { month, nursery, done_by: staffName || null, done_by_id: userId },
        { onConflict: 'month,nursery', ignoreDuplicates: true }
      );
      if (upErr) throw upErr;
      await load();
      // Read back what is stored before deciding anything, so the case is
      // opened from the same rows every other screen sees.
      const { data: fresh, error: freshErr } = await supabase
        .from('nops_2nd_cull_nursery').select('nursery').eq('month', month);
      if (freshErr) throw freshErr;
      const { data: existingCase } = await supabase
        .from('nops_2nd_cull_case').select('*').eq('month', month).maybeSingle();
      if ((fresh || []).length >= SECOND_CULL_NURSERIES.length && !existingCase && due) {
        const { data: c, error: caseErr } = await raiseCase({
          title: `${SECOND_CULL_CATEGORY} ${month}`,
          description: requestText(due.items),
          category: SECOND_CULL_CATEGORY,
          // Audit Portal, seat 2 (Pre Nursery Auditor + Drone Operator).
          assignedModule: 'audit',
          assignedSeatNo: 2,
          priority: SECOND_CULL_PRIORITY,
          source: 'scan',
          nursery: 'All Nursery',
          plot: null,
          by: staffName,
          byId: userId,
          dedupe: true,
        });
        if (caseErr) throw caseErr;
        if (c && c.id) {
          const { error: linkErr } = await supabase.from('nops_2nd_cull_case').upsert(
            { month, nelos_case_id: c.id },
            { onConflict: 'month', ignoreDuplicates: true }
          );
          if (linkErr) throw linkErr;
        }
      }
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const status = caseRow
    ? 'Drone flight requested'
    : doneCount >= SECOND_CULL_NURSERIES.length
      ? 'Pending drone flight'
      : 'Pending workdone';

  // Once the month's case is open, the month is finished for this card: its
  // nursery blocks leave and the card keeps only a line that says so, with the
  // history one press away. A nursery's own block also leaves once its FC has
  // pressed done.
  const finished = !!caseRow;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-black text-slate-800">2nd Cull · Pusing Polibeg</div>
          <div className="text-[11px] font-bold text-slate-400">{monthLabel(month)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-600">{status}</div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[10px] font-black uppercase tracking-widest text-emerald-700"
          >
            {showHistory ? 'Hide history' : 'History'}
          </button>
        </div>
      </div>

      {!online && (
        <div className="text-[11px] font-bold text-amber-700">
          No signal. The list shows once you are back online.
        </div>
      )}
      {error && (
        <div className="text-[11px] font-bold text-rose-600 break-words">{error}</div>
      )}

      {!due && !error && (
        <div className="text-[12px] font-bold text-slate-400">Loading…</div>
      )}

      {due && !finished && visible.filter((n) => !doneRows[n]).map((n) => {
        const list = plotsOf(due.items[n]);
        return (
          <div key={n} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-black text-slate-700">{n}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">Pending workdone</div>
            </div>

            {list.length === 0 ? (
              <div className="text-[12px] font-bold text-slate-400">Nothing due in this nursery this month.</div>
            ) : (
              <ul className="space-y-1">
                {list.map(({ plot, batches }) => (
                  <li key={plot} className="text-[12px] text-slate-700">
                    <span className="font-black">{plot}</span>
                    <span className="text-slate-400"> · batch {batches.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={() => markDone(n)}
              disabled={!online || busy}
              className="w-full rounded-xl py-2.5 font-black text-[11px] uppercase tracking-widest bg-emerald-600 text-white disabled:bg-slate-200 disabled:text-slate-500"
            >
              {busy ? 'Saving…' : '2nd cull done'}
            </button>
          </div>
        );
      })}

      {due && !finished && visible.length > 0 && visible.every((n) => doneRows[n]) && (
        <div className="text-[12px] font-bold text-slate-500">
          Done for your nursery. Waiting for the other nurseries.
        </div>
      )}

      {showHistory && (
        <div className="border-t border-slate-200 pt-3 space-y-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">History</div>
          {!history && <div className="text-[12px] font-bold text-slate-400">Loading…</div>}
          {history && history.length === 0 && (
            <div className="text-[12px] font-bold text-slate-400">No 2nd cull has been recorded yet.</div>
          )}
          {history && history.map((h) => (
            <div key={h.month} className="rounded-xl border border-slate-200 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-black text-slate-700">{monthLabel(h.month)}</div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {h.caseOpened ? 'Drone flight requested' : 'Not finished'}
                </div>
              </div>
              {visible.map((n) => (
                <div key={n} className="text-[11px] text-slate-600">
                  <span className="font-black">{n}</span>
                  <span className="text-slate-400">
                    {' · '}{h.done[n]
                      ? `done by ${h.done[n].done_by || '—'} on ${String(h.done[n].done_at || '').slice(0, 10)}`
                      : 'not done'}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

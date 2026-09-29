/* ══════════════════════════════════════════════════════════════════════
   NELOS, IN THE FC PORTAL

   What is waiting for this Field Conductor, and the case they are working
   on, over whatever screen they were on. The portal it belongs to is a
   different site on a different build (ai.mjmnursery.com), so nothing is
   imported from it — what is copied is the DECISIONS, and each of them is
   named in src/lib/nelos.js so the two can be checked against each other.

   Grouped the way the day is worked, the same as every other Nelos surface:

     ⏰ Overdue          late, and pinned to the top however far you scroll
     Assigned to me      my name on it, not yet late
     Other pending       the rest of this portal's queue

   A case opens in place — start it, resolve it, close it, comment on it —
   because a Field Conductor standing in a plot is not going to leave for
   another site to say "done". The writes are nelos_case.html's, move for
   move, so a case settled here is indistinguishable from one settled there.

   Everything fails soft: the case log is not this app's, and a portal that
   cannot reach it must still scan barcodes.
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isOverdue, pendingCases } from '../lib/nelos.js';
import { compressImage, dataUrlToBlob } from '../lib/image.js';
import { useLang } from '../context/LanguageContext.jsx';
import NelosNewCase from './NelosNewCase.jsx';

const MODULE = 'scan';                 // this portal's key in nelos_modules

/* Anchored to the dock icon, the way the portal's own Nelos dock
   (shared/shared_nelos_dock.js, in mjm-ai-system) has always worked: the
   button and its panel are one thing, and the panel opens attached to
   wherever the button currently is — not a dialog that appears somewhere
   else on the screen, unrelated to what was tapped.

   That file keeps the fab and the panel as flex siblings inside one
   positioned wrapper, so the panel simply falls in beside the button. A
   window opened from a separate React tree cannot be a flex sibling of
   the button that opened it, so this gets the same result with maths
   instead: given where the button sits (anchor) and which quarter of the
   screen its centre is in, pick the edge of the button the panel grows
   away from, and how much room that direction actually has.

   PANEL is the reference dock's own DEF_W/MIN_W/MIN_H (shared_nelos_dock.js)
   — one size, everywhere, rather than a phone shape and a desktop shape
   fighting over which one is "right". */
const GAP = 10;
const PANEL = { w: 370, minW: 280, minH: 220 };

function anchoredFrame(anchor) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const ax = anchor?.x ?? vw - 78, ay = anchor?.y ?? vh - 168;
  const size = anchor?.size ?? 62;
  const cx = ax + size / 2, cy = ay + size / 2;

  const openLeft = cx <= vw / 2;   // icon on the left half -> panel grows rightward from it
  const openUp = cy > vh / 2;      // icon in the bottom half -> panel grows upward from it

  const width = Math.max(PANEL.minW, Math.min(PANEL.w, vw - 24));
  const maxHeight = openUp
    ? Math.max(PANEL.minH, ay - GAP - 12)
    : Math.max(PANEL.minH, vh - (ay + size) - GAP - 12);

  /* Always resolved to a single 'left' value, clamped inside the viewport,
     rather than picking 'left' or 'right' the way the vertical axis picks
     'top' or 'bottom'. The reference dock (shared_nelos_dock.js) can get
     away with that because its fab naturally rests in a corner; this one
     can be dragged anywhere along the width of the screen, including the
     middle, where a 370px-wide panel aligned flush to one edge of a
     62px icon would run off the OTHER edge of a narrow phone. Clamping
     keeps it beside the icon everywhere that fits, and at the nearest
     screen edge instead of off it everywhere else. */
  const idealLeft = openLeft ? ax : ax + size - width;
  const left = Math.min(Math.max(idealLeft, 12), Math.max(12, vw - width - 12));

  const frame = { position: 'fixed', left, width, maxWidth: 'calc(100vw - 24px)', maxHeight };
  frame[openUp ? 'bottom' : 'top'] = openUp
    ? Math.max(12, vh - ay + GAP) : Math.max(12, ay + size + GAP);
  return frame;
}

const PRIORITY_KEY = { urgent: 'nel.prUrgent', high: 'nel.prHigh', normal: 'nel.prNormal', low: 'nel.prLow' };
const SOURCE_LABEL = {
  operation: 'Seedling Stock',
  nursery_ops: 'HQ Operation',
  scan: 'FC Portal',
  mobile: 'Admin Portal',
  audit: 'Audit Portal',
  npayroll: 'Payroll',
  nelos: 'Nelos',
};
const DOT = { urgent: 'bg-rose-600', high: 'bg-orange-500', normal: 'bg-sky-500', low: 'bg-slate-400' };

/* A full date, for "Created …". fmtDay below is the DUE-date format and
   deliberately has no year — a due date is always near — but the day a case
   was raised can be months back, and "20 Aug" then says the wrong thing. */
const fmtDate = (d, loc) => {
  if (!d) return '—';
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(loc,
      { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
};

const fmtDay = (d, loc) => {
  if (!d) return '';
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  } catch (e) {
    return d;
  }
};
const fmtStamp = (ts, loc) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(loc,
      { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
};

/* ── One case, opened ────────────────────────────────────────────── */

function CaseView({ caseId, me, onBack, onChanged }) {
  const { t, lang } = useLang();
  /* The BCP-47 tag for the language the portal is in. 'ms-MY' gives BM
     month names; the date is part of the wording, not decoration. */
  const loc = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  /* EVERY photo of the fix, not one.

     One is rarely the job: the gap before and the planting after, three
     trays that needed the same thing, a wide shot and the close-up that
     shows what it actually was. And on a phone "take a photo" IS one at a
     time — the camera returns after each shot — so the picker appends
     rather than replaces and stays on screen to be tapped again.

     Same decision as the office side (mjm-ai-system → shared_nelos_dock.js
     _shots). Change one, change the other. */
  const [shots, setShots] = useState([]);
  const resolutionRef = useRef(null);

  /* select('*') rather than a column list. Nelos has grown columns over
     several migrations, and asking for one this database has not got would
     fail the whole read. One row, so the width costs nothing. */
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('nelos_cases').select('*').eq('id', caseId).single();
    if (error) { setErr(error.message || t('nel.couldNotOpen')); return; }
    setC(data);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  /* A system note, best effort. A status change that saved but whose note
     did not is untidy; one refused because the note failed would be worse. */
  async function note(body, kind = 'status') {
    try {
      await supabase.from('nelos_case_comments').insert([
        { case_id: caseId, body, kind, author_name: me.name, author_id: me.id },
      ]);
    } catch (e) { /* the case still moved */ }
  }

  async function patch(fields, noteText) {
    setBusy(true); setFlash(null);
    try {
      const { data, error } = await supabase.from('nelos_cases')
        .update({ updated_by: me.name, updated_at: new Date().toISOString(), ...fields })
        .eq('id', caseId).select().single();
      if (error) { setFlash({ ok: false, msg: t('nel.couldNotSave', { msg: error.message }) }); return false; }
      setC(data);
      onChanged();
      if (noteText) await note(noteText);
      await load();
      return true;
    } catch (e) {
      setFlash({ ok: false, msg: t('nel.couldNotSave', { msg: e?.message || t('nel.errNetwork') }) });
      return false;
    } finally { setBusy(false); }
  }

  /* The photo of the fix, into the same bucket and path shape the dock
     uses (mjm-ai-system/shared/shared_nelos_dock.js → uploadShot) so one
     case's picture is in the same place whichever surface solved it. */
  async function uploadShot(file, n) {
    /* SHRUNK FIRST. A phone camera hands over eight to twelve megabytes,
       and an upload that size over a plot's signal is an upload that does
       not finish — which is how "solve took no photo" happened. A photo of
       the fix has to show what was done, not be printable. If the shrink
       itself fails the original still goes, which is slow but not lost. */
    let body = file, type = file.type || 'image/jpeg';
    try {
      const small = await compressImage(file, { maxW: 1600, quality: 0.82, maxBytes: 900 * 1024 });
      const blob = dataUrlToBlob(small);
      if (blob) { body = blob; type = 'image/jpeg'; }
    } catch (e) { /* the original goes instead */ }
    const ext = type === 'image/jpeg' ? 'jpg'
              : (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `solve/${caseId}-${Date.now()}-${n}.${ext}`;
    const { error } = await supabase.storage.from('nelos-photos')
      .upload(path, body, { contentType: type });
    if (error) return null;
    return supabase.storage.from('nelos-photos').getPublicUrl(path).data?.publicUrl || null;
  }

  async function confirmResolve() {
    const text = resolutionRef.current?.value.trim();
    if (!text) {
      setFlash({ ok: false, msg: t('nel.saySolved') });
      resolutionRef.current?.focus();
      return;
    }
    /* Upload BEFORE the patch: a failed upload leaves the case as it was,
       whereas patching first would mark work solved and then lose the
       picture of it. */
    const urls = [];
    for (let i = 0; i < shots.length; i++) {
      const url = await uploadShot(shots[i], i + 1);
      if (!url) {
        /* LOUD, and the case is NOT resolved. A photo somebody stood in a
           plot to take, dropped silently, is the fault this is here to
           stop: they would walk away believing it was kept. */
        setFlash({ ok: false, msg: t('nel.photoFailed', { n: i + 1 }) });
        return;
      }
      urls.push(url);
    }
    const fields = { status: 'resolved', resolution: text, resolved_by: me.name,
                     resolved_at: new Date().toISOString() };
    /* The FIRST photo still goes in resolution_photo_url, which every
       reader of a single photo goes on finding, and all of them into
       resolution_photo_urls. */
    if (urls.length) fields.resolution_photo_url = urls[0];
    if (urls.length) fields.resolution_photo_urls = urls;

    let ok = await patch(fields, `Resolved — ${me.name}`);
    /* A database that has not run shared/RUN_ME_nelos_solve_photos.sql has
       no resolution_photo_urls column and refuses the whole patch. Rather
       than fail the solve, it goes again with the one photo the old column
       holds — the extras are uploaded and waiting for the column. */
    if (!ok && urls.length > 1) {
      delete fields.resolution_photo_urls;
      ok = await patch(fields, `Resolved — ${me.name}`);
    }
    if (ok) { setShots([]); onBack(); }
  }

  async function closeCase() {
    if (!window.confirm(t('nel.closeConfirm'))) return;
    await patch({ status: 'closed', closed_by: me.name, closed_at: new Date().toISOString() },
      `Closed — ${me.name}`);
  }

  async function reopen() {
    await patch({ status: 'open', resolved_at: null, resolved_by: null, closed_at: null, closed_by: null },
      `Reopened — ${me.name}`);
  }

  if (err) return <div className="p-4"><div className="text-[12.5px] font-bold text-slate-400">{err}</div></div>;
  if (!c) return <div className="p-4"><div className="text-[12.5px] font-bold text-slate-400">{t('nel.loadingCase')}</div></div>;

  const s = c.status;
  const pending = s === 'open' || s === 'in_progress';
  /* Where the work is: the nursery with its plot in brackets, and the batch
     only when there is one — a batch case that did not say so would be
     missing the thing that identifies it. */
  let where = c.nursery_name ? c.nursery_name + (c.plot_name ? ` (${c.plot_name})` : '')
                             : (c.plot_name || '');
  if (c.batch_name) where = (where ? `${where} · ` : '') + t('nel.batch', { name: c.batch_name });

  /* Every status this view knows offers at least one move, so the "nothing
     to do" line is a fallback for a status arriving from somewhere else —
     never something shown beside a live button. */
  const hasActions = s === 'open' || s === 'in_progress' || s === 'resolved' || s === 'closed';

  const btn = 'px-3.5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-white cursor-pointer disabled:opacity-50';
  const sec = 'text-[10px] font-black uppercase tracking-[.11em] text-[#913673]';
  const kk  = 'text-[8.5px] font-black uppercase tracking-widest text-slate-400';
  const vv  = 'text-[12px] font-bold text-slate-800 mt-0.5 leading-snug break-words';

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <span className="ml-auto text-[10px] font-black tracking-wider text-slate-400">{c.case_no || ''}</span>
      </div>

      {/* The dock's case pane, move for move
          (mjm-ai-system/shared/shared_nelos_dock.js → detailHtml): two
          blocks in the order the job is done. The pills that were here read
          "FC Portal · Normal · Open" on very nearly every case — three
          words of nothing between the title and the work — and the four-cell
          grid said the same things at greater length. Keep the two in step. */}
      <div className={`${sec} mt-3`}>{t('nel.caseDetails')}</div>
      <h3 className="mt-1.5 text-[17px] font-black text-slate-800 leading-[1.25]">{c.title}</h3>
      <div className="mt-1 text-[11px] font-bold text-slate-400">
        {t('nel.created', { date: fmtDate((c.created_at || '').slice(0, 10), loc) })}
        {c.raised_by ? ` · ${t('nel.createdBy', { who: c.raised_by })}` : ''}
      </div>

      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 mt-3 px-3.5 py-[11px] bg-slate-50 border border-[#eef2f7] rounded-xl">
        <div className="min-w-0"><div className={kk}>{t('nel.nurseryPlot')}</div><div className={vv}>{where || '—'}</div></div>
        <div className="min-w-0"><div className={kk}>{t('nel.assignedTo')}</div>
          <div className={vv}>{SOURCE_LABEL[c.assigned_module || c.source_module] || c.assigned_module || c.source_module || '—'}</div></div>
        <div className="min-w-0"><div className={kk}>{t('nel.pic')}</div>
          <div className={vv}>{c.assignee_name || <span className="text-slate-400 font-semibold">{t('nel.unassigned')}</span>}</div></div>
      </div>

      {/* What was written about it — the one field saying what is actually
          wrong, and this window never showed it. */}
      <div className={`mt-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words ${
        c.description ? 'text-slate-700' : 'text-slate-400 italic'}`}>
        {c.description || t('nel.noDetail')}
      </div>

      {c.resolution && (
        <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="text-[9px] font-black uppercase tracking-[.1em] text-emerald-600">{t('nel.resolution')}</div>
          <div className="text-[12.5px] font-bold text-emerald-800 mt-1 whitespace-pre-wrap">{c.resolution}</div>
          {/* Every photo of the fix. resolution_photo_urls holds them all
              where the column exists; resolution_photo_url is the first of
              them and the only one on a database that has not run
              shared/RUN_ME_nelos_solve_photos.sql yet. */}
          {(() => {
            let list = c.resolution_photo_urls;
            if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = null; } }
            if (!Array.isArray(list) || !list.length) list = c.resolution_photo_url ? [c.resolution_photo_url] : [];
            if (!list.length) return null;
            return (
              <div className={list.length > 1 ? 'grid grid-cols-2 gap-2 mt-2' : 'mt-2'}>
                {list.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                    <img src={u} alt={t('nel.photoNof', { i: i + 1 })} className="w-full rounded-lg block" />
                  </a>
                ))}
              </div>
            );
          })()}
          <div className="text-[10px] font-bold text-emerald-700 mt-1.5">
            {t('nel.resolvedBy', { who: c.resolved_by || t('nel.unknown') })}
            {c.resolved_at ? ` · ${fmtStamp(c.resolved_at, loc)}` : ''}
            {c.closed_at ? `  ·  ${t('nel.closedBy', { who: c.closed_by || t('nel.unknown') })} · ${fmtStamp(c.closed_at, loc)}` : ''}
          </div>
        </div>
      )}

      {flash && (
        <div className={`mt-3 px-3 py-2 rounded-lg text-[11.5px] font-black ${
          flash.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{flash.msg}</div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {s === 'resolved' && <button className={`${btn} bg-slate-600`} disabled={busy} onClick={closeCase}>🔒 {t('nel.closeCase')}</button>}
        {(s === 'resolved' || s === 'closed') && (
          <button className={`${btn} bg-orange-600`} disabled={busy} onClick={reopen}>↩ {t('nel.reopen')}</button>
        )}
        {!hasActions && <span className="text-[11.5px] font-bold text-slate-400">{t('nel.nothingToDo')}</span>}
      </div>

      {/* Solving is the whole reason a pending case gets opened, so the block
          to do it is ON SCREEN — the dock's case pane works this way and this
          did not: it hid the photo and the remark behind a "Mark Resolved"
          button, so opening a case showed no way to solve it until you had
          pressed something that sounded like it would solve it already. */}
      {pending && (
        <div className="mt-4 pt-3.5 border-t border-[#f8e2f1]">
          <div className={sec}>{t('nel.solveCase')}</div>

          {shots.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {shots.map((f, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden bg-slate-100 aspect-square">
                  <img src={URL.createObjectURL(f)} alt={t('nel.photoNof', { i: i + 1 })}
                       className="w-full h-full object-cover block" />
                  <button type="button" aria-label={t('nel.removePhoto')}
                    onClick={() => setShots(shots.filter((_, n) => n !== i))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/60 text-white text-[12px] leading-none cursor-pointer">✕</button>
                  <span className="absolute bottom-1 left-1 px-1.5 rounded bg-slate-900/60 text-white text-[9px] font-black tabular-nums">{i + 1}</span>
                </div>
              ))}
            </div>
          )}
          {/* STAYS ON SCREEN with photos already taken — that is the whole
              point. `capture` is deliberately NOT set: forcing the camera
              takes away the gallery, and on some Android builds a captured
              file came back with no name and was dropped. The input's value
              is cleared after every pick so the same file can be chosen
              twice and the camera re-opened straight away. */}
          <label className={`mt-2 flex flex-col items-center justify-center gap-1 min-h-[68px] cursor-pointer
                            border-[1.5px] border-dashed border-[#f2cfe7] rounded-xl bg-[#fcf5fa]/60
                            text-[#913673] text-[11.5px] font-black`}>
            <span aria-hidden="true">📷</span>
            <span>{shots.length ? t('nel.addPhoto', { n: shots.length }) : t('nel.takePhoto')}</span>
            <input type="file" accept="image/*" multiple className="hidden nel-shot-in"
                   onChange={(e) => {
                     const picked = Array.from(e.target.files || []);
                     if (picked.length) setShots((prev) => [...prev, ...picked]);
                     e.target.value = '';
                   }} />
          </label>

          {/* Labelled rather than prompted from inside the box: a placeholder
              is gone the moment anybody types, so the one thing saying what
              the box is for disappears as they start filling it in. */}
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mt-3 mb-1.5">{t('nel.solveRemark')}</div>
          <textarea ref={resolutionRef} rows={3}
            className="w-full border-[1.5px] border-slate-200 rounded-xl px-3 py-2 text-[13px] font-semibold
                       bg-white text-slate-800 outline-none focus:border-[#e4a0ce]" />
          <button className={`${btn} bg-green-600 mt-2`} disabled={busy} onClick={confirmResolve}>{t('nel.saveSolve')}</button>
        </div>
      )}

    </div>
  );
}

/* ── The list ────────────────────────────────────────────────────── */
function Row({ c, onOpen }) {
  const { t, lang } = useLang();
  const loc = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const bits = [
    c.case_no,
    [c.batch_name && t('nel.batch', { name: c.batch_name }), c.plot_name, c.nursery_name].filter(Boolean).join(' · '),
    c.assignee_name ? `→ ${c.assignee_name}` : null,
  ].filter(Boolean);
  return (
    <button type="button" onClick={() => onOpen(c.id)}
      className="w-full text-left flex items-start gap-2.5 px-4 py-2.5 border-b border-dashed border-slate-100 hover:bg-[#fcf5fa] cursor-pointer">
      <span className={`w-2 h-2 rounded-full mt-[7px] shrink-0 ${DOT[c.priority] || DOT.normal}`}
        title={c.priority ? t(PRIORITY_KEY[c.priority] || 'nel.prNormal') : ''} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-bold leading-tight ${isOverdue(c) ? 'text-rose-800' : 'text-slate-800'}`}>
          {c.title}
        </span>
        <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">
          <span className="inline-block text-[9px] font-black uppercase tracking-wider bg-[#f8e2f1] text-[#913673] px-1.5 py-px rounded">
            {SOURCE_LABEL[c.source_module] || c.source_module}
          </span>
          {bits.map((b) => <span key={b}> · {b}</span>)}
          {c.due_date && (isOverdue(c)
            ? <span className="text-rose-700 font-black whitespace-nowrap"> · ⏰ {t('nel.rowOverdue', { day: fmtDay(c.due_date, loc) })}</span>
            : <span className="whitespace-nowrap"> · {t('nel.rowDue', { day: fmtDay(c.due_date, loc) })}</span>)}
        </span>
      </span>
    </button>
  );
}

export default function NelosWindow({ onClose, onCount, anchor }) {
  const { session } = useAuth();
  const { t } = useLang();
  /* Bumped on resize so the anchored frame — computed fresh from
     window.innerWidth/innerHeight on every render — is recomputed when
     neither the anchor nor anything else here changes, only the window. */
  const [, forceResize] = useState(0);
  const [state, setState] = useState({ status: 'loading', rows: [], uid: null });
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  /* What was just raised, said once on the list the person lands back on.
     A form that closes with no word is a form you press twice. */
  const [raised, setRaised] = useState(null);

  const me = {
    id: session?.user?.id || null,
    name: session?.user?.user_metadata?.full_name || session?.user?.email || 'Unknown',
  };

  const reload = useCallback(async () => {
    const { rows, uid, failed } = await pendingCases({ module: MODULE });
    setState({ status: failed ? 'failed' : 'ready', rows, uid });
    if (onCount) onCount(failed ? 0 : rows.length);
  }, [onCount]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const onResize = () => forceResize((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Escape closes it, the same as every other window on the device —
  // there is no dark backdrop to tap any more (see the transparent
  // click-catcher below), so the keyboard needs its own way out too.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rows, uid } = state;
  const mine = (c) => !!uid && c.assignee_id === uid;
  const over = rows.filter(isOverdue);
  const rest = rows.filter((c) => !isOverdue(c));
  const restMine = rest.filter(mine);
  const restOther = rest.filter((c) => !mine(c));
  const groups = [over.length, restMine.length, restOther.length].filter(Boolean).length;
  const head = 'px-4 pt-2.5 pb-1 text-[9px] font-black uppercase tracking-widest text-slate-400';

  const frame = anchoredFrame(anchor);

  return (
    <>
      {/* No dark backdrop — a pop-out beside the icon reads as attached to
          it, not as a dialog that has taken over the screen; a full-screen
          tint would say the latter. This catcher is only for a tap
          somewhere else to close it, same as the icon itself does. */}
      <div onClick={onClose} className="fixed inset-0 z-[55]" />
      <div
        style={{ ...frame, zIndex: 56 }}
        className="bg-white rounded-2xl shadow-[0_16px_50px_rgba(0,0,0,.28)] border border-slate-200 flex flex-col overflow-hidden"
        role="dialog" aria-modal="true" aria-label="Nelos"
      >
        <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
          <span className="font-black text-slate-800 text-sm">NELOS</span>
          <span className="font-black text-[#913673] text-[10px] uppercase tracking-[0.18em] bg-[#efc7e2]/45 px-2 py-0.5 rounded-full">{t('nel.toDo')}</span>
          {state.status === 'ready' && !!rows.length && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{rows.length}</span>
          )}
          {/* The other half of a case log: noticing one. The Field
              Conductor is the person standing in the plot. */}
          {!openId && !adding && (
            <button onClick={() => { setRaised(null); setAdding(true); }}
              className="ml-auto px-2.5 py-1.5 rounded-full bg-[#bc4996] hover:bg-[#913673] text-white text-[10px] font-black uppercase tracking-wider cursor-pointer shrink-0">
              {t('nel.newCase')}
            </button>
          )}
          <button onClick={onClose} title={t('common.close')} aria-label={t('common.close')}
            className={`grid place-items-center w-9 h-9 rounded-full bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-xl leading-none cursor-pointer shrink-0${
              openId || adding ? ' ml-auto' : ' ml-1'}`}>
            ×
          </button>
        </div>

        <div className="overflow-y-auto">
          {/* A case raised for another system does not land in this
              portal's queue, so the list can stay exactly as it was. Say
              so, or the Field Conductor raises it again. */}
          {!adding && !openId && raised && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-[11.5px] font-black bg-emerald-100 text-emerald-800">
              {t('nel.caseRaised', { no: raised })}
            </div>
          )}
          {adding ? (
            <NelosNewCase
              source={MODULE}
              me={me}
              onBack={() => setAdding(false)}
              onDone={(c) => {
                setAdding(false);
                setRaised(c?.case_no || t('nel.theCase'));
                reload();
              }} />
          ) : openId ? (
            <CaseView caseId={openId} me={me}
              onBack={() => { setOpenId(null); reload(); }}
              onChanged={reload} />
          ) : state.status === 'loading' ? (
            <div className="py-10 text-center text-[12px] font-bold text-slate-300">{t('nel.loadingCases')}</div>
          ) : state.status === 'failed' ? (
            <div className="py-10 px-6 text-center text-[12px] font-bold text-slate-400">
              {t('nel.logUnreachable')}<br />
              <span className="text-[11px] font-semibold text-slate-300">{t('nel.restStillWorks')}</span>
            </div>
          ) : !rows.length ? (
            <div className="py-10 text-center text-[12px] font-bold text-slate-300">{t('nel.nothingPending')}</div>
          ) : (
            <>
              {/* Overdue leads and says so: "3 pending" and "3 overdue" are
                  not the same news, so its heading shows even alone. */}
              {!!over.length && (
                <>
                  <div className={`${head} text-rose-700 sticky top-0 bg-white`}>{t('nel.overdueHead', { n: over.length })}</div>
                  {over.map((c) => <Row key={c.id} c={c} onOpen={setOpenId} />)}
                </>
              )}
              {!!restMine.length && (
                <>
                  {groups > 1 && <div className={head}>{t('nel.assignedToMe', { n: restMine.length })}</div>}
                  {restMine.map((c) => <Row key={c.id} c={c} onOpen={setOpenId} />)}
                </>
              )}
              {!!restOther.length && (
                <>
                  {groups > 1 && <div className={head}>{t('nel.otherPending', { n: restOther.length })}</div>}
                  {restOther.map((c) => <Row key={c.id} c={c} onOpen={setOpenId} />)}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

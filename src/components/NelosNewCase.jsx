/* ══════════════════════════════════════════════════════════════════════
   NELOS — RAISING A CASE FROM THE FC PORTAL

   The Field Conductor is the one standing in the plot. They see the thing
   that is wrong first, and until now the only cases this portal could
   raise were the ones it raised by itself — the culling calculator's two.
   Anything else had to wait until somebody was back at a desk on the hub.
   This is the same form the hub's dock and the Admin Portal carry, so a
   case raised from a phone in a nursery is the same case, filed the same
   way, as one raised from an office.

   The questions, in the order the person answering them thinks:

     Assign to    which system works this — Seedling Stock, HQ Operation,
                  FC, Admin, Auditor. Read from nelos_modules, not
                  hardcoded: the User Setting page can rename or add one,
                  and this follows.
     Work         that system's own case titles, scoped by
                  nelos_categories.module_key — the whole point of that
                  column. The FC should not be offering "Height Shortfall"
                  to the auditor.
     PIC          the people pinned to that system in nelos_handlers, by
                  name. Optional: a case with nobody on it is the system's
                  to pick up, which is how the queue is meant to work.
     Nursery      then the plots that nursery actually has.
     Photo        one picture, into the public nelos-photos bucket.
     Remarks      what you saw.

   Priority is not asked. It belongs to the KIND of case, not to the moment
   somebody is raising one — nelos_categories.default_priority already says
   what each kind is normally raised at.

   No date field either. The date is today, it is printed under the
   heading, and asking somebody to confirm the current date is asking them
   to do the computer's job. A due date still exists: the category's
   default_days sets it, exactly as the other two forms do.

   The insert goes through raiseCase() in src/lib/nelos.js rather than
   writing nelos_cases directly, so the row shape stays in the one place
   this app defines it — the file that the culling calculator's automatic
   raises also go through.

   source_module is 'scan' — where it was raised. assigned_module is what
   the person chose, and the nelos_cases_route trigger honours an explicit
   one ("routing is the default, not a rule").

   If Mobile/src/components/NelosNewCase.jsx changes, change this with it.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import CfSelect from './CfSelect.jsx';
import { supabase } from '../lib/supabase.js';
import { raiseCase } from '../lib/nelos.js';
import { useLang } from '../context/LanguageContext.jsx';

/* The four nurseries and the plots each one has, the same list the hub's
   dock and the Admin Portal's form offer, so all three raise forms ask the
   same question. PALMS' own NURSERIES has only the three this portal logs
   plots in; a case can be about any of them, PN included. */
const NURSERY_PLOTS = {
  PN: Array.from({ length: 52 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
  BNN: Array.from({ length: 14 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
  UNN1: Array.from({ length: 18 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`),
  UNN2: Array.from({ length: 20 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`),
};
const NURSERY_LABEL = { PN: 'Pre Nursery', BNN: 'BNN', UNN1: 'UNN1', UNN2: 'UNN2' };

/* Shown only if nelos_modules cannot be read. The five systems as they
   stand, in the order that table seeds them, under the short names
   nelos_modules.handler_label already carries. */
const FALLBACK_MODULES = [
  { key: 'operation', label: 'Seedling Stock' },
  { key: 'nursery_ops', label: 'HQ Operation' },
  { key: 'scan', label: 'FC' },
  { key: 'mobile', label: 'Admin' },
  { key: 'audit', label: 'Auditor' },
];

const MAX_PHOTO = 8 * 1024 * 1024;

const FIELD =
  'w-full border-[1.5px] border-slate-200 rounded-xl px-3 py-2.5 text-[13px] font-semibold ' +
  'bg-white text-slate-800 outline-none focus:border-violet-400 disabled:bg-slate-50 disabled:text-slate-400';
const LABEL = 'block text-[9px] font-black uppercase tracking-widest text-slate-400 mt-3 mb-1';

export default function NelosNewCase({ source = 'scan', me, onBack, onDone }) {
  const { t, lang } = useLang();
  const loc = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const [modules, setModules] = useState(FALLBACK_MODULES);
  const [cats, setCats] = useState([]);
  const [people, setPeople] = useState([]);

  const [assignTo, setAssignTo] = useState('');
  const [work, setWork] = useState('');
  const [pic, setPic] = useState('');
  const [nursery, setNursery] = useState('');
  const [plot, setPlot] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const titleRef = useRef(null);
  const remarksRef = useRef(null);
  const fileRef = useRef(null);

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const todayLabel = today.toLocaleDateString(loc, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  /* Systems, case titles and people, all three read once. Each fails on its
     own terms: no modules leaves the five above, no categories turns Work
     into a free-text line, no people leaves the case unassigned — which is
     a valid case, not a blocked form. */
  useEffect(() => {
    let alive = true;

    /* handler_label is the short name — Seedling Stock, HQ Operation, FC,
       Admin, Auditor — and it already exists. "Assign to" wants those same
       five words, so it reads them rather than inventing a second set that
       could drift. `label` is the fallback for a system added later that
       has not been given one. */
    supabase
      .from('nelos_modules')
      .select('key,label,handler_label')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (!alive || error || !data?.length) return;
        setModules(data.map((m) => ({ key: m.key, label: m.handler_label || m.label })));
      }, () => {});

    supabase
      .from('nelos_categories')
      .select('name,module_key,default_priority,default_days')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!alive || error) return;
        setCats(data || []);
      }, () => {});

    /* nelos_handlers, not the nelos_people() RPC: that one is admin-only,
       and anybody entitled to raise a case needs to be able to name who
       should get it. The table is readable by any authenticated user and
       carries the pin this needs. */
    supabase
      .from('nelos_handlers')
      .select('user_id,full_name,email,primary_module')
      .then(({ data, error }) => {
        if (!alive || error) return;
        setPeople(data || []);
      }, () => {});

    return () => { alive = false; };
  }, []);

  // Revoke the preview's object URL rather than leaking it.
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

  const worksFor = assignTo ? cats.filter((c) => c.module_key === assignTo) : [];
  /* Sorted by name inside the system, which is what makes a list of people
     scannable — the pin decides who is in it, the name decides the order. */
  const picsFor = assignTo
    ? people
        .filter((p) => p.primary_module === assignTo)
        .map((p) => ({ id: p.user_id, name: p.full_name || p.email || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  /* Changing the system invalidates the two answers that hang off it. */
  function pickAssignTo(key) {
    setAssignTo(key);
    setWork('');
    setPic('');
  }

  const chosen = () => worksFor.find((x) => x.name === work);

  /* No default_priority, or no set titles for that system at all, means
     normal — the same floor the other two forms use. */
  const priorityFromWork = () => chosen()?.default_priority || 'normal';

  /* The due date the chosen work normally gets, counted from today. No
     default_days means no due date, which is honest — a case nobody set a
     deadline for does not get an invented one. */
  function dueFromWork() {
    const c = chosen();
    if (!c || c.default_days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() + Number(c.default_days));
    return d.toISOString().slice(0, 10);
  }

  function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO) {
      setErr(t('nel.errPhotoBig'));
      e.target.value = '';
      return;
    }
    setErr(null);
    if (photo?.url) URL.revokeObjectURL(photo.url);
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  function dropPhoto() {
    if (photo?.url) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit() {
    /* The chosen work IS the case's title — that is what "choose work"
       means. A system with no case titles set up yet falls back to a typed
       line, so an empty nelos_categories cannot make this form unusable. */
    const title = (worksFor.length ? work : titleRef.current?.value.trim()) || '';
    if (!assignTo) { setErr(t('nel.errChooseWho')); return; }
    if (!title) {
      setErr(worksFor.length ? t('nel.errChooseWork') : t('nel.errSayWhat'));
      if (!worksFor.length) titleRef.current?.focus();
      return;
    }

    setBusy(true);
    setErr(null);
    const remarks = remarksRef.current?.value.trim() || null;

    try {
      /* Photo first. If it fails the case is not raised, and the form stays
         open with everything still filled in — better than a case that
         quietly lost its picture. */
      let photoUrl;
      if (photo?.file) {
        const f = photo.file;
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${todayISO}/${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('nelos-photos')
          .upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) {
          setErr(t('nel.errPhotoUpload', { msg: upErr.message }));
          setBusy(false);
          return;
        }
        photoUrl = supabase.storage.from('nelos-photos').getPublicUrl(path).data.publicUrl;
      }

      const picRow = picsFor.find((p) => p.id === pic);
      const { data, error } = await raiseCase({
        title,
        description: remarks,
        category: worksFor.length ? work : null,
        priority: priorityFromWork(),
        source,
        assignedModule: assignTo,
        assigneeId: picRow?.id || null,
        assigneeName: picRow?.name || null,
        dueDate: dueFromWork(),
        photoUrl,
        nursery: nursery || null,
        plot: plot || null,
        by: me?.name || null,
        byId: me?.id || null,
      });
      if (error || !data) {
        setErr(t('nel.errRaise', { msg: error?.message || t('nel.errRefused') }));
        setBusy(false);
        return;
      }
      onDone(data);
    } catch (e) {
      setErr(t('nel.errRaise', { msg: e?.message || t('nel.errNetwork') }));
      setBusy(false);
    }
  }

  return (
    <div className="p-4 pb-6">
      <button onClick={onBack}
        className="text-[11px] font-black uppercase tracking-widest text-violet-700 hover:text-violet-900 cursor-pointer">
        ‹ {t('common.back')}
      </button>

      <h3 className="mt-2 text-[16px] font-black text-slate-800 leading-tight">{t('nel.addNewCase')}</h3>
      {/* The date, said rather than asked. */}
      <div className="text-[11px] font-bold text-slate-400 mt-0.5">{todayLabel}</div>

      {err && (
        <div className="mt-3 px-3 py-2 rounded-lg text-[11.5px] font-black bg-rose-100 text-rose-800">{err}</div>
      )}

      <label className={LABEL} htmlFor="nnc-to">{t('nel.assignToLabel')}</label>
      <CfSelect id="nnc-to" value={assignTo} onChange={(e) => pickAssignTo(e.target.value)}>
        <option value="">{t('nel.chooseSystem')}</option>
        {modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </CfSelect>

      <label className={LABEL} htmlFor="nnc-work">{t('nel.work')}</label>
      {worksFor.length ? (
        <CfSelect id="nnc-work" value={work} onChange={(e) => setWork(e.target.value)}>
          <option value="">{t('nel.chooseWork')}</option>
          {worksFor.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </CfSelect>
      ) : (
        /* Either no system is chosen yet, or that system has no case titles
           set up. Both are answered by saying so rather than by an empty
           dropdown that looks broken. */
        <input id="nnc-work" ref={titleRef} className={FIELD} disabled={!assignTo}
          placeholder={assignTo ? t('nel.noTitles') : t('nel.systemFirst')} />
      )}

      <label className={LABEL} htmlFor="nnc-pic">{t('nel.pic')}</label>
      <CfSelect id="nnc-pic" value={pic} onChange={(e) => setPic(e.target.value)} disabled={!assignTo}>
        <option value="">
          {assignTo && !picsFor.length ? t('nel.noPeople') : t('nel.anyone')}
        </option>
        {picsFor.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </CfSelect>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="nnc-nursery">{t('nel.nursery')}</label>
          <CfSelect id="nnc-nursery" value={nursery}
            onChange={(e) => { setNursery(e.target.value); setPlot(''); }}>
            <option value="">{t('nel.none')}</option>
            {Object.keys(NURSERY_PLOTS).map((n) => <option key={n} value={n}>{NURSERY_LABEL[n]}</option>)}
          </CfSelect>
        </div>
        <div>
          <label className={LABEL} htmlFor="nnc-plot">{t('cull.plot')}</label>
          <CfSelect id="nnc-plot" value={plot} onChange={(e) => setPlot(e.target.value)}
            disabled={!nursery}>
            <option value="">{nursery ? t('nel.none') : t('nel.nurseryFirst')}</option>
            {(NURSERY_PLOTS[nursery] || []).map((p) => <option key={p} value={p}>{p}</option>)}
          </CfSelect>
        </div>
      </div>

      <label className={LABEL}>{t('nel.photo')}</label>
      {photo ? (
        /* A fixed height, not max-h: the remove button is positioned against
           this box, and an image still decoding has no height of its own —
           which drops the ✕ over the field below it. */
        <div className="relative">
          <img src={photo.url} alt="" className="w-full h-40 object-cover rounded-xl border-[1.5px] border-slate-200 bg-slate-50" />
          <button type="button" onClick={dropPhoto} aria-label={t('nel.removePhoto')}
            className="absolute top-2 right-2 grid place-items-center w-8 h-8 rounded-full bg-slate-900/70 text-white text-lg leading-none cursor-pointer">
            ✕
          </button>
        </div>
      ) : (
        /* capture="environment" opens the camera straight onto the back lens
           on a phone, and is simply ignored on a desktop, where the same
           control is a file picker. One control, both jobs. */
        <label className="flex items-center justify-center gap-2 w-full py-4 rounded-xl border-[1.5px] border-dashed border-slate-300 text-[12.5px] font-bold text-slate-500 cursor-pointer hover:border-violet-400 hover:text-violet-700">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} hidden />
          <span>📷 {t('nel.takeOrUpload')}</span>
        </label>
      )}

      <label className={LABEL} htmlFor="nnc-remarks">{t('nel.remarks')}</label>
      <textarea id="nnc-remarks" ref={remarksRef} rows={3} className={FIELD} placeholder={t('nel.whatYouSaw')} />

      <button onClick={submit} disabled={busy}
        className="w-full mt-4 px-3.5 py-3 rounded-xl text-[12px] font-black uppercase tracking-wider text-white bg-violet-600 cursor-pointer disabled:opacity-50">
        {busy ? t('nel.creating') : t('nel.createNewCase')}
      </button>
    </div>
  );
}

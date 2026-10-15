import { useEffect, useMemo, useState } from 'react';
import { fmtNum, fmtPct } from './cullingData.js';
import { CULL_LIMIT, HQ_ACTION, actionForPlot, caseBody } from './cullingActions.js';
// Every figure on this screen comes from here.
import {
  blocksCachedAt, diagnose, figuresBroken, figuresFor, hasFigures, lastLoadWasCached,
  loadPlots, plantedNear, rateFor, closeCollectingStatus, openStatuses,
} from './cullingSource.js';
import { todayStr } from './data.js';
import { agoText } from '../../lib/ago.js';
import { listJobs } from '../../lib/outbox.js';
import { openCasePlots } from '../../lib/nelos.js';
import { clearRefused, refusedCases, retryRefused, submitCase } from './cullingOffline.js';
import { clearInang, loadInang, pruneInang, saveInang } from './cullingInang.js';

/**
 * The Culling Calculator.
 *
 * A calculator, deliberately: one plot at a time, a keypad, and a running
 * sum. Counting pokok inang is done walking the plot in several goes — "300
 * here, 250 there" — so the entry has to add up as you go rather than make
 * somebody total it on paper first and key in one number.
 *
 * Nothing here writes to stock. What the Field Conductor counts feeds the
 * rate and goes into a Nelos case, and the case is the record — so the
 * figures behind a decision are readable by whoever picks the work up,
 * without any of it moving a seedling in the ledger.
 *
 * The case is also the whole handoff. There is no second entry step for the
 * Site Auditor here: the auditor does the work and closes the case in Nelos,
 * rather than doing it, closing it, and coming back to key the same result
 * into this screen as well.
 */
export default function CullingTab({ t, staffName, userId, flash, nurseryKeys, canRemove }) {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  /* The plots to list, and the figures behind each — both from
     cullingSource.js, which only ever hands over blocks it has figures for.
     A collection against a batch that was never transplanted into that plot
     is left out at the source, so there is no "cannot say" row to render:
     every plot here has a transplanted-in figure, a collected figure and a
     balance between them. */
  const [rows, setRows] = useState([]);
  const plots = useMemo(
    () =>
      rows
        /* Only the nurseries this person works. Which ones those are comes
           from FC Portal user access, and the list lost that filter when the
           delivery orders replaced the old plot source — a BNN-only Field
           Conductor was being offered UNN blocks. */
        .filter((r) => !r.nursery || !nurseryKeys?.length || nurseryKeys.includes(r.nursery))
        .map((r) => ({ ...r, ...figuresFor(r) })),
    [rows, tick, nurseryKeys]
  );

  /* Plots that already have an open case. Read once and refreshed after a
     case is raised, so the picker can say "this one has been sent" instead
     of leaving somebody to find out by pressing the button and being told
     it was a duplicate. */
  const [raised, setRaised] = useState(() => new Set());
  const reloadRaised = () =>
    openCasePlots({ source: 'scan' }).then(setRaised, () => {});

  /* What is selected. A plot on its own stopped being unique the moment its
     batches were separated: U4 batch 301 and U4 batch 302 are two blocks of
     ground, collected on their own timetables. */
  const [plotId, setPlotId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState('');    // the one being keyed now
  const [busy, setBusy] = useState(false);
  /* { at } when the blocks on screen came off the device rather than the
     office; at === 0 means this phone has never had a good read. */
  const [stale, setStale] = useState(null);

  /* Requests the server turned down. Normally none — this is empty on every
     phone on a good day — but a case refused after it was queued used to
     disappear without a word, and the Field Conductor was left believing an
     auditor had been sent. See cullingOffline.js. */
  const [notSent, setNotSent] = useState(() => refusedCases());
  const [retrying, setRetrying] = useState(false);
  const reloadNotSent = () => setNotSent(refusedCases());

  /* Take a plot off this screen by CLOSING its collecting status, which is
     what the X in the picker does for an admin. Not a delete — see
     closeCollectingStatus. The row goes from the list the moment the server
     has taken it, so the admin is not left wondering whether it worked.

     Confirmed first, and the question names the plot: this changes a record
     other people are reading, and the picker is a list of similar-looking
     rows under a thumb. */
  const [removing, setRemoving] = useState(null);
  async function removePlot(plot) {
    if (!canRemove || removing) return;

    /* Ask what is running BEFORE asking the person, so the confirm names
       the statuses rather than describing them. A read that fails falls
       back to the plain wording — it still says the PALMS status changes,
       it just cannot say which. */
    let msg = t('cull.removeAskPlain', { plot });
    try {
      const st = await openStatuses(plot);
      if (!st.collecting.length) { flash(t('cull.removeNothing', { plot })); return; }
      const lines = [t('cull.removeAsk1', { plot })];
      lines.push(t('cull.removeCloses', { names: st.collecting.join(', ') }));
      if (st.other.length) {
        lines.push(t('cull.removeKeeps', { names: st.other.join(', ') }));
        lines.push(t('cull.removeBoard', { plot, names: st.other.join(', ') }));
      } else {
        lines.push(t('cull.removeBoardNone', { plot }));
      }
      lines.push(t('cull.removeAsk2'));
      msg = lines.join('\n');
    } catch (e) { /* plain wording, set above */ }

    if (!window.confirm(msg)) return;
    setRemoving(plot);
    try {
      const n = await closeCollectingStatus(plot);
      if (n > 0) {
        /* Off the list by hand is still off the list, so its selection goes
           with it — the same rule the load-time prune follows. */
        clearInang(plot);
        setRows((prev) => prev.filter((r) => r.plot !== plot));
        if (plotId === plot) setPlotId(null);   // key IS the plot name
        flash(t('cull.removed', { plot }));
      } else {
        /* Nothing open to close. Saying "done" would be a lie and saying
           "failed" would send somebody looking for a fault. */
        flash(t('cull.removeNothing', { plot }));
      }
    } catch (e) {
      flash(e && e.message === 'offline' ? t('cull.removeOffline') : t('cull.removeFailed'));
    } finally {
      setRemoving(null);
    }
  }

  // Best effort: a read that fails leaves the screen empty rather than broken.
  useEffect(() => {
    let live = true;
    loadPlots().then((p) => {
      if (!live) return;
      setRows(p || []);
      /* Where these figures came from, so the screen can say so. An empty
         list means one of two very different things and only the source
         knows which. */
      const cached = lastLoadWasCached();
      setStale(cached ? { at: blocksCachedAt() } : null);
      refresh();
      /* A PLOT THAT HAS LEFT THE LIST TAKES ITS SELECTION WITH IT. The plot
         is here because a PALMS collecting status is open on it; once that
         closes the plot has been collected, and last month's selection is a
         figure waiting to be mistaken for a current one.

         Never off a CACHED list. What a phone serves with no signal is
         whatever it last saw, and deleting against it would wipe the
         selections of every plot that has opened since. The list is the one
         just read from the server, before this person's nursery filter —
         the filter decides what they may SEE, not what exists. */
      if (!cached) pruneInang((p || []).map((r) => r.plot));
    }, () => {});
    openCasePlots({ source: 'scan' }).then((s) => { if (live) setRaised(s); }, () => {});
    /* A plot that ought to be on this list and is not has been stopped by one
       of the rules behind it, and the screen cannot say which — it simply
       does not have the row. So the answer is put within reach: with the
       calculator open, cullDebug('B4') or cullDebug('U17', '237') in the
       browser console prints every batch the Batch Report holds there and
       the rule it fell at. */
    window.cullDebug = async (plot, batch) => {
      const lines = await diagnose(plot, batch);
      console.log('%cblocks', 'font-weight:bold');
      console.table(lines.map((l) => ({
        plot: l.plot, batch: l.batch, transplanted: l.transplanted,
        collected: l.collected, why: l.why,
      })));
      /* Which orders make up the collected figure on screen. "N15 batch 244
         collected 186 — from which D/O?" is asked of a number, and the
         answer is the orders that were counted into it, named and totalled,
         so the screen and the paperwork can be squared without adding a
         column up by hand. */
      lines.filter((l) => l.why === 'LISTED' && l.orders.length).forEach((l) => {
        console.log(
          `%c${l.plot} batch ${l.batch} collected ${l.collected.toLocaleString()} on ` +
            `${l.orders.length} order${l.orders.length === 1 ? '' : 's'}: ` +
            l.orders.map((o) => `${o.do || '(no number)'} ${o.qty}`).join(', '),
          'font-weight:bold'
        );
      });
      if (plot) {
        console.log('%cwhat the batch report holds', 'font-weight:bold');
        console.table(await plantedNear(plot, batch));
      }
      return lines;
    };

    /* The other half of the same question. cullDebug answers "why is this
       plot not on the list"; this answers "I pressed the button — where did
       the case go". Three places it can be, and the console names which:
       still queued on the phone, refused by the server with the reason it
       gave, or on the server and therefore a Nelos routing matter rather
       than a portal one. */
    window.cullCase = async () => {
      const queued = (await listJobs()).filter((j) => j.kind === 'culling_case');
      const refused = refusedCases();
      console.log(`%cwaiting on this phone: ${queued.length}`, 'font-weight:bold');
      if (queued.length) {
        console.table(queued.map((j) => ({
          plot: j.payload?.plot, category: j.payload?.category,
          queued: new Date(j.createdAt).toLocaleString(),
          tries: j.tries, lastError: j.lastError,
        })));
      }
      console.log(`%crefused by the server: ${refused.length}`, 'font-weight:bold');
      if (refused.length) {
        console.table(refused.map((r) => ({
          plot: r.payload?.plot, category: r.payload?.category,
          at: new Date(r.at).toLocaleString(), reason: r.message,
        })));
        console.log('cullCase.retry() to send them again once the database is fixed.');
      }
      /* What Nelos has for this portal, read the same way the case list reads
         it. Empty here with a case in the database means the case was routed
         somewhere this account cannot see — which is a routing rule, not a
         lost case. */
      const open = await openCasePlots({ source: 'scan' });
      console.log(`%copen cases Nelos shows this account: ${open.size}`, 'font-weight:bold',
                  open.size ? [...open].join(', ') : '(none)');
      return { queued: queued.length, refused: refused.length, openPlots: [...open] };
    };
    window.cullCase.retry = async () => {
      const r = await retryRefused();
      reloadNotSent();
      reloadRaised();
      console.log(`sent ${r.sent}, still refused ${r.left}`);
      return r;
    };
    /* A way out for a refusal nobody intends to send — a plot since dealt
       with by hand — so the strip is not permanent furniture. */
    window.cullCase.forget = () => { clearRefused(); reloadNotSent(); };
    return () => { live = false; };
  }, []);

  /* Anything counted without a signal goes up on its own — but NOT from
     here. lib/syncAll.js already empties every queue on reconnect and every
     thirty seconds, with a guard so two passes cannot overlap, and a second
     listener on this screen meant the same job was picked up by both and the
     case posted twice. One auditor sent to one plot twice is exactly what the
     dedupe is there to prevent, and racing it is not a way to test it.

     What is left here is only the screen keeping up: when the phone comes
     back, re-read which plots already have a case so the picker's tick is
     right. */
  useEffect(() => {
    const onUp = () => {
      reloadRaised();
      /* The flush is under way as this fires, so what it refuses is not
         written yet. A moment later it is, and the strip appears rather than
         waiting for the screen to be opened again. */
      setTimeout(reloadNotSent, 4000);
    };
    window.addEventListener('online', onUp);
    return () => window.removeEventListener('online', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* One row per PLOT, with its batches underneath.
     
     The list was one row per plot AND batch, which is right for the figures —
     a batch is the block of ground actually being emptied — but wrong for
     choosing: a Field Conductor is sent to a PLOT, and being asked which of
     B4's three batches he means before he has stood in it is the wrong
     question in the wrong order. So the plot is the choice, and the batch is
     a second, optional one made beside it.

     ALL sums the batches. That is the honest whole-plot figure: transplanted
     in is what went in across all of them, collected is what has come off,
     and the balance is the difference — the same arithmetic one batch gets,
     over more ground. */
  const plotList = useMemo(() => {
    const by = new Map();
    plots.forEach((b) => {
      if (!by.has(b.plot)) {
        by.set(b.plot, {
          key: b.plot, plot: b.plot, batch: '', nursery: b.nursery,
          transplant: 0, collected: 0, balance: 0,
          firstDate: '', lastDate: '', orders: [], blocks: [],
        });
      }
      const e = by.get(b.plot);
      e.blocks.push(b);
      e.transplant += b.transplant || 0;
      e.collected += b.collected || 0;
      e.balance += b.balance || 0;
      e.orders = e.orders.concat(b.orders || []);
      if (b.firstDate && (!e.firstDate || b.firstDate < e.firstDate)) e.firstDate = b.firstDate;
      if (b.lastDate && b.lastDate > e.lastDate) e.lastDate = b.lastDate;
      // Collection on the plot opened when its FIRST batch opened.
      e.daysCollecting = Math.max(e.daysCollecting || 0, b.daysCollecting || 0);
    });
    by.forEach((e) => {
      e.orders.sort((a, b2) => String(a.on).localeCompare(String(b2.on))
        || String(a.do).localeCompare(String(b2.do)));
      e.blocks.sort((a, b2) => String(a.batch).localeCompare(String(b2.batch)));
    });
    return [...by.values()];
  }, [plots]);

  const plotRow = plotList.find((p) => p.key === plotId) || plotList[0] || null;
  useEffect(() => { if (!plotId && plotRow) setPlotId(plotRow.key); }, [plotRow, plotId]);

  /* EVERY BATCH AT ONCE, which is the whole shape of this screen now.

     It used to be one batch at a time, chosen beside the plot. That was
     right about the arithmetic — the ten percent line is drawn per batch and
     two batches averaged together hide the one in trouble behind the one
     that is fine — and wrong about the job: a Field Conductor is sent to a
     PLOT, and the decision taken there is about the plot. Asking him to step
     through its batches one at a time to find out whether any of them is
     over is asking him to hold the answer in his head.

     So the plot's batches are a table, each with its balance, its rate, what
     has been selected off it and what that leaves — and the buttons act on
     all of them together. The worst batch decides; see actionForPlot. */
  const batches = plotRow ? plotRow.blocks : [];

  /* Which batch the keypad is typing into, and what has been keyed against
     each. Kept per BATCH, because a count belongs to the block it was walked
     in: there is no single running total on this screen any more.

     `termsBy` is the counts already entered, in the several goes they were
     walked in; `typing` is the one being keyed now, and it belongs to the
     active batch alone. */
  const [active, setActive] = useState(null);
  const [termsBy, setTermsBy] = useState(() => ({}));
  /* WHAT IS ALREADY SAVED against this plot, and how many rounds it has been
     through. Read from the database rather than from this phone, because the
     second round is usually keyed by somebody else and often on a different
     phone — see cullingInang.js. `rounds` is what the HQ button is decided
     from; `savedBy` is what the table starts filled with, so a selection
     made this morning is still on screen this afternoon. */
  const [saved, setSaved] = useState({ byBatch: {}, rounds: 0 });
  /* A selection belongs to the plot it was made on, so changing plot drops
     what is on screen and loads that plot's own. */
  useEffect(() => {
    setTyping(''); setActive(null);
    setSaved({ byBatch: {}, rounds: 0 });
    setTermsBy({});
    if (!plotId) return;
    let live = true;
    loadInang(plotId).then((got) => {
      if (!live) return;
      setSaved(got);
      /* The saved figure IS the starting selection. Anything else would
         show a plot as untouched when a round has already been keyed
         against it. */
      const start = {};
      Object.keys(got.byBatch).forEach((b) => {
        const r = got.byBatch[b];
        start[b] = r.terms && r.terms.length ? r.terms : (r.qty ? [r.qty] : []);
      });
      setTermsBy(start);
    });
    return () => { live = false; };
  }, [plotId]);

  /* One line per batch, which is what the table draws, what the buttons are
     decided from and what the case records — one list, so the three cannot
     read different figures.

     EDITABLE is decided on the batch's OWN rate, before anything is selected
     off it: a batch already under ten percent has nothing to bring down, and
     a cell that invites a count there is a count nobody needed to walk. A
     batch brought under the line by a selection stays editable, or there
     would be no way to correct the figure that got it there. */
  const lines = useMemo(() => batches.map((b) => {
    const terms = termsBy[b.batch] || [];
    const inang = terms.reduce((a, n) => a + n, 0)
                + (active === b.batch && typing !== '' ? Number(typing) : 0);
    const rate = rateFor({ balance: b.balance, transplant: b.transplant, inang: 0 });
    const finalRate = rateFor({ balance: b.balance, transplant: b.transplant, inang });
    return {
      ...b,
      terms,
      inang,
      rate,
      finalRate,
      finalBalance: hasFigures(b) ? b.balance - inang : 0,
      known: hasFigures(b),
      broken: figuresBroken(b),
      editable: Number.isFinite(rate) && rate > CULL_LIMIT,
    };
  }), [batches, termsBy, typing, active]);

  /* What the plot adds up to, for the line at the top. The worst batch is
     what the buttons answer to, so it is what the header shows. */
  const worstNow   = lines.length ? Math.max(...lines.map((l) => (Number.isFinite(l.rate) ? l.rate : Infinity))) : NaN;
  const anyBroken  = lines.some((l) => l.broken || !l.known);

  /* THE TWO BUTTONS, and they are the same two rules as before.

     Every final rate clear → the drone flight, which is what records the
     plot having got there. Any one of them still over → the final pokok
     inang selection, which sends somebody to the plot. A batch whose ledger
     does not add up answers neither: actionForPlot returns null and both
     buttons stay off, because "cannot say" must never read as "yes". */
  const action = actionForPlot(lines.map((l) => l.finalRate));
  const allClear  = !!action && action.key === 'drone';
  const anyOver   = !!action && action.key !== 'drone';

  /* HAS THIS ROUND BEEN KEYED? Not "is there a figure" — a figure loaded off
     the last round is somebody else's answer, and the HQ button must not
     light on the strength of it. It lights when a NEW selection has been
     made and the plot is still over, which is the office's own sentence:
     the second time someone keys the amount again and it is still over ten
     percent. */
  const keyedThisRound = useMemo(() => lines.some((l) => {
    const was = saved.byBatch[l.batch];
    return l.inang !== (was ? was.qty : 0);
  }), [lines, saved]);

  /* The three buttons, and each is a different question:
       drone  — every block clear, whatever round it took to get there;
       final  — still over, and nobody has been sent yet;
       HQ     — still over after a round has already been sent and a second
                selection keyed. A loop that has been round twice is not a
                figure to re-count. */
  const canDrone = allClear;
  const canFinal = anyOver && saved.rounds < 1;
  const canHq    = anyOver && saved.rounds >= 1 && keyedThisRound;

  /* The keypad types into ONE batch — the one whose cell was pressed. With
     none chosen it does nothing at all rather than guessing, because a count
     landing on the wrong block of ground is worse than a key that did not
     answer. */
  const commit = () => {
    if (typing === '' || !active) return;
    const n = Number(typing);
    setTermsBy((m) => ({ ...m, [active]: [...(m[active] || []), n] }));
    setTyping('');
  };
  const press = (k) => {
    if (!active) return;
    if (k === 'AC') { setTermsBy((m) => ({ ...m, [active]: [] })); setTyping(''); return; }
    if (k === 'DEL') { setTyping((s) => s.slice(0, -1)); return; }
    if (k === '+') { commit(); return; }
    if (k === '=') {
      // Fold what is being typed into the list. The total is the same either
      // way — this just makes "10 + 15 + 16 =" settle into one figure the
      // way a calculator does.
      commit();
      return;
    }
    /* Nought is a count, so it can be keyed and it stands on its own. It is
       replaced rather than prefixed by whatever is keyed next, the way any
       calculator behaves — 0 then 5 is 5, not 05. Nothing sane needs seven
       digits. */
    if (k === '00') {
      setTyping((s) => (s === '' || s === '0' ? '0' : (s + '00').slice(0, 6)));
      return;
    }
    setTyping((s) => (s === '0' ? k : (s + k).slice(0, 6)));
  };

  /* On a laptop, use the laptop.

     The keypad is drawn for a thumb in a nursery, and it stays the whole
     interface on a phone. But a Field Conductor writing up at a desk has a
     number pad and a backspace key already under their hands, and making them
     mouse over to a picture of a keypad to key 300 is asking them to use the
     worse of the two.

     The number pad is read by its PHYSICAL key (e.code) rather than by the
     character it sends. With Num Lock off, Chrome reports Numpad5 as "Clear"
     and Numpad4 as "ArrowLeft" — so a laptop with the lock off would have
     typed nothing at all, and the man at the desk would have decided the
     feature did not work. The keys under his fingers are numbered, so on
     this screen they enter numbers either way.

     Backspace is deletion everywhere, and it is stopped from bubbling
     because a browser with nothing focused reads it as "go back" — losing
     the count and the page with it. */
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Somebody typing into a field means that field, not the keypad.
      const el = e.target;
      if (el && el.closest && el.closest('input, textarea, select, [contenteditable]')) return;
      // The plot picker is a choice, not a count.
      if (picking) return;

      const pad = /^Numpad([0-9])$/.exec(e.code || '');
      if (pad)                          { press(pad[1]); e.preventDefault(); return; }
      if (e.key >= '0' && e.key <= '9') { press(e.key); e.preventDefault(); return; }
      if (e.key === 'Backspace')        { press('DEL'); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.code === 'NumpadDecimal') {
        press('AC'); e.preventDefault(); return;
      }
      if (e.key === '+' || e.code === 'NumpadAdd') { press('+'); e.preventDefault(); return; }
      if (e.key === '=' || e.key === 'Enter')      { press('='); e.preventDefault(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* Raise one of the three. `act` is the rule — the two bands out of
     cullingActions.js, or the HQ one beside them — so the button only has to
     say which, and the category, the title and the routing travel with it.

     THE SELECTION IS WRITTEN FIRST, and a refusal stops the case. The case
     and the table are one record of one decision: a case raised over figures
     the office cannot see is a case nobody can check, and a selection saved
     under a case that never went is a round counted for nothing. */
  async function raise(act) {
    if (!act || !plotRow || busy) return;
    setBusy(true);
    const attempt = (saved.rounds || 0) + 1;
    try {
      await saveInang({
        plot: plotRow.plot, nursery: plotRow.nursery, rows: lines,
        attempt, by: staffName, byId: userId,
      });
    } catch (e) {
      setBusy(false);
      flash(t('cull.saveFailed'));
      return;
    }
    setSaved((prev) => ({
      rounds: attempt,
      byBatch: Object.fromEntries(lines.map((l) => [l.batch, { qty: l.inang, terms: l.terms, attempt }])),
    }));
    const action = act;
    // The case's own sentence, not the button's label: see caseTitle in
    // cullingActions.js for why it does not follow the language picker.
    const title = action.caseTitle(plotRow.plot);
    const { data: c, error, deduped, queued } = await submitCase({
      title,
      /* EVERY batch of the plot, because the decision was taken over all of
         them. A case naming one would be a record of a different decision,
         and it would send the auditor to part of a plot. */
      description: caseBody({
        t, plot: plotRow.plot, nursery: plotRow.nursery,
        rows: lines, by: staffName, date: todayStr(),
      }),
      category: action.category,
      priority: action.priority,
      source: 'scan',            // the FC Portal's key in nelos_modules
      nursery: plotRow.nursery,
      plot: plotRow.plot,
      by: staffName,
      byId: userId,
      // Pressed twice, or the same plot revisited while the first case is
      // still open, must not queue a second identical job for the auditor.
      dedupe: true,
    });
    setBusy(false);
    if (error) {
      /* Refused. The count stays on screen so it can be sent again, and the
         strip above appears — the toast goes, and by the time somebody in the
         office is asked about it there would otherwise be nothing to see. */
      reloadNotSent();
      flash(t('cull.raiseFailed'));
      return;
    }
    /* No signal: it is in the outbox and will go up on its own. The count is
       cleared either way, because it HAS been recorded — leaving it on screen
       would invite it being sent a second time when the signal returns. */
    /* THE SELECTION STAYS ON SCREEN. It used to be cleared, because it had
       nowhere to live and leaving it invited the same count being sent
       twice. It is in the table now, and clearing it would show the plot as
       untouched the moment after somebody recorded a round against it —
       which is exactly what the next person must not see. */
    setTyping('');
    if (queued) { flash(t('cull.queued')); return; }
    reloadRaised();
    flash(deduped ? t('cull.alreadyOpen', { n: c.case_no || '' }) : t('cull.raised', { n: c.case_no || '' }));
  }

  if (!plots.length) {
    /* Two very different sentences, and the screen used to say the first one
       for both. "No plot is at Pengambilan" is a fact about the nursery; a
       phone that has never loaded anything knows no such fact, and telling a
       Field Conductor there is no culling to do is how an afternoon gets
       skipped. */
    return (
      <div className={`rounded-3xl px-4 py-10 text-center text-sm font-bold border ${
        stale && !stale.at
          ? 'bg-[#2a1f11] border-[#4a361c] text-amber-300'
          : 'bg-[#111821] border-[#1f2a38] text-slate-400'}`}>
        {stale && !stale.at ? t('cull.neverLoaded') : t('cull.noPlots')}
      </div>
    );
  }

  /* The whole calculator on ONE screen, phone included.

     It was a stack of fixed heights that came to more than a phone has, so a
     Field Conductor scrolled down to reach the keypad and back up to read the
     rate — on a tool held in one hand, in the sun. Now the card fills the
     height it is given and the KEYPAD takes up the slack: the panels are the
     size they need to be, the keys share whatever is left, and nothing
     overflows on a short screen or floats in the middle of a tall one. */
  return (
    <div
      data-calc
      /* The width is capped by the HEIGHT available, not just by 420px.
         A calculator is a shape as much as a size: fixing the width and
         letting the height collapse is what turned the keys into letterboxes
         91px wide and 28 tall on a short laptop window. Tied to the height,
         the whole thing narrows instead and the keys stay keys — full width
         on a phone, where the height is there, and a narrower calculator on a
         short window, which reads as deliberate rather than squashed. */
      className="mx-auto h-full w-full max-w-[min(420px,calc((100dvh-84px)*0.55))]"
    >
      <div className="bg-black rounded-[2rem] overflow-hidden shadow-2xl border border-[#1f2a38]
                      p-2.5 flex flex-col gap-1.5 h-full">
        {/* Figures from the device, not the office. One thin line, because a
            conductor counting pokok inang does not want a banner — but it has
            to be there: the numbers a rate is judged against were true when
            they were loaded, and a batch collected since would make this
            screen confidently wrong. Counting still works, and still saves. */}
        {stale && stale.at > 0 && (
          <div className="mx-1 rounded-lg bg-[#2a1f11] border border-[#4a361c] px-2.5 py-1
                          text-[10px] font-bold text-amber-300/90 text-center">
            {t('cull.showingCached', { when: agoText(stale.at, t) })}
          </div>
        )}

        {/* Which plot. The batch picker beside it has gone: every batch of
            the plot is on screen now, so choosing one was choosing which
            part of the answer to look at. */}
        <div className="flex items-center justify-between px-2 pt-1">
          <button
            onClick={() => setPicking(true)}
            className="flex items-center gap-1.5 text-white font-black text-[15px] cursor-pointer"
          >
            {plotRow ? plotRow.plot : '—'}
            <span className="text-[10px] text-slate-500">▼</span>
          </button>
          {/* WHERE THE PLOT STANDS, which is where its WORST batch stands.
              An average would read as a healthy plot with one block in
              trouble inside it. */}
          <div className="text-[13px] font-black tabular-nums">
            <span className="text-slate-500 mr-1">{t('cull.cullShort')} :</span>
            <span className={
              anyBroken ? 'text-amber-400'
                : worstNow > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
            }>
              {anyBroken ? t('cull.checkStock') : fmtPct(worstNow)}
            </span>
          </div>
        </div>

        {/* A request that did not go.
            Only ever drawn when there is one, so it costs nothing on the
            screen it is normally absent from — and when it is there it is the
            most important line on the calculator, because everything below it
            is about a case somebody believes has been raised and has not. */}
        {notSent.length > 0 && (
          <button
            data-notsent
            onClick={async () => {
              if (retrying) return;
              setRetrying(true);
              const r = await retryRefused();
              setRetrying(false);
              reloadNotSent();
              reloadRaised();
              flash(r.sent ? t('cull.notSentGone', { n: r.sent }) : t('cull.raiseFailed'));
            }}
            className="w-full rounded-2xl bg-rose-950/70 border border-rose-800 px-3 py-1.5
                       text-left text-rose-200 text-[11px] font-bold leading-snug cursor-pointer
                       hover:bg-rose-900/70"
          >
            {retrying ? t('common.saving') : t('cull.notSent', { n: notSent.length })}
          </button>
        )}

        {/* THE PLOT, ONE LINE PER BATCH.

            Four columns and they read left to right as the decision does:
            what is standing and what that rate is, what has been selected
            off it, and what that leaves. Green is clear, red is over the
            line — the one thing a Field Conductor has to be able to see
            from arm's length in the sun.

            The Select cell is a BUTTON on a batch that is over the line and
            plain type on one that is not: a batch already under ten percent
            has nothing to bring down, so a cell inviting a count there is a
            count nobody needed to walk. */}
        <div data-batches className="bg-[#101013] rounded-2xl px-2 py-2 overflow-y-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead>
              <tr className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                <th className="text-left font-black pb-1 px-1">{t('cull.batch')}</th>
                <th className="text-right font-black pb-1 px-1">{t('cull.balance')}</th>
                <th className="text-right font-black pb-1 px-1">{t('cull.selected')}</th>
                <th className="text-right font-black pb-1 px-1">{t('cull.finalBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.batch} data-batch={l.batch} className="border-t border-[#1f2a38]">
                  <td className="text-left py-1.5 px-1 font-bold text-slate-200">{l.batch || '—'}</td>
                  <td className="text-right py-1.5 px-1 text-slate-300">
                    {l.known || l.broken ? fmtNum(l.balance) : '—'}
                    {/* A minus balance is not a good rate, so it is named
                        rather than given a green percentage. */}
                    <span data-rate className={`ml-1 font-black ${
                      l.broken || !Number.isFinite(l.rate) ? 'text-amber-400'
                        : l.rate > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {Number.isFinite(l.rate) ? `(${fmtPct(l.rate)})` : `(${t('cull.checkStock')})`}
                    </span>
                  </td>
                  <td className="text-right py-1.5 px-1">
                    {l.editable ? (
                      <button
                        data-select={l.batch}
                        onClick={() => { if (active !== l.batch) { setTyping(''); setActive(l.batch); } }}
                        className={`min-w-[44px] rounded-lg px-2 py-0.5 font-bold cursor-pointer border transition-colors ${
                          active === l.batch
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-[#1c1c1e] border-[#2c2c2e] text-slate-200 hover:border-slate-500'
                        }`}
                      >
                        {fmtNum(l.inang)}
                      </button>
                    ) : (
                      <span className="text-slate-600">{fmtNum(l.inang)}</span>
                    )}
                  </td>
                  <td className="text-right py-1.5 px-1 text-slate-300">
                    {l.known ? fmtNum(l.finalBalance) : '—'}
                    <span data-final className={`ml-1 font-black ${
                      !Number.isFinite(l.finalRate) ? 'text-amber-400'
                        : l.finalRate > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {Number.isFinite(l.finalRate) ? `(${fmtPct(l.finalRate)})` : `(${t('cull.checkStock')})`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {anyBroken && (
            <div className="text-[10px] font-bold text-amber-500/80 leading-snug pt-1 px-1">
              {t('cull.negativeNote')}
            </div>
          )}
        </div>

        {/* THE DRONE FLIGHT, which is only on when EVERY batch is clear. One
            batch still over the line and the plot is not ready, however many
            of the others are. */}
        <button
          data-drone
          onClick={() => raise(action)}
          disabled={!canDrone || busy}
          className={`w-full rounded-2xl py-2.5 font-black text-[13px] uppercase tracking-widest transition-colors ${
            canDrone
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
              : 'bg-[#1c1c1e] text-slate-600 cursor-default'
          }`}
        >
          {busy && canDrone ? t('common.saving') : t('cull.actDrone')}
        </button>

        {/* The keypad, typing into whichever batch was pressed. It says so
            when nothing is: a keypad that quietly does nothing reads as a
            broken screen. */}
        <div className="bg-[#101013] rounded-2xl pt-1.5 pb-1.5 flex-1 min-h-0 flex flex-col">
          <div className="px-4 text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {active ? `${t('cull.batch')} ${active}` : t('cull.pickBatchFirst')}
            </div>
            <div data-typing className="text-slate-500 text-[13px] font-mono min-h-[14px] truncate">
              {active
                ? ([...(termsBy[active] || []), ...(typing === '' ? [] : [typing])].join(' + ') || ' ')
                : ' '}
            </div>
          </div>
          <Keypad onPress={press} />
        </div>

        {/* And the other way out: the plot is still over the line after
            everything that could be selected off it, so somebody goes and
            makes the final selection. Same case as before, under the same
            category — only the wording on the button has changed, because
            the category is what Nelos routes on. */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            data-final-selection
            onClick={() => raise(action)}
            disabled={!canFinal || busy}
            className={`rounded-2xl py-2.5 px-2 font-black text-[11px] uppercase tracking-wider leading-tight transition-colors ${
              canFinal
                ? 'bg-amber-500 hover:bg-amber-400 text-black cursor-pointer'
                : 'bg-[#1c1c1e] text-slate-600 cursor-default'
            }`}
          >
            {busy && canFinal ? t('common.saving') : t('cull.actRecheck')}
          </button>
          {/* HQ, and only on the SECOND time round. A plot still over after
              an auditor has already been sent and a second selection keyed
              is not a figure to re-count — it is one somebody at HQ comes
              and looks at. */}
          <button
            data-hq
            onClick={() => raise(HQ_ACTION)}
            disabled={!canHq || busy}
            className={`rounded-2xl py-2.5 px-2 font-black text-[11px] uppercase tracking-wider leading-tight transition-colors ${
              canHq
                ? 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                : 'bg-[#1c1c1e] text-slate-600 cursor-default'
            }`}
          >
            {busy && canHq ? t('common.saving') : t('cull.actHq')}
          </button>
        </div>
      </div>

      {picking && (
        <PlotPicker
          plots={plotList}
          current={plotId}
          raised={raised}
          t={t}
          canRemove={canRemove}
          onRemove={removePlot}
          onPick={(p) => { setPlotId(p); setTermsBy({}); setTyping(''); setActive(null); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/* The keypad.
   Digits fill the left; the two things you can do to a running count sit in
   the orange column, + above =. Both are two rows tall — + reaching from the
   9 down to the 6 and = from the 3 down to the 00 — so the column is two
   even halves rather than one small key and one long one. There is no ×, ÷
   or −: you are only ever adding up counts. */
/* The delete key's mark, drawn rather than typed.

   It was the character ⌫, which is not in every phone's font — and a glyph a
   font does not have comes out as an empty box, which is what a Field
   Conductor was looking at. A path cannot go missing. */
function Backspace() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
      <path d="M17 9.5l-5 5M12 9.5l5 5" />
    </svg>
  );
}

function Keypad({ onPress }) {
  const grey = 'bg-[#333336] hover:bg-[#4a4a4d] text-white';
  const dark = 'bg-[#1c1c1e] hover:bg-[#2c2c2e] text-white';
  const amber = 'bg-amber-500 hover:bg-amber-400 text-white';
  const key = (label, k, cls, span) => (
    <button
      key={k}
      onClick={() => onPress(k)}
      aria-label={typeof label === 'string' ? undefined : 'delete'}
      className={`${cls} ${span || ''} grid place-items-center rounded-2xl text-[22px] font-medium tabular-nums transition-colors cursor-pointer active:scale-95`}
    >
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-4 grid-rows-5 gap-1.5 px-2 pb-1 pt-1.5 flex-1 min-h-0">
      {key('AC', 'AC', grey, 'col-span-2')}
      {key(<Backspace />, 'DEL', grey, 'col-span-2')}
      {['7', '8', '9'].map((d) => key(d, d, dark))}
      {key('+', '+', amber, 'row-span-2')}
      {['4', '5', '6'].map((d) => key(d, d, dark))}
      {['1', '2', '3'].map((d) => key(d, d, dark))}
      {key('=', '=', amber, 'row-span-2')}
      {key('0', '0', dark, 'col-span-2')}
      {key('00', '00', dark)}
    </div>
  );
}

/* Which plot. Every plot PALMS has at Pengambilan that this person may see,
   with the rate its batches stand at, so the choice is made on the figures
   rather than by remembering plot numbers.

   A plot appears here because of its STATUS, not because a delivery order
   collects from it — see pengambilanPlots in cullingSource.js for why that
   is a considered choice and not the design this screen used to have. Which
   means a plot can show up with nothing collected off it yet: the batch
   step right after this one is where a Field Conductor tells the screen
   which block of it they actually mean, and a batch with a full balance and
   a 0% rate is one nobody has started on, not a fault to chase. */
function PlotPicker({ plots, current, raised, t, canRemove, onRemove, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#111821] border border-[#1f2a38] w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-7 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-slate-100 text-[14px] uppercase tracking-wide">{t('cull.pickPlot')}</h3>
          <button onClick={onClose} aria-label={t('common.cancel')}
            className="w-8 h-8 rounded-full hover:bg-[#1f2a38] text-slate-400 text-xl leading-none cursor-pointer">×</button>
        </div>
        <div className="space-y-1.5">
          {plots.map((p) => {
            const broken = figuresBroken(p);
            const rate = rateFor({ balance: p.balance, transplant: p.transplant, inang: 0 });
            return (
              <button
                key={p.key}
                onClick={() => onPick(p.key)}
                className={`w-full flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left cursor-pointer border transition-colors ${
                  p.key === current
                    ? 'bg-emerald-600/15 border-emerald-600/50'
                    : 'bg-[#0f1620] border-[#1f2a38] hover:border-slate-600'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-slate-100 text-[14px]">{p.plot}</span>
                    {/* How many batches are standing in it, since the row is
                        the whole plot now and its figures are their sum. The
                        batch itself is chosen after, beside the plot name. */}
                    {p.blocks && p.blocks.length > 1 && (
                      <span className="font-bold text-slate-400 text-[11px] tabular-nums">
                        {p.blocks.length} {t('cull.batches')}
                      </span>
                    )}
                    {p.blocks && p.blocks.length === 1 && p.blocks[0].batch && (
                      <span className="font-bold text-slate-400 text-[11px] tabular-nums">{p.blocks[0].batch}</span>
                    )}
                    {/* Already handed over. The rate alone cannot say this,
                        and without it the only way to find out is to press
                        the button and be told it was a duplicate. */}
                    {raised && raised.has(p.plot) && (
                      <span className="rounded-md bg-emerald-600 text-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                        ✓ Nelos
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    {p.nursery} · {t('cull.balance')} {fmtNum(p.balance)}
                  </div>
                </div>
                {/* A minus balance is not a good rate, so it does not get a
                    green percentage. It gets named for what it is. */}
                <div className="flex items-center gap-2 shrink-0">
                  {broken ? (
                    <div className="text-[9px] font-black uppercase tracking-wider text-amber-400 text-right leading-tight max-w-[86px]">
                      {t('cull.checkStock')}
                    </div>
                  ) : (
                    <div className={`text-[13px] font-black tabular-nums ${
                      rate > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {fmtPct(rate)}
                    </div>
                  )}
                  {/* Admins only. A plot sits on this screen because a
                      collecting status is open on it, and nothing closes one
                      except saving that plot in PALMS — so a status left open
                      months ago keeps the plot here for ever. This closes it.

                      A span with a role, not a button: the row itself is a
                      button and a button inside a button is not valid HTML,
                      which browsers resolve by dropping one of them. The
                      click is stopped here so pressing X never also picks the
                      plot underneath it. */}
                  {canRemove && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={t('cull.removeAria', { plot: p.plot })}
                      title={t('cull.removeTitle')}
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemove(p.plot); }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.stopPropagation(); e.preventDefault(); onRemove(p.plot);
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500
                                 hover:text-rose-300 hover:bg-rose-500/15 text-[15px] leading-none
                                 cursor-pointer transition-colors"
                    >
                      ×
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

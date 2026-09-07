import { useEffect, useMemo, useState } from 'react';
import { fmtNum, fmtPct } from './cullingData.js';
import { CULL_LIMIT, actionFor, caseBody } from './cullingActions.js';
// Every figure on this screen comes from here.
import {
  blocksCachedAt, diagnose, figuresBroken, figuresFor, hasFigures, lastLoadWasCached,
  loadPlots, plantedNear, rateFor,
} from './cullingSource.js';
import { todayStr } from './data.js';
import { agoText } from '../../lib/ago.js';
import { listJobs } from '../../lib/outbox.js';
import { openCasePlots } from '../../lib/nelos.js';
import { clearRefused, refusedCases, retryRefused, submitCase } from './cullingOffline.js';

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
export default function CullingTab({ t, staffName, userId, flash, nurseryKeys }) {
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
  const [terms, setTerms] = useState([]);      // the counts already entered
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

  // Best effort: a read that fails leaves the screen empty rather than broken.
  useEffect(() => {
    let live = true;
    loadPlots().then((p) => {
      if (!live) return;
      setRows(p || []);
      /* Where these figures came from, so the screen can say so. An empty
         list means one of two very different things and only the source
         knows which. */
      setStale(lastLoadWasCached() ? { at: blocksCachedAt() } : null);
      refresh();
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

  /* WHICH batch — always exactly one, never all of them together.

     The plot's batches were summed into one "All batches" figure, and that
     figure could not be acted on: a plot is culled batch by batch, the ten
     percent line is drawn per batch, and two batches averaged together hide
     the one that is in trouble behind the one that is fine. So the choice is
     always a single block, and the first is chosen for you.

     Reset whenever the plot changes — a batch number means nothing on a
     different plot. */
  const batches = plotRow ? plotRow.blocks : [];
  const [batchId, setBatchId] = useState(null);
  const picked = batches.find((b) => b.batch === batchId) || batches[0] || null;
  useEffect(() => { setBatchId(null); }, [plotId]);
  useEffect(() => {
    if (!batchId && picked) setBatchId(picked.batch);
  }, [batchId, picked]);
  /* A count belongs to the block it was walked in, so moving to another one
     clears it rather than quietly re-attributing it. */
  useEffect(() => { setTerms([]); setTyping(''); }, [plotId, batchId]);

  /* The row the whole screen works from — one object, so the rate, the action
     and the case cannot read different figures. It is one plot and one batch:
     the block of ground somebody is standing in. */
  const row = picked;

  const known = hasFigures(row);
  const broken = figuresBroken(row);
  const inang = terms.reduce((a, b) => a + b, 0) + (typing === '' ? 0 : Number(typing));
  /* Whether a count has been MADE, which is not the same as whether it came
     to anything. A Field Conductor who walks the plot and finds no pokok
     inang at all has done the work and has an answer — nought — and that
     answer has to be enterable, show a rate, and be sendable. Judging by the
     total instead treated "I looked and there are none" as "I have not
     looked yet", and left him with a dead button on a plot he had just
     walked. */
  const counted = terms.length > 0 || typing !== '';
  const rateNow = rateFor({ balance: row?.balance, transplant: row?.transplant, inang: 0 });
  const rateAfter = rateFor({ balance: row?.balance, transplant: row?.transplant, inang });
  const left = known ? row.balance - inang : 0;
  /* When to offer the button.
     Counting pokok inang is what brings a block DOWN to ten percent, so the
     button waited for a count. But a block already at or under ten percent
     before anybody counts has nothing to bring down — it is ready, and the
     drone flight is what records it having got there. Making the Field
     Conductor key a number he does not have, into a plot that already passes,
     to reach a button that was always going to say the same thing, is asking
     him to do the arithmetic the calculator just did.

     So: already passing, offer it straight away. Over the line, it still
     takes a count, because that is the only thing that can change the answer.
     rateAfter equals rateNow while nothing has been counted, so one call
     covers both. */
  const action = known && (counted || rateNow <= CULL_LIMIT) ? actionFor(rateAfter) : null;

  const press = (k) => {
    if (k === 'AC') { setTerms([]); setTyping(''); return; }
    if (k === 'DEL') { setTyping((s) => s.slice(0, -1)); return; }
    if (k === '+') {
      if (typing !== '') { setTerms((ts) => [...ts, Number(typing)]); setTyping(''); }
      return;
    }
    if (k === '=') {
      // Fold what is being typed into the list. The total is the same either
      // way — this just makes "10 + 15 + 16 =" settle into one figure the
      // way a calculator does.
      if (typing !== '') { setTerms((ts) => [...ts, Number(typing)]); setTyping(''); }
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

  async function raise() {
    if (!action || !row || busy) return;
    setBusy(true);
    // The case's own sentence, not the button's label: see caseTitle in
    // cullingActions.js for why it does not follow the language picker.
    const title = action.caseTitle(row.plot);
    const { data: c, error, deduped, queued } = await submitCase({
      title,
      description: caseBody({
        t, plot: row.plot, nursery: row.nursery, balance: row.balance,
        inang, rate: rateAfter, terms, by: staffName, date: todayStr(),
        /* Which block of the plot was walked. Without it the auditor is sent
           to a plot and left to work out which part of it was counted. It is
           always one batch now, so there is one name to give. */
        batch: row.batch,
      }),
      category: action.category,
      priority: action.priority,
      source: 'scan',            // the FC Portal's key in nelos_modules
      nursery: row.nursery,
      plot: row.plot,
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
    if (queued) {
      flash(t('cull.queued'));
      setTerms([]); setTyping('');
      return;
    }
    reloadRaised();
    flash(deduped ? t('cull.alreadyOpen', { n: c.case_no || '' }) : t('cull.raised', { n: c.case_no || '' }));
    setTerms([]); setTyping('');
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

        {/* Which plot, and where its rate stands before any of today's
            counting. Apple puts the clock here; the plot is what this
            calculator is always about, so it takes that place. */}
        <div className="flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 text-white font-black text-[15px] cursor-pointer"
            >
              {plotRow ? plotRow.plot : '—'}
              <span className="text-[10px] text-slate-500">▼</span>
            </button>
            {/* Which batch, beside the plot rather than folded into choosing
                it. Only when there is more than one: a dropdown offering one
                answer is furniture, so a single-batch plot just prints its
                number. */}
            {batches.length > 1 && (
              <select
                value={batchId || ''}
                onChange={(e) => setBatchId(e.target.value)}
                className="bg-[#1a1a1f] border border-[#2a2a33] text-slate-200 font-bold text-[11px]
                           rounded-lg px-2 py-1 tabular-nums cursor-pointer outline-none max-w-[130px]"
                aria-label={t('cull.batch')}
              >
                {batches.map((b) => (
                  <option key={b.batch} value={b.batch}>{b.batch}</option>
                ))}
              </select>
            )}
            {batches.length === 1 && batches[0].batch && (
              <span className="font-bold text-slate-400 text-[11px] tabular-nums">{batches[0].batch}</span>
            )}
          </div>
          <div className="text-[13px] font-black tabular-nums">
            <span className="text-slate-500 mr-1">{t('cull.cullShort')} :</span>
            <span className={
              broken ? 'text-amber-400'
                : known && rateNow > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
            }>
              {known ? fmtPct(rateNow) : t('cull.checkStock')}
            </span>
          </div>
        </div>

        {/* A request that did not go.
            Only ever drawn when there is one, so it costs nothing on the
            screen it is normally absent from — and when it is there it is the
            most important line on the calculator, because everything below it
            is about a case somebody believes has been raised and has not.
            Pressing it tries again: the usual cause is the database not yet
            knowing about culling cases, which somebody in the office fixes,
            and then the request is still wanted. */}
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

        {/* Two blocks, because there are two numbers and they are not the
            same kind of thing: what the plot is holding, and what has been
            counted off it. Told apart by a panel each rather than a rule
            between them — a hard border here made the screen busier without
            making it clearer. */}
        <div className="bg-[#101013] rounded-2xl px-4 py-2 text-right">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {t('cull.balance')}
          </div>
          <div className={`text-[clamp(19px,3.4dvh,28px)] font-light tabular-nums leading-tight ${
            broken ? 'text-amber-400' : 'text-slate-300'
          }`}>
            {fmtNum(row.balance)}
          </div>
          {/* Below zero means the stock ledger for this plot does not add up:
              more has been culled and sold off it than was ever transplanted
              in. It is a real figure and the office movement report shows it
              too, so it is named rather than hidden — but no rate is offered
              on top of it, because a rate worked out from it would be
              negative, and a negative rate reads as a healthy plot. */}
          {broken && (
            <div className="text-[10px] font-bold text-amber-500/80 leading-snug pt-0.5">
              {t('cull.negativeNote')}
            </div>
          )}
        </div>

        <div className="bg-[#101013] rounded-2xl pt-2 pb-1.5 flex-1 min-h-0 flex flex-col">
          <div className="px-4 text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {t('cull.selected')}
            </div>
            <div className="text-slate-500 text-[13px] font-mono min-h-[14px] truncate">
              {[...terms, ...(typing === '' ? [] : [typing])].join(' + ') || ' '}
            </div>
            {/* Named, so a check on the running count does not have to find it
                by whatever size it happens to be set at today. */}
            <div
              data-inang
              className="text-white text-[clamp(24px,5.2dvh,42px)] font-light tabular-nums leading-none truncate"
            >
              {inang ? fmtNum(inang) : '0'}
            </div>
          </div>

          {/* The keypad belongs to the count, so it sits inside its panel
              rather than floating under the whole card. */}
          <Keypad onPress={press} />
        </div>

        {/* What the count leaves, and what that means.

            This was a thin strip of small print under the keypad, sized as an
            afterthought to the two figures above it. Those have gone under
            the ! now, and this is what the counting is FOR: what is left
            standing, and whether that clears ten percent. It is the answer
            the Field Conductor walked the plot to get, so it is a panel like
            the balance and reads at the same size. */}
        <div className="bg-[#101013] rounded-2xl px-4 py-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {t('cull.left')}
            </div>
            <div className="text-[clamp(18px,3.1dvh,26px)] font-light tabular-nums leading-tight text-slate-300">
              {known ? fmtNum(left) : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {t('cull.estRate')}
            </div>
            <div
              data-est
              className={`text-[clamp(18px,3.1dvh,26px)] font-light tabular-nums leading-tight ${
              !known || !counted ? 'text-slate-600'
                : rateAfter > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
            }`}>
              {known && counted ? fmtPct(rateAfter) : '—'}
            </div>
          </div>
        </div>

        {/* The one button that acts on it. The wording comes from the rule
            that matched, so a new band added to cullingActions.js appears
            here with nothing changed. */}
        <button
          onClick={raise}
          disabled={!action || busy}
          className={`w-full rounded-2xl py-2.5 font-black text-[13px] uppercase tracking-widest transition-colors ${
            !action
              ? 'bg-[#1c1c1e] text-slate-600 cursor-default'
              : action.tone === 'ok'
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
              : 'bg-amber-500 hover:bg-amber-400 text-black cursor-pointer'
          }`}
        >
          {busy ? t('common.saving') : action ? t(action.titleKey) : t('cull.enterCount')}
        </button>
      </div>

      {picking && (
        <PlotPicker
          plots={plotList}
          current={plotId}
          raised={raised}
          t={t}
          onPick={(p) => { setPlotId(p); setTerms([]); setTyping(''); setPicking(false); }}
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
function PlotPicker({ plots, current, raised, t, onPick, onClose }) {
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
                {broken ? (
                  <div className="text-[9px] font-black uppercase tracking-wider text-amber-400 shrink-0 text-right leading-tight max-w-[86px]">
                    {t('cull.checkStock')}
                  </div>
                ) : (
                  <div className={`text-[13px] font-black tabular-nums shrink-0 ${
                    rate > CULL_LIMIT ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    {fmtPct(rate)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

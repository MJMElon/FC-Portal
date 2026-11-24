/* ── ONE ORDER, SCANNED AT TWO PLACES AT ONCE ─────────────────────────
   A big order is often loaded from two places at the same time -- one
   person at UNN 1, another at UNN 2, each with a phone, each scanning the
   seals going onto the same lorry. Each of them needs to know how many
   THEY have scanned, and how many the other place has, and a seal must
   never be counted at both.

   The second half was already true: the scan table is unique on
   (consent_id, barcode), the realtime feed puts the other phone's seals
   into this phone's list as they land, and a seal already in the list is
   refused as a duplicate -- scanned or keyed by hand alike. What was
   missing is WHO scanned each seal, so a card could only ever say one
   figure for the whole order.

   A SCAN POINT IS A PHONE. Its id is made once on the phone and kept in
   localStorage; its NAME is what the screen says, and defaults to the
   person signed in. The id and not the name is what a reset clears, so two
   phones that happen to carry the same name never clear each other.

   Which point holds a seal is kept on the card's progress as `pointOf`
   (barcode -> point id) and `pointNames` (point id -> name), beside the
   set of seals rather than inside the log lines, because the server is
   the answer to it: a seal two phones both took while neither had a line
   belongs to whichever reached the table first, and `notePoints` moves it
   there when the rows come back.

   A seal with no point is one scanned before any of this existed. It is
   counted, and it is shown as "Earlier scans" -- it is nobody's now, so
   any phone may clear it, which is the only way an order carrying a
   thousand seals nobody can account for gets put right. */

import { barcodeKey, defaultProgress, dedupeProgress, sealsAlreadyOnDO, sealsForNextDO } from './store.js';

const POINT_KEY = 'mjm.scan.point.v1';
export const NO_POINT = '';

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'sp-' + crypto.randomUUID();
  return 'sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** This phone's scan point: { id, name }. The id is made once and kept. */
export function myScanPoint(defaultName) {
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem(POINT_KEY) || 'null'); } catch (_) { cur = null; }
  if (!cur || !cur.id) {
    cur = { id: makeId(), name: '' };
    try { localStorage.setItem(POINT_KEY, JSON.stringify(cur)); } catch (_) { /* storage blocked */ }
  }
  return { id: cur.id, name: String(cur.name || '').trim() || String(defaultName || '').trim() || 'This phone' };
}

export function setScanPointName(name) {
  const cur = myScanPoint();
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(POINT_KEY) || 'null'); } catch (_) { raw = null; }
  const next = { id: (raw && raw.id) || cur.id, name: String(name || '').trim().slice(0, 40) };
  try { localStorage.setItem(POINT_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
  return myScanPoint();
}

/** Mark codes as taken at a point. The SAME object back when nothing moved. */
export function markPoint(cur, codes, pointId, pointName) {
  const base = cur || defaultProgress();
  const pointOf = { ...(base.pointOf || {}) };
  const pointNames = { ...(base.pointNames || {}) };
  let moved = false;
  for (const raw of codes || []) {
    const code = barcodeKey(raw);
    if (!code || pointOf[code] === pointId) continue;
    pointOf[code] = pointId;
    moved = true;
  }
  if (pointId && pointName && pointNames[pointId] !== pointName) { pointNames[pointId] = pointName; moved = true; }
  return moved ? { ...base, pointOf, pointNames } : base;
}

/** The server's rows say which point holds each seal. A row naming no point
    (written by an older build, or before the column existed) says nothing,
    so whatever this phone knows stands. */
export function notePoints(cur, rows) {
  let next = cur || defaultProgress();
  for (const r of rows || []) {
    const code = barcodeKey(r && r.barcode);
    const pid = r && r.scan_point;
    if (!code || !pid) continue;
    next = markPoint(next, [code], pid, r.scan_point_name || '');
  }
  return next;
}

/** How many seals each point holds on this card, mine first. */
export function countsByPoint(p, myId, myName) {
  const cur = p || {};
  const pointOf = cur.pointOf || {};
  const names = cur.pointNames || {};
  const by = new Map();
  for (const raw of cur.seen || []) {
    const code = barcodeKey(raw);
    if (!code) continue;
    const id = pointOf[code] || NO_POINT;
    by.set(id, (by.get(id) || 0) + 1);
  }
  const out = [...by.entries()].map(([id, n]) => ({
    id,
    n,
    mine: !!id && id === myId,
    name: id === myId ? (myName || names[id] || '') : (names[id] || ''),
  }));
  if (myId && !by.has(myId)) out.push({ id: myId, n: 0, mine: true, name: myName || names[myId] || '' });
  out.sort((a, b) => (b.mine - a.mine) || ((a.id === NO_POINT) - (b.id === NO_POINT)) || b.n - a.n);
  return out;
}

/** Which point holds this seal on the card, or null when the card has not got it. */
export function pointHolding(p, code) {
  const want = barcodeKey(code);
  const cur = p || {};
  if (!want || !(cur.seen || []).some((c) => barcodeKey(c) === want)) return null;
  const id = (cur.pointOf || {})[want] || NO_POINT;
  return { id, name: (cur.pointNames || {})[id] || '' };
}

/* Takes the given seals off a card -- never one already on a DO, which is
   a real collection whatever else happens -- and works out again every
   figure that hangs off the count, so a card reset below its quantity
   is no longer "complete" and sounds again when it is. */
export function dropSeals(cur, shouldDrop, qty) {
  const base = dedupeProgress(cur || defaultProgress());
  const onDO = new Set(sealsAlreadyOnDO(base).map(barcodeKey));
  const gone = new Set();
  for (const raw of base.seen || []) {
    const code = barcodeKey(raw);
    if (code && !onDO.has(code) && shouldDrop(code)) gone.add(code);
  }
  if (!gone.size) return { progress: base, dropped: [] };
  const seen = (base.seen || []).filter((c) => !gone.has(barcodeKey(c)));
  const pointOf = { ...(base.pointOf || {}) };
  gone.forEach((c) => { delete pointOf[c]; });
  const unique = seen.length;
  const q = Number(qty) || 0;
  const reached = q > 0 && unique >= q;
  return {
    progress: {
      ...base,
      seen,
      scans: (base.scans || []).filter((s) => !gone.has(barcodeKey(s && s.code))),
      unique,
      pointOf,
      over: Math.max(0, unique - q),
      overFired: unique > q ? !!base.overFired : false,
      completedFired: reached ? !!base.completedFired : false,
      completedAt: reached ? base.completedAt || null : null,
    },
    dropped: [...gone],
  };
}

/** The seals a reset clears: exactly the ones handed back from the outbox
    (`codes`) -- what this phone had not synced. A seal on a DO never goes
    (dropSeals). */
export function resetPoint(cur, codes, qty) {
  const gone = new Set((codes || []).map(barcodeKey));
  return dropSeals(cur, (code) => gone.has(code), qty);
}

/* THE TABLE IS THE ANSWER FOR EVERYTHING THIS PHONE HAS SYNCED.
   A scan stays on the phone until Sync (see saveScanRecord), so a seal the
   phone holds is in one of two states: still waiting in the outbox, or sent.
   One that is NOT waiting and the table has NOT got was refused by the
   server, or reset at another place, or deleted in Supabase -- in every case
   the phone should stop counting it, whichever point it names, this one
   included. (The office deleted three rows in Supabase and the order went
   on reading 3/9.)

   `waiting` is the Set of codes still in the outbox for this order, read
   BEFORE the table was: a seal sent between the two reads is then either
   still listed as waiting or already in the rows. `waiting` null is an
   outbox that could not be read, and then only ANOTHER named point's seals
   are judged -- never this phone's, never an unassigned one, because a
   queued seal must never be dropped. A seal on a DO is never dropped
   (dropSeals). */
export function reconcileWithServer(cur, rows, myId, qty, waiting) {
  const onServer = new Set((rows || []).map((r) => barcodeKey(r && r.barcode)));
  const pointOf = (cur && cur.pointOf) || {};
  return dropSeals(cur, (code) => {
    if (onServer.has(code)) return false;
    if (waiting) return !waiting.has(code);
    const id = pointOf[code] || NO_POINT;
    return id !== NO_POINT && id !== myId;
  }, qty);
}

/* WHAT THIS PHONE ISSUES ON ITS DO: the seals it scanned itself that are not
   on a DO yet -- never another named point's. A seal that names no point was
   scanned before points existed (or by a phone on an older build); it is
   nobody's, so whichever phone issues next takes it, which is what every DO
   did before. Without that it could never go out on any DO at all. */
export function sealsMineForDO(p, myId) {
  const pointOf = (p && p.pointOf) || {};
  return sealsForNextDO(p).filter((c) => {
    const id = pointOf[barcodeKey(c)] || NO_POINT;
    return id === NO_POINT || id === myId;
  });
}

/* HOW MANY MORE SEALS THE ORDER TAKES, counted over EVERY scan point: the
   order quantity, less what has gone out on a DO, less every seal waiting
   for one wherever it was scanned. Nought means the order is full, and a
   scan here is refused even though this phone has scanned none of it. */
export function orderRoomLeft(p, qty, issued) {
  const pending = sealsForNextDO(p).length;
  return Math.max(0, (Number(qty) || 0) - (Number(issued) || 0) - pending);
}

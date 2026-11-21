import { supabase } from '../../lib/supabase.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { PERMANENT, SKIP, flushOutbox, looksOffline, queueJob, listJobs, removeJob, patchJob } from '../../lib/outbox.js';
import { sealNo, rangeHolding } from '../../lib/sealRanges.js';

// The scan list is now driven by SIGNED CONSENTS from the mobile web
// (mobile_consent_records). When a consent is signed there, it appears here for
// the FC to scan seals against its quantity. Scanning progress (which barcodes
// were counted) is kept locally, keyed by the consent record id, so it survives
// reloads and works offline.

const CONSENTS_CACHE = 'scan_consents';
export const PROGRESS_KEY = 'mjm.scan.progress.v1';

export function defaultProgress() {
  return { seen: [], scans: [], rejected: {}, unique: 0, over: 0, completedFired: false, overFired: false, completedAt: null, doIssued: false, doSeals: [] };
}

/* ── A SEAL IS COUNTED ONCE ───────────────────────────────────────────
   The barcode on a seal is the thing being counted, so the count is a
   SET of barcodes and not a tally kept beside one. That distinction is
   the whole of this section, and it is the difference between a count
   that can drift and one that cannot.

   The scanner itself has always refused a seal it has already taken --
   it beeps, it buzzes, it says so. What got past that guard came in by
   the OTHER door. A card can be a merged consent group, several rows for
   one trip, and the scan table is unique on (consent_id, barcode): the
   SAME seal filed against two member rows is two perfectly legal rows,
   and the merge read them both in. Nothing in the list filtered the
   incoming barcodes against EACH OTHER -- only against what was already
   held -- so the seal landed twice, `unique` went up by two, and the log
   carried two lines reading the same number.

   A tally that is wrong stays wrong for ever, because nothing afterwards
   recomputes it. So:

   - **One door in.** `addBarcodes` is the only way a barcode joins a
     card, and it filters against what is held AND against the rest of
     its own batch.
   - **`unique` is derived**, never incremented. It is the size of the
     set, so a count cannot disagree with the seals it is made of.
   - **It heals on load.** A phone already carrying a doubled count has
     nothing to recompute it -- so `loadProgress` does, every time, and
     an over-quota card that was never over goes back to what was
     actually scanned. */
export const barcodeKey = (c) => String(c == null ? '' : c).trim();

/* The log is stored newest-first. Walk it from the OLDEST so the FIRST
   sighting of a seal is the one kept -- that is the entry with the real
   time on it, where a copy arriving later off the server merge carries
   no time at all. */
export function dedupeScans(scans) {
  const seen = new Set();
  const out = [];
  for (let i = (scans || []).length - 1; i >= 0; i--) {
    const s = scans[i];
    const code = barcodeKey(s && s.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(s);
  }
  out.reverse();
  return out;
}

/* Returns the SAME object when there was nothing to clean, so this can
   run on every load and in every updater without churning React. */
export function dedupeProgress(p) {
  if (!p) return p;
  const seen = [];
  const held = new Set();
  for (const raw of p.seen || []) {
    const code = barcodeKey(raw);
    if (!code || held.has(code)) continue;
    held.add(code);
    seen.push(code);
  }
  const scans = dedupeScans(p.scans);
  const clean = seen.length === (p.seen || []).length
    && scans.length === (p.scans || []).length
    && p.unique === seen.length;
  return clean ? p : { ...p, seen, scans, unique: seen.length };
}

export function dedupeProgressMap(map) {
  let moved = false;
  const out = {};
  for (const id of Object.keys(map || {})) {
    const fixed = dedupeProgress(map[id]);
    if (fixed !== map[id]) moved = true;
    out[id] = fixed;
  }
  return moved ? out : map;
}

/* The one door in. `entryOf(code, uniqueAfter)` builds the log line, so
   the caller decides what the time says and whether the seal was over
   quota -- off the count it will ACTUALLY be, not off a running one. */
export function addBarcodes(cur, codes, entryOf) {
  const base = dedupeProgress(cur);
  const held = new Set((base.seen || []).map(barcodeKey));
  const fresh = [];
  const entries = [];
  for (const raw of codes || []) {
    const code = barcodeKey(raw);
    if (!code || held.has(code)) continue;
    held.add(code);
    fresh.push(code);
    entries.push(entryOf(code, held.size));
  }
  if (!fresh.length) return base;
  return {
    ...base,
    seen: [...(base.seen || []), ...fresh],
    /* Newest first, so a batch goes on in reverse. */
    scans: [...entries.reverse(), ...(base.scans || [])],
    unique: held.size,
  };
}

/* ── AND IT IS COUNTED ON ONE ORDER ───────────────────────────────────
   A seal carries ONE lot of seedlings, so once it has been counted onto
   a customer's lorry it is spoken for. Scanning it again under the next
   customer is not a second seal, it is the same one being counted twice
   -- and the second order is then short by that much with nothing on
   either screen to say where it went.

   There are two ways to know, and the phone asks the quick one first:

   - **What this phone already holds.** Every card's seen list is in
     localStorage, so a seal taken on an earlier order is found with no
     network at all, instantly, and it is the ordinary case: one
     conductor, one phone, one order after another.
   - **What the server knows**, for a seal another device took. That is a
     round trip, so it stays in the background the way it always has --
     the scan counts optimistically and is TAKEN BACK when the answer
     comes. Fail open: no line, no answer, nothing removed.

   A refusal is remembered on the card (`rejected`), so the seal is turned
   away instantly the next time it is waved -- including after a take-back,
   where the order that really owns it may not be on this phone at all. */
export function findBarcodeLocally(progress, code, excludeIds) {
  const want = barcodeKey(code);
  if (!want) return null;
  const skip = new Set((excludeIds || []).map(String));
  for (const id of Object.keys(progress || {})) {
    if (skip.has(String(id))) continue;
    const p = progress[id] || {};
    if ((p.seen || []).some((c) => barcodeKey(c) === want)) return id;
  }
  return null;
}

/* Takes a seal back off a card: out of the set, out of the log, and the
   count derived again from what is left. The SAME object back when the
   card never had it. */
export function removeBarcode(cur, code) {
  const want = barcodeKey(code);
  const base = dedupeProgress(cur || defaultProgress());
  if (!want || !(base.seen || []).some((c) => barcodeKey(c) === want)) return base;
  const seen = (base.seen || []).filter((c) => barcodeKey(c) !== want);
  return {
    ...base,
    seen,
    scans: (base.scans || []).filter((s) => barcodeKey(s && s.code) !== want),
    unique: seen.length,
  };
}

/* Why it was turned away, kept so the next wave of the same seal is
   refused at once instead of being counted and taken back again. */
export function rememberElsewhere(cur, code, label) {
  const want = barcodeKey(code);
  if (!want) return cur;
  return { ...cur, rejected: { ...(cur.rejected || {}), [want]: label || '' } };
}

export function rejectedLabel(cur, code) {
  const want = barcodeKey(code);
  const r = (cur || {}).rejected || {};
  return Object.prototype.hasOwnProperty.call(r, want) ? (r[want] || '') : null;
}

export function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {};
    const fixed = dedupeProgressMap(raw);
    /* Written back, so a card repaired on this load stays repaired even
       if nothing is ever scanned against it again. */
    if (fixed !== raw) saveProgress(fixed);
    return fixed;
  } catch (e) {
    return {};
  }
}

export function saveProgress(map) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch (e) {
    /* ignore */
  }
}

// Last-synced consent list (for instant load + offline).
export function cachedConsents() {
  return cacheGet(CONSENTS_CACHE)?.value || null;
}

// Pull signed consents from Supabase (newest first) and cache them.
export async function fetchConsents() {
  const { data, error } = await supabase
    .from('mobile_consent_records')
    .select('id, al_number, order_number, customer_name, consent_qty, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  cacheSet(CONSENTS_CACHE, data || []);
  return data || [];
}

// AL numbers that have a collection booking for TODAY → { al_number: 'HH:MM' }
// (earliest slot). Used to push today's collections to the top of the list.
const TODAY_AL_CACHE = 'scan_today_als';

export function cachedTodayALs() {
  return cacheGet(TODAY_AL_CACHE)?.value || {};
}

export async function fetchTodayBookingALs() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('shared_collection_bookings')
    .select('al_number, start_time')
    .eq('booking_date', today)
    .neq('status', 'cancelled');
  if (error) throw error;
  const map = {};
  (data || []).forEach((b) => {
    if (!b.al_number) return;
    const t = (b.start_time || '99:99').slice(0, 5);
    if (!(b.al_number in map) || t < map[b.al_number]) map[b.al_number] = t;
  });
  cacheSet(TODAY_AL_CACHE, map);
  return map;
}

/* ── WHAT HAS BEEN COLLECTED ON EACH CARD ─────────────────────────────
   A DO names its AL and not the consent it was collected against, so the
   server can only say how much has gone out on the WHOLE order. That
   figure used to be written onto EVERY card of the AL. Order 0HVUL3 is
   what that looks like: 1,000 ordered, a consent of 700 collected in
   full, and then a consent for the other 300 -- which arrived already
   reading 700 collected against a quantity of 300, so it was finished
   before anybody scanned a seal, and never shown.

   So the AL total is SHARED OUT, oldest card first, each taking no more
   than its own quantity. Collection runs in the order the consents were
   signed, so that is the honest reading of a figure that names no card.
   Anything left over (a DO bigger than every consent on the AL) lands on
   the newest card, so the total is never lost. */
export function issuedShares(cards, issuedByAL) {
  const byAL = new Map();
  (cards || []).forEach((c) => {
    if (!c.al_number || /^MANUAL-/i.test(c.al_number)) return;
    if (!byAL.has(c.al_number)) byAL.set(c.al_number, []);
    byAL.get(c.al_number).push(c);
  });
  const out = {};
  byAL.forEach((list, al) => {
    if (!(al in (issuedByAL || {}))) return;
    let left = Number(issuedByAL[al]) || 0;
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    list.forEach((c, i) => {
      const last = i === list.length - 1;
      const share = last ? left : Math.min(c.qty || 0, left);
      out[c.id] = share;
      left -= share;
    });
  });
  return out;
}

/* Write the shares onto the progress map. The server is the answer, in
   BOTH directions -- a card the old rule had marked collected is put back
   -- except while a DO for that AL is still waiting on this phone to be
   sent: the server has not heard of it yet, so a lower server figure is
   not news. Returns prev itself when nothing moved. */
export function applyIssuedShares(prev, cards, shares, queuedALs) {
  let changed = false;
  const map = { ...prev };
  (cards || []).forEach((c) => {
    if (!(c.id in shares)) return;
    const share = shares[c.id];
    const cur = map[c.id] || defaultProgress();
    const local = cur.issuedQty || 0;
    if (local === share) return;
    if (local > share && queuedALs && queuedALs.has(c.al_number)) return;
    /* doIssued means this card's own qty is FULLY out, not merely that
       something is — see the long comment on mergeConsents' own read of
       it. A share smaller than the card's qty (the AL's total DO-issued
       split oldest-first, same as everywhere else here) still leaves a
       balance on it. */
    const fullyIssued = share > 0 && share >= (c.qty || 0);
    map[c.id] = { ...cur, issuedQty: share, doIssued: fullyIssued };
    if (fullyIssued) {
      /* A merged card's other members never get their own issuedQty —
         everything is tracked under the anchor's id above. Stamping the
         GROUP's full qty onto them here (never their own smaller share of
         it, which this function has no way to know) is what lets
         mergeConsents' self-heal trust a member's doIssued on its own,
         without re-deriving the whole group's history to check it. */
      (c.memberIds || [c.id]).forEach((id) => {
        if (id === c.id) return;
        map[id] = { ...(map[id] || defaultProgress()), doIssued: true, issuedQty: c.qty || 0 };
      });
    }
    changed = true;
  });
  return changed ? map : prev;
}

export function statusOf(c) {
  if (c.unique > c.qty) return 'over';
  if (c.unique >= c.qty && c.qty > 0) return 'done';
  if (c.unique > 0) return 'progress';
  return 'pending';
}

// Combine the synced consent records with local scan progress into the view
// models the UI renders (same shape the scanner expects). All consents with a
// customer name are shown — including walk-in (MANUAL-*) consents that have no
// linked AL order.
//
// Signing happens on the Customer Consent screen, which lets a trip be
// consented in more than one pass — the customer signs for part of the
// order now and the rest later, or the office resends a corrected one. Each
// pass writes its own mobile_consent_records row, so the same still-open
// order used to show as that many separate cards here, each "Pending to
// Scan" for its own slice of the quantity — confusing to scan against and
// no sign any of them were the same trip. Rows sharing an al_number that
// are NOT yet DO-issued are grouped into ONE card with their quantities
// summed; a card already issued (doIssued) is left out of the group, same
// as a genuinely separate, finished collection would be.
//
// The group's own id — the one new scans and the DO are recorded against —
// is its OLDEST member's. That stays the same id every time this re-runs
// (a later consent for the same AL only ever joins an existing group, never
// becomes its anchor), so progress keyed by it in localStorage survives a
// resync. memberIds carries every row in the group, for fetchScanRecords /
// subscribeScanRecords to read scans already filed against any of them —
// a scan does not go looking for a NEW row somebody just signed.
/* Live, not the stored doIssued flag alone: a row — or, read as a card's
   own qty, a merged group — counts as fully out only once what was
   actually issued REACHES what it was for, checked fresh every time
   rather than trusted from a flag that can be stale. Both writers
   (onDoSaved, applyIssuedShares) only ever set doIssued once this is
   already true, but a phone can still be holding an older saved copy of
   a row marked true on less than that, from before that was fixed — this
   is what lets it read correctly again without a round trip through a
   correct writer first. */
function fullyOut(qty, p) {
  const out = (p && p.issuedQty) || 0;
  return out > 0 && out >= (qty || 0);
}

export function mergeConsents(serverList, progress) {
  const rows = (serverList || []).filter((s) => s.customer_name);

  const groups = new Map(); // al_number -> rows[], only not-yet-issued ones
  const singles = [];
  rows.forEach((s) => {
    /* A row can carry doIssued:true from a PARTIAL issue — a DO for less
       than its own consent_qty, or an AL-wide DO total split across cards
       (issuedShares) that did not reach this one's own qty. Trusting the
       flag alone split a merged group apart the moment ANY amount went
       out on one member, so a second consent for the rest of the order
       could never rejoin it — N2T596 read Qty 600 forever on a 1,200
       order with 750 still on the ground, because its first 600 consent
       had 450 go out against it and was never seen whole again. */
    const p = progress[s.id] || {};
    const issued = !!p.doIssued && fullyOut(s.consent_qty, p);
    if (s.al_number && !issued) {
      if (!groups.has(s.al_number)) groups.set(s.al_number, []);
      groups.get(s.al_number).push(s);
    } else {
      singles.push(s);
    }
  });

  const cards = [];
  groups.forEach((members) => {
    members.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const anchor = members[0];
    const p = progress[anchor.id] || defaultProgress();
    const qty = members.reduce((sum, m) => sum + (m.consent_qty || 0), 0);
    cards.push({
      id: anchor.id,
      memberIds: members.map((m) => m.id),
      al_number: anchor.al_number || '',
      order_number: anchor.order_number || '',
      customer: anchor.customer_name || anchor.al_number || '—',
      qty,
      ref: anchor.al_number || '',
      createdAt: anchor.created_at ? new Date(anchor.created_at).getTime() : 0,
      seen: p.seen || [],
      scans: p.scans || [],
      unique: p.unique || 0,
      over: p.over || 0,
      completedFired: !!p.completedFired,
      overFired: !!p.overFired,
      // Live, same as the grouping test above — not the raw flag, which
      // applyIssuedShares can leave stale when a recomputed share happens
      // to numerically match what was already stored (see its own "local
      // === share" short-circuit). onList's filter is already safe either
      // way (it ORs this with issuedQty < qty), but a card should not say
      // something its own numbers do not.
      doIssued: fullyOut(qty, p),
      issuedQty: p.issuedQty || 0,
      doSeals: Array.isArray(p.doSeals) ? p.doSeals : null,
    });
  });

  singles.forEach((s) => {
    const p = progress[s.id] || defaultProgress();
    cards.push({
      id: s.id,
      memberIds: [s.id],
      al_number: s.al_number || '',
      order_number: s.order_number || '',
      customer: s.customer_name || s.al_number || '—',
      qty: s.consent_qty || 0,
      ref: s.al_number || '',
      createdAt: s.created_at ? new Date(s.created_at).getTime() : 0,
      seen: p.seen || [],
      scans: p.scans || [],
      unique: p.unique || 0,
      over: p.over || 0,
      completedFired: !!p.completedFired,
      overFired: !!p.overFired,
      doIssued: fullyOut(s.consent_qty, p),
      issuedQty: p.issuedQty || 0,
      doSeals: Array.isArray(p.doSeals) ? p.doSeals : null,
    });
  });

  return cards;
}

/* ── WHICH SEALS A CUSTOMER WAS GIVEN ─────────────────────────────────
   A consent signed on Mobile Consent now names the seal ranges handed to
   the customer, and a database trigger turns those into rows of
   seal_allocations. The scanner reads them so a seal that is not this
   customer's is turned away at the lorry, with no line, the same instant
   a duplicate is.

   Two reads, merged: the allocations of every AL on the list (what this
   phone is about to scan against), and every allocation made in the last
   120 days whatever its AL (so "this seal belongs to ANOTHER customer"
   can be said offline for an order this phone has never opened).

   FAIL OPEN, twice over. A read that fails -- no line, or the table not
   there because the SQL has not been run -- leaves whatever was cached
   last, and a phone that has never read the table successfully has NO
   cache at all, which every caller takes as "no seal feature". That
   absence is load-bearing: `sealFeatureLive()` is what decides whether a
   DO may carry seal_ranges, and a DO inserting a column the database does
   not have yet would be refused -- and then retried from the offline queue
   for ever. */
const SEAL_ALLOC_CACHE = 'seal_allocations';
const SEAL_ALLOC_DAYS = 120;
const SEAL_ALLOC_COLS = 'id, consent_id, al_number, customer_name, start_code, end_code, start_no, end_no';

/** The cached allocation rows, or null when this phone has never managed
    to read the table (no SQL yet, or never online since). */
export function cachedSealAllocations() {
  const hit = cacheGet(SEAL_ALLOC_CACHE);
  return hit && Array.isArray(hit.value) ? hit.value : null;
}

export function sealFeatureLive() {
  return cachedSealAllocations() !== null;
}

export async function fetchSealAllocations(alNumbers) {
  const als = [...new Set((alNumbers || []).filter(Boolean))];
  const since = new Date(Date.now() - SEAL_ALLOC_DAYS * 86400000).toISOString();
  const recent = await supabase
    .from('seal_allocations')
    .select(SEAL_ALLOC_COLS)
    .gte('created_at', since)
    .limit(5000);
  if (recent.error) throw recent.error;
  const byId = new Map();
  (recent.data || []).forEach((r) => byId.set(String(r.id), r));
  /* In slices, so three hundred AL numbers do not make one address too
     long for a proxy to carry. */
  for (let i = 0; i < als.length; i += 100) {
    const { data, error } = await supabase
      .from('seal_allocations')
      .select(SEAL_ALLOC_COLS)
      .in('al_number', als.slice(i, i + 100));
    if (error) throw error;
    (data || []).forEach((r) => byId.set(String(r.id), r));
  }
  const rows = [...byId.values()];
  cacheSet(SEAL_ALLOC_CACHE, rows);
  return rows;
}

/** A card's own allocations: filed under its AL, or against one of its
    member consent rows (a walk-in consent may carry no real AL). */
export function allocationsOf(card, allocs) {
  if (!card) return [];
  const al = String(card.al_number || '').trim();
  const ids = new Set((card.memberIds || [card.id]).map(String));
  return (allocs || []).filter((r) =>
    (al && String(r.al_number || '').trim() === al) || ids.has(String(r.consent_id))
  );
}

/** Is this seal the card's to take?
     null                      -- the card has no allocations (an order
                                  signed before seal ranges existed): no
                                  opinion, scan as it always has
     { ok: true, range }       -- inside one of the card's own ranges
     { ok: false, kind: 'other', other }  -- inside somebody else's
     { ok: false, kind: 'outside' }       -- inside nobody's */
export function sealVerdict(code, card, allocs) {
  const own = allocationsOf(card, allocs);
  if (!own.length) return null;
  if (sealNo(code) == null) return null;   // not a seal number at all: no opinion
  const range = rangeHolding(code, own);
  if (range) return { ok: true, range };
  const ownIds = new Set(own.map((r) => String(r.id)));
  const other = rangeHolding(code, (allocs || []).filter((r) => !ownIds.has(String(r.id))));
  return other ? { ok: false, kind: 'other', other } : { ok: false, kind: 'outside' };
}

/* ── WHICH SEALS GO ON THE NEXT DO ────────────────────────────────────
   A DO names the seals that went out on it: the ones scanned on the card
   since the last DO. `doSeals` is the list already put on one, kept in
   the card's progress beside `seen`, so a second DO for a part-collected
   order carries only its own.

   A card whose progress predates this list (no `doSeals` at all) may
   already have had DOs issued for what it scanned. Those took the seals
   in the order they were scanned, so the oldest `issuedQty` of `seen`
   are counted as gone -- the alternative, naming every seal again on the
   next DO, would mark seals collected twice. */
const sealKey = (c) => {
  const n = sealNo(c);
  return n == null ? barcodeKey(c) : 'n' + n;
};

export function sealsAlreadyOnDO(p) {
  const cur = p || {};
  if (Array.isArray(cur.doSeals)) return cur.doSeals;
  return (cur.seen || []).slice(0, Math.max(0, cur.issuedQty || 0));
}

export function sealsForNextDO(p) {
  const gone = new Set(sealsAlreadyOnDO(p).map(sealKey));
  const out = [];
  const taken = new Set();
  for (const c of (p || {}).seen || []) {
    const k = sealKey(c);
    if (!barcodeKey(c) || gone.has(k) || taken.has(k)) continue;
    taken.add(k);
    out.push(barcodeKey(c));
  }
  return out;
}

/** The progress with `codes` added to the list already on a DO. */
export function markSealsOnDO(p, codes) {
  const base = p || defaultProgress();
  const list = [...sealsAlreadyOnDO(base)];
  const have = new Set(list.map(sealKey));
  for (const c of codes || []) {
    const k = sealKey(c);
    if (!barcodeKey(c) || have.has(k)) continue;
    have.add(k);
    list.push(barcodeKey(c));
  }
  return { ...base, doSeals: list };
}

// ── Multi-device sync via Supabase (fcportal_scan_records table) ──────────────

// Persist a single scan event. ON CONFLICT DO NOTHING → unique(consent_id, barcode)
// prevents double-counting when two devices scan the same seal.
/* KEYED BY HAND rides on the row, so Seal Manage can show a seal typed on
   the Add dialog in red beside the ones the camera read. Sent ONLY for a typed
   seal: a scanned one writes exactly the row it always wrote. A database that
   has not had shared/RUN_ME_scan_keyed_by_hand.sql run refuses the WHOLE row
   over a column it has not got, so a refusal that NAMES the column drops it,
   is remembered for the session, and the same row goes again at once -- the
   seal is never lost over the mark. Any other refusal is not that answer. */
/* Optional columns: keyed_by_hand, and the SCAN POINT pair (scan_point,
   scan_point_name) that says which phone took the seal -- see scanPoints.js.
   A database that has not had the SQL run refuses the WHOLE row over a
   column it has not got, so a refusal that NAMES one of them drops that
   column, is remembered for the session, and the same row goes again at
   once. The seal is never lost over a label. Any other refusal is not that
   answer and disables nothing. */
const _noCol = new Set();
const OPTIONAL_COLS = ['keyed_by_hand', 'scan_point', 'scan_point_name'];
function _namedOptional(e) {
  if (!e) return null;
  const text = String(e.message || '') + ' ' + String(e.details || '') + ' ' + String(e.hint || '');
  if (!(e.code === '42703' || e.code === 'PGRST204' || /column/i.test(text))) return null;
  return OPTIONAL_COLS.find((c) => text.indexOf(c) >= 0) || null;
}
export function scanPointColumnLive() { return !_noCol.has('scan_point'); }

export async function insertScanRecord(consentId, alNumber, barcode, typed, point) {
  const row = { consent_id: consentId, al_number: alNumber, barcode };
  if (typed) row.keyed_by_hand = true;
  if (point && point.id) { row.scan_point = point.id; row.scan_point_name = point.name || null; }
  _noCol.forEach((c) => { delete row[c]; });
  let { error } = await supabase.from('fcportal_scan_records').insert(row);
  for (let i = 0; error && i < OPTIONAL_COLS.length; i++) {
    const col = _namedOptional(error);
    if (!col || !(col in row)) break;
    _noCol.add(col);
    if (col === 'scan_point' || col === 'scan_point_name') { delete row.scan_point; delete row.scan_point_name; _noCol.add('scan_point'); _noCol.add('scan_point_name'); }
    delete row[col];
    ({ error } = await supabase.from('fcportal_scan_records').insert(row));
  }
  if (error && error.code !== '23505') throw error; // 23505 = unique_violation (safe to ignore)
}

/* A SCAN STAYS ON THE PHONE UNTIL ITS DO IS ISSUED.

   The office: a scan is kept on the phone, and pressing Issue DO is the
   sync -- it sends that DO's seals up, and from then on they cannot be
   reset. With no line they stay on the phone, still unresettable, and go up
   by themselves the moment there is a line. A record leaves the phone only
   once the server has taken it.

   So every scan goes into the outbox marked `committed: false`, and the
   outbox never sends one in that state (flushScanRecords answers SKIP).
   Issue DO marks the DO's seals committed (`commitScans`) and flushes; the
   app-wide tick and the line returning flush them too. Reset may clear only
   what is NOT committed (`resetUnsynced`). A job with no `committed` field
   was queued by an older build, which meant to send it, so it is sent.

   `_queuing` covers the moment between the scan and the outbox write, so a
   read of the order in that gap cannot take the seal for one the server
   refused (see waitingScanCodes). */
export const SCAN_JOB = 'scan_record';
const _queuing = new Set();

export async function saveScanRecord(consentId, alNumber, barcode, typed, point) {
  const key = String(consentId) + '|' + barcodeKey(barcode);
  _queuing.add(key);
  try {
    await queueJob(SCAN_JOB, { consentId, alNumber, barcode, typed: !!typed, point: point || null, committed: false });
  } finally {
    _queuing.delete(key);
  }
}


/* SENDS THE COMMITTED SCANS -- the ones a DO has been issued for -- and
   leaves the rest queued. A seal the server refuses for good (the order
   already full across every scan point, a policy) leaves the queue, since
   keeping it would block everything behind it, and the next read of the
   order takes it off the phone. */
export function flushScanRecords() {
  return flushOutbox({
    [SCAN_JOB]: async (p) => {
      if (p && p.committed === false) return SKIP;   // its DO is not issued yet
      try {
        await insertScanRecord(p.consentId, p.alNumber, p.barcode, p.typed, p.point);
      } catch (e) {
        if (looksOffline(e)) throw e;      // try again when there is a line
        throw new Error(PERMANENT);        // the server refused the row itself
      }
    },
  });
}

// Pull all barcodes already stored for a consent (from any device). Takes
// either one consent id or an array — a merged card's scans can be filed
// against any of its member rows, not only the group's anchor.
export async function fetchScanRecords(consentIds) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  /* Paged: an order of 1,200 seals is past the 1,000 rows PostgREST hands
     back in one answer, and a short read here reads as seals another phone
     reset -- see reconcileWithServer. Ordered on the unique (consent_id, barcode) as well, so
     a page boundary cannot fall inside a run of rows sharing one timestamp. */
  const cols = scanPointColumnLive() ? 'barcode, scanned_at, scan_point, scan_point_name' : 'barcode, scanned_at';
  const all = [];
  for (let from = 0; from < 50000; from += 1000) {
    let { data, error } = await supabase
      .from('fcportal_scan_records')
      .select(cols)
      .in('consent_id', ids)
      .order('scanned_at', { ascending: true })
      .order('consent_id', { ascending: true })
      .order('barcode', { ascending: true })
      .range(from, from + 999);
    if (error && cols !== 'barcode, scanned_at' && _namedOptional(error)) {
      _noCol.add('scan_point'); _noCol.add('scan_point_name');
      return fetchScanRecords(consentIds);
    }
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

/* THE SEALS OF THESE CONSENTS STILL WAITING IN THE OUTBOX, as a Set of
   barcodes -- or null when the outbox could not be read, which the caller
   must treat as "anything might be waiting" (see reconcileWithServer). */
export async function waitingScanCodes(consentIds) {
  const ids = (Array.isArray(consentIds) ? consentIds : [consentIds]).map(String);
  try {
    const jobs = await listJobs();
    const out = new Set();
    for (const j of jobs) {
      if (j.kind !== SCAN_JOB || !j.payload) continue;
      if (!ids.includes(String(j.payload.consentId))) continue;
      out.add(barcodeKey(j.payload.barcode));
    }
    _queuing.forEach((k) => {
      const at = k.indexOf('|');
      if (ids.includes(k.slice(0, at))) out.add(k.slice(at + 1));
    });
    return out;
  } catch (_) { return null; }
}

/* ISSUE DO IS THE SYNC: these seals of these consents are committed --
   they go up with the next flush and can no longer be reset. */
export async function commitScans(consentIds, codes) {
  const ids = (Array.isArray(consentIds) ? consentIds : [consentIds]).map(String);
  const want = new Set((codes || []).map(barcodeKey));
  const jobs = await listJobs();
  for (const j of jobs) {
    if (j.kind !== SCAN_JOB || !j.payload || j.payload.committed !== false) continue;
    if (!ids.includes(String(j.payload.consentId))) continue;
    if (want.has(barcodeKey(j.payload.barcode))) await patchJob(j.uid, { committed: true });
  }
}

/* What this order still has on the phone: `open` can still be reset (no DO
   issued), `sending` is committed and waiting for a line. null when the
   outbox could not be read. */
export async function scanQueueCounts(consentIds) {
  const ids = (Array.isArray(consentIds) ? consentIds : [consentIds]).map(String);
  try {
    const jobs = await listJobs();
    let open = 0, sending = 0;
    for (const j of jobs) {
      if (j.kind !== SCAN_JOB || !j.payload) continue;
      if (!ids.includes(String(j.payload.consentId))) continue;
      if (j.payload.committed === false) open++; else sending++;
    }
    return { open, sending };
  } catch (_) { return null; }
}

/* RESET: TAKE BACK WHAT HAS NO DO YET, and nothing else. Every scan of
   these consents still queued and not committed leaves the outbox, and the
   caller drops the same seals off the phone. A committed scan (its DO is
   issued) stays queued until it is sent, and a seal already on a DO
   (`keep`) is a real collection. Needs no line -- nothing on the server
   changes. Answers the barcodes it took out of the queue. */
export async function resetUnsynced(consentIds, keep) {
  const ids = (Array.isArray(consentIds) ? consentIds : [consentIds]).map(String);
  const hold = keep || new Set();
  const out = [];
  const jobs = await listJobs();
  for (const j of jobs) {
    if (j.kind !== SCAN_JOB || !j.payload) continue;
    if (!ids.includes(String(j.payload.consentId))) continue;
    if (j.payload.committed !== false) continue;   // its DO is issued: not the phone's to take back
    const code = barcodeKey(j.payload.barcode);
    if (hold.has(code)) continue;
    await removeJob(j.uid);
    out.push(code);
  }
  return out;
}

// Barcodes on these consents that a DO has already carried, on any device
// -- the database fills fcportal_scan_records.do_number from each DO's
// seal_ranges. Asked only once the seal SQL is known to be in, since the
// column does not exist before it; and best effort, like every read here.
/* PAGED, like fetchScanRecords: PostgREST hands back at most 1,000 rows,
   and a short answer here reads as seals still waiting for a DO. BB0RS8
   had 1,470 on its DOs; the first 1,000 came back, the other 470 counted
   as pending, and the order read as full with 299 still to collect.
   Ordered on the unique (consent_id, barcode) so a page boundary is
   stable. */
export async function fetchSealsOnDO(consentIds) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  const all = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase
      .from('fcportal_scan_records')
      .select('barcode')
      .in('consent_id', ids)
      .not('do_number', 'is', null)
      .order('consent_id', { ascending: true })
      .order('barcode', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []).map((r) => r.barcode));
    if (!data || data.length < 1000) break;
  }
  return all;
}

// Has this barcode already been scanned under a DIFFERENT order? The
// table's own unique index is (consent_id, barcode) — it stops the SAME
// order's seal being double-counted, but nothing stops the same physical
// seal being filed a second time under a different consent_id entirely,
// which is exactly a seal reused on the wrong customer's order. This is the
// app-level check for that: excludeConsentIds is the scanning card's own
// member ids, so its own rows (and any sibling row from the same merged
// consent group) never flag themselves. Returns the first other row found
// (consent_id, al_number, scanned_at) or null.
export async function findBarcodeElsewhere(barcode, excludeConsentIds) {
  const { data, error } = await supabase
    .from('fcportal_scan_records')
    .select('consent_id, al_number, scanned_at')
    .eq('barcode', barcode)
    .order('scanned_at', { ascending: true })
    .limit(10);
  if (error) throw error;
  const exclude = new Set((excludeConsentIds || []).map(String));
  return (data || []).find((r) => !exclude.has(String(r.consent_id))) || null;
}

// Subscribe to live INSERTs across one or more consent ids. callback(barcode)
// fires when another device scans a new seal against any of them. Returns
// the channel — pass to unsubscribeScanRecords().
export function subscribeScanRecords(consentIds, callback, onReset) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  /* The channel is named after the card's ANCHOR only, so every phone on the
     same order joins the same channel whatever members its list happens to
     hold -- the reset broadcast has to reach all of them. */
  return supabase
    .channel('fcportal_scan:' + ids[0])
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'fcportal_scan_records',
      filter: `consent_id=in.(${ids.join(',')})`,
    }, (payload) => callback(payload.new.barcode, payload.new))
    .on('broadcast', { event: 'reset' }, (msg) => { if (onReset) onReset(msg && msg.payload); })
    .subscribe();
}

export function unsubscribeScanRecords(channel) {
  if (channel) supabase.removeChannel(channel);
}

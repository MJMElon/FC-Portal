import { supabase } from '../../lib/supabase.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { PERMANENT, flushOutbox, looksOffline, queueJob } from '../../lib/outbox.js';
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
export function mergeConsents(serverList, progress) {
  const rows = (serverList || []).filter((s) => s.customer_name);

  const groups = new Map(); // al_number -> rows[], only not-yet-issued ones
  const singles = [];
  rows.forEach((s) => {
    const issued = !!(progress[s.id] || {}).doIssued;
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
    cards.push({
      id: anchor.id,
      memberIds: members.map((m) => m.id),
      al_number: anchor.al_number || '',
      order_number: anchor.order_number || '',
      customer: anchor.customer_name || anchor.al_number || '—',
      qty: members.reduce((sum, m) => sum + (m.consent_qty || 0), 0),
      ref: anchor.al_number || '',
      createdAt: anchor.created_at ? new Date(anchor.created_at).getTime() : 0,
      seen: p.seen || [],
      scans: p.scans || [],
      unique: p.unique || 0,
      over: p.over || 0,
      completedFired: !!p.completedFired,
      overFired: !!p.overFired,
      doIssued: !!p.doIssued,
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
      doIssued: !!p.doIssued,
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
export async function insertScanRecord(consentId, alNumber, barcode) {
  const { error } = await supabase
    .from('fcportal_scan_records')
    .insert({ consent_id: consentId, al_number: alNumber, barcode });
  if (error && error.code !== '23505') throw error; // 23505 = unique_violation (safe to ignore)
}

/* A scan made with no line still reaches the server, later.
 *
 * The local progress is what THIS phone counts by, and it never needed the
 * network — but fcportal_scan_records is how OTHER devices hear a barcode
 * has been taken, and a scan made offline used to be skipped rather than
 * queued: the count survived on one phone while every other phone stayed
 * free to accept the same seedling again. Now it queues like everything
 * else in this repository and flushes on sync, on reconnect, and on the
 * 30-second tick. The unique index (23505 ignored above) makes a retry of
 * a row the server already took a no-op rather than a duplicate.
 */
export const SCAN_JOB = 'scan_record';

export async function saveScanRecord(consentId, alNumber, barcode) {
  try {
    await insertScanRecord(consentId, alNumber, barcode);
  } catch (e) {
    if (looksOffline(e)) {
      await queueJob(SCAN_JOB, { consentId, alNumber, barcode });
      return;
    }
    // The server refused it for a reason of its own; the local progress
    // still holds the scan, which is the behaviour this call always had.
  }
}

export function flushScanRecords() {
  return flushOutbox({
    [SCAN_JOB]: async (p) => {
      try {
        await insertScanRecord(p.consentId, p.alNumber, p.barcode);
      } catch (e) {
        if (looksOffline(e)) throw e;      // try again later
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
  const { data, error } = await supabase
    .from('fcportal_scan_records')
    .select('barcode, scanned_at')
    .in('consent_id', ids)
    .order('scanned_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Barcodes on these consents that a DO has already carried, on any device
// -- the database fills fcportal_scan_records.do_number from each DO's
// seal_ranges. Asked only once the seal SQL is known to be in, since the
// column does not exist before it; and best effort, like every read here.
export async function fetchSealsOnDO(consentIds) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  const { data, error } = await supabase
    .from('fcportal_scan_records')
    .select('barcode')
    .in('consent_id', ids)
    .not('do_number', 'is', null);
  if (error) throw error;
  return (data || []).map((r) => r.barcode);
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
export function subscribeScanRecords(consentIds, callback) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  return supabase
    .channel('fcportal_scan:' + ids.join(','))
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'fcportal_scan_records',
      filter: `consent_id=in.(${ids.join(',')})`,
    }, (payload) => callback(payload.new.barcode))
    .subscribe();
}

export function unsubscribeScanRecords(channel) {
  if (channel) supabase.removeChannel(channel);
}

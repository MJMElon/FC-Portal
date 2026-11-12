import { supabase } from '../../lib/supabase.js';
import { doPdfBlob } from '../../lib/pdf.js';
import { nurseryKey } from '../../lib/access.js';
import { loadPlotBatches } from '../maintenance/data.js';
import { batchKey, batchesIn, plotKey } from '../maintenance/plotBatches.js';

// ── Active Approval Letters (AL) ──────────────────────────────
// Closed is excluded the same way Cancelled is — the office decided this
// order's business is done, so no new DO should be issued against it. See
// Close AL in mjm-ai-system/operation/operation_booking.html.
export async function loadActiveALs() {
  const { data, error } = await supabase
    .from('shared_al_orders')
    .select('*')
    .not('status', 'in', '("Cancelled","Closed","Collected")')
    .gt('balance_quantity', 0)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// AL numbers that have at least one consent record.
export async function loadConsentALSet() {
  const { data } = await supabase.from('mobile_consent_records').select('al_number');
  const set = new Set();
  (data || []).forEach((c) => set.add(c.al_number));
  return set;
}

// Nursery / breed autocomplete data.
/**
 * The batches standing in each plot, for the DO form.
 *
 * THE SAME SOURCE THE REST OF THE SYSTEM USES. loadPlotBatches is the
 * maintenance module reader for shared_plot_batch_balance, which is the
 * Nursery Movement Report arithmetic in the database. Reusing that reader
 * rather than writing a second one is the point: two readers of the same
 * report drift, and the one that drifts is always the newer one nobody is
 * watching.
 */
export async function loadBatchData() {
  const map = await loadPlotBatches().catch((e) => {
    console.warn('[do] plot batches unavailable:', (e && e.message) || e);
    return new Map();
  });
  return { batchMap: map };
}

/* B01 and B1 are the same plot. plotKey keeps the padding, because
   elsewhere it has to; here the ledger and the balance view disagree about
   it, so the comparison drops leading zeros from the number and leaves
   anything else -- a -R suffix included -- alone. */
export function loosePlot(v) {
  return plotKey(v).replace(/^([A-Z]+)0*(\d+)/, '$1$2');
}

/**
 * The breed of each batch IN THIS PLOT, off the ledger.
 *
 * A breed belongs to the plot and batch together, not to the batch. One
 * batch can be transplanted into several plots, and it is the log that put
 * it into THIS plot that says what went in. A batch-wide lookup answers
 * the wrong question and is right often enough to be trusted.
 *
 * Asked per plot, when a plot is chosen, and filtered to the batches
 * already known to be standing there -- a handful of rows. The whole
 * ledger is tens of thousands and maintenance/data.js carries a hard-won
 * note about what paging it from every phone does to a database under
 * strain. This never does that.
 *
 * Planted and the three Transplanted types are the logs that put stock on
 * the ground, which is where a breed is recorded. Returns a Map keyed by
 * batchKey, empty on any failure -- not knowing a breed must not stop a
 * Field Conductor choosing a batch.
 */
export async function loadPlotBreeds(plot, batchNames) {
  const out = new Map();
  const want = loosePlot(plot);
  if (!want || !(batchNames || []).length) return out;
  const res = await supabase
    .from('shared_inventory_logs')
    .select('plot_name, batch_name, breed_name')
    .in('transaction_type', ['Planted', 'Transplanted',
      'Transplanted_Premium', 'Transplanted_DoubleTone'])
    .in('batch_name', batchNames)
    .then((r) => (r.error ? null : r.data || []), () => null);
  if (!res) {
    console.warn('[do] breeds for', plot, 'could not be read');
    return out;
  }
  for (const r of res) {
    if (loosePlot(r.plot_name) !== want) continue;   // a different plot of the same batch
    const bk = batchKey(r.batch_name);
    const breed = String(r.breed_name || '').trim();
    if (!bk || !breed || out.has(bk)) continue;
    out.set(bk, breed);
  }
  return out;
}

export async function loadDropdownData() {
  const [{ data: plots }, { data: breeds }] = await Promise.all([
    supabase.from('shared_plots').select('plot_name, nursery_name'),
    supabase.from('shared_breeds').select('name'),
  ]);
  return { plots: plots || [], breeds: breeds || [] };
}

export async function loadDOsForAL(alNumber) {
  const { data, error } = await supabase
    .from('shared_do_records')
    .select('*')
    .eq('al_number', alNumber)
    .order('delivery_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Same figure loadDOsForAL's caller derives (sum of total_qty) but for every
// AL in one request instead of one request per AL — the Signed Consents list
// needs this for every consent up front to know which are fully collected,
// not just the one consent someone has opened.
export async function loadIssuedQtyByALs(alNumbers) {
  if (!alNumbers || !alNumbers.length) return {};
  const { data, error } = await supabase
    .from('shared_do_records')
    .select('al_number, total_qty, status, remark')
    .in('al_number', alNumbers);
  if (error) throw error;
  return issuedQtyByAL(data);
}

/* A cancelled DO took nothing away. Same test as the office Delivery page
   (operation_delivery.html, its cumulMap), so the FC Portal and the AL
   list agree on what has been collected -- they did not, and a cancelled
   DO kept an order off the scan list while the office read a balance. */
export function isCancelledDO(d) {
  return !!d && (d.status === 'Cancelled' || String(d.remark || '').includes('[CANCELLED]'));
}

export function issuedQtyByAL(dos) {
  const map = {};
  (dos || []).forEach((d) => {
    if (!d || !d.al_number || isCancelledDO(d)) return;
    map[d.al_number] = (map[d.al_number] || 0) + (Number(d.total_qty) || 0);
  });
  return map;
}

export async function loadConsentsForAL(alNumber) {
  const { data, error } = await supabase
    .from('mobile_consent_records')
    .select('*')
    .eq('al_number', alNumber)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Per-order running DO number: DO-<orderNo>01, DO-<orderNo>02, … The order
// number is the AL number for Sales Web orders, so the DO number itself
// identifies the customer order and the PDF no longer needs a separate
// Order No. field.
export async function generateDONumber(al) {
  const orderNo = String(al?.order_number || al?.al_number || '').trim();
  if (!orderNo) return `DO-${Date.now().toString(36).toUpperCase()}`;
  const prefix = `DO-${orderNo}`;
  const { data } = await supabase
    .from('shared_do_records')
    .select('do_number')
    .ilike('do_number', `${prefix}%`);
  let max = 0;
  (data || []).forEach((r) => {
    const rest = String(r.do_number || '').slice(prefix.length);
    if (/OFF/i.test(rest)) return; // skip offline placeholders
    const num = parseInt(rest.replace(/\D/g, ''), 10) || 0;
    if (num > max) max = num;
  });
  return prefix + String(max + 1).padStart(2, '0');
}

// Upload a DO photo to the `documents` storage bucket; returns a public URL or
// falls back to the raw base64 string if the upload fails.
export async function uploadDOPhoto(base64, alNumber, doNumber) {
  try {
    const filePath = `do_photos/${alNumber}/${doNumber}_${Date.now()}.jpg`;
    const b64 = base64.split(',')[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/jpeg' });
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) return base64;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return data?.publicUrl || base64;
  } catch (e) {
    return base64;
  }
}

// Upload the customer's signature to the `documents` bucket, same shape as
// uploadDOPhoto — a reusable public URL rather than the signature living
// only inside the one-off PDF attachDOToOrder generates. Without this, the
// office's own DO print (operation_delivery.html) has no signature to show
// even for a DO the FC Portal issued and signed minutes earlier: the pad's
// data URL was never written onto the shared_do_records row at all.
export async function uploadDOSignature(base64, alNumber, doNumber) {
  try {
    const filePath = `do_signatures/${alNumber}/${doNumber}_${Date.now()}.png`;
    const b64 = base64.split(',')[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'image/png', upsert: true });
    if (error) return base64;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return data?.publicUrl || base64;
  } catch (e) {
    return base64;
  }
}

// Insert a DO record and deduct the AL balance. Returns { row, balance } — row
// is the inserted record (with its id, needed to open the Who Loaded This DO
// step against it) and balance is the new AL balance (or null when there is
// no linked AL row to deduct from). Same table the mobile DO module writes
// to, so both apps share one database.
//
// insert(...).select().single() rather than a plain insert(): the worker-tick
// step needs the row's id right after save, and a second query for it by
// do_number is a race a request this close behind the write is not
// guaranteed to win — the Mobile app hit exactly this and the fix there was
// the same one applied here, returning the row the insert already has.
/* ONE PRESS OF SAVE IS ONE DO, AND THE DATABASE HANDS OUT ITS NUMBER.

   A customer who collects twice in one day gets two DOs, and the second
   must not wear the first one's number (DO-MUGJB901 did, on 5 Nov). Every
   app works the next number out by reading the highest and adding one, so
   two saves close together, or a read that comes back short, give the same
   number twice. shared/RUN_ME_do_number_never_repeats.sql puts a trigger
   on the table that, under a lock on the order, moves a number already
   taken to the next free one. So the number on the form is a PREVIEW, and
   the number on the row that comes back is the DO. Everything after the
   insert (the PDF, the customer portal, the toast) must use the row.

   client_uid is one id per press of Save, made on the phone, carried by a
   queued copy too. A save that timed out while it landed, retried, comes
   back 23505 on the one-per-press index: that is the same DO, already in,
   and it is fetched rather than made a second time under a new number.

   A database that has not had the SQL run has no client_uid column, and
   naming a column a table has not got refuses the whole insert. A refusal
   that names it is remembered for the session and the same row is sent
   again without it. Shared with the Admin Portal (Mobile/src/lib/
   mobileQueue.js). Change one, change the other. */
let _doNoClientUid = false;
export function newDOPressId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function _namesClientUid(err) {
  const t = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  return /client_uid/i.test(t) && (err?.code === '42703' || err?.code === 'PGRST204' || /column/i.test(t));
}
async function _doByPress(uid) {
  if (!uid || _doNoClientUid) return null;
  const { data, error } = await supabase.from('shared_do_records').select('*').eq('client_uid', uid).limit(1);
  if (error) { if (_namesClientUid(error)) _doNoClientUid = true; return null; }
  return (data && data[0]) || null;
}
// Insert one DO row. Answers { row, existed }: existed is a retry of a
// press whose DO is already in the table.
export async function insertDORow(payload) {
  const body = { ...payload };
  if (_doNoClientUid) delete body.client_uid;
  let { data: row, error } = await supabase.from('shared_do_records').insert([body]).select().single();
  if (error && body.client_uid && _namesClientUid(error)) {
    _doNoClientUid = true;
    delete body.client_uid;
    ({ data: row, error } = await supabase.from('shared_do_records').insert([body]).select().single());
  }
  if (error && error.code === '23505' && body.client_uid) {
    const already = await _doByPress(body.client_uid);
    if (already) return { row: already, existed: true };
  }
  if (error) throw error;
  return { row, existed: false };
}

export async function saveDORecord(payload, al) {
  const { row, existed } = await insertDORow(payload);
  // A press already in the table had its balance deducted the first time.
  if (existed) return { row, balance: null };
  if (al && al.id != null) {
    const newBalance = (al.balance_quantity ?? 0) - (payload.total_qty || 0);
    // The DO row is IN the table by this line. A network blip on the balance
    // deduct must not throw the whole save back to persistDO's catch — that
    // queues the DO and the next flush inserts it a SECOND time. A missed
    // deduct is the smaller fault: issuedQtyByAL derives the collected figure
    // from the DO rows themselves, so the balance heals on the next read that
    // recomputes it, while a doubled DO row is a doubled collection for good.
    try {
      await supabase.from('shared_al_orders').update({ balance_quantity: newBalance }).eq('id', al.id);
    } catch (e) { /* deduct lost to a blip — the DO itself is saved */ }
    return { row, balance: newBalance };
  }
  return { row, balance: null };
}

// Look up an approval-letter order by its AL number (for the scan module's
// "Issue DO" flow). Returns the row or null.
export async function loadALByNumber(alNumber) {
  if (!alNumber) return null;
  const { data } = await supabase.from('shared_al_orders').select('*').eq('al_number', alNumber).maybeSingle();
  return data || null;
}

// Attach the issued DO to its Sales Web customer order so the customer portal
// shows it under the order's documents: build the DO PDF, upload it to the
// shared `order-attachments` bucket, then call the attach_do_to_order RPC
// (SECURITY DEFINER on the Sales Web side) which resolves the order from the
// AL number and inserts the salesweb_order_attachments + timeline rows.
// Best-effort: a failure here never blocks the DO itself. Returns true when
// the attachment row landed.
export async function attachDOToOrder({ payload, al, staff, sigDataUrl, photoBase64 }) {
  try {
    const alNumber = payload.al_number || al?.al_number;
    // Manual ALs have no Sales Web order to attach to.
    if (!alNumber || !payload.do_number || /^MANUAL-/i.test(alNumber)) return false;
    const { blob, fileName } = doPdfBlob(payload, al || {}, staff || '—', sigDataUrl || null, photoBase64 || null);
    const path = `do-pdfs/${alNumber}/${payload.do_number.replace(/[/\\]/g, '_')}.pdf`;
    const { error: upErr } = await supabase.storage
      .from('order-attachments')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) return false;
    const { data: urlData } = supabase.storage.from('order-attachments').getPublicUrl(path);
    if (!urlData?.publicUrl) return false;
    const { data, error } = await supabase.rpc('attach_do_to_order', {
      _al_number: alNumber,
      _do_number: payload.do_number,
      _file_name: fileName,
      _file_url: urlData.publicUrl,
      _file_size: blob.size,
      _uploaded_by: staff || 'barcode-counter',
    });
    return !error && data === true;
  } catch (e) {
    return false;
  }
}

// Persist a DO: online insert (+ photo upload + balance deduct + customer-order
// attachment) or, on no-network / failure, queue it for the next sync. Shared
// by the DO module and the scan module's Issue DO popup. Returns
// { queued, payload, savedRow } — savedRow is the inserted shared_do_records
// row (with its id) on a fresh online save, or null when queued: a queued DO
// has no server row yet to open the Who Loaded This DO step against, same as
// the Mobile app's equivalent flow.
export async function persistDO({ payload, photoBase64, al, sigDataUrl, staff }) {
  // Stamped ONCE, before either path, so a queued copy of a save that
  // landed carries the same id and is recognised.
  if (!payload.client_uid) payload = { ...payload, client_uid: newDOPressId() };
  if (navigator.onLine) {
    try {
      const finalPayload = { ...payload };
      // THE NUMBER IS CLAIMED AT SAVE, never trusted from the form. The Entry
      // modal generates its DO number when it OPENS, and the insert happens
      // minutes later — so a second save out of the same session (a figure
      // corrected and Save pressed again), or a modal opened before the
      // previous insert landed, wrote a SECOND row under the SAME number, and
      // the office DO list showed one DO twice (DO-MUGJB901, 5 Nov: qty 13 at
      // 06:31 and qty 47 at 06:33). Re-deriving here means the generator can
      // see every row already in the table, the one on screen included. The
      // number on the modal is a preview; the row, the PDF and onSaved all
      // carry this one. A generate that cannot answer keeps the preview
      // number rather than losing the save over it.
      try { finalPayload.do_number = await generateDONumber(al); } catch (e) { /* keep the preview number */ }
      if (photoBase64) finalPayload.image_url = await uploadDOPhoto(photoBase64, al.al_number, finalPayload.do_number);
      if (sigDataUrl) finalPayload.signature_url = await uploadDOSignature(sigDataUrl, al.al_number, finalPayload.do_number);
      const { row } = await saveDORecord(finalPayload, al);
      // The trigger may have moved the number; the row is the DO.
      if (row && row.do_number) finalPayload.do_number = row.do_number;
      await attachDOToOrder({ payload: finalPayload, al, staff, sigDataUrl, photoBase64 });
      return { queued: false, payload: finalPayload, savedRow: row || null };
    } catch (e) {
      /* fall through to offline queue */
    }
  }
  queueDO({ payload, photoBase64, sigDataUrl, staff });
  return { queued: true, payload, savedRow: null };
}

// ── Offline support ──────────────────────────────────────────────────
// A unique DO number for DOs created while offline (avoids collisions with the
// server sequence until they sync). Distinguishable by the "OFF" marker in the
// suffix; replaced with the real per-order running number on sync.
export function offlineDONumber(al) {
  const orderNo = String(al?.order_number || al?.al_number || '').trim() || 'NA';
  return `DO-${orderNo}OFF${Date.now().toString(36).toUpperCase()}`;
}

const DO_QUEUE_KEY = 'mjm.do.queue.v1';

export function readDOQueue() {
  try {
    return JSON.parse(localStorage.getItem(DO_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function writeDOQueue(arr) {
  try {
    localStorage.setItem(DO_QUEUE_KEY, JSON.stringify(arr));
  } catch (e) {
    /* ignore */
  }
}
// Queue a DO (with its photo as base64) for later sync. Returns the new length.
export function queueDO(entry) {
  const q = readDOQueue();
  q.push({ ...entry, queuedAt: Date.now() });
  writeDOQueue(q);
  return q.length;
}

// Push every queued DO to Supabase. Offline-placeholder DO numbers (containing
// "OFF") are replaced with a real sequential number before insert so the
// running sequence stays clean. Items that fail stay queued for the next
// attempt. Returns { synced, remaining }.
export async function flushDOQueue() {
  let q = readDOQueue();
  if (!q.length) return { synced: 0, remaining: 0 };
  const remaining = [];
  let synced = 0;
  for (const item of q) {
    try {
      const payload = { ...item.payload };
      const { data: alRow } = await supabase
        .from('shared_al_orders')
        .select('*')
        .eq('al_number', payload.al_number)
        .maybeSingle();
      // Replace offline placeholder numbers with the real per-order running
      // number now that we are online. The loop is sequential so each DO gets
      // a unique number.
      // A press already in the table (the save landed, its answer was lost)
      // is retired as synced, whatever number it carries.
      if (payload.client_uid && await _doByPress(payload.client_uid)) { synced++; continue; }
      if (payload.do_number && /OFF/i.test(payload.do_number)) {
        payload.do_number = await generateDONumber(alRow || { al_number: payload.al_number });
      } else if (payload.do_number) {
        // A queued DO with a REAL number is usually one whose insert landed
        // and whose acknowledgement was lost — a timeout is not a refusal
        // (the audit outbox learned this the hard way). Inserting it again is
        // the second copy the office sees on the DO list. So the table is
        // asked first: the same DO already there (same number, order, day and
        // quantity) is retired as synced; a DIFFERENT row wearing this number
        // means the number was taken while this one waited, and the queued DO
        // gets the next free number instead of a twin.
        const { data: existing } = await supabase
          .from('shared_do_records')
          .select('id, total_qty, delivery_date')
          .eq('do_number', payload.do_number)
          .eq('al_number', payload.al_number);
        const sameRow = (existing || []).some((r) =>
          Number(r.total_qty) === Number(payload.total_qty) && r.delivery_date === payload.delivery_date);
        if (sameRow) { synced++; continue; }
        if ((existing || []).length) {
          payload.do_number = await generateDONumber(alRow || { al_number: payload.al_number });
        }
      }
      if (item.photoBase64) {
        payload.image_url = await uploadDOPhoto(item.photoBase64, payload.al_number, payload.do_number);
      }
      if (item.sigDataUrl) {
        payload.signature_url = await uploadDOSignature(item.sigDataUrl, payload.al_number, payload.do_number);
      }
      let inserted;
      try { inserted = await insertDORow(payload); } catch (e) { remaining.push(item); continue; }
      if (inserted.row && inserted.row.do_number) payload.do_number = inserted.row.do_number;
      if (inserted.existed) { synced++; continue; }
      if (alRow) {
        await supabase
          .from('shared_al_orders')
          .update({ balance_quantity: (alRow.balance_quantity || 0) - (payload.total_qty || 0) })
          .eq('id', alRow.id);
      }
      await attachDOToOrder({ payload, al: alRow || { al_number: payload.al_number }, staff: item.staff, sigDataUrl: item.sigDataUrl, photoBase64: item.photoBase64 });
      synced++;
    } catch (e) {
      remaining.push(item);
    }
  }
  writeDOQueue(remaining);
  return { synced, remaining: remaining.length };
}

// ── Who loaded this DO ──────────────────────────────────────────────────
// The distinct nurseries a DO's items actually touch, resolved through
// plotMap (plot_name -> nursery_name) the same way itemsFromRecord already
// labels each item's nursery. nurseryKey (lib/access.js) is the same
// letters-and-digits normalisation every other nursery comparison in this
// system uses, so a DO's plot spelling lines up with mjmnpayroll_workers'
// own nursery spelling without trusting either side to be typed the same.
export function nurseriesOfDO(d, plotMap) {
  const keys = [];
  for (let i = 1; i <= 5; i++) {
    const plot = d[`plot_${i}`];
    if (!plot) continue;
    const key = nurseryKey(plotMap[plot] || plot);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/* THE DELIVERY ORDERS STILL OWING THEIR LOADERS.
   Narrowed by DATE in the query and by EMPTINESS in JS: the column is
   jsonb, and "null or an object with nothing in it" is a test PostgREST
   cannot be asked for cleanly, while `doNeedsWorkers` is the one rule the
   card and its test already share. The window is the portal's single
   answer to how far back a phone looks -- see VERIFY_WINDOW_DAYS.

   `select('*')` because the card hands the whole row to openWorkerTick,
   which reads plot_1..plot_5, worked_by_by_nursery and the lock. */
export async function loadDOsMissingWorkers(sinceDate) {
  let q = supabase
    .from('shared_do_records')
    .select('*')
    .order('delivery_date', { ascending: false });
  if (sinceDate) q = q.gte('delivery_date', sinceDate);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Active workers for the "Who Loaded This DO" tick list. Same table, same
// columns, same active-only filter as the maintenance module's own
// loadWorkers() (mjmnpayroll_workers — the roster the 555 Worker Portal
// signs people in against) but written as its own small query rather than
// importing the maintenance data layer, which pulls in offline/batch/
// schedule machinery the DO and Scan modules otherwise never touch — that
// coupling alone used to add several hundred KB to both of their bundles.
export async function loadDOWorkers() {
  const { data, error } = await supabase
    .from('mjmnpayroll_workers')
    .select('id, worker_no, full_name, nursery, section, role, job_title, maint_general, active')
    .eq('active', true)
    .order('full_name');
  if (error) throw error;
  return data || [];
}

// Writes who loaded a DO, grouped by nursery, and locks it — only an admin
// (checked by the caller) may call this again on an already-locked DO.
// Skipping the step writes nothing at all, same as leaving a cell blank: a
// DO with no worked_by_by_nursery and no lock reads identically to one
// nobody has looked at yet.
export async function saveDOWorkers(doId, workedByByNursery, lockedBy) {
  const { error } = await supabase
    .from('shared_do_records')
    .update({
      worked_by_by_nursery: workedByByNursery,
      worked_by_locked_at: new Date().toISOString(),
      worked_by_locked_by: lockedBy || null,
    })
    .eq('id', doId);
  if (error) throw error;
}

// Extract item rows (plot/nursery/breed/qty) from a DO record's plot_n columns.
/* `plot` is the column AS KEYED and `nursery` is it resolved -- two different
   answers, and the screens want different ones. plot_N holds the plot where
   one was chosen on the entry form and the NURSERY name where one was not
   (EntryModal falls back), so the raw column is "what the DO says the
   seedlings came off", which is what somebody standing at the lorry reads. */
export function itemsFromRecord(d, plotMap = {}) {
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const plot = d[`plot_${i}`];
    const breed = d[`breed_${i}`];
    const qty = parseInt(d[`qty_${i}`]) || 0;
    if (plot || breed || qty > 0) {
      lines.push({ plot: plot || '', nursery: plotMap[plot] || plot || '—', breed: breed || '—', qty });
    }
  }
  return lines;
}

/* The plots a DO names, in the order they were keyed and without repeats.
   Read off itemsFromRecord rather than walking plot_1..plot_5 again, because
   two loops over the same five columns is two rules the day one of them
   grows a sixth. */
export function plotsOfDO(d) {
  const out = [];
  itemsFromRecord(d || {}).forEach((l) => {
    const name = String(l.plot || '').trim();
    if (name && !out.includes(name)) out.push(name);
  });
  return out;
}

/* WHO THE DO IS FOR, which is not a column on every DO.

   This portal writes the customer into `remark` -- EntryModal's payload is
   `remark: al.customer_name` and names no customer column at all -- while a
   DO raised elsewhere carries `customer_name`. Asking only for the column
   therefore fell through to the AL NUMBER on every DO the FC Portal has
   ever issued, and an AL number is a reference, not a name. The AL number
   stays as the last resort, because a DO with nothing else on it still has
   to say which order it came off. */
export function customerOfDO(d) {
  const r = d || {};
  return [r.customer_name, r.remark, r.al_number]
    .map((v) => String(v == null ? '' : v).trim())
    .find(Boolean) || '';
}

import { supabase } from './supabase.js';

/**
 * Raising a Nelos case from the FC Portal.
 *
 * Nelos is the case system on the main portal (ai.mjmnursery.com), where
 * every module's follow-up work lands on somebody's To-Do list. The portal
 * has its own helper for this — shared/shared_nelos.js, a browser global —
 * but this app is a React bundle on a different domain and cannot load it.
 * It is the same Supabase project, so this writes the same row to the same
 * table instead.
 *
 * THE ROW SHAPE HERE MUST MATCH shared_nelos.js. If a column is added or
 * renamed there, this goes with it: a case raised from the field that the
 * case screen cannot read is worse than no case at all, because the Field
 * Conductor is told it was sent.
 *
 * Never throws. A case that cannot be raised must not take down the screen
 * that raised it — the caller shows the failure and the Field Conductor can
 * try again.
 */

// The statuses that count as "still open" — from shared_nelos.js.
const PENDING = ['open', 'in_progress'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

/**
 * An open case for the same module, plot and category is the same case being
 * raised again, not a new one. Without this, a Field Conductor who presses
 * the button twice — or comes back to the same plot tomorrow — files a
 * second identical case and the auditor gets a queue of duplicates.
 */
async function findOpenDuplicate({ source, category, plot }) {
  let q = supabase.from('nelos_cases').select('*').in('status', PENDING).eq('source_module', source);
  if (category) q = q.eq('category', category);
  if (plot) q = q.eq('plot_name', plot);
  const { data, error } = await q.limit(1);
  if (error) return null;
  return (data && data[0]) || null;
}

/**
 * Which plots already have an open case, so a screen can say so before
 * somebody raises a second one. Same question findOpenDuplicate() asks,
 * asked once for every plot rather than one at a time.
 *
 * Returns a Set of plot names — empty on any failure, because "we could
 * not check" must read as "no badge", never as "already raised".
 */
export async function openCasePlots({ source = 'scan', category } = {}) {
  try {
    let q = supabase.from('nelos_cases')
      .select('plot_name')
      .in('status', PENDING)
      .eq('source_module', source);
    if (category) q = q.eq('category', category);
    const { data, error } = await q.limit(500);
    if (error || !Array.isArray(data)) return new Set();
    return new Set(data.map((r) => r.plot_name).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

/**
 * raiseCase({ title, description, category, priority, source, sourceRef,
 *             nursery, plot, batch, by, byId, dedupe,
 *             assignedModule, assigneeId, assigneeName, dueDate, photoUrl })
 *
 * Returns { data, error, deduped }. `data` is the case row, so the caller can
 * quote its case_no back to the person who raised it.
 *
 * The last five are what a person filling in the form can say and a screen
 * raising a case by itself cannot. They are all optional and all omitted
 * from the row when absent — an automatic raise (CullingTab, the batch
 * report) sends none of them and falls through nelos_route_case() exactly
 * as it always has. Naming a destination overrides that routing, which is
 * the trigger's own rule: "an explicit destination wins: routing is the
 * default, not a rule."
 */
export async function raiseCase(opts) {
  if (!opts || !opts.title) return { data: null, error: new Error('Nelos: title is required') };

  try {
    if (opts.dedupe) {
      const existing = await findOpenDuplicate(opts);
      if (existing) return { data: existing, error: null, deduped: true };
    }

    const row = {
      title: String(opts.title).slice(0, 300),
      description: opts.description || null,
      category: opts.category || null,
      priority: PRIORITIES.includes(opts.priority) ? opts.priority : 'normal',
      status: 'open',
      /* 'scan' is the FC Portal's key in nelos_modules, and every other
         part of Nelos spells it that way — SOURCE_LABEL, the module
         filter, and nelos_routes, whose source_module is a foreign key
         to that table.

         This used to default to 'fc_portal', which is not a module key
         anywhere. No route row could exist for it (the foreign key
         forbids one), so nelos_route_case() found no rule and fell
         through to its last line — assigned_module := source_module —
         and every case raised here was assigned straight back to the
         people who raised it. That is the "PIC shows FC Portal" the
         case list was reporting. */
      source_module: opts.source || 'scan',
      source_ref: opts.sourceRef || null,
      nursery_name: opts.nursery || null,
      plot_name: opts.plot || null,
      batch_name: opts.batch || null,
      raised_by: opts.by || null,
      raised_by_id: opts.byId || null,
    };

    /* Only ever SENT when set. assigned_module absent lets the routing
       trigger decide, and photo_url is a column migration_nelos_case_tools
       added later — a database without it still takes the insert as long as
       nobody names it. */
    if (opts.assignedModule) row.assigned_module = opts.assignedModule;
    if (opts.assignedSeatNo) row.assigned_seat_no = opts.assignedSeatNo;
    if (opts.assigneeId) {
      row.assignee_id = opts.assigneeId;
      row.assignee_name = opts.assigneeName || null;
    }
    if (opts.dueDate) row.due_date = opts.dueDate;
    if (opts.photoUrl) row.photo_url = opts.photoUrl;

    const { data, error } = await supabase.from('nelos_cases').insert([row]).select().single();
    if (error) return { data: null, error };

    // The opening description also lands in the thread, so the case page
    // reads as one conversation from its first line — same as the portal's
    // own helper does it.
    if (opts.description) {
      await supabase
        .from('nelos_case_comments')
        .insert([
          {
            case_id: data.id,
            body: opts.description,
            kind: 'comment',
            author_name: opts.by || null,
            author_id: opts.byId || null,
          },
        ])
        .then((r) => r, () => ({}));
    }

    return { data, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   WHAT IS WAITING FOR ME

   The other direction: not raising a case but reading the ones already
   raised. Same model as the portal's floating dock
   (mjm-ai-system/shared/shared_nelos_dock.js) and the Admin Portal's block,
   and it has to stay that way — three surfaces showing three different
   answers to "what is pending for me" is worse than two of them not
   existing.

     • pending   = status in (open, in_progress)
     • order     = due date first (nulls last), then created; priority
                   re-sorted here, because it is a word in the database
     • scope     = nelos_my_scope(), the pin set on the User Setting page
     • queue     = assigned_module, falling back to source_module

   Everything fails soft and returns { rows: [], failed: true }: a case log
   that cannot be read must not break the screen it was opened over.
   ══════════════════════════════════════════════════════════════════════ */

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

/* BASE_COLS is what migration_nelos.sql created. ROUTED_COLS adds what the
   routing and seat migrations added later. Asking for a column that does not
   exist does not return it as null — PostgREST rejects the WHOLE select with
   a 400, which is how the portal's dock once vanished from every page at
   once. So the routed set is tried first and the base set is the fallback. */
const BASE_COLS =
  'id,case_no,title,category,priority,status,source_module,nursery_name,' +
  'plot_name,batch_name,assignee_id,assignee_name,due_date,created_at';
const ROUTED_COLS = `${BASE_COLS},assigned_module,assigned_seat_no`;

export const queueOf = (c) => c.assigned_module || c.source_module;
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const isOverdue = (c) => !!c.due_date && c.due_date < todayISO();

/* Who sees which cases. A person is pinned to one home module and from that
   pin sees their home module's queue plus anything assigned to them
   personally, anywhere. Not pinned, Nelos admin, or the lookup fails → no
   restriction: a scope check that cannot run must never HIDE cases. */
async function myScope(uid) {
  const open = { unrestricted: true };
  if (!uid) return open;
  try {
    const { data, error } = await supabase.rpc('nelos_my_scope', {});
    if (error) return open;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.is_admin || row.sees_all || !row.primary_module) return open;
    const list = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
    return {
      unrestricted: false,
      home: row.primary_module,
      seatNo: row.seat_no ?? null,
      cats: list.length ? new Set(list) : null,
      userId: uid,
    };
  } catch (e) {
    return open;
  }
}

function inScope(c, sc) {
  if (!sc || sc.unrestricted) return true;
  // My name on it — mine wherever it sits, and never category-filtered.
  if (sc.userId && c.assignee_id && c.assignee_id === sc.userId) return true;
  if (queueOf(c) !== sc.home) return false;
  if (c.assigned_seat_no && c.assigned_seat_no !== sc.seatNo) return false;
  if (!sc.cats) return true;
  return !!c.category && sc.cats.has(c.category);
}

/**
 * pendingCases({ module })
 *
 * What is waiting in this portal's queue, plus anything with your name on it
 * wherever it was routed — that is yours to answer from whichever screen you
 * are on. Returns { rows, uid, failed }.
 */
export async function pendingCases({ module = 'scan' } = {}) {
  let uid = null;
  try {
    const { data: sess } = await supabase.auth.getSession();
    uid = sess?.session?.user?.id || null;
  } catch (e) {
    return { rows: [], uid: null, failed: true };
  }
  if (!uid) return { rows: [], uid: null, failed: true };

  const ask = (cols) =>
    supabase
      .from('nelos_cases')
      .select(cols)
      .in('status', PENDING)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(50);

  let data;
  let error;
  try {
    ({ data, error } = await ask(ROUTED_COLS));
  } catch (e) {
    return { rows: [], uid, failed: true };
  }
  if (error) {
    // 42703 = undefined column: this database has not run the routing and
    // seat migrations. Ask for what it does have rather than standing down.
    if (error.code === '42703') {
      try {
        ({ data, error } = await ask(BASE_COLS));
      } catch (e) {
        return { rows: [], uid, failed: true };
      }
    }
    if (error) return { rows: [], uid, failed: true };
  }

  const rows = (data || [])
    .slice()
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));

  const sc = await myScope(uid);
  const seen = sc.unrestricted ? rows : rows.filter((c) => inScope(c, sc));
  return {
    rows: seen.filter((c) => queueOf(c) === module || c.assignee_id === uid),
    uid,
    failed: false,
  };
}

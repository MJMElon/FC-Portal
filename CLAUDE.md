# Working on the MJM Nursery phone apps

This repository is one half of a system. **The notes that matter live in the
other half — `mjm-ai-system/CLAUDE.md`** — and they apply here too. Read them
first; the most important one is that any change needing something run in the
database is not finished until the person has been handed the SQL to run,
because this environment cannot reach Supabase and never will.

What is specific to this repository:

- **Two front doors, one build.** `/` is the 555 FC Portal, signed in with a
  Supabase account. `/#/worker` is the 555 Worker Portal, entered with the PIN
  on a worker's row of the payroll register. A worker is `anon` and cannot read
  any table directly — everything goes through the `worker_*` database
  functions, which check the token and the boundary before answering. That is
  the whole security model.
- **The entry HTML is `app.html`, not `index.html`.** CI builds and commits the
  output back to the repository root, so the root `index.html` IS build output
  and the source must live under a different name or the build overwrites its
  own input. Dev server: open `/app.html`.
- **Offline is not a mode, it is the path.** Records go into an outbox
  (`src/lib/outbox.js`) and are sent from there, so the same code runs with a
  bar of signal or none. There is no separate offline branch to be in the wrong
  one of.
- **`public/sw.js` is a runtime-caching service worker, network-first for
  HTML.** It replaced a self-destruct worker whose job was to undo an earlier
  PRECACHING one that served a stale app shell — a real production incident.
  Offline entry was then asked for on purpose (a Field Conductor loses signal
  for hours and must still open the portal), and network-first HTML is what
  makes that safe to have again: with signal the live deploy always wins, and
  the cache only answers when the network itself fails. That property is
  load-bearing — do not flip it to cache-first, that is how the incident
  happened. app.html's recovery code still removes workers and caches when
  the app fails to mount, so a misbehaving worker cleans itself up.
- Rules shared with the office repository carry a comment saying so in both
  copies. Change one, change the other.

## A seal that will not read is keyed by hand, through the SAME door

A sticker gets wet, creased or printed short, and the conductor is standing
at the lorry with it in his hand. There were two ways on: wave it until the
battery goes, or leave the order short — and a count that is short for a
reason nobody wrote down is the one the office cannot settle later. So the
scan log carries an **Add** button.

**The whole risk in adding a keyboard is that it becomes a SECOND WRITER.**
A path of its own would skip the guards the camera goes through, and the one
it would skip is exactly the one that catches a typed mistake: `sealVerdict`,
which refuses a number that is not on this consent. `600` fat-fingered out of
`0035190` is caught there. So the dialog hands its seal to `recordScan` — the
same function the camera and the Bluetooth gun hand theirs to — and opens no
insert of its own.

Two things differ for a typed seal, and only two:

- **The debounce is skipped** (`opts.typed`). It exists because a camera
  reads one barcode ten times a second; a person pressing Add has done one
  deliberate thing, and swallowing it would be silence where the answer
  matters most — including the "duplicate" a second press should hear.
- **`recordScan` RETURNS its verdict** (`{ ok, key, vars }`), so the dialog
  prints the very sentence the toast prints. The toast is behind the dialog
  at that moment, and two wordings for one outcome is how they drift apart.
  The camera and the wedge ignore the return, as they always have.

Three smaller things, each a way this goes wrong:

- **It is a dialog, never `prompt()`.** A prompt is dismissed out of habit,
  and a cancel that looks like a save is the one shape of wrong this screen
  must not have. The test forbids `prompt(` in the file — after stripping
  comments, because this file explains in prose why it is not one.
- **It stays OPEN after each seal.** The reason a sticker is unreadable — a
  wet roll, a bad print run — is usually true of the next one too, and
  reopening per seal is the work done twice. The box clears on a seal that
  went in and KEEPS a refused one, because a refusal is usually a typo and
  retyping seven digits to fix one of them is how the second typo happens.
- **The wedge listener already lets a real `<input>` keep its keystrokes**,
  so typing is never swallowed and Enter reaches the form. A gun fired while
  the dialog is open simply fills the box.

The scan log itself is unchanged and still **read-only** — nothing added can
be edited or removed, by design, and `fcportal_scan_records` has no delete
anywhere in the app.

`tests/a_seal_that_will_not_read_is_keyed.cjs` lifts the real `recordScan`
out of the shipped file and drives it beside the real `store.js` and
`sealRanges.js`.

## Work that was done and nobody signed for it

Two gaps, one shape, and both were invisible BY CONSTRUCTION — which is why
neither was ever noticed on the day it happened:

- **A delivery order whose loading gang was never ticked.** Skipping "Who
  Loaded This DO" writes *nothing*: `saveDOWorkers` is never called, and
  `do/data.js` says in as many words that such a DO "reads identically to
  one nobody has looked at yet". The only difference between a DO somebody
  answered and one somebody walked past is an empty column nothing was
  looking at.
- **A transplanted plot whose four jobs were never recorded.** You found
  one by opening the sheet and looking.

Both are somebody's pay. `VerificationBoard` raises them on the dashboard,
**last** — after both boards and both rows of module tiles. It sat between
the collections and the maintenance status at first, on the theory that this
was the order of the morning; the office asked for it moved to the end
instead, so a prompt does not sit ahead of the day's own tools.

Three things in it:

- **`src/components/verify/pending.js` holds both rules and nothing else.**
  Pure and outside the card so the test drives the REAL ones. `doNeedsWorkers`
  treats `null`, `{}` and `{UNN1: []}` alike — all three name nobody, and
  `cleanPicks` can leave the second — and asks the shared `isCancelledDO`
  rather than a copy of it. That rule is EXACT: `'Cancelled'` with the
  capital, or `[CANCELLED]` in the remark. The first draft of the test used
  a lowercase status and was right to fail.
- **One card at a time, and the stepper CLAMPS.** Same choice the
  maintenance week stepper made: the last card rolling round to the first
  reads as a list that has started again, and somebody working down a deck
  of nine loses their place. It is also clamped against a list that SHRANK —
  answering the DO you are looking at takes it off the list underneath you.
- **It hides when there is nothing outstanding**, which the office asked
  for and is right for a prompt: a card reading "nothing to do" every day is
  a card nobody reads on the day it says something else.

**The loading list starts at a DATE, not a rolling window.** A rolling 92
days opened on **332 delivery orders** — nearly all from before anybody was
ticking loaders at all, so 332 questions that were never going to be
answered sitting on top of the handful that would. A wall gets scrolled
past; it is not a list anybody works down. `LOADING_WORKERS_FROM` is
`2026-10-01`, the month the step started being done, and it is a fixed date
for the same reason `TRANSPLANT_FLOW_FROM` is: records made before a rule
existed and records made after it have to meet somewhere, and the 1st of a
month is that somewhere.

**A DO answered has to LEAVE the list, and the only honest way to know is to
ask again.** `openWorkerTick` takes an `after` callback and it is the wrong
tool here: `closeWorkerTick` runs it on BOTH routes, so a DO somebody
skipped a second time would vanish exactly like one they filled in — card
gone, work still owed, which is the fault this board exists to stop. So the
popup CLOSING re-reads the delivery orders. One query, only on close, and it
cannot be wrong in either direction.

**The transplanting card does not name the missing jobs.** It did, and four
of them spelt in full — *"Lining & Arranging Polybag 15" × 18""* among them
— wrapped to three lines and turned the card into a paragraph, with the plot
(which is what somebody is actually looking for) carrying the least weight
on it. Which jobs are missing is the first thing the sheet says anyway, one
tap away.

**Colours are written out, never built from a variable.** Tailwind scans the
source, so `` `border-${tone}-200` `` is a class that is never generated and
a border that never appears. `TONE` is the explicit map; the test forbids
the interpolated form.

### Transplanting left the Maintenance module, and what that costs

The four transplanting jobs were never planned by the month's schedule —
the operation report decides which plots they apply to, by having
transplanted into them — so they sat in Maintenance as a button beside four
jobs they had nothing to do with. The office asked for them out, and the
board's right-hand half is now the only door: it raises a plot while any of
its four jobs is unrecorded and opens **the same `TransplantSheet`**, not a
rebuild of it.

**The cost was weighed and accepted.** The section hides itself when nothing
is outstanding, so a nursery-month with every job recorded has NO door until
the next plot is transplanted. That matters because a transplanting record
is a crew, and `TransplantSheet.jsx` spells out why: *"the plot's quantity is
divided among the people ticked here and that is what each of them is
paid."* Correcting a name is correcting somebody's month.

It is softened by the sheet being the whole sheet: whenever the section is
up, every plot of that nursery-month is one tap away, recorded or not. The
dead zone is only a nursery-month that is completely clear.

**And the office cannot fix one either — check before relying on it.** The
only writer of a CREW on `nops_transplant_field_records` in either
repository is this sheet. The office reads those rows on Worker Record →
Transplanting and writes **one column pair** on them, `checked_at` /
`checked_by` — its agreement, which is what sends a row to the salary claim
(`mjm-ai-system/CLAUDE.md` has the rule). It writes nothing else: not the
crew, not the quantity, not the day. `npayroll_script.js` reads the rows and
prices the agreed ones; the Work Maintenance screen edits
`nops_maint_payroll`, which is a different table.

**A correction made here CLEARS that agreement**, and a database trigger
does it rather than either screen — three things write this table and a rule
living in one of them is a rule the other two do not obey. So a crew put
right after the office ticked the row comes off the claim until somebody
ticks it again, which is the point: the figure moved. Nothing in this app has
to know, and nothing in this app may be relied on to do it. `shared/RUN_ME_move_transplant_month.sql` is a paste-in repair, not a
screen. The day somebody needs to correct a crew in a fully-recorded month,
the answer is to put a door back — a module tile is the cheap one.

`tests/nobody_signed_for_this_work.cjs` holds all of it, and checks the
button, the sheet and the state behind them are all gone from Maintenance —
a half-removal that leaves the import is the kind that comes back.

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

**A DO NUMBER IS NOT A THING ANYBODY RECOGNISES.** The card and the popup
both opened on `03682` and little else, and the question being asked —
which gang carried this — cannot be answered from a reference. Both now
name the CUSTOMER, the PLOT and the QUANTITY, off the same two rules in
`do/data.js` so the card and the popup cannot drift: the popup lists the
DO line by line (plot, and its nursery where the two differ) with the DO
own `total_qty` under them, falling back to the sum of the lines only
where it has none — a total worked out here that disagreed with the row
this popup was opened from would be the worse answer.

**The customer is NOT `customer_name`.** This portal writes it into the
REMARK — `EntryModal`s payload is `remark: al.customer_name` and names no
customer column at all — so reading the column fell through to the AL
number on every DO the FC Portal has ever issued, which is what the office
was looking at: `C2A729` where a name belongs. `customerOfDO` asks for the
column, then the remark, then the AL number, in that order, and the AL
number stays last because a DO with nothing else on it still has to say
which order it came off.

**Colours are written out, never built from a variable.** Tailwind scans the
source, so `` `border-${tone}-200` `` is a class that is never generated and
a border that never appears. `TONE` is the explicit map; the test forbids
the interpolated form.

**BOTH HALVES ARE SCOPED NOW, and the day it was asked for is the day the
note above predicted.** Transplanting reads only the conductor own
nurseries (`allowedNurseries(permissions, 'maintenance')`, matched through
`nurseryKey`), the same scoping the Maintenance module uses — and open to
everything for a login nobody has configured, because access fails open.
The loading half was NOT scoped: it showed every DO missing its gang,
whatever nursery, which is what the DO module beside it has always done —
nothing under `src/modules/do/` calls `allowedNurseries`. This file said
that scoping one and not the other would read as a bug later, and it did:
the office opened the board as BNN, found a DO for **N12** sitting beside
their own B2, and asked for it in one line — *"BNN acc 只看到 BNN 的 plot,
UNN1 只看到 UNN1 的 plot"*.

`doIsMine` in `verify/pending.js` is the rule, written exactly as the note
above said it would have to be:

- **The test is ANY of its plots is mine, never EVERY.** A DO carries
  `plot_1`..`plot_5` and one load really can be drawn from two nurseries;
  asking that all of them are mine drops a DO half of which is my own work,
  and nobody would ever name the gang for it. Both nurseries keep it.
- **A DO whose plots cannot be PLACED goes on showing** — no plots on it,
  or not one of them in Seedling Stock. A card that vanishes off every
  board with nothing saying where it went is the fault this board exists to
  stop, and it would be the Who Loaded step being skipped again, invisible
  to the system this time as well as to the person.
- **It is the DO page's own list** (`allowedNurseries(permissions, 'do')`),
  not maintenance's — two doors, and the office may narrow one and not the
  other. Empty or absent is every nursery.
- **It is applied in `loadPendingDOs`, not in the card**, because that one
  read feeds the dock badge as well. Narrowing the cards alone would badge
  the icon with a number nobody could find anything behind.

**WHAT IT COSTS, and it is what `another_nursery_can_load_the_do.cjs` is
entirely about: where the seedlings were is not who carried them.** A BNN
DO is regularly loaded by a UNN 1 gang, and the UNN 1 conductor no longer
sees it. There is no better rule available — this board lists exactly the
DOs whose `worked_by_by_nursery` is still EMPTY, so the one field that
would say who loaded it is the answer nobody has given yet, and the plots
are all there is. The work is not lost: it sits on the BNN board, and that
popup opens every other nursery by hand underneath its own, which is what
it was built for.

Section 1b of `tests/nobody_signed_for_this_work.cjs` holds it, and lifts
the REAL `plotsOfDO` (through `itemsFromRecord`) and the real `nurseryKey`
rather than restating either — a second reader of those five plot columns
is how the scope comes to disagree with what the card prints. **The
harness brace-scanner had to learn one thing to do it:** a body opens
after the PARAMETER LIST, not at the first `{` on the line, because
`itemsFromRecord(d, plotMap = {})` has a default that matches first and
hands back half a signature.

### A plot SEEDLING STOCK cannot place was on nobody's board at all

The office counted their own cards and said it: *"我的 pending verification
还是只有 B2 B3 没有 B11"*. The ledger had put seedlings into that plot and
none of its four jobs was recorded, so the board owed it a card.

**It could never have drawn one.** `loadPendingTransplants` builds `names`
from `shared_plots` filtered to the conductor's own nurseries, and
`loadTransplantingSince` then drops every ledger row whose plot is not in
that list — one line, `if (!allowed.has(k)) return;`. For ANOTHER
nursery's plot that is exactly right. For a plot on **no nursery list at
all** it is catastrophic, because then there is no conductor anywhere
whose list it is in: it is raised on no board, nobody is ever asked to
record its lining, its polybag filling, its blanket spray or its
transplanting, and **that is four crews' pay that no screen in the system
mentions.** Same shape as "A plot the salary claim does not know pays
nobody", one door along — and this board had already decided the question
for its OTHER half and written the answer down: *a card that vanishes off
every board with nothing saying where it went is the fault this board
exists to stop.*

So `loadTransplantingSince` takes a third argument, `knownPlots` — every
plot Seedling Stock lists ANYWHERE — and that is the only thing that can
tell the two cases apart. Four things in it:

- **Without it the function is exactly what it was.** Nothing else calls
  it with three arguments, and section 1 of the test asserts the old
  behaviour is untouched.
- **Another nursery's plot is still not mine.** It is on the list, just
  not on this conductor's — raising it here would undo the scoping the
  office asked for in the same week. Section 3 holds that half.
- **The unplaceable plot is MARKED, not quietly folded in.** The card
  reads *"On no nursery list"* where the nursery goes, rather than a blank
  that looks like a plot nobody got round to naming.
- **It opens no sheet.** `TransplantSheet` loads and saves BY NURSERY, so
  a sheet opened with none would file the crew — somebody's pay — under no
  nursery at all. The card raises the plot, which is the whole point of
  it, and says the one thing that fixes it: add the plot in Seedling
  Stock. The moment somebody does, it becomes an ordinary card on that
  nursery's board.
- **The date floor still applies.** It is a plot the board forgot, not a
  plot the board exempts.

`tests/a_plot_on_no_list_is_not_invisible.cjs` lifts the REAL reader out of
the shipped file — the whole fault was one line of filtering inside it, so
a restatement would have proved nothing — and stubs only the ledger read.
Two of its checks fail on the previous code.

**And `shared/CHECK_no_transplanting_recorded.sql` in the office repo is
the other half of this**: its *"ledger, plot not in Seedling Stock"* rows
name every arrival this was happening to, and its *"Seedling Stock says"*
rows print what each nursery's list actually holds. The board now raises
the plot; that check says why it was unplaceable.

### A SECOND delivery into a finished plot is four more crews, and it was invisible

The office counted their own cards and B11 was not among them. It had taken
**135 more seedlings on 24 Oct, after its four jobs were recorded on 29
Sep** — a new filling, a new lining, a new planting and a new spray, four
crews owed their pay, and no screen in the system mentioned it.

`missingJobs` asked whether the PLOT had a record of each job, in any month,
ever since `TRANSPLANT_FLOW_FROM`. So a plot that took another delivery
after its four were recorded counted as finished and dropped off the board
for good. The office settled what it should do in one line: the new
seedlings **要再做一次**.

**IT CANNOT BE DONE BY DATE, and that was the whole of the decision.** The
obvious rule — an arrival newer than the newest record — looks right and is
wrong here, because the office answered the question it turns on: filling
and lining are sometimes done BEFORE the seedlings arrive and sometimes
after, **两种都有**. A record older than an arrival therefore proves
nothing, and a date test would leave exactly those plots on the board for
ever.

**So it is the BATCH, which both sides already carry** — the ledger row
names the batches that have arrived, the record names the batches it was
recorded for. A job is owed again when the ledger names a batch that no
record of that job mentions. B11: ledger `269, 271`, record `269`.

Three things in it, and the second is the one that would have broken it:

- **The records DO carry batches**, which was checked before the rule was
  written rather than assumed — `saveTransplantRecord` writes `batch_name:
  rec.batch || null`, so a blank is possible.
  `shared/CHECK_why_a_plot_is_not_on_the_board.sql` in the office repo is
  what answered it, printing both sides job by job.
- **They are compared as SETS, never as strings.** U4's record reads `260,
  267, 259` against a ledger of `259, 260, 267`; N15's reads `271, 270`
  against `270, 271`. A string comparison calls all three different and
  puts three correct plots back on the board for ever, which is the wall
  this list exists not to be. Matched on letters and digits, like every
  other key in this system.
- **A record with NO batch on it covers everything.** Raising a plot for
  ever over a record nobody can tie to a delivery is worse than the fault,
  so that case keeps the old behaviour — and so does a caller that passes
  no batches at all, which is every caller before this rule existed.

**The card names the batch in its ordinary line** (`135 · 271`) and says
NOTHING ELSE. It carried a second line — *"New batch not recorded: 271"* —
and the office took it off in one sentence: *"干嘛要有那一行小字 … 他就和
B3 一样啊 同样 plot 不一样日期种"*. They are right, and the reason that line
existed had already gone: it was there because the sheet opened with all
four jobs ticked green for the earlier batch, so the card had to explain
why it was raising a plot that looked finished. **The sheet says it where
it belongs now** — the ticks go back to TO DO and each job names the batch
it owes — so the card was giving the same answer twice, in the place with
the least room for it, and dressing the ordinary case as an exception.

Section 2b of `tests/nobody_signed_for_this_work.cjs` is the office's own
six plots, letter for letter, including the three whose batch lists are the
same set in a different order.

#### And the second delivery is NOT ADDED TO THE FIRST

The rule above raised B11 correctly and then offered the wrong figure: the
card read **`3303 · 269, 271`**, which is September's 3,168 and October's
135 added together. That number is not a label — `saveTransplantRecord`
writes it into `source_qty`, and the salary claim divides `source_qty`
among the crew. **Four crews would have been paid for moving 3,303
seedlings when 135 arrived**, and September's 3,168 would have been paid a
second time. The office: *"之前3168记录了就记录了 这次的135 不要combine
起来"*.

**`loadTransplantingSince` keeps each delivery apart** (`byBatch`), and the
figure shown wherever a job is OWED is the figure of the batches
outstanding **on that job** (`owedQty`, `owedForJob`). `qty` is untouched
and is still every arrival since the floor — which is exactly right for the
ordinary plot, where nothing is recorded and every batch is owed, so
nothing moves for it.

Five things, and three of them are a crew's pay:

- **IT IS ASKED PER JOB, never per plot.** The four are not recorded
  together: the lining can be done for the new delivery while the spray
  still owes both. `owedForJob(row, records, key)` filters the records to
  that job and answers with the batches and the figure.
- **`owedBatches` answers `[]` for two OPPOSITE things** — nothing recorded
  at all, and everything already covered — and the first version read them
  as one, so a finished job offered every batch again. The record list is
  what tells them apart (`fresh`).
- **A JOB THAT OWES A NEW BATCH OPENS A BLANK FORM.** It opened on the
  September record, which made October's 135 a CORRECTION of it: the save
  passes `id` and would have overwritten September's crew. The prior record
  is shown as a line above the ticks instead (`tp.priorBatch`), which is
  what it is — what was recorded before, for another delivery.
- **TWO DELIVERIES CANNOT SHARE ONE MONTH ON ONE JOB**, because the unique
  key is `(plot, work_type, schedule_month)` and an upsert would replace the
  first crew with the second, silently. It is REFUSED, naming the record in
  the way (`tp.monthTaken`); dating the work in the month it was done is the
  answer, and the date box is there for it. **Widening that key is owed**
  the day a second delivery's jobs are genuinely done in the same month as
  the first — it is a schema change and the app's conflict target, so both
  move together.
- **The tick and the count follow the same rule.** A job owed again wears
  TO DO rather than the green ✓ it had for the old batch, and the plot list
  counts `missingJobs` rather than "has any record at all" — it read 4/4
  ALL DONE while the board beside it was raising the plot.

`staleQty` compares a record against **the batches that record is for**, not
against the plot's total, or every record on a two-delivery plot reads as a
figure the report has moved.

`tests/a_second_delivery_is_not_added_to_the_first.cjs` drives B11's own
3,168 and 135 through the shipped reader and the shipped rules.

### A job NOBODY DID is an answer, and the batch rule is what made it urgent

A blanket spray is not always needed — the grass does not always come — so
a plot can genuinely never have one, and there was no way to say so. The
plot therefore owed four jobs for ever: its card could never be cleared and
sat under every plot with work actually owing. The rule above is what made
it pressing rather than untidy: **once a second delivery owes the four jobs
again, a job that is never done comes back on every arrival.** The office
asked for it in one line: *"要有option是没有做"*.

**It is a RECORD and never a deletion**, the same choice the admin-closed
plot and the rejected signup made: an ordinary
`nops_transplant_field_records` row carrying the day, the plot, the job, the
batches it is about and who said so, with an **EMPTY CREW** — which is what
keeps it off every claim line BY CONSTRUCTION rather than by a rule
somebody has to remember, since `transplantFieldLines` has always dropped a
row with no crew. It goes through the one door everything else goes
through, and it can be reversed.

**THE ANSWER IS ABOUT THE BATCHES, NOT THE PLOT FOR EVER.** That falls out
of `missingJobs` and was not a second decision: the record carries the
ledger's batches like any other, so the job is answered for those and a new
delivery asks again — the grass may well come for the next lot. Nobody had
to choose a level; the batch rule above had already chosen it.

**The decision is a COLUMN** (`not_done`,
`shared/RUN_ME_transplant_not_done.sql`). The remark is free text the
office edits, and a decision that can be undone by somebody tidying a
sentence is not a record of anything — the rejected signup's reasoning
exactly. And every office screen reads a crew of nobody as a crew somebody
FORGOT, so without the column the sheet would say *"names nobody, go and
add who did the work"* about a job nobody is ever going to do.

Four things in it:

- **The flag is sent only by code that knows about it.** `rec.notDone` left
  undefined omits the key, so every caller from before this writes exactly
  the row it always wrote and a database without the column goes on
  working. Passing it FALSE is how a not-done record becomes a real one, so
  that has to be sent as well — a row left flagged would show the names and
  pay nobody.
- **A missing column REFUSES rather than failing open.** Dropping the flag
  and writing anyway would store a record naming nobody, which is the one
  shape this must not have; the job staying unrecorded is the truth, and
  the message names the file to run. Asked BEFORE `missingTable`, which
  matches "schema cache" and would otherwise swallow it — PostgREST words
  both refusals that way.
- **It does not wear the tick.** A green ✓ against a spray that never
  happened is the screen saying the work was done, and TO DO is wrong too
  because somebody has answered. It is its own state, in slate, and a plot
  carrying one reads **ANSWERED** rather than ALL DONE.
- **It is a dialog, never `confirm()`.** What has to be read is three
  lines — which plot, which job, that it can be undone — and no prompt asks
  for a reason: the remark box above is where one goes, and a prompt
  dismissed out of habit is a cancel that looks like a save.

`tests/a_job_that_was_not_done_is_an_answer.cjs` drives the real writer and
the real board rule, the schema-cache trap included.

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

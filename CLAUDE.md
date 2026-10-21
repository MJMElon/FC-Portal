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

/* THE PHONE CARRIES A DATE WINDOW, NOT A ROW COUNT.

   The office could see a job and the phone's History could not, and the
   reason was `.limit(500)`. A COUNT of rows is the wrong unit: at a hundred
   records a day it is FIVE DAYS, in a quiet month it is two, and nobody can
   tell which they are looking at. Worse, the cut moves every time somebody
   saves a job — the day it falls in the middle of is a different day each
   morning, so a record visible at breakfast is gone by lunch.

   It could not simply be raised, because the read was `select('*')` and that
   carries gps_track: every point walked, hundreds to a record. THAT is why
   the cap existed. The worker portal's own read had already worked this out
   (worker_maint_records in shared/create_worker_portal.sql lists its columns
   and says in as many words that the track is deliberately not among them);
   this is the FC portal's half of the same rule.

   So three things have to stay true, and each is a case below:

     · the list read must not ask for gps_track — the moment it does, the
       window has to shrink again and the fault is back;
     · the window must be a DATE, not a row count;
     · the offline cache must hold the same window, or a conductor with no
       signal is back to three days.

   Needs nothing but node:  node tests/history_is_a_window_not_a_count.cjs */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const data    = read('src', 'modules', 'maintenance', 'data.js');
const offline = read('src', 'modules', 'maintenance', 'offline.js');
const worker  = read('src', 'worker', 'workerMaintSource.js');

let pass = 0, fail = 0;
const is = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + what + ' → ' + a); }
  else { fail++; console.log('  FAIL ' + what + '\n         got  ' + a + '\n         want ' + b); }
};

// The column lists and the window numbers, lifted from the file rather than
// restated here — a test that keeps its own copy of the answer passes while
// the code is wrong.
// `scope` carries the ones that refer to each other — REC_COLS is written as
// REC_CORE plus the migrated columns, which is the point of it.
const grabConst = (src, name, scope) => {
  const i = src.indexOf('const ' + name);
  if (i < 0) throw new Error('could not find ' + name + ' — renamed?');
  const j = src.indexOf(';', i);
  const names = Object.keys(scope || {});
  return new Function(...names,
    'return (' + src.slice(src.indexOf('=', i) + 1, j) + ')')(...names.map((n) => scope[n]));
};

const REC_CORE   = grabConst(data, 'REC_CORE');
const REC_COLS   = grabConst(data, 'REC_COLS', { REC_CORE });
const REC_DAYS   = grabConst(data, 'REC_DAYS');
const MAX_RECORDS = grabConst(offline, 'MAX_RECORDS');

console.log('\n── 1. The list read leaves the walk behind ──');
is('the full column list does not name gps_track', /gps_track/.test(REC_COLS), false);
is('nor does the fallback list',                   /gps_track/.test(REC_CORE), false);
is('but it does carry the summary the cards draw',
  ['gps_points', 'gps_distance_m', 'gps_started_at'].every((c) => REC_COLS.includes(c)), true);
is('and the whole-row select is gone',
  /from\('nops_maint_field_records'\)\s*\n?\s*\.select\('\*'\)/.test(data), false);

console.log('\n── 2. The window is a date, and a generous one ──');
is('no five-hundred-row cap on the records read', /\.limit\(500\)/.test(data), false);
is('the read is filtered on work_date',           /work_date\.gte\./.test(data), true);
is('an undated record is kept whatever the window says',
  /work_date\.is\.null/.test(data), true);
is('the window is at least two months', REC_DAYS >= 60, true);

// The date the window starts from, worked out by the real helper.
const recSince = new Function('days', data.slice(
  data.indexOf('function recSince('), data.indexOf('\n}', data.indexOf('function recSince(')) + 2
) + '\nreturn recSince(days);');
const since = recSince(REC_DAYS);
const days = Math.round((Date.now() - Date.parse(since)) / 86400000);
is('recSince(' + REC_DAYS + ') lands ' + REC_DAYS + ' days back (' + since + ')',
  Math.abs(days - REC_DAYS) <= 1, true);
is('and it is a plain YYYY-MM-DD, which is what PostgREST compares',
  /^\d{4}-\d{2}-\d{2}$/.test(since), true);

console.log('\n── 3. The track is fetched for the one record somebody opens ──');
is('data.js exports loadTrack', /export async function loadTrack\(/.test(data), true);
is('it answers the shape the worker RPC already answers',
  ['track:', 'points:', 'distance_m:', 'started_at:', 'ended_at:']
    .every((k) => data.includes(k)), true);

console.log('\n── 4. The offline copy holds the same window ──');
is('the cache keeps thousands of rows, not hundreds', MAX_RECORDS >= 2000, true);
is('and it still strips the tracks, which is what makes a row small',
  /k === 'gps_track'/.test(offline), true);

console.log('\n── 5. The worker portal asks for all its function will give ──');
is('not five hundred', /maintRecords\(token, 500\)/.test(worker), false);
is('but two thousand',  /maintRecords\(token, 2000\)/.test(worker), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

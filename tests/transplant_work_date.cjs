/* A transplanting record is paid in the month the WORK was done.

   It used to be paid in the month the board happened to be showing, with
   `today` saved as the date. That is right only while a conductor records a
   job the same month he does it, and he does not always: September's work
   keyed in October filed itself under October. September's salary claim was
   short by it, October's carried work nobody did in October, and nothing on
   either screen could say so — the record held no date but the day it was
   keyed, so the real one was nowhere.

   Two things are checked here. The RULE, by running the real month function
   over real dates; and the WIRING, by reading the source that ships — the
   form keys a date, the save derives the month from it, and an edit that
   moves the month updates the row by id instead of upserting, because the
   conflict key has the month in it and an upsert would leave the old month's
   row standing and pay the job twice.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/transplant_work_date.cjs
   No build, no browser and no server needed.                               */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
function checkTrue(name, got) { check(name, !!got, true); }
function checkFalse(name, got) { check(name, !!got, false); }

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

(async () => {
  console.log('\nThe month a date is paid in');
  const { monthLabelOf } = await import(
    'file://' + path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'schedule.js'));
  check('a September day is September', monthLabelOf('2026-09-28'), 'Sep 2026');
  check('…even keyed on the 1st of October', monthLabelOf('2026-09-30'), 'Sep 2026');
  check('the 1st of October is October', monthLabelOf('2026-10-01'), 'Oct 2026');
  check('the last day of the year', monthLabelOf('2026-12-31'), 'Dec 2026');
  check('…and the first of the next', monthLabelOf('2027-01-01'), 'Jan 2027');
  check('a date with a time on it still answers', monthLabelOf('2026-09-03T08:14:00Z'), 'Sep 2026');
  check('nothing answers nothing, rather than guessing this month',
        monthLabelOf(''), '');

  console.log('\nThe form asks when');
  const sheet = read('modules', 'maintenance', 'TransplantSheet.jsx');
  checkTrue('there is a date field', /const \[date, setDate\] = useState/.test(sheet));
  checkTrue('…defaulting to the record’s own date where there is one',
            /existing && existing\.work_date/.test(sheet));
  checkTrue('…and to today otherwise', /\|\| today \|\| ''/.test(sheet));
  checkTrue('it is on screen as a date input', /type="date"/.test(sheet));
  checkTrue('…shut on a record this person may not reopen',
            /type="date"[\s\S]{0,120}readOnly=\{locked\}/.test(sheet));
  checkTrue('…and bounded to the window the sheet can read back, so a date '
          + 'that would hide the record cannot be keyed',
            /min=\{TRANSPLANT_FLOW_FROM\} max=\{today\}/.test(sheet));
  checkTrue('the month it will be paid in is PRINTED, not left to be worked out',
            /t\('tp\.paidIn', \{ m: monthLabelOf\(date\) \}\)/.test(sheet));
  checkTrue('…and flagged when it is not this month',
            /date\.slice\(0, 7\) !== today\.slice\(0, 7\)/.test(sheet));
  checkTrue('Save will not go without a date', /const balanced = !!date/.test(sheet));

  console.log('\nThe save follows the date, not the board');
  checkTrue('the month is derived from the keyed date',
            /month: monthLabelOf\(when\)/.test(sheet));
  checkTrue('…and the date saved is that date', /date: when/.test(sheet));
  checkFalse('the board’s month is no longer what gets saved',
             /nursery, month, date: today/.test(sheet));
  checkTrue('the form hands the save the date', /\n\s+date,\n/.test(sheet));
  checkTrue('…and which record it is editing',
            /id: existing && existing\.id/.test(sheet));

  console.log('\nMoving a record to another month does not duplicate it');
  const data = read('modules', 'maintenance', 'transplantData.js');
  checkTrue('a known row is updated by id', /rec\.id\s*\n?\s*\?\s*await supabase\.from\(TABLE\)\.update\(row\)\.eq\('id', rec\.id\)/.test(data));
  checkTrue('…and only a new one is upserted',
            /:\s*await supabase\.from\(TABLE\)\.upsert\(row, \{ onConflict: 'plot_name,work_type,schedule_month' \}\)/.test(data));
  checkTrue('and the reason is written down where the next person will read it',
            /conflict key has the month in it/i.test(data));

  console.log('\nBoth languages');
  const i18n = read('i18n.js');
  ['tp.whenDone', 'tp.paidIn', 'tp.whenHint'].forEach((k) => {
    check(`${k} is in en and ms`,
          (i18n.match(new RegExp(`'${k.replace('.', '\\.')}':`, 'g')) || []).length, 2);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

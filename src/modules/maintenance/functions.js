/**
 * What "Maintenance" is made of, written down once.
 *
 * The board used to be one tick — you had Maintenance or you did not. It is
 * really two jobs with a form between them: reading the office's plan for the
 * month, and recording a morning's work against it. And the record form itself
 * is five separate things, not all of which every nursery wants keyed.
 *
 * So each of those is its own switch, and this file is the list. It is used in
 * three places and must stay one list:
 *
 *   555 FC Portal → Manage → Setting        (scan/scan_user_access.html)
 *   555 Worker Portal → Settings            (worker/WorkerSettings.jsx)
 *   the board itself                        (MaintenanceModule and its sheets)
 *
 * The office screen lives in the other repository and carries its own copy of
 * the keys and the defaults below. Change one, change the other — the comment
 * there says the same thing back.
 */

import { canScan } from '../../lib/access.js';
import { isCompanyOn, isVetoed } from '../../lib/portalSettings.js';

/**
 * What each switch means when nobody has said.
 *
 * Everything is ON by default, so this change takes nothing away from anybody:
 * a Field Conductor whose access was saved before these switches existed has
 * no entry for `batches` at all, and reading that as "off" would empty his
 * record form on the morning of the deploy.
 *
 * GPS is the one exception and is OFF unless it is deliberately ticked. It
 * asks the phone for a location — a permission prompt, and a position stored
 * against a person's name — and that is not something to switch on for the
 * whole estate because a new version shipped.
 *
 * `record` is here for a reason worth writing down. It used to be a tick on
 * the per-person screen and was read with the older canScan rule, which is
 * all-or-nothing per page: once a person's maintenance entry exists, anything
 * not named in it is OFF. When the tick moved to System Setting the office
 * screen stopped seeding the key — and every row saved after that lost Record
 * Work, permanently, with no tick left anywhere to give it back. Switching
 * "Record work" ON for the company did not help either: canScan never reads
 * the company's ON, only its veto, so the switch could turn recording off and
 * never on again.
 *
 * Naming it here is what makes it answerable: canMaintFn asks the company,
 * then the person, then this. An absent answer is "nobody has been asked",
 * which for recording work is the whole job.
 */
export const MAINT_FUNCTION_DEFAULT = {
  schedule: true,
  record:   true,
  batches:  true,
  workers:  true,
  gps:      false,
  photos:   true,
  remark:   true,
};

/**
 * The switches, in the order they are shown, with the record form's five
 * nested underneath it. `label` is an i18n key; the office screen spells its
 * own labels out because that page is English only.
 */
export const MAINT_FUNCTIONS = [
  { key: 'schedule', icon: '📅', label: 'wk.fnSchedule' },
  {
    key: 'record',
    icon: '📝',
    label: 'wk.fnRecord',
    children: [
      { key: 'batches', icon: '🌱', label: 'wk.fnBatches' },
      { key: 'workers', icon: '👷', label: 'wk.fnWorkers' },
      { key: 'gps',     icon: '📍', label: 'wk.fnGps' },
      /* This was the one switch stored but not acted on for a worker, and it
         is not any more. A PIN sign-in is `anon` and the anon key is public,
         so the documents bucket could not simply be opened to it; photos go
         up through a ticket the database mints against the worker's own
         token instead. See workerMaintSource.uploadPhotos, and
         shared/RUN_ME_worker_photos.sql in the office repository. */
      { key: 'photos',  icon: '📷', label: 'wk.fnPhotos' },
      { key: 'remark',  icon: '✏️', label: 'wk.fnRemark' },
    ],
  },
];

/**
 * Is this function switched on for this person?
 *
 * `verify` and `export` are older ticks and keep their own rule — canScan /
 * canMaintain — because changing what an absent one means would change access
 * that is already saved, and both are still ticks on the per-person screen so
 * they are still seeded there. `record` is NOT: its tick moved to System
 * Setting, nothing seeds it any more, and under the older rule an unseeded key
 * reads as no. It is answered here now. This answers for the switches above:
 * absent means the documented default, present means what it says.
 *
 * A closed page closes every function inside it, the same way canScan does.
 */
export function canMaintFn(permissions, key) {
  if (!canScan(permissions, 'maintenance', 'view')) return false;

  /* The company's switch, in the only order that makes all three layers say
     what they look like they say:

       1. switched OFF by the company   → off, whatever anybody else says
       2. this person has an answer     → that answer
       3. switched ON by the company    → on, for anybody never asked
       4. nobody has said anything      → the documented default

     Two and three that way round is the whole point: a master switch decides
     for the people nobody has decided about, and does not overrule the ones
     somebody has. */
  if (isVetoed(permissions, 'maintenance', key)) return false;

  const acts = (permissions && permissions.scan_actions && permissions.scan_actions.maintenance) || {};
  const v = acts[key];
  if (v !== undefined) return !!v;

  if (isCompanyOn(permissions, 'maintenance', key)) return true;
  return MAINT_FUNCTION_DEFAULT[key] === true;
}

/**
 * May this person change or remove a record that is already saved?
 *
 * `edit` and `delete` are two ticks on Setting → a person → Maintenance, and
 * they are deliberately separate: correcting a figure and making a morning's
 * record disappear are different acts, and somebody trusted to fix a typo is
 * not automatically somebody trusted to erase the row.
 *
 * THE ONLY THING THAT SAYS YES IS THE TICK. This is the one rule in the file
 * that does not fail open, and the exception is deliberate.
 *
 * Everything else here answers an absent switch with "nobody has been asked",
 * because a deploy must not take away access somebody already relies on. That
 * reasoning does not survive contact with Delete. An unticked box that still
 * lets somebody erase a month of records is the screen lying in the direction
 * that costs data, and there is no reading of a blank answer that should mean
 * "yes, remove it". So absent is off, the box shows off, and the two agree.
 *
 * What this changes: correcting a record used to fall to whoever ran the
 * Operation module, without a tick anywhere saying so. Anybody who was
 * relying on that now needs Edit work done ticked on their row — which is the
 * point, because now the screen shows who can.
 *
 * A closed page closes both, the same way canScan does.
 */
export function canMaintCorrect(permissions, key) {
  if (!canScan(permissions, 'maintenance', 'view')) return false;
  const acts = (permissions && permissions.scan_actions && permissions.scan_actions.maintenance) || {};
  return acts[key] === true;
}

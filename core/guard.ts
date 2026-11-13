/** Logging a dose, and the double-dose guard in front of it. */

import { type CivilDate, type CivilDateTime, minutesBetween } from './civil.ts';
import { type Entry, type EntryId, lastFor, type Log, push } from './log.ts';
import { err, ok, type Result } from './result.ts';
import { findMed, findSlot, guardHours, type MedId, type Schedule, type SlotId } from './schedule.ts';
import { statusOf } from './status.ts';

/** Whether giving `med` now would land too close to its last dose. */
export type Guard =
  | { readonly kind: 'clear' }
  /** `entry` was given `minutesAgo` minutes ago, inside the med's guard hours. */
  | { readonly kind: 'recent'; readonly entry: Entry; readonly minutesAgo: number };

export function guard(schedule: Schedule, log: Log, med: MedId, now: CivilDateTime): Guard {
  const m = findMed(schedule, med);
  const last = m && lastFor(log, med, now);
  if (!m || !last) return { kind: 'clear' };
  const ago = minutesBetween(last.at, now);
  return ago < guardHours(m) * 60 ? { kind: 'recent', entry: last, minutesAgo: ago } : { kind: 'clear' };
}

export type LogError =
  | { readonly kind: 'unknownDose' }
  | { readonly kind: 'alreadyLogged'; readonly entry: Entry }
  | { readonly kind: 'tooSoon'; readonly entry: Entry; readonly minutesAgo: number }
  | { readonly kind: 'notOpenYet'; readonly opensIn: number }
  | { readonly kind: 'closed' };

export interface DoseRef {
  readonly med: MedId;
  readonly slot: SlotId;
  readonly day: CivilDate;
}

/**
 * Logs `med`'s `slot` dose for `day`, given at `now` by `by`.
 *
 * Refuses a slot already logged, one whose window isn't open or has closed, and — unless
 * `overrideGuard` — a dose inside the med's guard hours (`tooSoon`). The UI shows `tooSoon` as a
 * confirmation; a second, deliberate tap passes `overrideGuard`. On a refusal there is no new log.
 */
export function logDose(
  schedule: Schedule,
  log: Log,
  dose: DoseRef,
  now: CivilDateTime,
  by: string,
  overrideGuard: boolean,
): Result<{ log: Log; id: EntryId }, LogError> {
  const m = findMed(schedule, dose.med);
  const s = m && findSlot(m, dose.slot);
  if (!m || !s) return err({ kind: 'unknownDose' });
  const status = statusOf(schedule, log, m, s, dose.day, now);
  switch (status.kind) {
    case 'given':
      return err({ kind: 'alreadyLogged', entry: status.entry });
    case 'upcoming':
      return err({ kind: 'notOpenYet', opensIn: status.opensIn });
    case 'missed':
      return err({ kind: 'closed' });
    case 'due':
    case 'overdue':
      break;
  }
  if (!overrideGuard) {
    const g = guard(schedule, log, dose.med, now);
    if (g.kind === 'recent') return err({ kind: 'tooSoon', entry: g.entry, minutesAgo: g.minutesAgo });
  }
  return ok(push(log, { med: dose.med, slot: dose.slot, day: dose.day, at: now, by }));
}

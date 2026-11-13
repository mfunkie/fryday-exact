/** Per-day completion and the streak. */

import { addDays, type CivilDate, type CivilDateTime, dateOf, yesterday } from './civil.ts';
import { findEntry, type Log } from './log.ts';
import { occurrences, perDay, type Schedule } from './schedule.ts';
import { plan } from './status.ts';

/** How one day went. */
export interface DayRecord {
  readonly day: CivilDate;
  readonly given: number;
  readonly expected: number;
}

export const isComplete = (r: DayRecord) => r.expected > 0 && r.given >= r.expected;
export const fraction = (r: DayRecord) => (r.expected === 0 ? 0 : Math.min(1, r.given / r.expected));

function record(schedule: Schedule, log: Log, day: CivilDate): DayRecord {
  const given = occurrences(schedule, day).filter(({ med, slot }) => findEntry(log, med.id, slot.id, day)).length;
  return { day, given, expected: perDay(schedule) };
}

/** The last `days` days ending on `today`, oldest first. */
export function history(schedule: Schedule, log: Log, today: CivilDate, days: number): DayRecord[] {
  return Array.from({ length: days }, (_, i) => record(schedule, log, addDays(today, i - days + 1)));
}

/** Whether any of `day`'s doses can still be given at `now` (upcoming or open). */
function inProgress(schedule: Schedule, log: Log, day: CivilDate, now: CivilDateTime): boolean {
  return plan(schedule, log, day, now).some((d) => ['upcoming', 'due', 'overdue'].includes(d.status.kind));
}

/**
 * Consecutive complete days ending now. A day still in progress (today, or last night while its
 * late dose is still open) neither adds to the streak nor breaks it.
 */
export function streak(schedule: Schedule, log: Log, now: CivilDateTime): number {
  // Bounded by the log: no complete day can come before the earliest entry.
  if (log.entries.length === 0) return 0;
  const earliest = log.entries.reduce((d, e) => (e.day < d ? e.day : d), log.entries[0]!.day);
  let n = 0;
  for (let day = dateOf(now); day >= earliest; day = yesterday(day)) {
    if (isComplete(record(schedule, log, day))) n += 1;
    else if (!inProgress(schedule, log, day, now)) break;
  }
  return n;
}

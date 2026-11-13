/** Each scheduled dose's status at a moment. */

import {
  addMinutes,
  at as atTime,
  type CivilDate,
  type CivilDateTime,
  dateOf,
  minutesBetween,
  tomorrow,
  yesterday,
} from './civil.ts';
import { type Entry, findEntry, type Log } from './log.ts';
import { type Med, type MedId, type MedKind, occurrences, type Schedule, type Slot, type SlotId } from './schedule.ts';

/**
 * Where a scheduled dose stands at `now`.
 *
 * The lifecycle: `upcoming` → (window opens `earlyMin` before the slot) `due` → (`lateMin` after
 * it) `overdue` → (the same med's next slot opens) `missed`. A dose can be logged while `due` or
 * `overdue`, and is then `given` for good. Closing a dose when the next one opens keeps a late
 * morning dose from being given on top of the evening one.
 */
export type DoseStatus =
  /** The window opens in `opensIn` minutes. */
  | { readonly kind: 'upcoming'; readonly opensIn: number }
  /** Inside the window; `minutesLate` is negative while early. */
  | { readonly kind: 'due'; readonly minutesLate: number }
  /** Past the window but still loggable. */
  | { readonly kind: 'overdue'; readonly minutesLate: number }
  | { readonly kind: 'given'; readonly entry: Entry }
  /** Closed without a dose. */
  | { readonly kind: 'missed' };

export const isOpen = (s: DoseStatus): s is Extract<DoseStatus, { kind: 'due' | 'overdue' }> =>
  s.kind === 'due' || s.kind === 'overdue';

/** One scheduled dose and its status. */
export interface Dose {
  readonly med: MedId;
  readonly medName: string;
  readonly kind: MedKind;
  readonly note?: string;
  readonly slot: SlotId;
  readonly slotLabel: string;
  readonly day: CivilDate;
  readonly scheduled: CivilDateTime;
  readonly status: DoseStatus;
}

/** When the dose of `med` after the one scheduled at `at` opens. */
function nextOpening(schedule: Schedule, med: Med, at: CivilDateTime): CivilDateTime | undefined {
  const day = dateOf(at);
  const laterToday = med.slots.map((s) => atTime(day, s.at)).filter((t) => t > at);
  const firstTomorrow = med.slots.map((s) => atTime(tomorrow(day), s.at));
  const pool = laterToday.length > 0 ? laterToday : firstTomorrow;
  if (pool.length === 0) return undefined;
  return addMinutes(Math.min(...pool) as CivilDateTime, -schedule.window.earlyMin);
}

export function statusOf(
  schedule: Schedule,
  log: Log,
  med: Med,
  slot: Slot,
  day: CivilDate,
  now: CivilDateTime,
): DoseStatus {
  const entry = findEntry(log, med.id, slot.id, day);
  if (entry) return { kind: 'given', entry };
  const at = atTime(day, slot.at);
  const late = minutesBetween(at, now);
  const { earlyMin, lateMin } = schedule.window;
  if (late < -earlyMin) return { kind: 'upcoming', opensIn: -late - earlyMin };
  const close = nextOpening(schedule, med, at);
  if (close !== undefined && now >= close) return { kind: 'missed' };
  return late <= lateMin ? { kind: 'due', minutesLate: late } : { kind: 'overdue', minutesLate: late };
}

/** Every dose scheduled on `day`, earliest first, with its status at `now`. */
export function plan(schedule: Schedule, log: Log, day: CivilDate, now: CivilDateTime): Dose[] {
  return occurrences(schedule, day).map(({ med, slot, at }) => ({
    med: med.id,
    medName: med.name,
    kind: med.kind,
    ...(med.note !== undefined && { note: med.note }),
    slot: slot.id,
    slotLabel: slot.label,
    day,
    scheduled: at,
    status: statusOf(schedule, log, med, slot, day, now),
  }));
}

const RANK: Record<DoseStatus['kind'], number> = { overdue: 0, due: 1, upcoming: 2, given: 3, missed: 3 };

/**
 * The dose to show in the hero: the most urgent open dose (overdue before due, earliest first),
 * else the next upcoming one today, else tomorrow's first. Yesterday's late-evening dose still
 * counts while it's open.
 */
export function nextUp(schedule: Schedule, log: Log, now: CivilDateTime): Dose | undefined {
  const today = dateOf(now);
  const doses = [
    ...plan(schedule, log, yesterday(today), now).filter((d) => isOpen(d.status)),
    ...plan(schedule, log, today, now),
  ].filter((d) => RANK[d.status.kind] < 3);
  doses.sort((a, b) => RANK[a.status.kind] - RANK[b.status.kind] || a.scheduled - b.scheduled);
  return doses[0] ?? plan(schedule, log, tomorrow(today), now)[0];
}

/**
 * Named states for screenshots and tests, the same six as the Rune app's `scenes.rs`. Each pins
 * the clock and builds its log through `logDose`, so every entry in a scene passed the same
 * checks a tap does. `/?scene=<name>` opens the app in one, on its own storage file.
 */

import { addDays, at, type CivilDate, type CivilDateTime, date, time, tomorrow, weekday } from './civil.ts';
import { logDose } from './guard.ts';
import { emptyLog, type Log } from './log.ts';
import { medId, type Schedule, slotId } from './schedule.ts';

/** Scenes render on this Friday. */
export const DAY = date(2026, 11, 6);

export interface Scene {
  readonly now: CivilDateTime;
  readonly log: Log;
}

function give(s: Schedule, log: Log, med: string, slot: string, day: CivilDate, h: number, m: number, by: string): Log {
  const r = logDose(s, log, { med: medId(med), slot: slotId(slot), day }, at(day, time(h, m)), by, false);
  if (!r.ok) throw new Error(`scene dose ${med}/${slot} on ${day} refused: ${r.error.kind}`);
  return r.value.log;
}

/** Full days before `DAY`, `back` of them, leaving out the days `gaps` back; Jess covers weekday mornings. */
function history(s: Schedule, back: number, gaps: readonly number[]): Log {
  let log = emptyLog;
  for (let n = back; n >= 1; n--) {
    if (gaps.includes(n)) continue;
    const day = addDays(DAY, -n);
    const morning = weekday(day) <= 4 ? 'Jess' : 'You';
    log = give(s, log, 'insulin', 'am', day, 7, 8, morning);
    log = give(s, log, 'amlodipine', 'am', day, 7, 10, morning);
    log = give(s, log, 'insulin', 'pm', day, 19, 4, 'You');
  }
  return log;
}

/** The morning doses as Jess gave them on `DAY`. */
const jessMorning = (s: Schedule, log: Log) =>
  give(s, give(s, log, 'insulin', 'am', DAY, 7, 12, 'Jess'), 'amlodipine', 'am', DAY, 7, 14, 'Jess');

export const SCENES = {
  /** 7:20 AM: both morning doses due, nothing logged yet. An 11-day streak. */
  morning: (s: Schedule): Scene => ({ now: at(DAY, time(7, 20)), log: history(s, 13, [12]) }),
  /** 1:05 PM: Jess gave both morning doses; counting down to the evening insulin. */
  afternoon: (s: Schedule): Scene => ({ now: at(DAY, time(13, 5)), log: jessMorning(s, history(s, 13, [12])) }),
  /** 7:02 PM: the morning insulin went in late (1:30 PM), so Give on the evening dose trips the guard. */
  guard: (s: Schedule): Scene => {
    let log = give(s, history(s, 13, [12]), 'amlodipine', 'am', DAY, 7, 14, 'Jess');
    log = give(s, log, 'insulin', 'am', DAY, 13, 30, 'Jess');
    return { now: at(DAY, time(19, 2)), log };
  },
  /** 8:40 PM: the evening insulin is 1h 40m late; the backdrop and orb turn coral. */
  late: (s: Schedule): Scene => ({ now: at(DAY, time(20, 40)), log: jessMorning(s, history(s, 13, [12])) }),
  /** 7:06 PM: the evening dose just logged. Everything's done; the streak ticks up. */
  done: (s: Schedule): Scene => ({
    now: at(DAY, time(19, 6)),
    log: give(s, jessMorning(s, history(s, 13, [12])), 'insulin', 'pm', DAY, 19, 6, 'You'),
  }),
  /** 12:35 AM Saturday: last night's insulin was never logged and is still open. */
  midnight: (s: Schedule): Scene => ({ now: at(tomorrow(DAY), time(0, 35)), log: jessMorning(s, history(s, 13, [12])) }),
} as const satisfies Record<string, (s: Schedule) => Scene>;

export type SceneName = keyof typeof SCENES;
export const isScene = (name: string): name is SceneName => Object.hasOwn(SCENES, name);

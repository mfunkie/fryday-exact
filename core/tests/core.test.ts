/**
 * Behaviour tests for the domain, written as the situations the app has to get right — the same
 * situations, by name, as the Rune app's `fryday-core/src/tests.rs` — plus property tests for the
 * invariants every situation shares.
 */

import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  addDays,
  at as atDay,
  type CivilDate,
  type CivilDateTime,
  date,
  dateOf,
  type DoseStatus,
  emptyLog,
  type EntryId,
  findMed,
  findSlot,
  formatMinutes,
  formatTime,
  fraction,
  fry,
  guard,
  guardHours,
  history,
  lastLogged,
  type Log,
  logDose,
  logFromJson,
  logToJson,
  medId,
  minutesBetween,
  nextUp,
  perDay,
  plan,
  type Schedule,
  scheduleFromJson,
  scheduleToJson,
  slotId,
  streak,
  time,
  tomorrow,
  undo,
  validate,
  yesterday,
} from '../index.ts';

const DAY = date(2026, 11, 6);
const at = (h: number, m = 0) => atDay(DAY, time(h, m));

function give(s: Schedule, log: Log, med: string, slot: string, day: CivilDate, now: CivilDateTime, by = 'You') {
  const r = logDose(s, log, { med: medId(med), slot: slotId(slot), day }, now, by, false);
  if (!r.ok) throw new Error(`dose refused: ${JSON.stringify(r.error)}`);
  return r.value;
}

function status(s: Schedule, log: Log, med: string, slot: string, now: CivilDateTime): DoseStatus {
  const d = plan(s, log, dateOf(now), now).find((x) => x.med === med && x.slot === slot);
  if (!d) throw new Error('not scheduled');
  return d.status;
}

// ------------------------------------------------------------------ schedule

test('the default schedule is valid and round-trips through JSON', () => {
  const s = fry();
  expect(validate(s).ok).toBe(true);
  expect(scheduleFromJson(scheduleToJson(s))).toEqual({ ok: true, value: s });
  expect(perDay(s)).toBe(3);
});

test('validation names what is wrong', () => {
  const base = fry();
  const dupMed = { ...base, meds: [base.meds[0]!, { ...base.meds[1]!, id: medId('insulin') }] };
  expect(validate(dupMed)).toEqual({ ok: false, error: { kind: 'duplicateMed', med: 'insulin' } });
  const ins = base.meds[0]!;
  const dupSlot = { ...base, meds: [{ ...ins, slots: [ins.slots[0]!, { ...ins.slots[1]!, id: slotId('am') }] }] };
  expect(validate(dupSlot)).toMatchObject({ ok: false, error: { kind: 'duplicateSlot' } });
  expect(validate({ ...base, meds: [] })).toMatchObject({ error: { kind: 'noMeds' } });
  expect(validate({ ...base, caregivers: [] })).toMatchObject({ error: { kind: 'noCaregivers' } });
  expect(validate({ ...base, window: { earlyMin: 400, lateMin: 400 } })).toMatchObject({
    error: { kind: 'windowTooWide', minutes: 800 },
  });
  expect(scheduleFromJson('{')).toMatchObject({ error: { kind: 'parse' } });
});

test('the Rune app’s documented example schedule parses here too', () => {
  const json = readFileSync(join(__dirname, 'fixtures/schedule.example.json'), 'utf8');
  const r = scheduleFromJson(json);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const aml = findMed(r.value, medId('amlodipine'));
  expect(aml && guardHours(aml)).toBe(6);
  expect(r.value.meds[0]!.slots[1]!.at).toBe(time(19));
});

// ------------------------------------------------------------------ status lifecycle

test('a dose moves from upcoming to due to overdue to missed', () => {
  const s = fry();
  expect(status(s, emptyLog, 'insulin', 'am', at(5, 30))).toEqual({ kind: 'upcoming', opensIn: 30 });
  expect(status(s, emptyLog, 'insulin', 'am', at(6))).toEqual({ kind: 'due', minutesLate: -60 });
  expect(status(s, emptyLog, 'insulin', 'am', at(8))).toEqual({ kind: 'due', minutesLate: 60 });
  expect(status(s, emptyLog, 'insulin', 'am', at(8, 1))).toEqual({ kind: 'overdue', minutesLate: 61 });
  expect(status(s, emptyLog, 'insulin', 'am', at(17, 59))).toEqual({ kind: 'overdue', minutesLate: 659 });
  // The evening dose's window opens at 6 PM, which closes the morning one.
  expect(status(s, emptyLog, 'insulin', 'am', at(18))).toEqual({ kind: 'missed' });
});

test('a once-daily med stays loggable until tomorrow’s window opens', () => {
  const s = fry();
  expect(status(s, emptyLog, 'amlodipine', 'am', at(23, 30)).kind).toBe('overdue');
  const tomorrowEarly = atDay(tomorrow(DAY), time(6));
  const aml = plan(s, emptyLog, DAY, tomorrowEarly).find((d) => d.med === 'amlodipine');
  expect(aml?.status).toEqual({ kind: 'missed' });
});

test('a logged dose reads as given with who and when', () => {
  const s = fry();
  const { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(7, 5), 'Jess');
  const st = status(s, log, 'insulin', 'am', at(9));
  expect(st).toMatchObject({ kind: 'given', entry: { by: 'Jess', at: at(7, 5) } });
});

test('next up prefers overdue, then due, then upcoming', () => {
  const s = fry();
  // 8:30: both morning doses overdue; insulin comes first (schedule order breaks the tie).
  expect(nextUp(s, emptyLog, at(8, 30))).toMatchObject({ med: 'insulin', slot: 'am' });
  let { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(8, 30));
  expect(nextUp(s, log, at(8, 31))).toMatchObject({ med: 'amlodipine', status: { kind: 'overdue' } });
  ({ log } = give(s, log, 'amlodipine', 'am', DAY, at(8, 31)));
  expect(nextUp(s, log, at(9))).toMatchObject({ med: 'insulin', slot: 'pm', status: { kind: 'upcoming' } });
});

test('next up rolls to tomorrow once today is done', () => {
  const s = fry();
  let log = emptyLog;
  ({ log } = give(s, log, 'insulin', 'am', DAY, at(7)));
  ({ log } = give(s, log, 'amlodipine', 'am', DAY, at(7)));
  ({ log } = give(s, log, 'insulin', 'pm', DAY, at(19)));
  expect(nextUp(s, log, at(21))).toMatchObject({ day: tomorrow(DAY), slot: 'am' });
});

test('last night’s dose is still next up after midnight', () => {
  const s = fry();
  let log = emptyLog;
  ({ log } = give(s, log, 'insulin', 'am', DAY, at(7)));
  ({ log } = give(s, log, 'amlodipine', 'am', DAY, at(7)));
  const n = nextUp(s, log, atDay(tomorrow(DAY), time(0, 35)));
  expect(n).toMatchObject({ med: 'insulin', slot: 'pm', day: DAY, status: { kind: 'overdue', minutesLate: 335 } });
});

// ------------------------------------------------------------------ logging and the guard

test('the same slot cannot be logged twice', () => {
  const s = fry();
  const { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(7), 'Jess');
  const again = logDose(s, log, { med: medId('insulin'), slot: slotId('am'), day: DAY }, at(7, 30), 'You', true);
  expect(again).toMatchObject({ ok: false, error: { kind: 'alreadyLogged', entry: { by: 'Jess' } } });
});

test('insulin inside the guard hours needs an override', () => {
  const s = fry();
  // A very late morning dose...
  const { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(13), 'Jess');
  // ...makes the on-time evening dose only six hours later.
  const pm = { med: medId('insulin'), slot: slotId('pm'), day: DAY };
  expect(logDose(s, log, pm, at(19), 'You', false)).toMatchObject({
    ok: false,
    error: { kind: 'tooSoon', minutesAgo: 360 },
  });
  expect(guard(s, log, medId('insulin'), at(19))).toMatchObject({ kind: 'recent', minutesAgo: 360 });
  // A deliberate second tap goes through.
  const r = logDose(s, log, pm, at(19), 'You', true);
  expect(r.ok && r.value.log.entries.length).toBe(2);
});

test('the guard clears after its hours', () => {
  const s = fry();
  const { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(7));
  expect(guard(s, log, medId('insulin'), at(14, 59)).kind).toBe('recent');
  expect(guard(s, log, medId('insulin'), at(15)).kind).toBe('clear');
});

test('a dose cannot be logged before its window or after it closes', () => {
  const s = fry();
  const ref = (med: string, slot: string) => ({ med: medId(med), slot: slotId(slot), day: DAY });
  expect(logDose(s, emptyLog, ref('insulin', 'pm'), at(12), 'You', true)).toEqual({
    ok: false,
    error: { kind: 'notOpenYet', opensIn: 360 },
  });
  expect(logDose(s, emptyLog, ref('insulin', 'am'), at(18, 30), 'You', true)).toEqual({
    ok: false,
    error: { kind: 'closed' },
  });
  expect(logDose(s, emptyLog, ref('vitamins', 'am'), at(7), 'You', true)).toEqual({
    ok: false,
    error: { kind: 'unknownDose' },
  });
});

test('undo takes back the last tap', () => {
  const s = fry();
  let { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(7));
  const second = give(s, log, 'amlodipine', 'am', DAY, at(7, 1));
  log = second.log;
  expect(lastLogged(log)?.id).toBe(second.id);
  log = undo(log, second.id);
  expect(status(s, log, 'amlodipine', 'am', at(7, 2)).kind).toBe('due');
  const again = give(s, log, 'amlodipine', 'am', DAY, at(7, 3));
  expect(again.id).not.toBe(second.id); // ids are never reused
});

// ------------------------------------------------------------------ history

function fullDay(s: Schedule, log: Log, day: CivilDate): Log {
  const t = (h: number) => atDay(day, time(h, 5));
  log = give(s, log, 'insulin', 'am', day, t(7)).log;
  log = give(s, log, 'amlodipine', 'am', day, t(7)).log;
  return give(s, log, 'insulin', 'pm', day, t(19)).log;
}

test('the streak counts complete days and waits for today', () => {
  const s = fry();
  let log = emptyLog;
  for (let i = 5; i >= 1; i--) log = fullDay(s, log, addDays(DAY, -i));
  expect(streak(s, log, at(9))).toBe(5); // today in progress doesn't break it
  log = fullDay(s, log, DAY);
  expect(streak(s, log, at(21))).toBe(6);
});

test('last night’s open dose doesn’t break the streak after midnight', () => {
  const s = fry();
  let log = emptyLog;
  for (let i = 4; i >= 1; i--) log = fullDay(s, log, addDays(DAY, -i));
  log = give(s, log, 'insulin', 'am', DAY, at(7)).log;
  log = give(s, log, 'amlodipine', 'am', DAY, at(7)).log;
  const saturday = tomorrow(DAY);
  expect(streak(s, log, atDay(saturday, time(0, 35)))).toBe(4); // Friday's evening dose is still open
  // Once Friday's evening dose closes unlogged, the streak breaks.
  expect(streak(s, log, atDay(saturday, time(6)))).toBe(0);
});

test('a gap resets the streak', () => {
  const s = fry();
  let log = fullDay(s, emptyLog, yesterday(DAY));
  log = fullDay(s, log, addDays(DAY, -3));
  expect(streak(s, log, at(9))).toBe(1);
});

test('history is oldest first and counts partial days', () => {
  const s = fry();
  const { log } = give(s, emptyLog, 'insulin', 'am', DAY, at(7));
  const h = history(s, log, DAY, 14);
  expect(h).toHaveLength(14);
  expect(h[13]).toEqual({ day: DAY, given: 1, expected: 3 });
  for (let i = 1; i < h.length; i++) expect(h[i - 1]!.day < h[i]!.day).toBe(true);
  expect(fraction(h[13]!)).toBeCloseTo(1 / 3);
});

// ------------------------------------------------------------------ persistence

test('the log round-trips through JSON', () => {
  const log = fullDay(fry(), emptyLog, DAY);
  expect(logFromJson(logToJson(log))).toEqual({ ok: true, value: log });
});

test('a log written by the Rune app reads here', () => {
  // What `fryday_core::store::to_json` writes (jiff civil date-times).
  const rune = `{"version":1,"entries":[{"id":0,"med":"insulin","slot":"pm","day":"2026-11-06","at":"2026-11-07T00:20:00","by":"Jess"}]}`;
  const r = logFromJson(rune);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.entries[0]).toMatchObject({ day: DAY, at: atDay(tomorrow(DAY), time(0, 20)), by: 'Jess' });
  expect(r.value.nextId).toBe(1);
});

test('a newer schema is refused rather than misread', () => {
  expect(logFromJson('{"version": 99, "entries": []}')).toEqual({ ok: false, error: { kind: 'tooNew', version: 99 } });
  expect(logFromJson('[]')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
});

test('formatting', () => {
  expect(formatMinutes(0)).toBe('0m');
  expect(formatMinutes(45)).toBe('45m');
  expect(formatMinutes(125)).toBe('2h 05m');
  expect(formatMinutes(-90)).toBe('1h 30m');
  expect(formatTime(time(0, 5))).toBe('12:05 AM');
  expect(formatTime(time(7))).toBe('7:00 AM');
  expect(formatTime(time(12, 30))).toBe('12:30 PM');
  expect(formatTime(time(19))).toBe('7:00 PM');
});

// ------------------------------------------------------------------ properties

/** A random sequence of taps: (minute of a 3-day span, med index, slot index, override). */
const taps = fc.array(
  fc.tuple(fc.integer({ min: 0, max: 3 * 24 * 60 - 1 }), fc.nat(1), fc.nat(1), fc.boolean()),
  { maxLength: 40 },
);
type Tap = [number, number, number, boolean];

function replay(s: Schedule, ts: Tap[]): Log {
  const start = atDay(DAY, time(0));
  let log = emptyLog;
  for (const [minute, mi, si, force] of [...ts].sort((a, b) => a[0] - b[0])) {
    const now = (start + minute) as CivilDateTime;
    const med = s.meds[mi % s.meds.length]!;
    const slot = med.slots[si % med.slots.length]!;
    // Try today's dose, then yesterday's (a late-evening dose after midnight).
    for (const day of [dateOf(now), yesterday(dateOf(now))]) {
      const r = logDose(s, log, { med: med.id, slot: slot.id, day }, now, 'You', force);
      if (r.ok) {
        log = r.value.log;
        break;
      }
    }
  }
  return log;
}

const s = fry();

test('property: no slot is ever logged twice', () => {
  fc.assert(
    fc.property(taps, (ts) => {
      const keys = replay(s, ts).entries.map((e) => `${e.med}/${e.slot}/${e.day}`);
      return new Set(keys).size === keys.length;
    }),
  );
});

test('property: without overrides, insulin doses are always guard hours apart', () => {
  fc.assert(
    fc.property(taps, (ts) => {
      const times = replay(s, ts.map(([m, mi, si]) => [m, mi, si, false] as Tap))
        .entries.filter((e) => e.med === 'insulin')
        .map((e) => e.at)
        .sort((a, b) => a - b);
      return times.every((t, i) => i === 0 || minutesBetween(times[i - 1]!, t) >= 8 * 60);
    }),
  );
});

test('property: every entry was logged inside its window', () => {
  fc.assert(
    fc.property(taps, (ts) =>
      replay(s, ts).entries.every((e) => {
        const slot = findSlot(findMed(s, e.med)!, e.slot)!;
        return minutesBetween(atDay(e.day, slot.at), e.at) >= -s.window.earlyMin;
      }),
    ),
  );
});

test('property: the streak never exceeds the days with entries', () => {
  fc.assert(
    fc.property(taps, (ts) => {
      const log = replay(s, ts);
      const end = (atDay(DAY, time(23, 59)) + 48 * 60) as CivilDateTime;
      return streak(s, log, end) <= new Set(log.entries.map((e) => e.day)).size;
    }),
  );
});

test('property: the log survives a JSON round trip', () => {
  fc.assert(
    fc.property(taps, (ts) => {
      const log = replay(s, ts);
      expect(logFromJson(logToJson(log))).toEqual({ ok: true, value: log });
    }),
  );
});

test('property: plan has one status per scheduled dose', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 24 * 60 - 1 }), taps, (minute, ts) => {
      const now = (atDay(DAY, time(0)) + minute) as CivilDateTime;
      return plan(s, replay(s, ts), DAY, now).length === perDay(s);
    }),
  );
});

test('property: entry ids stay unique through undo and redo', () => {
  fc.assert(
    fc.property(taps, fc.array(fc.nat(), { maxLength: 10 }), (ts, undos) => {
      let log = replay(s, ts);
      const seen = new Set<EntryId>(log.entries.map((e) => e.id));
      for (const u of undos) {
        const e = log.entries[u % Math.max(1, log.entries.length)];
        if (e) log = undo(log, e.id);
      }
      const r = logDose(s, log, { med: medId('insulin'), slot: slotId('am'), day: DAY }, at(7), 'You', true);
      return !r.ok || !seen.has(r.value.id);
    }),
  );
});

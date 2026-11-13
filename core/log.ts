/**
 * The dose log: what was given, for which scheduled slot, when and by whom.
 *
 * Unlike the Rust version's `&mut Log`, a `Log` here is immutable: every change returns a new
 * log, which is what React state wants and makes "the log is unchanged on a refusal" free.
 */

import type { CivilDate, CivilDateTime } from './civil.ts';
import type { MedId, SlotId } from './schedule.ts';

declare const brand: unique symbol;
export type EntryId = number & { readonly [brand]: 'EntryId' };

/**
 * One given dose. `day` and `slot` say which scheduled dose it fulfils; `at` is when it was
 * actually given, which can fall on another calendar day (a 7 PM slot given after midnight).
 */
export interface Entry {
  readonly id: EntryId;
  readonly med: MedId;
  readonly slot: SlotId;
  readonly day: CivilDate;
  readonly at: CivilDateTime;
  readonly by: string;
}

/** Entries in time order. Only `logDose` adds to it, so every entry passed the guard. */
export interface Log {
  readonly entries: readonly Entry[];
  readonly nextId: number;
}

export const emptyLog: Log = { entries: [], nextId: 0 };

/** Rebuilds a log from stored entries, keeping ids unique for what's logged next. */
export function logFromEntries(entries: readonly Entry[]): Log {
  const sorted = [...entries].sort((a, b) => a.at - b.at || a.id - b.id);
  const nextId = sorted.reduce((n, e) => Math.max(n, e.id + 1), 0);
  return { entries: sorted, nextId };
}

/** The entry fulfilling `med`'s `slot` on `day`, if any. */
export function findEntry(log: Log, med: MedId, slot: SlotId, day: CivilDate): Entry | undefined {
  return log.entries.find((e) => e.med === med && e.slot === slot && e.day === day);
}

/** `med`'s latest dose given at or before `now`. */
export function lastFor(log: Log, med: MedId, now: CivilDateTime): Entry | undefined {
  let best: Entry | undefined;
  for (const e of log.entries) {
    if (e.med === med && e.at <= now && (!best || e.at > best.at)) best = e;
  }
  return best;
}

/** The most recently logged entry: what "Undo" takes back. */
export function lastLogged(log: Log): Entry | undefined {
  let best: Entry | undefined;
  for (const e of log.entries) if (!best || e.id > best.id) best = e;
  return best;
}

/** Internal to the domain: callers go through `logDose`. */
export function push(log: Log, e: Omit<Entry, 'id'>): { log: Log; id: EntryId } {
  const id = log.nextId as EntryId;
  return { log: { entries: [...log.entries, { ...e, id }], nextId: log.nextId + 1 }, id };
}

/** Removes an entry (a mistaken tap). Ids are never reused. */
export function undo(log: Log, id: EntryId): Log {
  return { ...log, entries: log.entries.filter((e) => e.id !== id) };
}

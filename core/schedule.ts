/** The schedule: meds, their daily slots, the on-time window and the caregivers. */

import {
  at,
  type CivilDate,
  type CivilDateTime,
  type CivilTime,
  formatTimeISO,
  parseTime,
  time,
} from './civil.ts';
import { err, ok, type Result } from './result.ts';

declare const brand: unique symbol;
/** A med's stable id (`"insulin"`), referenced by log entries. */
export type MedId = string & { readonly [brand]: 'MedId' };
/** A slot's id within its med (`"am"`). */
export type SlotId = string & { readonly [brand]: 'SlotId' };

export const medId = (s: string) => s as MedId;
export const slotId = (s: string) => s as SlotId;

/** Decides a med's icon and its default double-dose guard. */
export type MedKind = 'insulin' | 'pill' | 'liquid';

/**
 * Hours after a dose during which another dose of the same med is refused unless overridden.
 * Insulin given twice is the dangerous mistake, so it gets the widest guard.
 */
export function defaultGuardHours(kind: MedKind): number {
  switch (kind) {
    case 'insulin':
      return 8;
    case 'pill':
    case 'liquid':
      return 6;
  }
}

/** One daily time a med is given. */
export interface Slot {
  readonly id: SlotId;
  /** Shown on the card: "Morning", "Evening". */
  readonly label: string;
  readonly at: CivilTime;
}

export interface Med {
  readonly id: MedId;
  readonly name: string;
  readonly kind: MedKind;
  /** A short reminder on the card ("with food", "in Churu"). */
  readonly note?: string;
  readonly slots: readonly Slot[];
  /** Overrides {@link defaultGuardHours}. */
  readonly guardHours?: number;
}

export const guardHours = (m: Med): number => m.guardHours ?? defaultGuardHours(m.kind);

/** How far around a slot's time a dose counts as on time, in minutes. */
export interface Window {
  /** Minutes before the slot that it opens: earlier taps are refused. */
  readonly earlyMin: number;
  /** Minutes after the slot that it stays "due" before it reads "overdue". */
  readonly lateMin: number;
}

export interface Schedule {
  readonly pet: string;
  /** Who can log a dose; the first is the default. */
  readonly caregivers: readonly string[];
  readonly window: Window;
  readonly meds: readonly Med[];
}

export type ScheduleError =
  | { kind: 'noMeds' }
  | { kind: 'noCaregivers' }
  | { kind: 'duplicateMed'; med: string }
  | { kind: 'noSlots'; med: string }
  | { kind: 'duplicateSlot'; med: string; slot: string }
  | { kind: 'windowTooWide'; minutes: number }
  | { kind: 'parse'; message: string };

export function describeScheduleError(e: ScheduleError): string {
  switch (e.kind) {
    case 'noMeds':
      return 'the schedule has no meds';
    case 'noCaregivers':
      return 'the schedule has no caregivers';
    case 'duplicateMed':
      return `med id "${e.med}" appears more than once`;
    case 'noSlots':
      return `med "${e.med}" has no slots`;
    case 'duplicateSlot':
      return `med "${e.med}" has slot id "${e.slot}" more than once`;
    case 'windowTooWide':
      return `the on-time window (${e.minutes} min) must be shorter than 12 hours`;
    case 'parse':
      return `couldn't read the schedule: ${e.message}`;
  }
}

/**
 * Fry's routine: insulin every 12 hours and amlodipine in the morning. Times only; amounts
 * belong to the vet's instructions, not this app.
 */
export function fry(): Schedule {
  const slot = (id: string, label: string, t: CivilTime): Slot => ({ id: slotId(id), label, at: t });
  return {
    pet: 'Fry',
    caregivers: ['You', 'Jess'],
    window: { earlyMin: 60, lateMin: 60 },
    meds: [
      {
        id: medId('insulin'),
        name: 'Insulin',
        kind: 'insulin',
        note: 'after a meal',
        slots: [slot('am', 'Morning', time(7)), slot('pm', 'Evening', time(19))],
      },
      {
        id: medId('amlodipine'),
        name: 'Amlodipine',
        kind: 'liquid',
        note: 'in Churu',
        slots: [slot('am', 'Morning', time(7))],
      },
    ],
  };
}

/**
 * Checks the rules the rest of the domain relies on: unique ids, at least one med, slot and
 * caregiver, and an on-time window shorter than the 12 hours between doses.
 */
export function validate(s: Schedule): Result<Schedule, ScheduleError> {
  if (s.meds.length === 0) return err({ kind: 'noMeds' });
  if (s.caregivers.length === 0) return err({ kind: 'noCaregivers' });
  const wide = s.window.earlyMin + s.window.lateMin;
  if (wide >= 12 * 60) return err({ kind: 'windowTooWide', minutes: wide });
  const meds = new Set<MedId>();
  for (const med of s.meds) {
    if (meds.has(med.id)) return err({ kind: 'duplicateMed', med: med.id });
    meds.add(med.id);
    if (med.slots.length === 0) return err({ kind: 'noSlots', med: med.id });
    const slots = new Set<SlotId>();
    for (const slot of med.slots) {
      if (slots.has(slot.id)) return err({ kind: 'duplicateSlot', med: med.id, slot: slot.id });
      slots.add(slot.id);
    }
  }
  return ok(s);
}

/** The JSON shape a schedule is written in: times as `"07:00"`. */
interface ScheduleJson {
  pet: string;
  caregivers: string[];
  window?: { early_min: number; late_min: number };
  meds: {
    id: string;
    name: string;
    kind: MedKind;
    note?: string;
    guard_hours?: number;
    slots: { id: string; label: string; at: string }[];
  }[];
}

/** Parses and validates a schedule written as JSON (the same format the Rune app reads). */
export function scheduleFromJson(json: string): Result<Schedule, ScheduleError> {
  let raw: ScheduleJson;
  try {
    raw = JSON.parse(json) as ScheduleJson;
  } catch (e) {
    return err({ kind: 'parse', message: (e as Error).message });
  }
  const meds: Med[] = [];
  for (const m of raw.meds ?? []) {
    if (!['insulin', 'pill', 'liquid'].includes(m.kind)) {
      return err({ kind: 'parse', message: `unknown kind "${String(m.kind)}"` });
    }
    const slots: Slot[] = [];
    for (const s of m.slots ?? []) {
      const t = parseTime(s.at.slice(0, 5));
      if (t === undefined) return err({ kind: 'parse', message: `bad time "${s.at}"` });
      slots.push({ id: slotId(s.id), label: s.label, at: t });
    }
    meds.push({
      id: medId(m.id),
      name: m.name,
      kind: m.kind,
      ...(m.note !== undefined && { note: m.note }),
      ...(m.guard_hours !== undefined && { guardHours: m.guard_hours }),
      slots,
    });
  }
  return validate({
    pet: raw.pet,
    caregivers: raw.caregivers ?? [],
    window: raw.window
      ? { earlyMin: raw.window.early_min, lateMin: raw.window.late_min }
      : { earlyMin: 60, lateMin: 60 },
    meds,
  });
}

export function scheduleToJson(s: Schedule): string {
  const raw: ScheduleJson = {
    pet: s.pet,
    caregivers: [...s.caregivers],
    window: { early_min: s.window.earlyMin, late_min: s.window.lateMin },
    meds: s.meds.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      ...(m.note !== undefined && { note: m.note }),
      ...(m.guardHours !== undefined && { guard_hours: m.guardHours }),
      slots: m.slots.map((sl) => ({ id: sl.id, label: sl.label, at: `${formatTimeISO(sl.at)}:00` })),
    })),
  };
  return JSON.stringify(raw, null, 2);
}

export const findMed = (s: Schedule, id: MedId) => s.meds.find((m) => m.id === id);
export const findSlot = (m: Med, id: SlotId) => m.slots.find((sl) => sl.id === id);

export interface Occurrence {
  readonly med: Med;
  readonly slot: Slot;
  readonly at: CivilDateTime;
}

/** Every (med, slot, scheduled time) on `day`, earliest first; ties keep schedule order. */
export function occurrences(s: Schedule, day: CivilDate): Occurrence[] {
  return s.meds
    .flatMap((med) => med.slots.map((slot) => ({ med, slot, at: at(day, slot.at) })))
    .sort((a, b) => a.at - b.at); // Array.prototype.sort is stable.
}

/** Doses expected on one day. */
export const perDay = (s: Schedule): number => s.meds.reduce((n, m) => n + m.slots.length, 0);

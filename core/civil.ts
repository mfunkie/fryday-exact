/**
 * Wall-clock ("civil") dates and times with no time zone, the TypeScript stand-in for `jiff::civil`.
 *
 * A `CivilDateTime` is whole minutes since 1970-01-01 00:00 on the wall clock, so ordering and
 * arithmetic are plain number operations, and nothing here can read the system clock.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** `"2026-11-06"`. */
export type CivilDate = Brand<string, 'CivilDate'>;
/** Minutes since midnight, 0..1439. */
export type CivilTime = Brand<number, 'CivilTime'>;
/** Minutes since 1970-01-01 00:00, wall clock. */
export type CivilDateTime = Brand<number, 'CivilDateTime'>;

const DAY = 24 * 60;

export function time(h: number, m = 0): CivilTime {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new RangeError(`invalid time ${h}:${m}`);
  }
  return (h * 60 + m) as CivilTime;
}

export function date(y: number, mo: number, d: number): CivilDate {
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`invalid date ${y}-${mo}-${d}`);
  }
  return back.toISOString().slice(0, 10) as CivilDate;
}

function dayNumber(d: CivilDate): number {
  return Date.parse(`${d}T00:00:00Z`) / 86_400_000;
}

function fromDayNumber(n: number): CivilDate {
  return new Date(n * 86_400_000).toISOString().slice(0, 10) as CivilDate;
}

export function at(d: CivilDate, t: CivilTime): CivilDateTime {
  return (dayNumber(d) * DAY + t) as CivilDateTime;
}

export function dateOf(dt: CivilDateTime): CivilDate {
  return fromDayNumber(Math.floor(dt / DAY));
}

export function timeOf(dt: CivilDateTime): CivilTime {
  return (((dt % DAY) + DAY) % DAY) as CivilTime;
}

export function addDays(d: CivilDate, n: number): CivilDate {
  return fromDayNumber(dayNumber(d) + n);
}

export const tomorrow = (d: CivilDate): CivilDate => addDays(d, 1);
export const yesterday = (d: CivilDate): CivilDate => addDays(d, -1);

export function addMinutes(dt: CivilDateTime, m: number): CivilDateTime {
  return (dt + m) as CivilDateTime;
}

/** Whole minutes from `from` to `to`, negative when `to` is earlier. */
export function minutesBetween(from: CivilDateTime, to: CivilDateTime): number {
  return to - from;
}

/** Monday 0 … Sunday 6. */
export function weekday(d: CivilDate): number {
  return (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Parses `"2026-11-06"`; `undefined` when it isn't a real date. */
export function parseDate(s: string): CivilDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  try {
    return date(Number(m[1]), Number(m[2]), Number(m[3]));
  } catch {
    return undefined;
  }
}

/** Parses `"07:00"`. */
export function parseTime(s: string): CivilTime | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return undefined;
  try {
    return time(Number(m[1]), Number(m[2]));
  } catch {
    return undefined;
  }
}

export function formatTimeISO(t: CivilTime): string {
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `"2026-11-06T19:04:00"`, the stored form of a date-time (what `jiff` writes). */
export function toISO(dt: CivilDateTime): string {
  return `${dateOf(dt)}T${formatTimeISO(timeOf(dt))}:00`;
}

export function parseDateTime(s: string): CivilDateTime | undefined {
  const [d, t] = s.split('T');
  const day = d === undefined ? undefined : parseDate(d);
  const tm = t === undefined ? undefined : parseTime(t.slice(0, 5));
  return day === undefined || tm === undefined ? undefined : at(day, tm);
}

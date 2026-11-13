import { type CivilDate, type CivilTime, weekday } from './civil.ts';

/** "2h 05m", "45m", "0m": a compact duration for countdowns. Negative input reads as its size. */
export function formatMinutes(mins: number): string {
  const m = Math.abs(Math.trunc(mins));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m % 60}m` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "7:05 AM": a 12-hour clock time. */
export function formatTime(t: CivilTime): string {
  const h = Math.floor(t / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(t % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "Friday, November 6". */
export function longDate(d: CivilDate): string {
  const [, mo, day] = d.split('-').map(Number) as [number, number, number];
  return `${DAYS[weekday(d)]}, ${MONTHS[mo - 1]} ${day}`;
}

/**
 * The view model: everything the screen shows, worked out from the schedule, the log and `now`.
 * The Rune app computes this inside its views (`hero.rs` `face()`, `cards.rs`); here it is one
 * pure function the data module answers with, so the Contract view only places and paints it,
 * and every word on screen is unit-testable without a renderer.
 */

import { type CivilDateTime, dateOf, minutesBetween, timeOf } from './civil.ts';
import { formatMinutes, formatTime, longDate } from './format.ts';
import { guard } from './guard.ts';
import { fraction, history, isComplete, streak } from './history.ts';
import { lastLogged, type Log } from './log.ts';
import { findMed, type Schedule } from './schedule.ts';
import { type Dose, isOpen, nextUp, plan } from './status.ts';

/** Accent colours, named as `app.tamber` names them. */
export type Tone = 'tangerine' | 'amber' | 'mint' | 'ember' | 'muted';

/** What the orb says. */
export interface Face {
  eyebrow: string;
  big: string;
  caption: string;
  detail: string;
  tone: Tone;
  /** The ring's metal: gold while waiting, chrome when all is done, rose when it needs a look. */
  metal: 'gold' | 'chrome' | 'rose';
  /** Rings pulse out while a dose wants attention. */
  pulse: boolean;
}

/** One dose's card. */
export interface Card {
  /** `insulin-am-2026-11-06`: the card's and its button's key. */
  key: string;
  med: string;
  slot: string;
  day: string;
  name: string;
  kind: 'insulin' | 'pill' | 'liquid';
  /** "Morning · 7:00 AM · after a meal", or "Last night · 7:00 PM · …". */
  subtitle: string;
  /** "due now", "1h 40m late", "given", "upcoming", "missed". */
  words: string;
  tone: Tone;
  /** What the card's end holds. */
  state: 'give' | 'late' | 'given' | 'upcoming' | 'missed';
  givenBy: string;
  givenAt: string;
  /** The upcoming chip: "in 10h 40m". */
  chip: string;
  /** The hero's dose, open: it glows. */
  next: boolean;
  /** The guard's question, when this card is waiting for a second tap. */
  guard: string;
}

export interface Dot {
  day: string;
  /** "full", "partial", "empty". */
  fill: 'full' | 'partial' | 'empty';
  fraction: number;
}

export interface Board {
  dateLine: string;
  caregivers: string[];
  face: Face;
  cards: Card[];
  streak: number;
  dots: Dot[];
  /** "Undo insulin" while the last dose was logged in the last two hours, else "". */
  undo: string;
  /** The hero's dose is late: the backdrop warms to coral. */
  late: boolean;
}

export const cardKey = (d: Pick<Dose, 'med' | 'slot' | 'day'>) => `${d.med}-${d.slot}-${d.day}`;

/** Today's doses, preceded by last night's while it's still open (after midnight). */
export function doses(s: Schedule, log: Log, now: CivilDateTime): Dose[] {
  const today = dateOf(now);
  const yesterday = plan(s, log, dateOf((now - 24 * 60) as CivilDateTime), now).filter((d) => isOpen(d.status));
  return [...yesterday, ...plan(s, log, today, now)];
}

function statusWords(d: Dose): string {
  switch (d.status.kind) {
    case 'upcoming':
      return 'upcoming'; // the card's chip already counts down to the window
    case 'due':
      return 'due now';
    case 'overdue':
      return `${formatMinutes(d.status.minutesLate)} late`;
    case 'given':
      return 'given';
    case 'missed':
      return 'missed';
  }
}

function face(s: Schedule, log: Log, now: CivilDateTime, all: Dose[], next: Dose | undefined, pending: Card | undefined): Face {
  if (!next) {
    return { eyebrow: 'ALL SET', big: '—', caption: 'No doses scheduled', detail: '', tone: 'mint', metal: 'chrome', pulse: false };
  }
  if (pending) {
    const g = guard(s, log, pending.med as Dose['med'], now);
    if (g.kind === 'recent') {
      return {
        eyebrow: 'CHECK FIRST',
        big: formatMinutes(g.minutesAgo),
        caption: `since ${g.entry.by} gave ${pending.name.toLowerCase()}`,
        detail: `at ${formatTime(timeOf(g.entry.at))}`,
        tone: 'ember',
        metal: 'rose',
        pulse: true,
      };
    }
  }
  const name = `${next.slotLabel} ${next.medName.toLowerCase()}`;
  const when = formatTime(timeOf(next.scheduled));
  const allDone = all.every((d) => d.status.kind === 'given' || d.status.kind === 'missed');
  const tomorrow = next.day > dateOf(now);
  switch (next.status.kind) {
    case 'overdue':
      return { eyebrow: 'LATE', big: formatMinutes(next.status.minutesLate), caption: name, detail: `was due ${when}`, tone: 'ember', metal: 'rose', pulse: true };
    case 'due':
      return { eyebrow: 'DUE NOW', big: 'Now', caption: name, detail: when, tone: 'tangerine', metal: 'gold', pulse: true };
    default: {
      const big = formatMinutes(minutesBetween(now, next.scheduled));
      return allDone || tomorrow
        ? { eyebrow: 'ALL DONE TODAY', big, caption: `until ${name.toLowerCase()}`, detail: `${when} tomorrow`, tone: 'mint', metal: 'chrome', pulse: false }
        : { eyebrow: 'NEXT UP', big, caption: `until ${name.toLowerCase()}`, detail: when, tone: 'amber', metal: 'gold', pulse: false };
    }
  }
}

/**
 * The board at `now`. `pendingKey` names the card whose Give the guard refused and that waits for
 * a deliberate second tap ("" for none); a key that no longer needs confirming is ignored.
 */
export function board(s: Schedule, log: Log, now: CivilDateTime, pendingKey: string): Board {
  const today = dateOf(now);
  const all = doses(s, log, now);
  const next = nextUp(s, log, now);
  const isNext = (d: Dose) => !!next && cardKey(d) === cardKey(next);
  const cards: Card[] = all.map((d) => {
    const key = cardKey(d);
    const note = d.note ? ` · ${d.note}` : '';
    const label = d.day < today ? 'Last night' : d.slotLabel;
    const st = d.status;
    const g = isOpen(st) && key === pendingKey ? guard(s, log, d.med, now) : undefined;
    return {
      key,
      med: d.med,
      slot: d.slot,
      day: d.day,
      name: d.medName,
      kind: d.kind,
      subtitle: `${label} · ${formatTime(timeOf(d.scheduled))}${note}`,
      words: statusWords(d),
      tone: st.kind === 'due' ? 'tangerine' : st.kind === 'given' ? 'mint' : st.kind === 'upcoming' ? 'muted' : 'ember',
      state: st.kind === 'due' ? 'give' : st.kind === 'overdue' ? 'late' : st.kind,
      givenBy: st.kind === 'given' ? st.entry.by : '',
      givenAt: st.kind === 'given' ? formatTime(timeOf(st.entry.at)) : '',
      chip: st.kind === 'upcoming' ? `in ${formatMinutes(st.opensIn)}` : '',
      next: isNext(d) && isOpen(st),
      guard:
        g?.kind === 'recent'
          ? `${d.medName} was given ${formatMinutes(g.minutesAgo)} ago by ${g.entry.by}. Two doses this close together can be dangerous: give again only if you're sure it was missed.`
          : '',
    };
  });
  const pending = cards.find((c) => c.guard !== '');
  const last = lastLogged(log);
  const recent = last && minutesBetween(last.at, now) >= 0 && minutesBetween(last.at, now) < 120;
  return {
    dateLine: `${s.pet} · ${longDate(today)}`,
    caregivers: [...s.caregivers],
    face: face(s, log, now, all, next, pending),
    cards,
    streak: streak(s, log, now),
    dots: history(s, log, today, 14).map((r) => ({
      day: r.day,
      fill: isComplete(r) ? 'full' : r.given > 0 ? 'partial' : 'empty',
      fraction: fraction(r),
    })),
    undo: recent ? `Undo ${(findMed(s, last.med)?.name ?? 'dose').toLowerCase()}` : '',
    late: next?.status.kind === 'overdue',
  };
}

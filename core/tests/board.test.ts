/**
 * The view model, scene by scene: every word the orb and cards show, without a renderer. These
 * pin the same states the Rune app's snapshot goldens pin, as text.
 */

import { expect, test } from 'bun:test';

import { board, fry, SCENES, type SceneName } from '../index.ts';

const s = fry();
const at = (name: SceneName, pending = '') => {
  const sc = SCENES[name](s);
  return board(s, sc.log, sc.now, pending);
};

test('every scene builds through logDose without a refusal', () => {
  for (const name of Object.keys(SCENES) as SceneName[]) expect(() => SCENES[name](s)).not.toThrow();
});

test('morning: the orb is gold, due now, pulsing; an 11-day streak with one gap', () => {
  const b = at('morning');
  expect(b.face).toEqual({
    eyebrow: 'DUE NOW', big: 'Now', caption: 'Morning insulin', detail: '7:00 AM', tone: 'tangerine', metal: 'gold', pulse: true,
  });
  expect(b.cards.map((c) => [c.key, c.state, c.words])).toEqual([
    ['insulin-am-2026-11-06', 'give', 'due now'],
    ['amlodipine-am-2026-11-06', 'give', 'due now'],
    ['insulin-pm-2026-11-06', 'upcoming', 'upcoming'],
  ]);
  expect(b.cards[0]!.next).toBe(true);
  expect(b.cards[2]!.chip).toBe('in 10h 40m');
  expect(b.streak).toBe(11);
  expect(b.dots.map((d) => d.fill[0]).join('')).toBe('fefffffffffffe'); // the gap 12 days back; today in progress, not yet full
  expect(b.undo).toBe('');
});

test('afternoon: next up is the evening insulin, amber, still', () => {
  const b = at('afternoon');
  expect(b.face).toMatchObject({ eyebrow: 'NEXT UP', big: '5h 55m', caption: 'until evening insulin', tone: 'amber', pulse: false });
  expect(b.cards.slice(0, 2).map((c) => [c.givenBy, c.givenAt])).toEqual([['Jess', '7:12 AM'], ['Jess', '7:14 AM']]);
});

test('guard: a pending second tap turns the orb rose and the card asks', () => {
  const b = at('guard', 'insulin-pm-2026-11-06');
  expect(b.face).toMatchObject({ eyebrow: 'CHECK FIRST', big: '5h 32m', caption: 'since Jess gave insulin', detail: 'at 1:30 PM', metal: 'rose' });
  expect(b.cards[2]!.guard).toBe(
    "Insulin was given 5h 32m ago by Jess. Two doses this close together can be dangerous: give again only if you're sure it was missed.",
  );
  expect(at('guard').cards[2]!.guard).toBe(''); // only after a refused tap
});

test('a stale pending key is ignored', () => {
  expect(at('morning', 'insulin-pm-2026-11-06').face.eyebrow).toBe('DUE NOW');
});

test('late: ember backdrop, the card says how late', () => {
  const b = at('late');
  expect(b.late).toBe(true);
  expect(b.face).toMatchObject({ eyebrow: 'LATE', big: '1h 40m', detail: 'was due 7:00 PM', tone: 'ember' });
  expect(b.cards[2]).toMatchObject({ state: 'late', words: '1h 40m late', tone: 'ember' });
});

test('done: chrome, tomorrow next, the streak includes today, undo offered', () => {
  const b = at('done');
  expect(b.face).toMatchObject({ eyebrow: 'ALL DONE TODAY', big: '11h 54m', detail: '7:00 AM tomorrow', metal: 'chrome' });
  expect(b.streak).toBe(12);
  expect(b.undo).toBe('Undo insulin');
});

test('midnight: last night’s open dose comes first and keeps the streak', () => {
  const b = at('midnight');
  expect(b.dateLine).toBe('Fry · Saturday, November 7');
  expect(b.cards[0]).toMatchObject({ key: 'insulin-pm-2026-11-06', subtitle: 'Last night · 7:00 PM · after a meal', state: 'late' });
  expect(b.cards).toHaveLength(4);
  expect(b.streak).toBe(11);
});

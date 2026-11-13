// What the view asks for. Each source answers exactly its shape in ui/shapes.contract; the
// build type-checks that. Exact refuses the clock here, so `now` always arrives as an argument.
import type { Result, Sources } from '../app.contract.d.ts';
import { board, lastLogged, logDose, medId, parseDate, slotId, undo } from '../core/index.ts';
import { load, nowFor, save, schedule } from './storage.ts';

type Reply = Result<'giveDose'>;
const reply = (outcome: Reply['outcome'], notice = ''): Reply => ({ ok: outcome === 'logged' || outcome === 'undone', outcome, notice });

export const sources: Sources = {
  loadBoard: async ([scene, utcOffset, pendingKey, ms], _store, storage) =>
    board(schedule, await load(storage, scene), nowFor(scene, ms, utcOffset), pendingKey) as Result<'loadBoard'>,

  /** A tap on Give. The first tap inside the guard hours is refused as `tooSoon`; the view asks, and a second tap confirms. */
  giveDose: async ([scene, med, slot, day, ms, utcOffset, by, confirmed], _store, storage) => {
    const d = parseDate(day);
    if (!d) return reply('refused', 'That dose isn’t in the schedule.');
    const log = await load(storage, scene);
    const r = logDose(schedule, log, { med: medId(med), slot: slotId(slot), day: d }, nowFor(scene, ms, utcOffset), by, confirmed);
    if (r.ok) {
      await save(storage, scene, r.value.log);
      return reply('logged');
    }
    switch (r.error.kind) {
      case 'tooSoon':
        return reply('tooSoon');
      case 'alreadyLogged':
        return reply('refused', `Already logged by ${r.error.entry.by}.`);
      case 'notOpenYet':
        return reply('refused', 'Not yet: this dose’s window hasn’t opened.');
      case 'closed':
        return reply('refused', 'This dose’s window has closed.');
      case 'unknownDose':
        return reply('refused', 'That dose isn’t in the schedule.');
    }
  },

  /** Takes back the most recent entry. */
  undoLast: async ([scene], _store, storage) => {
    const log = await load(storage, scene);
    const last = lastLogged(log);
    if (!last) return reply('refused', 'Nothing to undo.');
    await save(storage, scene, undo(log, last.id));
    return reply('undone');
  },
};

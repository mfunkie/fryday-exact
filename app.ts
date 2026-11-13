// Fryday's data module: the log in a JSON file (the Rune app's format), and the board the view
// shows, worked out by `core/` from the log and the instant the view passes. Exact refuses the
// clock here, so `now` always arrives as an argument, which is the Rune app's rule too.
import type { Answer, Result, Sources, Storage } from './app.contract.d.ts';
import {
  type CivilDateTime,
  type Log,
  board,
  describeStoreError,
  emptyLog,
  fry,
  isScene,
  lastLogged,
  logDose,
  logFromJson,
  logToJson,
  medId,
  parseDate,
  SCENES,
  slotId,
  undo,
} from './core/index.ts';

export const grants = 'fs.read app:/data\nfs.write app:/data';

const schedule = fry();

/** A real instant, as the view has it, on the person's wall clock. */
const civil = (ms: number, utcOffset: number) => (Math.floor(ms / 60_000) + utcOffset) as CivilDateTime;

/** Where a log lives: the real one, or a scene's own copy, so a screenshot never touches real data. */
const file = (scene: string) => (scene === '' ? 'app:/data/log.json' : `app:/data/scene-${scene}.json`);

/** The instant the board is drawn at: a scene pins its own. */
function nowFor(scene: string, ms: number, utcOffset: number): CivilDateTime {
  return isScene(scene) ? SCENES[scene](schedule).now : civil(ms, utcOffset);
}

async function load(storage: Storage, scene: string): Promise<Log> {
  let bytes: ArrayBuffer;
  try {
    bytes = await storage.fs.readFile(file(scene));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOENT') return isScene(scene) ? SCENES[scene](schedule).log : emptyLog;
    throw e; // 'bake' (the build) passes through
  }
  const parsed = logFromJson(new TextDecoder().decode(bytes));
  if (!parsed.ok) throw new Error(describeStoreError(parsed.error)); // fails the resource; its last answer stays
  return parsed.value;
}

const save = (storage: Storage, scene: string, log: Log) =>
  storage.fs.atomicWriteFile(file(scene), new TextEncoder().encode(logToJson(log)));

type Reply = Result<'giveDose'>;
const reply = (outcome: Reply['outcome'], notice = ''): Reply => ({ ok: outcome === 'logged' || outcome === 'undone', outcome, notice });

const sources: Sources = {
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

export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);

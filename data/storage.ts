// The log on disk: one JSON file in the Rune app's format, or a scene's own copy, so a screenshot
// or test that opens `/?scene=…` never touches the real log.
import type { Storage } from '../app.contract.d.ts';
import { type CivilDateTime, describeStoreError, emptyLog, fry, isScene, type Log, logFromJson, logToJson, SCENES } from '../core/index.ts';

export const schedule = fry();

const file = (scene: string) => (scene === '' ? 'app:/data/log.json' : `app:/data/scene-${scene}.json`);

/** A real instant, as the view has it, on the person's wall clock; a scene pins its own. */
export function nowFor(scene: string, ms: number, utcOffset: number): CivilDateTime {
  return isScene(scene) ? SCENES[scene](schedule).now : ((Math.floor(ms / 60_000) + utcOffset) as CivilDateTime);
}

export async function load(storage: Storage, scene: string): Promise<Log> {
  let bytes: ArrayBuffer;
  try {
    bytes = await storage.fs.readFile(file(scene));
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return isScene(scene) ? SCENES[scene](schedule).log : emptyLog;
    throw e; // 'bake' (the build) passes through
  }
  const parsed = logFromJson(new TextDecoder().decode(bytes));
  if (!parsed.ok) throw new Error(describeStoreError(parsed.error)); // fails the resource; its last answer stays
  return parsed.value;
}

export const save = (storage: Storage, scene: string, log: Log) =>
  storage.fs.atomicWriteFile(file(scene), new TextEncoder().encode(logToJson(log)));

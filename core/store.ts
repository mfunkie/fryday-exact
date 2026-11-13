/**
 * Versioned JSON for the log: the same document the Rune app writes, so a log moves between
 * the two apps. Pure: reading and writing storage happens in `src/shell/storage.ts`.
 */

import { parseDate, parseDateTime, toISO } from './civil.ts';
import { type Entry, type EntryId, type Log, logFromEntries } from './log.ts';
import { err, ok, type Result } from './result.ts';
import { medId, slotId } from './schedule.ts';

/** The schema version this build writes and reads. */
export const VERSION = 1;

export type StoreError = { kind: 'malformed'; message: string } | { kind: 'tooNew'; version: number };

export function describeStoreError(e: StoreError): string {
  return e.kind === 'malformed'
    ? `the log is malformed: ${e.message}`
    : `the log was written by a newer Fryday (schema v${e.version}); this build reads v${VERSION}`;
}

interface EntryJson {
  id: number;
  med: string;
  slot: string;
  day: string;
  at: string;
  by: string;
}

export function logToJson(log: Log): string {
  const entries: EntryJson[] = log.entries.map((e) => ({
    id: e.id,
    med: e.med,
    slot: e.slot,
    day: e.day,
    at: toISO(e.at),
    by: e.by,
  }));
  return JSON.stringify({ version: VERSION, entries }, null, 2);
}

export function logFromJson(json: string): Result<Log, StoreError> {
  let doc: { version?: unknown; entries?: unknown };
  try {
    doc = JSON.parse(json) as typeof doc;
  } catch (e) {
    return err({ kind: 'malformed', message: (e as Error).message });
  }
  if (typeof doc.version !== 'number' || !Array.isArray(doc.entries)) {
    return err({ kind: 'malformed', message: 'missing version or entries' });
  }
  if (doc.version > VERSION) return err({ kind: 'tooNew', version: doc.version });
  const entries: Entry[] = [];
  for (const raw of doc.entries as EntryJson[]) {
    const day = parseDate(raw.day);
    const at = parseDateTime(raw.at);
    if (day === undefined || at === undefined || typeof raw.id !== 'number') {
      return err({ kind: 'malformed', message: `bad entry ${JSON.stringify(raw)}` });
    }
    entries.push({ id: raw.id as EntryId, med: medId(raw.med), slot: slotId(raw.slot), day, at, by: raw.by });
  }
  return ok(logFromEntries(entries));
}

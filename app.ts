// Fryday's data module: Exact's entry point. The sources live in data/, the domain in core/.
import type { Answer } from './app.contract.d.ts';
import { sources } from './data/sources.ts';

// What the module may touch, read at build without running it: the log files under app:/data.
export const grants = 'fs.read app:/data\nfs.write app:/data';
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);

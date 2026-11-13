/**
 * The rules that keep the domain testable, as the Rune app's scripts/guard.sh keeps them: nothing
 * in `core/` reads the clock, randomness or I/O, or knows about Exact. (Exact already refuses the
 * clock and randomness in the data module at run time; this fails the build first.)
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..');
const FORBIDDEN: [RegExp, string][] = [
  [/Date\.now\(|new Date\(\s*\)|performance\.now|performanceNow/, 'reads the clock'],
  [/Math\.random/, 'reads randomness'],
  [/from ['"](node:|fs|path)|storage\.fs|fetch\(/, 'does I/O'],
  [/app\.contract|exact:/, 'knows about the view'],
];

test('core/ is pure: no clock, randomness, I/O or view', () => {
  const findings: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      for (const [re, why] of FORBIDDEN) if (re.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) findings.push(`core/${f}:${i + 1} ${why}: ${line.trim()}`);
    });
  }
  expect(findings).toEqual([]);
});

test('no core file grows past 300 lines', () => {
  const long = readdirSync(dir).filter((n) => n.endsWith('.ts')).filter((f) => readFileSync(join(dir, f), 'utf8').split('\n').length > 300);
  expect(long).toEqual([]);
});

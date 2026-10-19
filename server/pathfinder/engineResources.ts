import fs from 'node:fs/promises';
import { PathFinderError } from './errors.js';

/** Sequential Linux /proc samples are a soft estimate, not an exact coincident peak. */
export async function residentBytes(pid: number): Promise<number> {
  const fail = (): never => { throw new PathFinderError('ENGINE_RSS_UNAVAILABLE', 502); };
  if (process.platform !== 'linux') return fail();
  const rows: Array<{ pid: number; parent: number }> = [];
  for (const name of await fs.readdir('/proc')) if (/^[1-9][0-9]*$/.test(name)) {
    try {
      const stat = await fs.readFile('/proc/' + name + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      rows.push({ pid: Number(name), parent: Number(fields[1]) });
    } catch (cause) { if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')) return fail(); }
  }
  const retained = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!retained.has(row.pid) && retained.has(row.parent)) { retained.add(row.pid); changed = true; }
  }
  let total = 0, root = false;
  for (const current of retained) {
    try {
      const status = await fs.readFile('/proc/' + current + '/status', 'utf8');
      const found = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
      if (found) { total += Number(found[1]) * 1024; if (current === pid) root = true; }
    } catch (cause) { if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')) return fail(); }
  }
  if (!root || !Number.isSafeInteger(total)) return fail();
  return total;
}
export type PreparationEngineObservation = { mode: 'oneshot'; thresholdBytes: number; intervalMilliseconds: number;
  observedMaximumBytes: number; samples: number; wallMilliseconds: number; exactPeak: false; outcome: 'completed' | 'refused' };
const observations = new Map<string, PreparationEngineObservation>();
export function retainPreparationEngineObservation(requestId: string, value: PreparationEngineObservation): void {
  observations.set(requestId, Object.freeze({ ...value }));
  while (observations.size > 16) observations.delete(observations.keys().next().value!);
}
export function preparationEngineObservation(requestId: string): PreparationEngineObservation | null {
  return observations.get(requestId) ?? null;
}

import fs from 'node:fs/promises';
import { canonical, sha256, parseOutput, fail, parseStat, rssBytes } from '../pathfinder-capacity/lib.mjs';
export { canonical, sha256, parseOutput, fail };

/** Full decoded DTO parity. Arrays and all numeric points retain their original order/value. */
export function semantic(value) {
  const result = structuredClone(value);
  delete result.requestId;
  if (result.prepared && typeof result.prepared === 'object') delete result.prepared.loadedFromDisk;
  return result;
}
export const digest = value => sha256(canonical(semantic(value)));
export function validateCorpus(value) {
  if (value?.schemaVersion !== 'pathfinder.runner.session.corpus.v1' || !Array.isArray(value.cases) || value.cases.length !== 31) fail('SESSION_CORPUS_INVALID');
  const labels = new Set();
  for (const item of value.cases) {
    if (typeof item.label !== 'string' || !item.label || labels.has(item.label) || item.request?.schemaVersion !== 'pathfinder.model.runner.v1' || typeof item.request.timeoutMilliseconds !== 'number') fail('SESSION_CORPUS_INVALID');
    labels.add(item.label);
  }
  return value;
}
/** Sequential /proc reads form a sampled estimate; short peaks and atomic tree RSS are unproved. */
export async function processRows() {
  const rows = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const stat = parseStat(await fs.readFile('/proc/' + name + '/stat', 'utf8'));
      const bytes = rssBytes(await fs.readFile('/proc/' + name + '/status', 'utf8'));
      rows.push({ ...stat, rssBytes: bytes });
    } catch { /* A process may exit between reads. */ }
  }
  return rows;
}
export function descendants(rows, root) {
  const ids = new Set([root]);
  for (let changed = true; changed;) { changed = false; for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  return rows.filter(row => ids.has(row.pid) && row.state !== 'Z');
}
export async function groupGone(pid) { return !(await processRows()).some(row => row.group === pid && row.state !== 'Z'); }
export async function waitGone(pid, milliseconds = 11000) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) { if (await groupGone(pid)) return true; await new Promise(resolve => setTimeout(resolve, 40)); }
  return await groupGone(pid);
}
export function equality(a, b) { return canonical(semantic(a)) === canonical(semantic(b)); }
export function classifyError(error) { return typeof error?.code === 'string' ? error.code : error?.name ?? 'ERROR'; }
/** The agreed durable-batch boundary permits a crash between individual items. */
export function unfinishedBatch(value, total = 64) {
  return value?.state === 'running' && value.total === total && Number.isInteger(value.completed) && value.completed >= 0 && value.completed < total &&
    Number.isInteger(value.attempts) && value.attempts >= 1 && ['completeItems','runningItems','waitingItems'].every(key=>Number.isInteger(value[key])&&value[key]>=0) &&
    value.completeItems + value.runningItems + value.waitingItems === total && value.runningItems + value.waitingItems > 0;
}
